'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { useAuth } from '../../lib/auth';
import { ApiClientError, api } from '../../lib/api';

export default function RegisterPage(): JSX.Element {
  const { register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const token = await register(email.trim(), password, displayName.trim() || undefined);
      if (token) {
        // Dev/test convenience: the API returns the verification token when no
        // mailer is configured. Verify immediately.
        await api('/auth/verify-email', { method: 'POST', body: { token } });
        router.push('/login?verified=1');
      } else {
        router.push('/verify-email?email=' + encodeURIComponent(email.trim()));
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.details) {
        const issues = err.details as Array<{ issue: string }>;
        setError(issues.map((i) => i.issue).join(' '));
      } else {
        setError(err instanceof ApiClientError ? err.message : 'Registration failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto py-10">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <form onSubmit={(e) => void onSubmit(e)} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm text-slate-400">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-400">Display name (optional)</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-400">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"
          />
          <span className="text-xs text-slate-500">
            Min 12 characters, with upper + lower + digit + symbol.
          </span>
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-amber-400 text-slate-950 py-2 rounded font-medium hover:bg-amber-300 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-400">
        Have an account?{' '}
        <Link href="/login" className="text-amber-300 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
