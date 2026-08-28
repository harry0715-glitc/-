const DEFAULT_TIMEOUT_MS = 15_000;
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

export class SupabaseError extends Error {
  constructor(message, status = 500, code = '') {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.code = code;
  }
}

export function getSupabaseConfig() {
  const rawUrl = String(process.env?.SUPABASE_URL || '').trim();
  const serverKey = String(
    process.env?.SUPABASE_SERVICE_ROLE_KEY
      || process.env?.SUPABASE_SERVER_KEY
      || ''
  ).trim();
  if (!rawUrl || !serverKey) return null;

  try {
    const url = new URL(rawUrl);
    if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password) return null;
    return { baseUrl: rawUrl.replace(/\/+$/, ''), serverKey };
  } catch {
    return null;
  }
}

export function getSupabaseDataMode() {
  const mode = String(process.env?.SUPABASE_DATA_MODE || 'gas').trim().toLowerCase();
  return mode === 'supabase' || mode === 'shadow' ? mode : 'gas';
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseConfig());
}

export function isSupabaseEnabled() {
  return getSupabaseDataMode() === 'supabase' && isSupabaseConfigured();
}

export async function supabaseRequest(path, options = {}) {
  const config = getSupabaseConfig();
  if (!config) throw new SupabaseError('Supabase 尚未完成設定', 500, 'NOT_CONFIGURED');

  const {
    method = 'GET',
    body,
    json = true,
    responseType = 'json',
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  timeoutId.unref?.();

  const requestHeaders = {
    Accept: 'application/json',
    apikey: config.serverKey,
    Authorization: `Bearer ${config.serverKey}`,
    ...headers,
  };
  let requestBody = body;
  if (json && body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal,
    });
    if (responseType === 'arrayBuffer') {
      if (!response.ok) {
        const text = await response.text();
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        const message = parsed?.message || parsed?.error_description || parsed?.error;
        throw new SupabaseError(
          typeof message === 'string' && message ? message.slice(0, 240) : 'Supabase 操作失敗',
          response.status,
          String(parsed?.code || '')
        );
      }
      return {
        response,
        text: '',
        data: Buffer.from(await response.arrayBuffer()),
      };
    }
    const text = await response.text();
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = null; }
    }
    if (!response.ok) {
      const message = parsed?.message || parsed?.error_description || parsed?.error;
      throw new SupabaseError(
        typeof message === 'string' && message ? message.slice(0, 240) : 'Supabase 操作失敗',
        response.status,
        String(parsed?.code || '')
      );
    }
    return { response, text, data: parsed };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new SupabaseError('Supabase 連線逾時', 504, 'TIMEOUT');
    }
    if (error instanceof SupabaseError) throw error;
    throw new SupabaseError('Supabase 暫時無法連線', 502, 'NETWORK');
  } finally {
    clearTimeout(timeoutId);
  }
}

function restPath(table, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.set(key, String(value));
  });
  const suffix = query.toString();
  return `/rest/v1/${encodeURIComponent(table)}${suffix ? `?${suffix}` : ''}`;
}

export async function supabaseSelect(table, params = {}) {
  const result = await supabaseRequest(restPath(table, { select: '*', ...params }));
  return Array.isArray(result.data) ? result.data : [];
}

export async function supabaseInsert(table, rows, options = {}) {
  const { returnRepresentation = true, timeoutMs } = options;
  const result = await supabaseRequest(`/rest/v1/${encodeURIComponent(table)}`, {
    method: 'POST',
    body: Array.isArray(rows) ? rows : [rows],
    headers: { Prefer: returnRepresentation ? 'return=representation' : 'return=minimal' },
    timeoutMs,
  });
  return Array.isArray(result.data) ? result.data : [];
}

export async function supabaseUpsert(table, rows, onConflict = 'id') {
  const path = `/rest/v1/${encodeURIComponent(table)}?on_conflict=${encodeURIComponent(onConflict)}`;
  const result = await supabaseRequest(path, {
    method: 'POST',
    body: Array.isArray(rows) ? rows : [rows],
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  });
  return Array.isArray(result.data) ? result.data : [];
}

export async function supabaseUpdate(table, filters, changes, options = {}) {
  const { returnRepresentation = true, timeoutMs } = options;
  const result = await supabaseRequest(restPath(table, filters), {
    method: 'PATCH',
    body: changes,
    headers: { Prefer: returnRepresentation ? 'return=representation' : 'return=minimal' },
    timeoutMs,
  });
  return Array.isArray(result.data) ? result.data : [];
}

export async function supabaseDelete(table, filters) {
  const result = await supabaseRequest(restPath(table, filters), {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  return Array.isArray(result.data) ? result.data : [];
}

function storagePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export async function supabaseUploadPhoto(path, bytes, contentType) {
  const result = await supabaseRequest(
    `/storage/v1/object/worker-photos/${storagePath(path)}`,
    {
      method: 'POST',
      body: bytes,
      json: false,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=31536000',
        'x-upsert': 'false',
      },
    }
  );
  return result.data;
}

export async function supabaseDeletePhoto(path) {
  if (!path) return;
  await supabaseRequest('/storage/v1/object/worker-photos', {
    method: 'DELETE',
    body: { prefixes: [path] },
  });
}

export async function supabaseDownloadPhoto(path) {
  const result = await supabaseRequest(
    `/storage/v1/object/worker-photos/${storagePath(path)}`,
    { responseType: 'arrayBuffer' }
  );
  return {
    bytes: result.data,
    contentType: result.response.headers.get('content-type') || 'image/jpeg',
  };
}

export async function supabaseCreateSignedPhotoUrl(path, expiresIn = 300) {
  return supabaseCreateSignedObjectUrl('worker-photos', path, expiresIn);
}

export async function supabaseEnsurePrivateBucket(bucket, options = {}) {
  const bucketId = String(bucket || '').trim();
  if (!bucketId) throw new SupabaseError('Supabase 儲存空間名稱不正確', 400, 'BUCKET_NAME');
  try {
    await supabaseRequest('/storage/v1/bucket', {
      method: 'POST',
      body: {
        id: bucketId,
        name: bucketId,
        public: false,
        file_size_limit: options.fileSizeLimit || 50000000,
        allowed_mime_types: options.allowedMimeTypes || ['application/json'],
      },
    });
  } catch (error) {
    const alreadyExists = error instanceof SupabaseError
      && (error.status === 409 || (error.status === 400 && /already exists|duplicate|exists/i.test(error.message)));
    if (!alreadyExists) throw error;
  }
}

export async function supabaseUploadObject(bucket, path, bytes, contentType) {
  const bucketId = String(bucket || '').trim();
  const result = await supabaseRequest(
    `/storage/v1/object/${encodeURIComponent(bucketId)}/${storagePath(path)}`,
    {
      method: 'POST',
      body: bytes,
      json: false,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
        'x-upsert': 'false',
      },
    }
  );
  return result.data;
}

export async function supabaseCreateSignedObjectUrl(bucket, path, expiresIn = 300) {
  const bucketId = String(bucket || '').trim();
  const result = await supabaseRequest(
    `/storage/v1/object/sign/${encodeURIComponent(bucketId)}/${storagePath(path)}`,
    {
      method: 'POST',
      body: { expiresIn },
    }
  );
  const signedPath = result.data?.signedURL || result.data?.signedUrl || '';
  if (!signedPath) throw new SupabaseError('照片連結產生失敗', 502, 'PHOTO_SIGN');
  if (/^https?:\/\//i.test(signedPath)) return signedPath;
  const config = getSupabaseConfig();
  return `${config.baseUrl}${signedPath.startsWith('/') ? '' : '/'}${signedPath}`;
}
