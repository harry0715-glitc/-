import test from 'node:test';
import assert from 'node:assert/strict';

function materializeSheetRows(rawVals, displayVals) {
  if (rawVals.length < 2) return [];
  const headers = rawVals[0];
  return rawVals.slice(1)
    .filter(row => row[0] !== '' && row[0] !== null && row[0] !== undefined)
    .map((row, rowIndex) => {
      const obj = {};
      headers.forEach((h, i) => {
        const rawValue = row[i];
        const displayValue = displayVals[rowIndex + 1]?.[i] ?? '';
        obj[h] = rawValue == null ? '' : String(displayValue || rawValue);
      });
      return obj;
    });
}

test('materializeSheetRows preserves leading zero from display values for phone columns', () => {
  const rawVals = [
    ['id', 'name', 'phone'],
    ['1', '王小明', 912345678],
  ];
  const displayVals = [
    ['id', 'name', 'phone'],
    ['1', '王小明', '0912345678'],
  ];

  assert.deepEqual(materializeSheetRows(rawVals, displayVals), [
    { id: '1', name: '王小明', phone: '0912345678' },
  ]);
});

test('materializeSheetRows falls back to raw value when display value is blank', () => {
  const rawVals = [
    ['id', 'name', 'phone'],
    ['2', '李小美', '0988777666'],
  ];
  const displayVals = [
    ['id', 'name', 'phone'],
    ['2', '李小美', ''],
  ];

  assert.deepEqual(materializeSheetRows(rawVals, displayVals), [
    { id: '2', name: '李小美', phone: '0988777666' },
  ]);
});

test('materializeSheetRows heals legacy 9-digit phone values even when sheet display already lost the leading zero', () => {
  const rawVals = [
    ['id', 'name', 'phone'],
    ['3', '林宗翰', 963620715],
  ];
  const displayVals = [
    ['id', 'name', 'phone'],
    ['3', '林宗翰', '963620715'],
  ];

  const rows = materializeSheetRows(rawVals, displayVals).map((row) => ({
    ...row,
    phone: String(row.phone || '').replace(/\D/g, '').length === 9 && String(row.phone || '').startsWith('9')
      ? `0${String(row.phone || '')}`
      : String(row.phone || ''),
  }));

  assert.deepEqual(rows, [
    { id: '3', name: '林宗翰', phone: '0963620715' },
  ]);
});
