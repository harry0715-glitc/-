import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTRACTOR_SHEET_HEADERS,
  buildContractorSheetRow,
  findContractorSheetDeleteIndex,
  normalizeContractorSheetRows,
} from '../src/contractor-sheet.mjs';

test('contractor sheet headers include hidden workerId anchor column', () => {
  assert.deepEqual(CONTRACTOR_SHEET_HEADERS, [
    '編號', 'workerId', '姓名', '身分證字號', '手機', '職稱', '進場日期', '備註', '登記時間'
  ]);
});

test('buildContractorSheetRow writes workerId in stable second column', () => {
  const row = buildContractorSheetRow(3, {
    id: 'w-1001',
    name: '王小明',
    idNumber: 'A123456789',
    phone: '0912345678',
    jobTitle: '水電',
    entryDate: '2026-06-01',
    notes: '需補件',
    createdAt: '2026-06-06T10:00:00.000Z',
  });

  assert.equal(row[0], 3);
  assert.equal(row[1], 'w-1001');
  assert.equal(row[2], '王小明');
  assert.equal(row[4], '0912345678');
  assert.equal(row.length, 9);
});

test('findContractorSheetDeleteIndex prefers exact workerId over fuzzy content match', () => {
  const rows = [
    [1, 'w-old', '王小明', 'A123456789', '0912345678', '水電', '2026-06-01', '需補件', '2026/6/6 上午10:00:00'],
    [2, 'w-1001', '王小明', 'A123456789', '0912345678', '水電', '2026-06-01', '需補件', '2026/6/6 上午10:00:00'],
  ];

  const index = findContractorSheetDeleteIndex(rows, {
    id: 'w-1001',
    name: '王小明',
    idNumber: 'A123456789',
    phone: '0912345678',
    jobTitle: '水電',
    entryDate: '2026-06-01',
    notes: '需補件',
    createdAt: '2026-06-06T10:00:00.000Z',
  });

  assert.equal(index, 1);
});

test('findContractorSheetDeleteIndex falls back for legacy rows without workerId', () => {
  const rows = [
    [1, '王大明', 'B123456789', '0922333444', '木工', '2026-06-02', '', '2026/6/7 上午9:00:00'],
    [2, '李小美', 'C123456789', '0933555666', '水電', '2026-06-03', '夜間施工', '2026/6/7 上午10:00:00'],
  ];

  const index = findContractorSheetDeleteIndex(rows, {
    id: 'legacy-not-present',
    name: '李小美',
    idNumber: 'C123456789',
    phone: '0933555666',
    jobTitle: '水電',
    entryDate: '2026-06-03',
    notes: '夜間施工',
    createdAt: '2026-06-07T02:00:00.000Z',
  });

  assert.equal(index, 1);
});

test('normalizeContractorSheetRows upgrades legacy 8-column rows to 9 columns with blank workerId', () => {
  const normalized = normalizeContractorSheetRows([
    [1, '王大明', 'B123456789', '0922333444', '木工', '2026-06-02', '', '2026/6/7 上午9:00:00'],
  ]);

  assert.deepEqual(normalized, [
    [1, '', '王大明', 'B123456789', '0922333444', '木工', '2026-06-02', '', '2026/6/7 上午9:00:00'],
  ]);
});
