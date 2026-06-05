import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_USERNAME,
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

test('normalizePhone keeps only digits and caps length at 10', () => {
  assert.equal(normalizePhone('09-1234-5678 ext99'), '0912345678');
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
