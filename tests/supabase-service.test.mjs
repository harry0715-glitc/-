import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  getAdminDataFromSupabase,
  getPublicConfigFromSupabase,
  syncBundleToSupabase,
} from '../netlify/functions/supabase-service.mjs';
import {
  getSupabaseDataMode,
  isSupabaseEnabled,
} from '../netlify/functions/supabase-client.mjs';

const ENV_NAMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DATA_MODE'];
const originalEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  ENV_NAMES.forEach((name) => {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  });
});

function enableSupabase() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-key-for-test-only';
  process.env.SUPABASE_DATA_MODE = 'supabase';
}

test('Supabase data mode is opt-in and does not replace GAS by default', () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_DATA_MODE;
  assert.equal(getSupabaseDataMode(), 'gas');
  assert.equal(isSupabaseEnabled(), false);
});

test('public contractor config maps Supabase rows to the existing UI contract', async () => {
  enableSupabase();
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/rest\/v1\/contractors\?/);
    return new Response(JSON.stringify([
      { id: 'sub-1', name: '乙次承包商', company_type: 'subcontractor', status: 'active', created_at: '2026-08-01T00:00:00.000Z' },
      { id: 'main-1', name: '主承包商', company_type: 'primary', status: 'active', created_at: '2026-08-01T00:00:00.000Z' },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await getPublicConfigFromSupabase();
  assert.equal(result.primaryContractor.name, '主承包商');
  assert.deepEqual(result.contractors.map((item) => item.companyType), ['primary', 'subcontractor']);
  assert.equal(result.contractors[1].levelLabel, '次承包商');
});

test('Supabase admin data preserves contractor scoping and existing field names', async () => {
  enableSupabase();
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes('/contractors?')) {
      return new Response(JSON.stringify([
        { id: 'sub-1', name: '乙次承包商', company_type: 'subcontractor', status: 'active', created_at: '2026-08-01T00:00:00.000Z' },
        { id: 'main-1', name: '主承包商', company_type: 'primary', status: 'active', created_at: '2026-08-01T00:00:00.000Z' },
      ]), { status: 200 });
    }
    if (text.includes('/workers?')) {
      assert.match(text, /contractor_id=eq\.sub-1/);
      return new Response(JSON.stringify([
        {
          id: 'worker-1',
          name: '王小明',
          id_number: 'A123456789',
          phone: '0912345678',
          emergency_contact: '王大明',
          emergency_phone: '0900000000',
          blood_type: 'O',
          job_title: '水電',
          contractor_id: 'sub-1',
          contractor_name: '乙次承包商',
          entry_date: '2026-08-01',
          notes: '',
          created_at: '2026-08-01T00:00:00.000Z',
          updated_at: '2026-08-01T00:00:00.000Z',
          photo_storage_path: null,
          photo_file_id: 'drive-file-1',
        },
      ]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${text}`);
  };

  const result = await getAdminDataFromSupabase({
    id: 'manager-1',
    username: 'manager@example.com',
    displayName: '次管理者',
    email: 'manager@example.com',
    role: 'contractor',
    contractorId: 'sub-1',
    contractorName: '乙次承包商',
    mustChangePassword: false,
  });
  assert.equal(result.profile.contractorId, 'sub-1');
  assert.deepEqual(result.contractors.map((item) => item.id), ['sub-1']);
  assert.equal(result.workers[0].idNumber, 'A123456789');
  assert.equal(result.workers[0].hasPhoto, true);
});

test('Supabase migration batches worker writes for larger legacy bundles', async () => {
  enableSupabase();
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    return new Response('[]', { status: 200 });
  };

  const workers = Array.from({ length: 101 }, (_, index) => ({
    id: `worker-${index}`,
    name: `人員${index}`,
    idNumber: `A${String(index).padStart(9, '0')}`,
    phone: `0912345${String(index).padStart(3, '0')}`,
    emergencyContact: '緊急聯絡人',
    emergencyPhone: '0900000000',
    bloodType: 'O',
    jobTitle: '水電',
    contractorId: 'main-1',
    contractorName: '主承包商',
    entryDate: '2026-08-01',
    notes: '',
    createdAt: '2026-08-01T00:00:00.000Z',
  }));

  const result = await syncBundleToSupabase({
    contractors: [{ id: 'main-1', name: '主承包商', companyType: 'primary', status: 'active' }],
    workers,
    managers: [],
  });
  const workerRequests = requests.filter((request) => request.url.includes('/workers?'));
  assert.deepEqual(workerRequests.map((request) => request.body.length), [100, 1]);
  assert.equal(result.workers, 101);
  assert.deepEqual(result.skippedWorkers, []);
});
