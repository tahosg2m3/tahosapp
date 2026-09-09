import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { useServer } from '../../context/ServerContext';

export default function NsfwGate({ channel, children }) {
  const { setCurrentChannel } = useServer();
  const storageKey = `chat:nsfw-accepted:${channel?.id}`;
  const [accepted, setAccepted] = useState(
    () => !channel?.nsfw || sessionStorage.getItem(storageKey) === 'yes'
  );

  useEffect(() => {
    setAccepted(!channel?.nsfw || sessionStorage.getItem(storageKey) === 'yes');
  }, [channel?.id, channel?.nsfw, storageKey]);

  if (!channel?.nsfw || accepted) return children;

  return (
    <div className="flex h-full flex-1 items-center justify-center bg-[#0f172a] p-6">
      <section className="max-w-md rounded-3xl border border-[#ef4444]/25 bg-[#151d2c] p-7 text-center shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ef4444]/15 text-[#f87171]">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-white">Age-restricted channel</h1>
        <p className="mt-3 text-sm leading-6 text-[#94a3b8]">
          This channel may contain adult content. By continuing, you confirm that you are at least 18 years old.

        </p>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(storageKey, 'yes');
            setAccepted(true);
          }}
          className="mt-6 w-full rounded-xl bg-[#ef4444] py-3 text-sm font-bold text-white hover:bg-[#dc2626]"
        >
          I am 18 or older, continue
        </button>
        <button
          type="button"
          onClick={() => setCurrentChannel(null)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold text-[#94a3b8] hover:bg-white/[0.05] hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Go Back
        </button>
      </section>
    </div>
  );
}
