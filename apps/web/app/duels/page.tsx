import type { JSX } from 'react';
import Link from 'next/link';
import { DuelsDisclaimer } from './disclaimer';

/** Duels hub — Bot Duel (practice) and the rated Daily Duel. */
export default function DuelsPage(): JSX.Element {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Duels</h1>
      <p className="mt-2 text-sm text-slate-400">
        Short head-to-head quizzes — and three trading duels. Practise against Mira, play the rated
        Daily Duel once a day, meet a live opponent in Chart Detective, the Case Duel, the Myth vs
        Fact Blitz, or the Speed Quiz Duel, trade head-to-head for 15 minutes in the Paper Trading
        Sprint or the Crisis Duel, or trade all week in a league of 30 in the Weekly Portfolio
        Battle.
      </p>
      <div className="mt-6 space-y-4">
        <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Friend Challenge</h2>
          <p className="mt-1 text-sm text-slate-400">
            Challenge one player directly — no queue, no random opponent. Pick Speed Quiz, Blitz,
            Case Duel, Chart Detective, Sprint, or Crisis Duel, send the invite, and the duel starts
            the moment they accept. Rated — both Ratings are shown on the invite, so accepting is
            the opt-in. Invites expire after 24 hours.
          </p>
          <Link
            href="/duels/challenge"
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Challenge a friend
          </Link>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Weekly Portfolio Battle</h2>
          <p className="mt-1 text-sm text-slate-400">
            One week, same fictional market for every player, virtual ₹100,000 each. Join before
            Monday, trade all week in a league of 30 — the winner is the best risk-adjusted return,
            not the highest return. Top 3 are promoted one tier, bottom 3 demoted. Rated — your
            Trading Rating moves against the market index. Hosted by Anaya, Portfolio Architect.
          </p>
          <Link
            href="/duels/weekly"
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Play a Weekly Portfolio Battle
          </Link>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Paper Trading Sprint</h2>
          <p className="mt-1 text-sm text-slate-400">
            15 minutes, same fictional market for both players, virtual ₹100,000 each. The winner is
            the best risk-adjusted return, not the highest return — a steady gain beats a wild one.
            Rated — your Trading Rating moves with the result. Hosted by Tara; Mira (bot) is offered
            after 30 seconds in the queue.
          </p>
          <Link
            href="/duels/sprint"
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Play a Paper Trading Sprint
          </Link>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Crisis Duel</h2>
          <p className="mt-1 text-sm text-slate-400">
            15 minutes, same fictional market for both players, virtual ₹100,000 each — and a crash
            hits mid-duel (minute 7–10, never announced in advance): every instrument falls ~12%
            over 3 minutes, then recovers ~5%. The winner is the best crisis risk-adjusted return —
            moving to cash early beats holding through the crash, but selling at the bottom locks
            the fall and misses the recovery. Rated — your Trading Rating moves with the result.
            Hosted by Tara; Mira (bot) is offered after 30 seconds in the queue.
          </p>
          <Link
            href="/duels/crisis"
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Play a Crisis Duel
          </Link>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Chart Detective</h2>
          <p className="mt-1 text-sm text-slate-400">
            5 fictional charts, 30 seconds each, same charts for both players, live. Read the chart,
            then pick the best interpretation — a correct reading pays 100 points, and a fast answer
            adds up to 50 more. A wrong reading pays nothing. Rated — your Learning Rating moves
            with the result. Hosted by Kabir; Mira (bot) is offered after 30 seconds in the queue.
          </p>
          <Link
            href="/duels/chart"
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Play Chart Detective
          </Link>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Case Duel</h2>
          <p className="mt-1 text-sm text-slate-400">
            5 real-life money cases, 45 seconds each, same cases for both players, live. Pick the
            best action — the best action pays 100 points, the second-best 50, and a fast answer
            adds up to 20 more. Rated — your Learning Rating moves with the result. Hosted by Kabir;
            Mira (bot) is offered after 30 seconds in the queue.
          </p>
          <Link
            href="/duels/case"
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Play a Case Duel
          </Link>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Myth vs Fact Blitz</h2>
          <p className="mt-1 text-sm text-slate-400">
            10 rapid true-or-false questions, 10 seconds each, same set for both players, live.
            Rated — your Learning Rating moves with the result. One wrong answer breaks your streak;
            a long streak pays a bonus. Matched by Rating; Mira (bot) is offered after 30 seconds in
            the queue.
          </p>
          <Link
            href="/duels/blitz"
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Play a Blitz Duel
          </Link>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Live Speed Quiz Duel</h2>
          <p className="mt-1 text-sm text-slate-400">
            7 questions, 15 seconds each, same set for both players, live. Rated — your Learning
            Rating moves with the result. Matched by Rating; Mira (bot) is offered after 30 seconds
            in the queue.
          </p>
          <Link
            href="/duels/live"
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Play a Live Duel
          </Link>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Bot Duel vs Mira</h2>
          <p className="mt-1 text-sm text-slate-400">
            7 questions, 15 seconds each. Practice only — your Rating never changes. Mira adapts to
            your Learning Rating.
          </p>
          <Link
            href="/duels/bot"
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Play a Bot Duel
          </Link>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Daily Duel</h2>
          <p className="mt-1 text-sm text-slate-400">
            5 questions, the same set for everyone today. Rated — one per day. You are paired with
            another player in order of finishing; if nobody else finishes, you play Mira instead.
          </p>
          <Link
            href="/duels/daily"
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Play today&apos;s Daily Duel
          </Link>
        </div>
      </div>
      <DuelsDisclaimer />
    </main>
  );
}
