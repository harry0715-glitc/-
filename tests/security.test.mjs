import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_USERNAME,
  buildContractorSheetWorkerMatcher,
  findDuplicateContractor,
  findDuplicateWorker,
  isFixedAdminUsername,
  maskIdNumber,
  maskPhone,
  normalizeAdminUsername,
  normalizeIdNumber,
  normalizeNotes,
  normalizePhone,
  normalizeText,
  sanitizeWorkerForPublic,
  validateAdminSecret,
} from '../src/security.mjs';

test('normalizeAdminUsername trims and lowercases values', () => {
  assert.equal(normalizeAdminUsername('  Admin  '), ADMIN_USERNAME);
});

test('normalizeText trims and collapses repeated whitespace', () => {
  assert.equal(normalizeText('  楓根   室內設計  '), '楓根 室內設計');
});

test('isFixedAdminUsername only accepts the fixed admin account', () => {
  assert.equal(isFixedAdminUsername('admin'), true);
  assert.equal(isFixedAdminUsername('Admin'), true);
  assert.equal(isFixedAdminUsername('manager'), false);
  assert.equal(isFixedAdminUsername(''), false);
});

test('validateAdminSecret requires at least 6 characters', () => {
  assert.equal(validateAdminSecret('12345'), false);
  assert.equal(validateAdminSecret('123456'), true);
});

test('normalizeIdNumber uppercases and removes spaces', () => {
  assert.equal(normalizeIdNumber(' a123 456789 '), 'A123456789');
});

test('normalizePhone keeps only digits, heals legacy mobile numbers, and caps length at 10', () => {
  assert.equal(normalizePhone('09-1234-5678 ext99'), '0912345678');
  assert.equal(normalizePhone('912345678'), '0912345678');
  assert.equal(normalizePhone('963620715'), '0963620715');
});

test('normalizeNotes trims note text', () => {
  assert.equal(normalizeNotes('  需補件  '), '需補件');
});

test('findDuplicateContractor matches normalized names', () => {
  const contractors = [{ id: '1', name: '楓根 室內設計' }];
  assert.deepEqual(findDuplicateContractor(contractors, '  楓根   室內設計 '), contractors[0]);
});

test('findDuplicateWorker detects duplicate by id number first', () => {
  const workers = [{ id: '1', name: '王小明', contractorId: 'c1', idNumber: 'a123456789', phone: '0912345678' }];
  const match = findDuplicateWorker(workers, { name: '別人', contractorId: 'c2', idNumber: 'A123456789' });
  assert.equal(match?.type, 'idNumber');
  assert.equal(match?.worker.id, '1');
});

test('findDuplicateWorker detects duplicate by contractor plus name plus phone', () => {
  const workers = [{ id: '1', name: '王小明', contractorId: 'c1', idNumber: '', phone: '0912-345-678' }];
  const match = findDuplicateWorker(workers, { name: ' 王小明 ', contractorId: 'c1', phone: '0912345678' });
  assert.equal(match?.type, 'profile');
  assert.equal(match?.worker.id, '1');
});

test('findDuplicateWorker ignores same profile in another contractor', () => {
  const workers = [{ id: '1', name: '王小明', contractorId: 'c1', idNumber: '', phone: '0912345678' }];
  assert.equal(findDuplicateWorker(workers, { name: '王小明', contractorId: 'c2', phone: '0912345678' }), null);
});

test('maskIdNumber hides middle characters', () => {
  assert.equal(maskIdNumber('A123456789'), 'A*******89');
});

test('maskPhone hides middle digits with stable format', () => {
  assert.equal(maskPhone('0912345678'), '09** *** 678');
  assert.equal(maskPhone('09-1234-5678'), '09** *** 678');
});

test('sanitizeWorkerForPublic masks id number but keeps phone visible for display', () => {
  const worker = {
    id: '1',
    name: '王小明',
    idNumber: 'A123456789',
    phone: '912345678',
    jobTitle: '水電',
    contractorId: 'c1',
    contractorName: '大林水電',
    entryDate: '2026-06-01',
    notes: '已完成教育訓練',
    photoUrl: 'https://example.com/photo.jpg',
    createdAt: '2026-06-06T10:00:00.000Z',
  };

  assert.deepEqual(sanitizeWorkerForPublic(worker), {
    ...worker,
    idNumber: 'A*******89',
    phone: '0912345678',
  });
});

test('buildContractorSheetWorkerMatcher matches the exact contractor-sheet row for deletion sync', () => {
  const worker = {
    name: '王小明',
    idNumber: 'A123456789',
    phone: '0912345678',
    jobTitle: '水電',
    entryDate: '2026-06-01',
    notes: '需補件',
    createdAt: '2026-06-06T10:00:00.000Z',
  };

  const matcher = buildContractorSheetWorkerMatcher(worker);
  assert.equal(matcher(['1', '王小明', 'A123456789', '0912345678', '水電', '2026-06-01', '需補件', new Date(worker.createdAt).toLocaleString('zh-TW')]), true);
  assert.equal(matcher(['1', '王小明', 'A123456789', '0912345678', '木工', '2026-06-01', '需補件', new Date(worker.createdAt).toLocaleString('zh-TW')]), false);
});
