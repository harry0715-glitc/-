import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { getWorkerDocumentPacketFromSupabase, saveWorkerDocumentsInSupabase } from '../netlify/functions/supabase-service.mjs';

const savedFetch = globalThis.fetch;
const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const savedEnv = names.map((name) => process.env[name]);
afterEach(() => {
  globalThis.fetch = savedFetch;
  names.forEach((name, index) => {
    if (savedEnv[index] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[index];
  });
});
const worker = { id: 'w1', name: 'Test', contractor_id: 'c1', contractor_name: 'Test company', updated_at: '2026-09-07T00:00:00Z' };
const owner = { id: 'owner', role: 'owner' };
function setup(handler) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/workers?')) return Response.json([worker]);
    return handler(String(url), options);
  };
}
async function payload(pages = 3) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage();
  const now = new Date().toISOString();
  return {
    id: worker.id,
    expectedUpdatedAt: worker.updated_at,
    documentPacket: `data:application/pdf;base64,${Buffer.from(await pdf.save()).toString('base64')}`,
    documentAcceptance: {
      templateVersion: 'worker-onboarding-v1', signedAt: now,
      documents: Object.fromEntries(['privacy', 'health', 'safety'].map((key) => [key, { accepted: true, viewedAt: now, acceptedAt: now }])),
    },
  };
}
test('another contractor cannot download or replace worker documents', async () => {
  setup(() => { throw new Error('must not reach storage'); });
  const actor = { role: 'contractor', contractorId: 'other' };
  await assert.rejects(getWorkerDocumentPacketFromSupabase({ id: 'w1' }, actor));
  await assert.rejects(saveWorkerDocumentsInSupabase(await payload(), actor));
});
test('a stale worker snapshot cannot be signed', async () => {
  setup(() => { throw new Error('must not upload'); });
  await assert.rejects(saveWorkerDocumentsInSupabase({ ...await payload(), expectedUpdatedAt: '2020-01-01' }, owner), /資料已變更/);
});
test('incomplete PDF and acceptance are rejected before upload', async () => {
  setup(() => { throw new Error('must not upload'); });
  await assert.rejects(saveWorkerDocumentsInSupabase(await payload(2), owner), /三頁/);
  const input = await payload();
  input.documentAcceptance.documents.health.accepted = false;
  await assert.rejects(saveWorkerDocumentsInSupabase(input, owner), /閱讀與同意/);
});
test('re-sign uses one atomic RPC and deletes new object on database failure', async () => {
  const calls = [];
  setup((url, options) => {
    calls.push({ url, options });
    if (url.includes('/rpc/')) return Response.json({ message: 'conflict' }, { status: 409 });
    return Response.json({});
  });
  await assert.rejects(saveWorkerDocumentsInSupabase(await payload(), owner));
  assert.equal(calls.filter(({ url }) => url.includes('/rpc/replace_worker_document_packet')).length, 1);
  assert.equal(calls.filter(({ options }) => options.method === 'DELETE').length, 1);
  assert.equal(calls.some(({ options }) => options.method === 'PATCH'), false);
});
test('download is restricted to active current template and a short-lived link', async () => {
  let version = 'old';
  setup((url, options) => {
    if (url.includes('/worker_document_packets?')) return Response.json([{ storage_path: 'c1/w1/p.pdf', template_version: version }]);
    assert.equal(JSON.parse(options.body).expiresIn, 300);
    return Response.json({ signedURL: '/storage/v1/object/sign/worker-documents/c1/w1/p.pdf?token=test' });
  });
  await assert.rejects(getWorkerDocumentPacketFromSupabase({ id: 'w1' }, owner), /文件版本/);
  version = 'worker-onboarding-v1';
  const result = await getWorkerDocumentPacketFromSupabase({ id: 'w1' }, owner);
  assert.match(result.url, /^https:\/\/example.supabase.co\//);
});
