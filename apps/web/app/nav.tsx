'use client';

import Link from 'next/link';
import { useAuth } from '../lib/auth';

/** Top navigation — auth-aware. */
export function Nav(): React.ReactNode {
  const { user, loading, logout, isAdmin } = useAuth();

  return (
    <header className="border-b border-slate-800">
      <div className="mx-auto max-w-4xl px-4 py-3 flex items-center gap-6">
        <Link href="/" className="font-bold text-lg text-amber-300">
          Candle
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-300">
          <Link href="/tracks" className="hover:text-white">
            Tracks
          </Link>
          {user && (
            <Link href="/dashboard" className="hover:text-white">
              Dashboard
            </Link>
          )}
          {user && (
            <Link href="/simulator" className="hover:text-white">
              Simulator
            </Link>
          )}
          {isAdmin && (
            <Link href="/admin" className="hover:text-white text-violet-300">
              Admin
            </Link>
          )}
        </nav>
        <div className="ml-auto text-sm">
          {loading ? (
            <span className="text-slate-500">…</span>
          ) : user ? (
            <span className="flex items-center gap-3">
              <span className="text-slate-400">{user.displayName ?? user.email}</span>
              <button
                onClick={() => void logout()}
                className="text-slate-400 hover:text-white underline underline-offset-2"
              >
                Log out
              </button>
            </span>
          ) : (
            <span className="flex items-center gap-3">
              <Link href="/login" className="hover:text-white">
                Log in
              </Link>
              <Link
                href="/register"
                className="bg-amber-400 text-slate-950 px-3 py-1.5 rounded font-medium hover:bg-amber-300"
              >
                Sign up
              </Link>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
