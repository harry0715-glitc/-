import { createHmac, timingSafeEqual } from "node:crypto";

import { SupabaseError, isSupabaseConfigured, isSupabaseEnabled } from "./supabase-client.mjs";
import {
  createWorkerInSupabase,
  deleteWorkerInSupabase,
  generateReportFromSupabase,
  getAdminDataFromSupabase,
  getManagerBySession,
  getWorkerPhotoFromSupabase,
  managerProfileFromSession,
  syncBundleToSupabase,
  syncManagerFromLogin,
  updateWorkerInSupabase,
  UserInputError,
} from "./supabase-service.mjs";

const COOKIE_NAME = "__Host-wr_session";
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const ACTOR_TOKEN_TTL_SECONDS = 5 * 60;
const UPSTREAM_TIMEOUT_MS = 15_000;
const MIGRATION_TIMEOUT_MS = 55_000;
const REPORT_TIMEOUT_MS = 55_000;
const GENERIC_ERROR = "Request failed";
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SUPABASE_FAST_ACTIONS = new Set([
  "adminGetData",
  "adminAddWorker",
  "adminUpdateWorker",
  "adminDeleteWorker",
  "adminGetPhoto",
  "adminGenerateReport",
]);
const SUPABASE_MIRROR_ACTIONS = new Set([
  "adminUpdatePrimaryContractor",
  "adminAddContractor",
  "adminArchiveContractor",
  "adminCreateManager",
  "adminResetManagerPassword",
  "adminSetManagerStatus",
]);

export const config = {
  path: "/api/admin",
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};

export default async function netlifyHandler(request) {
  const headers = Object.fromEntries(request.headers.entries());
  if (!headers.host) headers.host = new URL(request.url).host;
  const result = await handler({
    httpMethod: request.method,
    headers,
    body: await request.text(),
    isBase64Encoded: false
  });
  return new Response(result.body, {
    status: result.statusCode,
    headers: result.headers
  });
}

async function handler(event) {
  if (String(event?.httpMethod || "").toUpperCase() !== "POST") {
    return errorResponse(405, { Allow: "POST" });
  }

  if (!isSameOrigin(event)) {
    return errorResponse(403);
  }

  let request;
  try {
    request = parseRequestBody(event);
  } catch {
    return errorResponse(400);
  }

  if (!isRecord(request) || typeof request.action !== "string" || !request.action) {
    return errorResponse(400);
  }

  const payload = request.payload === undefined ? {} : request.payload;
  if (!isRecord(payload)) {
    return errorResponse(400);
  }

  if (request.action === "logout") {
    return jsonResponse(200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
  }

  const config = readConfig();
  if (!config) {
    return errorResponse(500);
  }

  if (request.action === "login") {
    if (!hasCredentials(payload)) {
      return errorResponse(400);
    }

    const upstreamBody = await postJson(config.appsScriptUrl, {
      action: "adminLogin",
      payload: {
        username: payload.username,
        password: payload.password
      },
      adminSecret: config.gasAdminSecret
    });

    if (!upstreamBody) {
      return errorResponse(502);
    }

    if (upstreamBody.ok !== true) {
      return jsonResponse(401, {
        ok: false,
        error: "帳號或密碼錯誤，或帳號暫時鎖定"
      });
    }

    const identity = extractSessionIdentity(upstreamBody);
    if (!identity) {
      return errorResponse(502);
    }

    const authenticated = authResponse(upstreamBody);
    if (isSupabaseEnabled()) {
      try {
        await syncManagerFromLogin(authenticated.data.profile, identity.sessionVersion);
      } catch (error) {
        console.warn(`Supabase 管理者同步失敗：${error.message}`);
      }
    }

    return jsonResponse(
      200,
      authenticated,
      {
        "Set-Cookie": createSessionCookie(
          identity.managerId,
          identity.sessionVersion,
          config.sessionSecret
        )
      }
    );
  }

  const session = verifySessionCookie(
    getHeader(event, "cookie"),
    config.sessionSecret
  );
  if (!session) {
    return errorResponse(401);
  }

  const actorToken = createActorToken(
    session.managerId,
    session.sessionVersion,
    config.gasAdminSecret
  );

  let supabaseActor = null;
  if (isSupabaseEnabled()) {
    try {
      supabaseActor = await getManagerBySession(session.managerId, session.sessionVersion);
    } catch (error) {
      console.warn(`Supabase 工作階段檢查失敗：${error.message}`);
    }
  }

  if (request.action === "adminGetSession" && supabaseActor) {
    return jsonResponse(200, {
      ok: true,
      data: { profile: managerProfileFromSession(supabaseActor) }
    });
  }

  if (request.action === "adminSyncSupabase") {
    if (!isSupabaseConfigured()) {
      return jsonResponse(500, {
        ok: false,
        error: "Supabase 尚未完成設定，請確認 Netlify 的 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY"
      });
    }
    const migrationBody = await postJson(config.appsScriptUrl, {
      action: "adminExportSupabaseData",
      payload: {},
      adminSecret: config.gasAdminSecret,
      actorToken
    }, MIGRATION_TIMEOUT_MS);
    if (!migrationBody || migrationBody.ok !== true) {
      return jsonResponse(migrationBody ? 400 : 502, {
        ok: false,
        error: migrationBody
          ? "Google 資料匯出失敗，請確認 Apps Script 已部署最新版本"
          : "Google 資料服務逾時，請稍後再試"
      });
    }
    try {
      const synced = await syncBundleToSupabase(migrationBody.data);
      return jsonResponse(200, { ok: true, data: synced });
    } catch (error) {
      return supabaseErrorResponse(error);
    }
  }

  if (supabaseActor && SUPABASE_FAST_ACTIONS.has(request.action)) {
    try {
      let result;
      if (request.action === "adminGetData") {
        result = await getAdminDataFromSupabase(supabaseActor);
      } else if (request.action === "adminAddWorker") {
        result = await createWorkerInSupabase(payload, supabaseActor, "manager");
      } else if (request.action === "adminUpdateWorker") {
        result = await updateWorkerInSupabase(payload, supabaseActor);
      } else if (request.action === "adminDeleteWorker") {
        result = await deleteWorkerInSupabase(payload, supabaseActor);
      } else if (request.action === "adminGetPhoto") {
        result = await getWorkerPhotoFromSupabase(payload, supabaseActor);
        if (result.legacy) {
          result = null;
        }
      } else if (request.action === "adminGenerateReport") {
        result = await generateReportFromSupabase(payload, supabaseActor, async (action, gasPayload) => {
          return callGasAction(config, action, gasPayload, actorToken, REPORT_TIMEOUT_MS);
        });
      }
      if (result !== null && result !== undefined) {
        return jsonResponse(200, { ok: true, data: result });
      }
    } catch (error) {
      return supabaseErrorResponse(error);
    }
  }

  const upstreamBody = await postJson(config.appsScriptUrl, {
    action: request.action,
    payload,
    adminSecret: config.gasAdminSecret,
    actorToken
  }, request.action === "adminGenerateReport" ? REPORT_TIMEOUT_MS : UPSTREAM_TIMEOUT_MS);

  if (!upstreamBody) {
    return errorResponse(502);
  }
  if (upstreamBody.ok !== true) {
    const message = typeof upstreamBody.error === "string"
      ? upstreamBody.error.slice(0, 200)
      : GENERIC_ERROR;
    const unauthorized = /未授權|工作階段|帳號已停用|管理帳號已停用/.test(message);
    return jsonResponse(unauthorized ? 401 : 400, { ok: false, error: message });
  }

  if (isSupabaseConfigured() && SUPABASE_MIRROR_ACTIONS.has(request.action)) {
    try {
      await syncGasSnapshot(config, actorToken);
    } catch (error) {
      console.warn(`Supabase 資料鏡像同步失敗：${error.message}`);
    }
  }

  if (request.action === "adminChangePassword") {
    const identity = extractSessionIdentity(upstreamBody);
    if (!identity || identity.managerId !== session.managerId) {
      return errorResponse(502);
    }
    if (isSupabaseEnabled()) {
      try {
        await syncManagerFromLogin(authResponse(upstreamBody).data.profile, identity.sessionVersion);
      } catch (error) {
        console.warn(`Supabase 管理者同步失敗：${error.message}`);
      }
    }
    return jsonResponse(
      200,
      authResponse(upstreamBody),
      {
        "Set-Cookie": createSessionCookie(
          identity.managerId,
          identity.sessionVersion,
          config.sessionSecret
        )
      }
    );
  }

  return jsonResponse(200, upstreamBody);
}

function readConfig() {
  const appsScriptUrl = requiredEnv("APPS_SCRIPT_URL");
  const gasAdminSecret = requiredEnv("GAS_ADMIN_SECRET", 32);
  const sessionSecret = requiredEnv("SESSION_SECRET", 32);
  if (!appsScriptUrl || !gasAdminSecret || !sessionSecret) {
    return null;
  }

  try {
    const parsedUrl = new URL(appsScriptUrl);
    if (!HTTP_PROTOCOLS.has(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      return null;
    }
  } catch {
    return null;
  }

  return { appsScriptUrl, gasAdminSecret, sessionSecret };
}

function requiredEnv(name, minimumLength = 1) {
  const value = process.env?.[name];
  return typeof value === "string" && value.trim().length >= minimumLength
    ? value.trim()
    : null;
}

function parseRequestBody(event) {
  if (typeof event?.body !== "string") {
    throw new Error("Invalid body");
  }

  const body = event.isBase64Encoded === true
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(body);
}

function hasCredentials(payload) {
  return typeof payload.username === "string" && payload.username.trim() !== ""
    && typeof payload.password === "string" && payload.password.length > 0;
}

async function postJson(url, requestBody, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  timeoutId.unref?.();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response || (typeof response.ok === "boolean" && !response.ok)) {
      return null;
    }
    if (typeof response.status === "number" && (response.status < 200 || response.status >= 300)) {
      return null;
    }

    const responseText = await response.text();
    const parsedBody = JSON.parse(responseText);
    return isRecord(parsedBody) ? parsedBody : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractSessionIdentity(responseBody) {
  const data = isRecord(responseBody.data) ? responseBody.data : null;
  const manager = data && isRecord(data.manager) ? data.manager : null;
  const user = data && isRecord(data.user) ? data.user : null;
  const profile = data && isRecord(data.profile) ? data.profile : null;
  const sessionVersion = data && typeof data.sessionVersion === "string"
    ? data.sessionVersion.trim()
    : "";
  const candidates = [
    responseBody.managerId,
    data && data.managerId,
    profile && profile.id,
    manager && manager.managerId,
    manager && manager.id,
    user && user.managerId,
    user && user.id
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return sessionVersion
        ? { managerId: candidate.trim(), sessionVersion }
        : null;
    }
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) {
      return sessionVersion
        ? { managerId: String(candidate), sessionVersion }
        : null;
    }
  }
  return null;
}

function authResponse(upstreamBody) {
  const profile = extractProfile(upstreamBody);
  return { ok: true, data: { profile } };
}

function extractProfile(upstreamBody) {
  const data = isRecord(upstreamBody.data) ? upstreamBody.data : {};
  return isRecord(data.profile) ? data.profile : {};
}

async function callGasAction(config, action, payload, actorToken, timeoutMs) {
  const upstreamBody = await postJson(config.appsScriptUrl, {
    action,
    payload,
    adminSecret: config.gasAdminSecret,
    actorToken
  }, timeoutMs);
  if (!upstreamBody) throw new SupabaseError("Google 文件服務暫時無法連線", 502, "GAS_UNAVAILABLE");
  if (upstreamBody.ok !== true) {
    throw new UserInputError(
      typeof upstreamBody.error === "string" ? upstreamBody.error.slice(0, 240) : "報表產生失敗"
    );
  }
  return upstreamBody.data;
}

async function syncGasSnapshot(config, actorToken) {
  const migrationBody = await postJson(config.appsScriptUrl, {
    action: "adminExportSupabaseData",
    payload: {},
    adminSecret: config.gasAdminSecret,
    actorToken
  }, MIGRATION_TIMEOUT_MS);
  if (!migrationBody || migrationBody.ok !== true) {
    throw new Error("Google 資料同步來源無法取得");
  }
  return syncBundleToSupabase(migrationBody.data);
}

function supabaseErrorResponse(error) {
  if (error instanceof UserInputError) {
    return jsonResponse(400, { ok: false, error: error.message });
  }
  if (error instanceof SupabaseError) {
    if (error.code === "NOT_CONFIGURED") {
      return jsonResponse(500, {
        ok: false,
        error: "Supabase 尚未完成設定，請確認 Netlify 的 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY"
      });
    }
    if (error.status === 401 || error.status === 403) {
      return jsonResponse(502, {
        ok: false,
        error: "Supabase 伺服器密鑰無效或沒有權限"
      });
    }
    if (error.status === 404) {
      return jsonResponse(502, {
        ok: false,
        error: "Supabase 資料表尚未建立，請確認已執行資料庫設定"
      });
    }
    if (error.status === 504) {
      return jsonResponse(504, {
        ok: false,
        error: "Supabase 連線逾時，請稍後再試"
      });
    }
  }
  return errorResponse(502);
}

function createSessionCookie(managerId, sessionVersion, sessionSecret) {
  const expiry = nowSeconds() + SESSION_MAX_AGE_SECONDS;
  const encodedPayload = encodeBase64url(JSON.stringify({
    managerId,
    sessionVersion,
    exp: expiry
  }));
  const signature = hmacBase64url(encodedPayload, sessionSecret);
  return `${COOKIE_NAME}=${encodedPayload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function verifySessionCookie(cookieHeader, sessionSecret) {
  const cookieValue = getCookie(cookieHeader, COOKIE_NAME);
  const separator = cookieValue.lastIndexOf(".");
  if (separator <= 0 || separator === cookieValue.length - 1) {
    return null;
  }

  const encodedPayload = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);
  if (!BASE64URL_PATTERN.test(encodedPayload) || !BASE64URL_PATTERN.test(signature)) {
    return null;
  }

  const expectedSignature = hmacBase64url(encodedPayload, sessionSecret);
  if (!constantTimeTextEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const parsedPayload = JSON.parse(decodeBase64url(encodedPayload));
    if (!isRecord(parsedPayload)
      || typeof parsedPayload.managerId !== "string"
      || !parsedPayload.managerId
      || typeof parsedPayload.sessionVersion !== "string"
      || !parsedPayload.sessionVersion
      || !Number.isSafeInteger(parsedPayload.exp)
      || parsedPayload.exp <= nowSeconds()) {
      return null;
    }
    return {
      managerId: parsedPayload.managerId,
      sessionVersion: parsedPayload.sessionVersion
    };
  } catch {
    return null;
  }
}

function createActorToken(managerId, sessionVersion, gasAdminSecret) {
  const issuedAt = nowSeconds();
  const expiry = issuedAt + ACTOR_TOKEN_TTL_SECONDS;
  const encodedPayload = encodeBase64url(JSON.stringify({
    managerId,
    sessionVersion,
    iat: issuedAt,
    exp: expiry
  }));
  return `${encodedPayload}.${hmacBase64url(encodedPayload, gasAdminSecret)}`;
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return "";
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    return part.slice(separator + 1).trim();
  }
  return "";
}

function getHeader(event, name) {
  const normalizedName = name.toLowerCase();
  for (const headers of [event?.headers, event?.multiValueHeaders]) {
    if (!headers || typeof headers !== "object") {
      continue;
    }
    const key = Object.keys(headers).find(item => item.toLowerCase() === normalizedName);
    if (!key) {
      continue;
    }
    const value = headers[key];
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return value == null ? "" : String(value);
  }
  return "";
}

function isSameOrigin(event) {
  const origin = getHeader(event, "origin").trim();
  if (!origin) {
    return true;
  }
  if (origin.toLowerCase() === "null") {
    return false;
  }

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (!HTTP_PROTOCOLS.has(originUrl.protocol)) {
    return false;
  }

  const forwardedHost = firstHeaderValue(getHeader(event, "x-forwarded-host"));
  const requestHost = forwardedHost || firstHeaderValue(getHeader(event, "host"));
  if (!requestHost) {
    return false;
  }

  return normalizeHost(originUrl.host, originUrl.protocol)
    === normalizeHost(requestHost, originUrl.protocol);
}

function firstHeaderValue(value) {
  return value.split(",", 1)[0].trim();
}

function normalizeHost(value, protocol) {
  let host = value.trim().toLowerCase().replace(/\.$/, "");
  if ((protocol === "http:" && host.endsWith(":80"))
    || (protocol === "https:" && host.endsWith(":443"))) {
    host = host.slice(0, -3);
  }
  return host;
}

function encodeBase64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function hmacBase64url(value, secret) {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

function constantTimeTextEqual(left, right) {
  const leftBuffer = Buffer.from(left, "ascii");
  const rightBuffer = Buffer.from(right, "ascii");
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function errorResponse(statusCode, extraHeaders = {}) {
  return jsonResponse(statusCode, { ok: false, error: GENERIC_ERROR }, extraHeaders);
}
