import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createHmac } from 'node:crypto';

import adminApi from '../netlify/functions/admin-api.mjs';
import publicApi from '../netlify/functions/public-api.mjs';

const ORIGIN = 'https://workerslist.netlify.app';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test-deployment/exec';
const GAS_PUBLIC_SECRET = 'public-secret-1234567890-abcdefghij';
const GAS_ADMIN_SECRET = 'admin-secret-1234567890-abcdefghijk';
const SESSION_SECRET = 'session-secret-1234567890-abcdefghij';
const ENV_NAMES = [
  'APPS_SCRIPT_URL',
  'GAS_PUBLIC_SECRET',
  'GAS_ADMIN_SECRET',
  'SESSION_SECRET'
];
const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of ENV_NAMES) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

function setPublicConfig() {
  process.env.APPS_SCRIPT_URL = APPS_SCRIPT_URL;
  process.env.GAS_PUBLIC_SECRET = GAS_PUBLIC_SECRET;
}

function setAdminConfig() {
  process.env.APPS_SCRIPT_URL = APPS_SCRIPT_URL;
  process.env.GAS_ADMIN_SECRET = GAS_ADMIN_SECRET;
  process.env.SESSION_SECRET = SESSION_SECRET;
}

function request(path, body, headers = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function decodeSignedValue(value) {
  const separator = value.lastIndexOf('.');
  assert.ok(separator > 0);
  const encoded = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  return {
    encoded,
    signature,
    payload: JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  };
}

async function login() {
  const response = await adminApi(request('/api/admin', {
    action: 'login',
    payload: { username: 'manager@example.com', password: 'not-a-real-password' }
  }));
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  return { response, setCookie, cookie: setCookie.split(';', 1)[0] };
}

test('public gateway adds its server-only secret without exposing it', { concurrency: false }, async () => {
  setPublicConfig();
  let upstreamRequest;
  globalThis.fetch = async (_url, options) => {
    upstreamRequest = JSON.parse(options.body);
    return new Response(JSON.stringify({
      ok: true,
      data: { contractors: [{ id: 'co-1', name: '測試承包商' }] }
    }), { status: 200 });
  };

  const response = await publicApi(request('/api/public', {
    action: 'getPublicConfig',
    payload: {}
  }));
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /public, max-age=60/);
  assert.equal(upstreamRequest.publicSecret, GAS_PUBLIC_SECRET);
  assert.equal(upstreamRequest.action, 'getPublicConfig');
  assert.equal(text.includes(GAS_PUBLIC_SECRET), false);
});

test('public gateway rejects cross-origin and oversized submissions', { concurrency: false }, async () => {
  const crossOrigin = await publicApi(request('/api/public', {
    action: 'getPublicConfig',
    payload: {}
  }, { Origin: 'https://attacker.example' }));
  assert.equal(crossOrigin.status, 403);

  const oversized = await publicApi(request('/api/public', {
    action: 'submitRegistration',
    payload: { photo: 'data:image/jpeg;base64,abc' }
  }, { 'Content-Length': '8500001' }));
  assert.equal(oversized.status, 413);
});

test('admin gateway issues a protected host cookie and signs actor identity', { concurrency: false }, async () => {
  setAdminConfig();
  const upstreamRequests = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    upstreamRequests.push(body);
    if (body.action === 'adminLogin') {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          profile: { id: 'manager-1', role: 'contractor', email: 'manager@example.com' },
          sessionVersion: 'session-version-1'
        }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, data: { workers: [] } }), { status: 200 });
  };

  const loggedIn = await login();
  assert.equal(loggedIn.response.status, 200);
  assert.match(loggedIn.setCookie, /^__Host-wr_session=/);
  assert.match(loggedIn.setCookie, /; HttpOnly; Secure; SameSite=Strict; Path=\//);

  const dataResponse = await adminApi(request('/api/admin', {
    action: 'adminGetData',
    payload: {}
  }, { Cookie: loggedIn.cookie }));
  assert.equal(dataResponse.status, 200);

  const actor = decodeSignedValue(upstreamRequests[1].actorToken);
  assert.equal(actor.payload.managerId, 'manager-1');
  assert.equal(actor.payload.sessionVersion, 'session-version-1');
  assert.equal(
    actor.signature,
    createHmac('sha256', GAS_ADMIN_SECRET).update(actor.encoded, 'utf8').digest('base64url')
  );
});

test('password change rotates the session cookie and hides session version', { concurrency: false }, async () => {
  setAdminConfig();
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const sessionVersion = body.action === 'adminLogin'
      ? 'session-version-1'
      : 'session-version-2';
    return new Response(JSON.stringify({
      ok: true,
      data: {
        profile: { id: 'manager-1', role: 'owner', email: 'owner@example.com' },
        sessionVersion
      }
    }), { status: 200 });
  };

  const loggedIn = await login();
  const response = await adminApi(request('/api/admin', {
    action: 'adminChangePassword',
    payload: { currentPassword: 'old-value', newPassword: 'new-value-123456' }
  }, { Cookie: loggedIn.cookie }));
  const responseBody = await response.json();
  const newCookie = response.headers.get('set-cookie').split(';', 1)[0].split('=', 2)[1];
  const session = decodeSignedValue(newCookie);

  assert.equal(response.status, 200);
  assert.equal(session.payload.sessionVersion, 'session-version-2');
  assert.deepEqual(responseBody, {
    ok: true,
    data: { profile: { id: 'manager-1', role: 'owner', email: 'owner@example.com' } }
  });
});
