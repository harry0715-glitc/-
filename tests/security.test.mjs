import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_USERNAME,
  isFixedAdminUsername,
  maskIdNumber,
  maskPhone,
  normalizeAdminUsername,
  validateAdminSecret,
} from '../src/security.mjs';

test('normalizeAdminUsername trims and lowercases values', () => {
  assert.equal(normalizeAdminUsername('  Admin  '), ADMIN_USERNAME);
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

test('maskIdNumber hides middle characters', () => {
  assert.equal(maskIdNumber('A123456789'), 'A*******89');
});

test('maskPhone hides middle digits with stable format', () => {
  assert.equal(maskPhone('0912345678'), '09** *** 678');
  assert.equal(maskPhone('09-1234-5678'), '09** *** 678');
});
