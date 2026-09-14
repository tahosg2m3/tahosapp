import { useEffect } from 'react';
import toast from 'react-hot-toast';

export default function DesktopUpdateNotifier() {
  useEffect(() => {
    const bridge = globalThis.electron?.desktopUpdater;
    if (!bridge) return undefined;

    const showUpdateError = state => {
      if (state?.status !== 'error' || !state.message) return;
      toast.error(state.message, { id: 'desktop-update-error', duration: 6000 });
    };

    bridge.getState().then(showUpdateError).catch(() => {});
    return bridge.onState(showUpdateError);
  }, []);

  return null;
}
