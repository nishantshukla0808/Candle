'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api, ApiClientError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { DuelsDisclaimer } from '../disclaimer';

/**
 * Friend Challenge (Phase 12, docs/17) — invite-only start-mode for
 * the existing duels, not the friends system (doc 06).
 *
 * Create a challenge by opponent userId + duel type, list pending
 * incoming/outgoing invites with an expiry countdown, accept (the
 * duel starts at once, rated — the play page resumes it on load) or
 * decline. An invite link (/duels/challenge?code=…) opens the invite
 * for the invited player. No friend list, no chat, no profiles here.
 */

type ChallengeDuelType = 'LIVE' | 'BLITZ' | 'CASE' | 'CHART' | 'SPRINT' | 'CRISIS';

const DUEL_TYPES: Array<{ value: ChallengeDuelType; label: string; blurb: string }> = [
  { value: 'LIVE', label: 'Speed Quiz Duel', blurb: '7 questions, 15 sec each. Learning Rating.' },
  {
    value: 'BLITZ',
    label: 'Myth vs Fact Blitz',
    blurb: '10 rapid true/false, 10 sec each. Learning Rating.',
  },
  { value: 'CASE', label: 'Case Duel', blurb: '5 money cases, 45 sec each. Learning Rating.' },
  {
    value: 'CHART',
    label: 'Chart Detective',
    blurb: '5 fictional charts, 30 sec each. Learning Rating.',
  },
  {
    value: 'SPRINT',
    label: 'Paper Trading Sprint',
    blurb: '15 min, same fictional market. Trading Rating.',
  },
  { value: 'CRISIS', label: 'Crisis Duel', blurb: '15 min + a crash mid-duel. Trading Rating.' },
];

const PLAY_PATH: Record<ChallengeDuelType, string> = {
  LIVE: '/duels/live',
  BLITZ: '/duels/blitz',
  CASE: '/duels/case',
  CHART: '/duels/chart',
  SPRINT: '/duels/sprint',
  CRISIS: '/duels/crisis',
};

interface ChallengeView {
  id: string;
  duelType: ChallengeDuelType;
  rated: boolean;
  ratingKind: 'LEARNING' | 'TRADING';
  creator: { userId: string; displayName: string | null; rating: number };
  invitee: { userId: string; displayName: string | null; rating: number };
  status: string;
  inviteCode: string;
  inviteLink: string;
  duelId: string | null;
  playUrl: string | null;
  createdAt: string;
  expiresAt: string;
  expiresInMs: number;
}

function labelFor(type: ChallengeDuelType): string {
  return DUEL_TYPES.find((t) => t.value === type)?.label ?? type;
}

function countdown(expiresAt: string, nowMs: number): string {
  const ms = new Date(expiresAt).getTime() - nowMs;
  if (ms <= 0) return 'expired';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s left`;
}

function ChallengeCard({
  challenge,
  mine,
  nowMs,
  onAccept,
  onDecline,
  busy,
}: {
  challenge: ChallengeView;
  mine: 'incoming' | 'outgoing';
  nowMs: number;
  onAccept?: (id: string) => void;
  onDecline?: (id: string) => void;
  busy: boolean;
}): JSX.Element {
  const other = mine === 'incoming' ? challenge.creator : challenge.invitee;
  return (
    <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
      <p className="font-medium">
        {labelFor(challenge.duelType)} —{' '}
        {challenge.ratingKind === 'LEARNING' ? 'Learning' : 'Trading'} Rating
      </p>
      <p className="mt-1 text-sm text-slate-400">
        {mine === 'incoming' ? 'From' : 'To'} {other.displayName ?? 'Player'} (Rating {other.rating}
        ) · {countdown(challenge.expiresAt, nowMs)}
      </p>
      <p className="mt-1 text-sm text-slate-400">
        Rated — both Ratings are shown before accepting, so accepting is the opt-in. No stakes, no
        real money.
      </p>
      {mine === 'outgoing' && (
        <p className="mt-2 break-all text-sm">
          Invite link:{' '}
          <Link href={challenge.inviteLink} className="text-amber-300 underline">
            {challenge.inviteLink}
          </Link>
        </p>
      )}
      {mine === 'incoming' && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAccept?.(challenge.id)}
            className="rounded bg-amber-400 px-4 py-2 font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-50"
          >
            Accept — start the duel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecline?.(challenge.id)}
            className="rounded border border-slate-700 px-4 py-2 font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}
    </div>
  );
}

function ChallengePageInner(): JSX.Element {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const code = params.get('code');
  const [incoming, setIncoming] = useState<ChallengeView[]>([]);
  const [outgoing, setOutgoing] = useState<ChallengeView[]>([]);
  const [invited, setInvited] = useState<ChallengeView | null>(null);
  const [opponentId, setOpponentId] = useState('');
  const [duelType, setDuelType] = useState<ChallengeDuelType>('LIVE');
  const [created, setCreated] = useState<ChallengeView | null>(null);
  const [started, setStarted] = useState<{ duelId: string; playUrl: string } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (loading) return;
    if (!user) router.push('/login');
  }, [loading, user, router]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [inc, out] = await Promise.all([
        api<ChallengeView[]>('/challenges/incoming', { token: accessToken }),
        api<ChallengeView[]>('/challenges/outgoing', { token: accessToken }),
      ]);
      setIncoming(inc);
      setOutgoing(out);
      if (code) {
        try {
          const invite = await api<ChallengeView>(`/challenges/invite/${code}`, {
            token: accessToken,
          });
          setInvited(invite);
        } catch {
          setInvited(null);
          setError('That invite link is not for you, or it no longer exists.');
        }
      }
    } catch (e) {
      if (e instanceof ApiClientError) setError(e.message);
    }
  }, [accessToken, code]);

  useEffect(() => {
    if (loading || !user || !accessToken) return;
    void load();
  }, [loading, user, accessToken, load]);

  async function createChallenge(): Promise<void> {
    if (!accessToken) return;
    setError('');
    setMessage('');
    setCreated(null);
    setBusy(true);
    try {
      const view = await api<ChallengeView>('/challenges', {
        method: 'POST',
        token: accessToken,
        body: { opponentId: opponentId.trim(), duelType },
      });
      setCreated(view);
      setOutgoing((prev) => [view, ...prev]);
      setMessage('Challenge sent. Share the invite link with your opponent.');
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not send the challenge.');
    } finally {
      setBusy(false);
    }
  }

  async function accept(id: string): Promise<void> {
    if (!accessToken) return;
    setError('');
    setBusy(true);
    try {
      const res = await api<{ challenge: ChallengeView; duelId: string; playUrl: string }>(
        `/challenges/${id}/accept`,
        { method: 'POST', token: accessToken }
      );
      setStarted({ duelId: res.duelId, playUrl: res.playUrl });
      setIncoming((prev) => prev.filter((c) => c.id !== id));
      setInvited(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not accept the challenge.');
    } finally {
      setBusy(false);
    }
  }

  async function decline(id: string): Promise<void> {
    if (!accessToken) return;
    setError('');
    setBusy(true);
    try {
      await api<ChallengeView>(`/challenges/${id}/decline`, { method: 'POST', token: accessToken });
      setIncoming((prev) => prev.filter((c) => c.id !== id));
      setInvited(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not decline the challenge.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${link}`);
      setMessage('Invite link copied.');
    } catch {
      setMessage(`Invite link: ${window.location.origin}${link}`);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Friend Challenge</h1>
      <p className="mt-2 text-sm text-slate-400">
        Challenge one player to a duel — no queue, no random opponent. Pick a duel type, send the
        invite, and the duel starts the moment they accept. Every challenge is rated (your Ratings
        are shown on the invite, so accepting is the opt-in). Invites expire after 24 hours. There
        are no stakes and no real money — this is learning, not wagering.
      </p>

      {started && (
        <div className="mt-6 rounded border border-emerald-700 bg-emerald-950/50 p-4">
          <h2 className="font-medium">Duel started!</h2>
          <p className="mt-1 text-sm text-slate-300">
            Your opponent accepted. The countdown is already running — open the duel now.
          </p>
          <Link
            href={started.playUrl}
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Play the duel
          </Link>
        </div>
      )}

      {invited && invited.status === 'PENDING' && (
        <div className="mt-6">
          <h2 className="font-medium">You have been challenged</h2>
          <div className="mt-2">
            <ChallengeCard
              challenge={invited}
              mine="incoming"
              nowMs={nowMs}
              onAccept={(id) => void accept(id)}
              onDecline={(id) => void decline(id)}
              busy={busy}
            />
          </div>
        </div>
      )}

      <div className="mt-6 rounded border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="font-medium">Challenge a player</h2>
        <p className="mt-1 text-sm text-slate-400">
          Enter your opponent&apos;s user id — from a past duel, or one they shared with you. There
          is no friends list yet: challenges are by user id until Profiles + Settings arrives.
        </p>
        <label className="mt-3 block text-sm">
          Opponent user id
          <input
            value={opponentId}
            onChange={(e) => setOpponentId(e.target.value)}
            placeholder="e.g. 11111111-1111-4111-8111-111111111111"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
        </label>
        <label className="mt-3 block text-sm">
          Duel type
          <select
            value={duelType}
            onChange={(e) => setDuelType(e.target.value as ChallengeDuelType)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          >
            {DUEL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} — {t.blurb}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !opponentId.trim()}
          onClick={() => void createChallenge()}
          className="mt-4 rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send challenge'}
        </button>
        {created && (
          <div className="mt-3 rounded border border-slate-700 p-3 text-sm">
            <p>
              Invite link:{' '}
              <Link href={created.inviteLink} className="break-all text-amber-300 underline">
                {created.inviteLink}
              </Link>
            </p>
            <button
              type="button"
              onClick={() => void copyLink(created.inviteLink)}
              className="mt-2 rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
            >
              Copy invite link
            </button>
            <p className="mt-2 text-slate-400">
              Or open the {labelFor(created.duelType)} page — the duel starts when they accept:{' '}
              <Link href={PLAY_PATH[created.duelType]} className="text-amber-300 underline">
                {PLAY_PATH[created.duelType]}
              </Link>
            </p>
          </div>
        )}
      </div>

      {message && <p className="mt-4 text-sm text-emerald-300">{message}</p>}
      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

      <div className="mt-6 space-y-4">
        <h2 className="font-medium">Challenges for me ({incoming.length})</h2>
        {incoming.length === 0 && (
          <p className="text-sm text-slate-400">No pending challenges for you right now.</p>
        )}
        {incoming.map((c) => (
          <ChallengeCard
            key={c.id}
            challenge={c}
            mine="incoming"
            nowMs={nowMs}
            onAccept={(id) => void accept(id)}
            onDecline={(id) => void decline(id)}
            busy={busy}
          />
        ))}
      </div>

      <div className="mt-6 space-y-4">
        <h2 className="font-medium">Challenges I sent ({outgoing.length})</h2>
        {outgoing.length === 0 && (
          <p className="text-sm text-slate-400">You have no pending outgoing challenges.</p>
        )}
        {outgoing.map((c) => (
          <ChallengeCard key={c.id} challenge={c} mine="outgoing" nowMs={nowMs} busy={busy} />
        ))}
      </div>
      <DuelsDisclaimer />
    </main>
  );
}

export default function FriendChallengePage(): JSX.Element {
  return (
    <Suspense>
      <ChallengePageInner />
    </Suspense>
  );
}
