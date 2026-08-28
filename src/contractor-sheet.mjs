import { normalizeIdNumber, normalizeNotes, normalizePhone, normalizeText } from './security.mjs';

export const CONTRACTOR_SHEET_HEADERS = [
  '編號', 'workerId', '姓名', '身分證字號', '手機', '職稱', '進場日期', '備註', '登記時間',
];

function formatCreatedAt(createdAt) {
  return createdAt ? new Date(createdAt).toLocaleString('zh-TW') : '';
}

function buildLegacyMatchFingerprint(worker = {}) {
  return [
    normalizeText(worker.name),
    normalizeIdNumber(worker.idNumber),
    normalizePhone(worker.phone),
    normalizeText(worker.jobTitle),
    normalizeText(worker.entryDate),
    normalizeNotes(worker.notes),
    normalizeText(formatCreatedAt(worker.createdAt)),
  ];
}

function buildRowFingerprint(row = []) {
  const normalized = normalizeContractorSheetRows([row])[0] || [];
  return [
    normalizeText(normalized[2]),
    normalizeIdNumber(normalized[3]),
    normalizePhone(normalized[4]),
    normalizeText(normalized[5]),
    normalizeText(normalized[6]),
    normalizeNotes(normalized[7]),
    normalizeText(normalized[8]),
  ];
}

export function normalizeContractorSheetRows(rows = []) {
  return rows.map((row) => {
    if (row.length >= 9) return [...row];
    if (row.length === 8) {
      return [row[0], '', row[1], row[2], row[3], row[4], row[5], row[6], row[7]];
    }
    return [...row];
  });
}

export function buildContractorSheetRow(serialNumber, worker = {}) {
  return [
    serialNumber,
    String(worker.id || ''),
    worker.name || '',
    worker.idNumber || '',
    worker.phone || '',
    worker.jobTitle || '',
    worker.entryDate || '',
    worker.notes || '',
    formatCreatedAt(worker.createdAt),
  ];
}

export function findContractorSheetDeleteIndex(rows = [], worker = {}) {
  const normalizedRows = normalizeContractorSheetRows(rows);
  const workerId = String(worker.id || '').trim();
  if (workerId) {
    const workerIdIndex = normalizedRows.findIndex((row) => String(row[1] || '').trim() === workerId);
    if (workerIdIndex >= 0) return workerIdIndex;
  }

  const expected = buildLegacyMatchFingerprint(worker);
  return normalizedRows.findIndex((row) => {
    const actual = buildRowFingerprint(row);
    return expected.every((value, index) => actual[index] === value);
  });
}
