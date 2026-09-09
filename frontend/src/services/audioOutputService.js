const OUTPUT_DEVICE_STORAGE_KEY = 'voice:output-device';

let selectedOutputDeviceId = typeof localStorage !== 'undefined'
  ? (localStorage.getItem(OUTPUT_DEVICE_STORAGE_KEY) || '')
  : '';
const activeOutputTargets = new Set();
let warnedAboutUnsupportedRouting = false;

export function getSelectedAudioOutputDeviceId() {
  return selectedOutputDeviceId;
}

export async function applyAudioOutputDevice(target, deviceId = selectedOutputDeviceId) {
  if (!target) return false;
  const nextDeviceId = String(deviceId || '');
  if (typeof target.setSinkId !== 'function') {
    if (nextDeviceId && !warnedAboutUnsupportedRouting) {
      warnedAboutUnsupportedRouting = true;
      console.warn('This environment does not support changing the output device for app audio.');
    }
    return !nextDeviceId;
  }

  try {
    await target.setSinkId(nextDeviceId);
    return true;
  } catch (error) {
    if (error?.name !== 'NotAllowedError') {
      console.warn('Could not apply the audio output device:', error);
    }
    return false;
  }
}

export function registerAudioOutputTarget(target) {
  if (!target) return () => {};
  activeOutputTargets.add(target);
  void applyAudioOutputDevice(target);
  return () => activeOutputTargets.delete(target);
}

export function setGlobalAudioOutputDevice(deviceId) {
  selectedOutputDeviceId = String(deviceId || '');
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, selectedOutputDeviceId);
  }
  return Promise.allSettled(
    [...activeOutputTargets].map(target => applyAudioOutputDevice(target, selectedOutputDeviceId)),
  );
}
