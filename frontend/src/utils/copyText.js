export async function copyText(value) {
  const text = String(value ?? '');
  if (!text) throw new Error('There is no text to copy.');

  const desktopWrite = globalThis.electron?.clipboard?.writeText;
  if (typeof desktopWrite === 'function') {
    try {
      if (await desktopWrite(text)) return;
    } catch {
      // Use the browser clipboard if the desktop bridge is unavailable.
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error('The clipboard is unavailable.');
}
