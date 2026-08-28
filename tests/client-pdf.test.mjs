import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import { coverDimensions, createRosterPdf } from '../client-pdf.mjs';

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('photo placement fills the fixed cell without changing aspect ratio', () => {
  for (const [sourceWidth, sourceHeight] of [[1600, 900], [900, 1600], [420, 540]]) {
    const placed = coverDimensions(sourceWidth, sourceHeight, 10, 20, 123, 164);
    assert.ok(placed.width >= 123 - 0.000001);
    assert.ok(placed.height >= 164 - 0.000001);
    assert.ok(Math.abs((placed.width / placed.height) - (sourceWidth / sourceHeight)) < 0.000001);
    assert.ok(Math.abs((placed.x + placed.width / 2) - (10 + 123 / 2)) < 0.000001);
    assert.ok(Math.abs((placed.y + placed.height / 2) - (20 + 164 / 2)) < 0.000001);
  }
});

test('browser PDF generator creates a Chinese roster without a server round trip', async () => {
  const fontBytes = await readFile(new URL('../netlify/functions/assets/NotoSansTC-VF.ttf', import.meta.url));
  const workers = Array.from({ length: 10 }, (_, index) => ({
    id: `worker-${index}`,
    name: `測試人員${index + 1}`,
    idNumber: `A12345678${index}`,
    phone: '0912345678',
    emergencyContact: '緊急聯絡人',
    emergencyPhone: '0987654321',
    bloodType: 'O',
    jobTitle: '施工人員',
    contractorId: 'main-1',
    contractorName: '楓根室內裝修設計有限公司',
    companyType: 'primary',
    entryDate: '2026-08-29',
    notes: '客戶端 PDF 效能與中文字型測試',
    createdAt: '2026-08-29T01:00:00.000Z',
    updatedAt: '2026-08-29T01:00:00.000Z',
  }));
  const startedAt = Date.now();
  const pdf = await createRosterPdf({
    primaryContractorName: '楓根室內裝修設計有限公司',
    reportName: '每日新增人員名冊',
    scopeLabel: '全部公司（含主承包商與次承包商）',
    dataBasis: '登記日期：2026-08-29',
    workers,
    photos: workers.map(() => ONE_PIXEL_PNG),
  }, { fontBytes });
  const bytes = Buffer.from(await pdf.arrayBuffer());

  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  assert.ok(bytes.length > 10_000);
  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getPageCount(), 4);
  assert.ok(Date.now() - startedAt < 20_000, '10-person PDF should finish well below the old server timeout');
});
