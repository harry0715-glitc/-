import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../Code.js', import.meta.url), 'utf8');
const validation = new Function(
  `${source}\nreturn { validateIdNumber_, requireDate_, contractorType_, contractorLevelLabel_, sortContractors_, estimateWorkerPageUnits_ };`
)();

test('accepts valid Taiwan national and resident certificate numbers', () => {
  assert.equal(validation.validateIdNumber_('A123456789'), 'A123456789');
  assert.equal(validation.validateIdNumber_('FA12345689'), 'FA12345689');
  assert.equal(validation.validateIdNumber_('A800000005'), 'A800000005');
});

test('rejects invalid identity check digits and impossible dates', () => {
  assert.throws(
    () => validation.validateIdNumber_('A123456788'),
    /檢查碼不正確/
  );
  assert.equal(validation.requireDate_('2024-02-29', '日期'), '2024-02-29');
  assert.throws(() => validation.requireDate_('2026-02-31', '日期'), /格式不正確/);
});

test('keeps one primary contractor first and treats legacy rows as subcontractors', () => {
  const contractors = validation.sortContractors_([
    { id: 'sub-b', name: '乙次承包商', companyType: 'subcontractor' },
    { id: 'main', name: '主承包商公司', companyType: 'primary' },
    { id: 'legacy', name: '甲舊包商' }
  ]);
  assert.equal(contractors[0].id, 'main');
  assert.deepEqual(new Set(contractors.map((item) => item.id)), new Set(['main', 'legacy', 'sub-b']));
  assert.equal(validation.contractorType_({ companyType: 'primary' }), 'primary');
  assert.equal(validation.contractorType_({}), 'subcontractor');
  assert.equal(validation.contractorLevelLabel_({ companyType: 'primary' }), '主承包商');
});

test('reserves more PDF space for long notes', () => {
  assert.equal(validation.estimateWorkerPageUnits_({ notes: '一般備註' }), 1);
  assert.equal(validation.estimateWorkerPageUnits_({ notes: '長'.repeat(250) }), 3);
});
