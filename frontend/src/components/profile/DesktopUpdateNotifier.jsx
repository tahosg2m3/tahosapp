import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

export default function DesktopUpdateNotifier() {
  const notifiedVersionRef = useRef('');

  useEffect(() => {
    const bridge = globalThis.electron?.desktopUpdater;
    if (!bridge) return undefined;

    const showReadyNotification = state => {
      if (state?.status !== 'downloaded' || !state.availableVersion) return;
      if (notifiedVersionRef.current === state.availableVersion) return;
      notifiedVersionRef.current = state.availableVersion;

      toast.custom(t => (
        <div className="w-[360px] rounded-xl border border-white/[0.09] bg-[#17191f] p-4 text-[#DBDEE1] shadow-2xl">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5865F2]/20 text-[#aab4ff]">
              <RefreshCw className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-white">tahosapp {state.availableVersion} is ready</p>
              <p className="mt-1 text-xs leading-5 text-[#949BA4]">The update has downloaded. It will install automatically when you close the app, or you can restart now.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => bridge.install()} className="rounded-md bg-[#5865F2] px-3 py-2 text-xs font-bold text-white hover:bg-[#4752C4]">
                  Restart and Install
                </button>
                <button type="button" onClick={() => toast.dismiss(t.id)} className="rounded-md bg-[#383A40] px-3 py-2 text-xs font-bold text-[#DBDEE1] hover:bg-[#4E5058]">
                  Sonra
                </button>
              </div>
            </div>
          </div>
        </div>
      ), { id: 'desktop-update-ready', duration: Infinity });
    };

    bridge.getState().then(showReadyNotification).catch(() => {});
    return bridge.onState(showReadyNotification);
  }, []);

  return null;
}
