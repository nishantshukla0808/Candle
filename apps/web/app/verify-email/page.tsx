'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api, ApiClientError } from '../../lib/api';

function VerifyInner(): JSX.Element {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        await api('/auth/verify-email', { method: 'POST', body: { token } });
        if (!cancelled) setState('ok');
      } catch (err) {
        if (!cancelled) {
          setState('error');
          setMessage(err instanceof ApiClientError ? err.message : 'Verification failed.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <div className="max-w-md mx-auto py-10">
        <h1 className="text-2xl font-bold">Verify your email</h1>
        <p className="mt-4 text-slate-400">
          We sent a verification link to your email. Open it to activate your account, then{' '}
          <Link href="/login" className="text-amber-300 hover:underline">
            log in
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-10">
      <h1 className="text-2xl font-bold">Verify your email</h1>
      {state === 'idle' && <p className="mt-4 text-slate-400">Verifying…</p>}
      {state === 'ok' && (
        <p className="mt-4 text-emerald-300">
          Email verified!{' '}
          <Link href="/login" className="text-amber-300 hover:underline">
            Log in
          </Link>
          .
        </p>
      )}
      {state === 'error' && <p className="mt-4 text-red-400">{message}</p>}
    </div>
  );
}

export default function VerifyEmailPage(): JSX.Element {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
