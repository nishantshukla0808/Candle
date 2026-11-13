import { PaginationMeta } from '@candle/shared';

/**
 * Pure pagination-meta helper — the single place paginated responses
 * compute their meta (blueprint §6).
 */
export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.max(1, Math.floor(limit));
  return {
    page: safePage,
    limit: safeLimit,
    total: Math.max(0, Math.floor(total)),
    totalPages: Math.ceil(Math.max(0, total) / safeLimit),
  };
}
