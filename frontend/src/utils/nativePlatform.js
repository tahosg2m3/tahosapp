// The build flag is independent of the bridge, including during cold startup.
export const isNativeAndroid = () => import.meta.env.VITE_NATIVE_ANDROID === 'true'
  || globalThis.Capacitor?.getPlatform?.() === 'android';
