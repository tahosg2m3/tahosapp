import { API_ORIGIN } from '../config/runtimeConfig';

const GET_CACHE_TTL_MS = 1_500;
const MAX_COMPLETED_GETS = 100;
const inFlightGets = new Map();
const completedGets = new Map();
let cacheGeneration = 0;

function bytesFromBase64(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function desktopResponseBody(result) {
  if (result?.body == null) return new Uint8Array();
  if (result.body instanceof ArrayBuffer) return new Uint8Array(result.body);
  if (ArrayBuffer.isView(result.body)) {
    return new Uint8Array(result.body.buffer, result.body.byteOffset, result.body.byteLength);
  }
  // Older desktop versions used Base64 across the bridge. Keep accepting it
  // so the renderer and the main process can be upgraded independently.
  return bytesFromBase64(result.body);
}

function headersToObject(headers) {
  return Object.fromEntries(new Headers(headers || {}).entries());
}

function requestMethod(init) {
  return String(init.method || 'GET').trim().toUpperCase();
}

function getCacheKey(target, init) {
  if (requestMethod(init) !== 'GET' || init.cache === 'no-store') return null;
  const headers = new Headers(init.headers || {});
  if (/no-store/i.test(headers.get('cache-control') || '')) return null;
  // The authorization value prevents data from one signed-in account being
  // reused after an account switch. It never leaves this in-memory map.
  return `${target.href}\n${headers.get('authorization') || ''}`;
}

function clearCompletedGetCache() {
  cacheGeneration += 1;
  completedGets.clear();
}

async function requestThroughDesktopBridge(target, init, bridge) {
  if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

  let removeAbortListener = () => {};
  const bridgeRequest = bridge({
    path: `${target.pathname}${target.search}`,
    method: init.method || 'GET',
    headers: headersToObject(init.headers),
    body: init.body,
  });
  const abortRequest = new Promise((_, reject) => {
    if (!init.signal) return;
    const handleAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    init.signal.addEventListener('abort', handleAbort, { once: true });
    removeAbortListener = () => init.signal.removeEventListener('abort', handleAbort);
  });

  let result;
  try {
    result = init.signal ? await Promise.race([bridgeRequest, abortRequest]) : await bridgeRequest;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new TypeError('The desktop app could not establish a secure API connection.');
  } finally {
    removeAbortListener();
  }

  if (!result || result.transportError) {
    const message = result?.code === 'API_TIMEOUT'
      ? 'The server response timed out.'
      : 'The desktop app could not connect to the server.';
    throw new TypeError(message);
  }

  const hasNoResponseBody = [204, 205, 304].includes(result.status);
  return new Response(hasNoResponseBody ? null : desktopResponseBody(result), {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}

async function performApiFetch(input, init, target) {
  const bridge = globalThis.electron?.api?.request;
  const canUseDesktopBridge = typeof bridge === 'function'
    && target.origin === API_ORIGIN
    && target.pathname.startsWith('/api/')
    && (init.body == null || typeof init.body === 'string');

  if (!canUseDesktopBridge) return fetch(input, init);

  // Chromium's native fetch is the fastest path and preserves cancellation,
  // connection pooling and streaming. Some Windows/network configurations do
  // block custom-scheme CORS requests, so retain the privileged bridge as a
  // transparent fallback instead of making every request pay the IPC cost.
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error?.name === 'AbortError' || init.signal?.aborted) throw error;
    return requestThroughDesktopBridge(target, init, bridge);
  }
}

export function invalidateApiCache() {
  clearCompletedGetCache();
}

export async function apiFetch(input, init = {}) {
  const target = new URL(String(input), globalThis.location?.href);
  const cacheKey = getCacheKey(target, init);

  if (!cacheKey) {
    if (!['GET', 'HEAD'].includes(requestMethod(init))) clearCompletedGetCache();
    return performApiFetch(input, init, target);
  }

  const cached = completedGets.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response.clone();
  if (cached) completedGets.delete(cacheKey);

  const pending = inFlightGets.get(cacheKey);
  if (pending) return (await pending).clone();

  const requestGeneration = cacheGeneration;
  const request = performApiFetch(input, init, target)
    .then((response) => {
      if (response.ok && requestGeneration === cacheGeneration) {
        if (completedGets.size >= MAX_COMPLETED_GETS) {
          const oldestKey = completedGets.keys().next().value;
          if (oldestKey) completedGets.delete(oldestKey);
        }
        const cacheEntry = {
          expiresAt: Date.now() + GET_CACHE_TTL_MS,
          response: response.clone(),
        };
        completedGets.set(cacheKey, cacheEntry);
        globalThis.setTimeout(() => {
          if (completedGets.get(cacheKey) === cacheEntry) completedGets.delete(cacheKey);
        }, GET_CACHE_TTL_MS);
      }
      return response;
    })
    .finally(() => inFlightGets.delete(cacheKey));

  inFlightGets.set(cacheKey, request);
  return (await request).clone();
}
