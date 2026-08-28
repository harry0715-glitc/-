const CONFIG_TIMEOUT_MS = 15_000;
const SUBMISSION_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 8_500_000;
const MAX_PHOTO_CHARACTERS = 8_100_000;
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_ACTIONS = new Set(["getPublicConfig", "submitRegistration"]);

import { SupabaseError, isSupabaseEnabled } from "./supabase-client.mjs";
import {
  getPublicConfigFromSupabase,
  submitRegistrationToSupabase,
  UserInputError,
} from "./supabase-service.mjs";

export const config = {
  path: "/api/public",
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};

export default async function publicApi(request) {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" }, { Allow: "POST" });
  }
  if (!isSameOrigin(request)) {
    return jsonResponse(403, { ok: false, error: "Request failed" });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return jsonResponse(413, { ok: false, error: "照片檔案過大，請重新裁切後上傳" });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "請重新整理頁面後再試" });
  }
  if (!isRecord(body) || !ALLOWED_ACTIONS.has(body.action)) {
    return jsonResponse(400, { ok: false, error: "不支援的操作" });
  }
  const payload = body.payload === undefined ? {} : body.payload;
  if (!isRecord(payload)) {
    return jsonResponse(400, { ok: false, error: "資料格式不正確" });
  }
  if (body.action === "submitRegistration"
    && (typeof payload.photo !== "string" || payload.photo.length > MAX_PHOTO_CHARACTERS)) {
    return jsonResponse(413, { ok: false, error: "照片為必填，且檔案不可過大" });
  }

  if (isSupabaseEnabled()) {
    try {
      const data = body.action === "getPublicConfig"
        ? await getPublicConfigFromSupabase()
        : await submitRegistrationToSupabase(payload);
      const responseHeaders = body.action === "getPublicConfig"
        ? {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          Vary: "Origin"
        }
        : {};
      return jsonResponse(200, { ok: true, data }, responseHeaders);
    } catch (error) {
      if (error instanceof UserInputError) {
        return jsonResponse(400, { ok: false, error: safePublicError(error.message) });
      }
      const status = error instanceof SupabaseError && error.status === 504 ? 504 : 502;
      return jsonResponse(status, { ok: false, error: "資料服務暫時無法連線" });
    }
  }

  const appsScriptUrl = requiredEnv("APPS_SCRIPT_URL");
  const publicSecret = requiredEnv("GAS_PUBLIC_SECRET", 32);
  if (!appsScriptUrl || !publicSecret || !isValidUrl(appsScriptUrl)) {
    return jsonResponse(500, { ok: false, error: "服務尚未完成設定" });
  }

  const upstream = await postJson(
    appsScriptUrl,
    {
      action: body.action,
      payload,
      publicSecret
    },
    body.action === "submitRegistration" ? SUBMISSION_TIMEOUT_MS : CONFIG_TIMEOUT_MS
  );
  if (!upstream) {
    return jsonResponse(502, { ok: false, error: "Google 服務暫時無法連線" });
  }
  if (upstream.ok !== true) {
    const message = typeof upstream.error === "string"
      ? upstream.error.slice(0, 200)
      : "操作失敗";
    if (/未授權的公開操作/.test(message)) {
      return jsonResponse(500, { ok: false, error: "服務密鑰設定不一致" });
    }
    return jsonResponse(400, { ok: false, error: safePublicError(message) });
  }
  const responseHeaders = body.action === "getPublicConfig"
    ? {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      Vary: "Origin"
    }
    : {};
  return jsonResponse(200, upstream, responseHeaders);
}

function safePublicError(message) {
  const allowed = [
    /為必填/,
    /格式不正確/,
    /檢查碼不正確/,
    /長度超過限制/,
    /檔案過大/,
    /已有在冊資料/,
    /不存在或已停用/,
    /個資蒐集與使用同意/
  ];
  return allowed.some(pattern => pattern.test(message))
    ? message
    : "資料暫時無法儲存，請稍後再試";
}

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const result = JSON.parse(await response.text());
    return isRecord(result) ? result : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function requiredEnv(name, minimumLength = 1) {
  const value = process.env?.[name];
  return typeof value === "string" && value.trim().length >= minimumLength
    ? value.trim()
    : null;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return HTTP_PROTOCOLS.has(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0].trim();
  const requestHost = forwardedHost || request.headers.get("host") || new URL(request.url).host;
  if (!requestHost || !HTTP_PROTOCOLS.has(originUrl.protocol)) return false;
  return normalizeHost(originUrl.host, originUrl.protocol)
    === normalizeHost(requestHost, originUrl.protocol);
}

function normalizeHost(value, protocol) {
  let host = String(value).trim().toLowerCase().replace(/\.$/, "");
  if ((protocol === "http:" && host.endsWith(":80"))
    || (protocol === "https:" && host.endsWith(":443"))) {
    host = host.slice(0, -3);
  }
  return host;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}
