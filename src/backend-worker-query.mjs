import { filterAndSortWorkers } from './worker-directory.mjs';

function toSafeInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

export function filterSortAndPaginateWorkers(workers, contractors, options = {}) {
  const limit = Math.min(100, Math.max(1, toSafeInteger(options.limit, 20)));
  const offset = toSafeInteger(options.offset, 0);
  const filtered = filterAndSortWorkers(workers, contractors, options);
  const items = filtered.slice(offset, offset + limit);
  return {
    items,
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + items.length < filtered.length,
  };
}

export function summarizeWorkerSearch({ total = 0, limit = 20, offset = 0 } = {}) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeLimit = Math.max(1, Number(limit) || 20);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const page = Math.floor(safeOffset / safeLimit) + 1;
  const pageCount = Math.max(1, Math.ceil(safeTotal / safeLimit));
  return {
    total: safeTotal,
    limit: safeLimit,
    offset: safeOffset,
    page,
    pageCount,
    hasPrev: safeOffset > 0,
    hasNext: safeOffset + safeLimit < safeTotal,
  };
}
