import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';

import {
  DOCUMENT_TEMPLATE_VERSION,
  createDocumentAcceptance,
  createEmptyDocumentState,
  mergeRosterAndDocumentPackets,
  validateDocumentState,
} from '../worker-documents.mjs';

function completedDocumentState() {
  const state = createEmptyDocumentState();
  const now = new Date().toISOString();
  Object.values(state.documents).forEach((item) => {
    item.viewedAt = now;
    item.acceptedAt = now;
    item.accepted = true;
  });
  state.signatureDataUrl = 'data:image/png;base64,signature';
  state.signedAt = now;
  return state;
}

async function pdfBlob(pageCount) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) pdf.addPage([595.28, 841.89]);
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

test('document state requires reading, acceptance, health details when declared, and signature', () => {
  const state = createEmptyDocumentState();
  assert.match(validateDocumentState(state), /閱讀/);

  const now = new Date().toISOString();
  Object.values(state.documents).forEach((item) => {
    item.viewedAt = now;
    item.acceptedAt = now;
    item.accepted = true;
  });
  state.health.mode = 'declared';
  assert.match(validateDocumentState(state), /健康狀況/);
  state.health.conditions = ['hypertension'];
  assert.match(validateDocumentState(state), /手寫簽名/);
  state.signatureDataUrl = 'data:image/png;base64,signature';
  state.signedAt = now;
  assert.equal(validateDocumentState(state), '');
});

test('acceptance metadata contains no health answers or reusable signature image', () => {
  const acceptance = createDocumentAcceptance(completedDocumentState());
  assert.equal(acceptance.templateVersion, DOCUMENT_TEMPLATE_VERSION);
  assert.deepEqual(Object.keys(acceptance.documents), ['privacy', 'health', 'safety']);
  assert.equal(Object.hasOwn(acceptance, 'health'), false);
  assert.equal(Object.hasOwn(acceptance, 'signatureDataUrl'), false);
});

test('roster PDF is followed by each complete three-page worker packet', async () => {
  const merged = await mergeRosterAndDocumentPackets(
    await pdfBlob(2),
    [await pdfBlob(3), await pdfBlob(3)],
  );
  const pdf = await PDFDocument.load(await merged.arrayBuffer());
  assert.equal(pdf.getPageCount(), 8);
});
