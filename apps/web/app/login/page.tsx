'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { useAuth } from '../../lib/auth';
import { ApiClientError } from '../../lib/api';

export default function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      // Onboarding welcome redirects to the dashboard when the assessment
      // is already done or was dismissed (spec §2).
      router.push('/onboarding');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto py-10">
      <h1 className="text-2xl font-bold">Log in</h1>
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
          <span className="text-sm text-slate-400">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-amber-400 text-slate-950 py-2 rounded font-medium hover:bg-amber-300 disabled:opacity-50"
        >
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-400">
        No account?{' '}
        <Link href="/register" className="text-amber-300 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
