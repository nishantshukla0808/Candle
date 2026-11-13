'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api, ApiClientError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export default function AuditLogPage(): JSX.Element {
  const { accessToken, user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await api<{ total: number; items: AuditEntry[] }>(
        `/admin/audit-log?page=${page}&limit=20`,
        { token: accessToken }
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load.');
    }
  }, [accessToken, page]);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.push('/');
    void load();
  }, [loading, user, isAdmin, router, load]);

  if (loading) return <p className="text-slate-400 py-10">Loading…</p>;

  return (
    <div className="py-6">
      <Link href="/admin" className="text-sm text-slate-400 hover:text-white">
        ← Admin
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Audit log</h1>
      <p className="text-sm text-slate-500">{total} entries (append-only)</p>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-4 space-y-2">
        {items.map((e) => (
          <details
            key={e.id}
            className="border border-slate-800 rounded px-4 py-2 text-sm bg-slate-900/50"
          >
            <summary className="cursor-pointer">
              <span className="text-violet-300 font-mono">{e.action}</span>{' '}
              <span className="text-slate-400">
                {e.entityType}/{e.entityId.slice(0, 8)}…
              </span>
              <span className="text-slate-600 ml-2">{new Date(e.createdAt).toLocaleString()}</span>
            </summary>
            <div className="mt-2 grid gap-2 text-xs">
              <p className="text-slate-500">
                actor <span className="font-mono">{e.actorId.slice(0, 8)}…</span>
                {e.ip && (
                  <>
                    {' '}
                    · ip <span className="font-mono">{e.ip}</span>
                  </>
                )}
              </p>
              {e.before !== null && e.before !== undefined && (
                <div>
                  <p className="text-slate-500">before:</p>
                  <pre className="bg-slate-950 p-2 rounded overflow-x-auto text-slate-400">
                    {JSON.stringify(e.before, null, 2)?.slice(0, 800)}
                  </pre>
                </div>
              )}
              {e.after !== null && e.after !== undefined && (
                <div>
                  <p className="text-slate-500">after:</p>
                  <pre className="bg-slate-950 p-2 rounded overflow-x-auto text-slate-400">
                    {JSON.stringify(e.after, null, 2)?.slice(0, 800)}
                  </pre>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="text-sm border border-slate-700 px-3 py-1 rounded disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="text-sm text-slate-500 py-1">Page {page}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          className="text-sm border border-slate-700 px-3 py-1 rounded"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
