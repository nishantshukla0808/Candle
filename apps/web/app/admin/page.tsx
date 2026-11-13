'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { JSX } from 'react';
import { useAuth } from '../../lib/auth';

export default function AdminHome(): JSX.Element {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.push('/');
  }, [loading, user, isAdmin, router]);

  if (loading || !isAdmin) return <p className="text-slate-400 py-10">Checking permissions…</p>;

  return (
    <div className="py-6">
      <h1 className="text-2xl font-bold">Content admin</h1>
      <p className="mt-1 text-sm text-slate-400">
        Draft → published workflow. Published versions are immutable; edits create new versions.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Link
          href="/admin/tracks"
          className="border border-slate-800 rounded p-5 bg-slate-900/50 hover:border-violet-400/50"
        >
          <h2 className="font-semibold">Tracks & modules</h2>
          <p className="text-sm text-slate-400 mt-1">Create tracks, modules, and lessons.</p>
        </Link>
        <Link
          href="/admin/tracks"
          className="border border-slate-800 rounded p-5 bg-slate-900/50 hover:border-violet-400/50"
        >
          <h2 className="font-semibold">Lessons & quizzes</h2>
          <p className="text-sm text-slate-400 mt-1">Edit drafts, manage questions, publish.</p>
        </Link>
        <Link
          href="/admin/audit-log"
          className="border border-slate-800 rounded p-5 bg-slate-900/50 hover:border-violet-400/50"
        >
          <h2 className="font-semibold">Audit log</h2>
          <p className="text-sm text-slate-400 mt-1">Who changed what, and when.</p>
        </Link>
      </div>
    </div>
  );
}
