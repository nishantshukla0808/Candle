import { buildPaginationMeta } from './pagination';

describe('buildPaginationMeta', () => {
  it('computes totalPages with ceiling division', () => {
    expect(buildPaginationMeta(1, 20, 120)).toEqual({
      page: 1,
      limit: 20,
      total: 120,
      totalPages: 6,
    });
    expect(buildPaginationMeta(1, 20, 121)).toEqual({
      page: 1,
      limit: 20,
      total: 121,
      totalPages: 7,
    });
  });

  it('handles an empty result set', () => {
    expect(buildPaginationMeta(1, 20, 0)).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('clamps invalid page/limit to sane minimums', () => {
    expect(buildPaginationMeta(0, -5, 10).page).toBe(1);
    expect(buildPaginationMeta(0, -5, 10).limit).toBe(1);
  });
});
