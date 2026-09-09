import { API_ORIGIN } from '../config/runtimeConfig';

function bytesFromBase64(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function headersToObject(headers) {
  return Object.fromEntries(new Headers(headers || {}).entries());
}

export async function apiFetch(input, init = {}) {
  const target = new URL(String(input), globalThis.location?.href);
  const bridge = globalThis.electron?.api?.request;
  const canUseDesktopBridge = typeof bridge === 'function'
    && target.origin === API_ORIGIN
    && target.pathname.startsWith('/api/')
    && (init.body == null || typeof init.body === 'string');

  if (!canUseDesktopBridge) return fetch(input, init);
  if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

  let result;
  try {
    result = await bridge({
      path: `${target.pathname}${target.search}`,
      method: init.method || 'GET',
      headers: headersToObject(init.headers),
      body: init.body,
    });
  } catch (_) {
    throw new TypeError('The desktop app could not establish a secure API connection.');
  }

  if (!result || result.transportError) {
    const message = result?.code === 'API_TIMEOUT'
      ? 'The server response timed out.'
      : 'The desktop app could not connect to the server.';
    throw new TypeError(message);
  }

  const hasNoResponseBody = [204, 205, 304].includes(result.status);
  return new Response(hasNoResponseBody ? null : bytesFromBase64(result.body), {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}
