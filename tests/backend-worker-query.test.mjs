import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterSortAndPaginateWorkers,
  summarizeWorkerSearch,
} from '../src/backend-worker-query.mjs';

const contractors = [
  { id: 'co-1', name: '大林工程' },
  { id: 'co-2', name: '宏展水電' },
];

const workers = [
  { id: '1', name: '王大明', contractorId: 'co-1', phone: '0912345678', idNumber: 'A123456789', jobTitle: '木工', notes: '南棟', entryDate: '2026-06-01', createdAt: '2026-06-03T08:00:00.000Z' },
  { id: '2', name: '李小美', contractorId: 'co-2', phone: '0933555666', idNumber: 'B234567890', jobTitle: '水電', notes: '夜間施工', entryDate: '2026-06-02', createdAt: '2026-06-04T08:00:00.000Z' },
  { id: '3', name: '陳建成', contractorId: 'co-1', phone: '0988777666', idNumber: 'C345678901', jobTitle: '木工', notes: '', entryDate: '2026-05-29', createdAt: '2026-06-02T08:00:00.000Z' },
];

test('filterSortAndPaginateWorkers applies backend-style search and returns total before paging', () => {
  const result = filterSortAndPaginateWorkers(workers, contractors, {
    search: '大林',
    sortBy: 'nameAsc',
    limit: 1,
    offset: 0,
  });

  assert.equal(result.total, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, '王大明');
  assert.equal(result.hasMore, true);
});

test('filterSortAndPaginateWorkers supports contractor and job filters with offset paging', () => {
  const result = filterSortAndPaginateWorkers(workers, contractors, {
    contractorId: 'co-1',
    jobTitle: '木工',
    sortBy: 'createdAtDesc',
    limit: 1,
    offset: 1,
  });

  assert.equal(result.total, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, '3');
  assert.equal(result.hasMore, false);
});

test('summarizeWorkerSearch returns safe page metadata for UI', () => {
  assert.deepEqual(summarizeWorkerSearch({ total: 45, limit: 20, offset: 20 }), {
    total: 45,
    limit: 20,
    offset: 20,
    page: 2,
    pageCount: 3,
    hasPrev: true,
    hasNext: true,
  });
});
