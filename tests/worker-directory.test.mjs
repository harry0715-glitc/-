import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDuplicateWorkerMessage,
  filterAndSortWorkers,
  getJobTitleOptions,
  workerMatchesSearch,
} from '../src/worker-directory.mjs';

const contractors = [
  { id: 'co-1', name: '大林工程' },
  { id: 'co-2', name: '宏展水電' },
];

const workers = [
  {
    id: '1',
    name: '王大明',
    idNumber: 'a123456789',
    phone: '0912-345-678',
    jobTitle: '木工',
    contractorId: 'co-1',
    notes: '南棟支援',
    entryDate: '2026-06-01',
    createdAt: '2026-06-03T08:00:00.000Z',
  },
  {
    id: '2',
    name: '李小美',
    idNumber: 'B234567890',
    phone: '0933555666',
    jobTitle: '水電',
    contractorId: 'co-2',
    notes: '夜間施工',
    entryDate: '2026-05-28',
    createdAt: '2026-06-04T08:00:00.000Z',
  },
];

test('workerMatchesSearch supports contractor name and normalized phone/id search', () => {
  assert.equal(workerMatchesSearch(workers[0], contractors, '大林'), true);
  assert.equal(workerMatchesSearch(workers[0], contractors, '0912345'), true);
  assert.equal(workerMatchesSearch(workers[0], contractors, 'A1234'), true);
  assert.equal(workerMatchesSearch(workers[0], contractors, '不存在'), false);
});

test('filterAndSortWorkers applies search, contractor filter, job filter, and sorting', () => {
  const result = filterAndSortWorkers(workers, contractors, {
    search: '施工',
    contractorId: 'co-2',
    jobTitle: '水電',
    sortBy: 'nameAsc',
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, '李小美');
});

test('filterAndSortWorkers sorts by contractor and created date', () => {
  const byContractor = filterAndSortWorkers(workers, contractors, { sortBy: 'contractorAsc' });
  assert.deepEqual(byContractor.map((worker) => worker.id), ['1', '2']);

  const byCreatedDesc = filterAndSortWorkers(workers, contractors, { sortBy: 'createdAtDesc' });
  assert.deepEqual(byCreatedDesc.map((worker) => worker.id), ['2', '1']);
});

test('getJobTitleOptions returns sorted unique titles', () => {
  assert.deepEqual(getJobTitleOptions([...workers, { ...workers[0], id: '3' }]), ['木工', '水電']);
});

test('buildDuplicateWorkerMessage includes existing worker and contractor name', () => {
  const idMessage = buildDuplicateWorkerMessage({ type: 'idNumber', worker: workers[0] }, contractors);
  assert.match(idMessage, /王大明/);
  assert.match(idMessage, /大林工程/);

  const phoneMessage = buildDuplicateWorkerMessage({ type: 'profile', worker: workers[1] }, contractors);
  assert.match(phoneMessage, /李小美/);
  assert.match(phoneMessage, /宏展水電/);
});
