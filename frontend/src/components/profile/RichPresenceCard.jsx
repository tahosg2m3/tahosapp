import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  ExternalLink,
  Eye,
  Gamepad2,
  Headphones,
  Pause,
  Radio,
  Trophy,
  Users,
} from 'lucide-react';
import { resolveSafeMediaUrl } from '../../utils/safeMediaUrl';

const TYPE_DETAILS = {
  playing: { label: 'Playing', icon: Gamepad2 },
  listening: { label: 'Listening', icon: Headphones },
  watching: { label: 'Watching', icon: Eye },
  working: { label: 'Working', icon: Briefcase },
  competing: { label: 'Competing', icon: Trophy },
  custom: { label: 'Active', icon: Radio },
};

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function RichPresenceCard({ activity, compact = false }) {
  const [, setTick] = useState(0);
  const typeInfo = TYPE_DETAILS[activity?.type] || TYPE_DETAILS.custom;
  const TypeIcon = typeInfo.icon;
  const largeImage = resolveSafeMediaUrl(activity?.imageUrl);
  const smallImage = resolveSafeMediaUrl(activity?.smallImageUrl);
  const metadata = Object.entries(activity?.metadata || {}).slice(0, compact ? 2 : 8);
  const now = Date.now();

  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = activity?.startedAt ? Math.max(0, now - Number(activity.startedAt)) : 0;
  const musicProgress = useMemo(() => {
    const duration = Number(activity?.music?.durationMs);
    if (!duration) return null;
    const basePosition = Number(activity.music.positionMs) || 0;
    const sinceUpdate = activity?.playbackStatus === 'paused'
      ? 0
      : Math.max(0, now - Number(activity.updatedAt || now));
    const current = Math.min(duration, basePosition + sinceUpdate);
    return { current, total: duration, percentage: Math.min(100, (current / duration) * 100) };
  }, [activity, now]);
  const progress = useMemo(() => {
    if (musicProgress) return musicProgress;
    if (!activity?.progress) return null;
    const total = Number(activity.progress.total);
    const baseCurrent = Number(activity.progress.current);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(baseCurrent)) return null;
    const isTimedVideo = activity?.category === 'video';
    const sinceUpdate = isTimedVideo && activity?.playbackStatus !== 'paused'
      ? Math.max(0, now - Number(activity.updatedAt || now))
      : 0;
    const current = Math.min(total, Math.max(0, baseCurrent + sinceUpdate));
    return {
      ...activity.progress,
      current,
      total,
      percentage: Math.min(100, Math.max(0, (current / total) * 100)),
    };
  }, [activity, musicProgress, now]);

  return (
    <article className={`overflow-hidden rounded-xl border border-white/[0.08] bg-[#1e1f22] text-[#dbdee1] ${compact ? 'p-3' : 'p-5'}`}>
      <div className={`flex min-w-0 ${compact ? 'gap-3' : 'gap-5'}`}>
        <div className={`relative flex shrink-0 items-center justify-center overflow-visible rounded-xl bg-[#2b2d31] ${compact ? 'h-16 w-16' : 'h-24 w-24'}`} title={activity?.imageText || activity?.name}>
          {largeImage
            ? <img src={largeImage} alt="" className="h-full w-full rounded-xl object-cover" />
            : <TypeIcon className={`${compact ? 'h-7 w-7' : 'h-11 w-11'} text-[#949ba4]`} />}
          {smallImage && (
            <img
              src={smallImage}
              alt=""
              title={activity?.smallImageText || ''}
              className={`absolute -bottom-1.5 -right-1.5 rounded-full border-[3px] border-[#1e1f22] object-cover ${compact ? 'h-7 w-7' : 'h-9 w-9'}`}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#949ba4]"><TypeIcon className="h-3.5 w-3.5" /> {typeInfo.label}</p>
          <h3 className={`mt-0.5 truncate font-bold text-white ${compact ? 'text-sm' : 'text-xl'}`}>{activity?.name}</h3>
          {activity?.music?.song && <p className={`${compact ? 'text-xs' : 'text-base'} mt-1 truncate font-semibold text-[#dbdee1]`}>{activity.music.song}</p>}
          {(activity?.music?.artist || activity?.music?.album) && <p className="truncate text-xs text-[#949ba4]">{[activity.music.artist, activity.music.album].filter(Boolean).join(' — ')}</p>}
          {activity?.details && activity.details !== activity?.music?.song && <p className={`${compact ? 'text-xs' : 'text-base'} mt-1 truncate text-[#b5bac1]`}>{activity.details}</p>}
          {activity?.state && activity.state !== activity?.music?.artist && <p className="truncate text-xs text-[#949ba4]">{activity.state}</p>}
          {activity?.playbackStatus === 'paused'
            ? <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-[#f0b232]"><Pause className="h-3.5 w-3.5 fill-current" /> Paused</p>
            : !activity?.hideElapsed && <p className="mt-1.5 text-xs tabular-nums text-[#949ba4]">{formatDuration(elapsed)} elapsed</p>}
        </div>
      </div>

      {progress && Number.isFinite(progress.percentage) && (
        <div className={`${compact ? 'mt-3' : 'mt-4'}`}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-[#949ba4]">
            <span className="truncate">{progress.label || (activity?.type === 'listening' ? 'Track progress' : 'Progress')}</span>
            <span className="shrink-0 tabular-nums">{['music', 'video'].includes(activity?.category) || activity?.type === 'listening' ? `${formatDuration(progress.current)} / ${formatDuration(progress.total)}` : `${progress.current} / ${progress.total}`}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/35"><span className="block h-full rounded-full bg-[#5865f2] transition-[width] duration-500" style={{ width: `${progress.percentage}%` }} /></div>
        </div>
      )}

      {!compact && (activity?.party || metadata.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {activity.party && <span className="inline-flex items-center gap-1.5 rounded-md bg-black/25 px-2.5 py-1.5 text-xs text-[#b5bac1]"><Users className="h-3.5 w-3.5" /> {activity.party.size}/{activity.party.max}</span>}
          {metadata.map(([key, value]) => <span key={key} className="rounded-md bg-black/25 px-2.5 py-1.5 text-xs text-[#b5bac1]"><strong className="text-[#dbdee1]">{key}:</strong> {String(value)}</span>)}
        </div>
      )}

      {!compact && activity?.buttons?.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {activity.buttons.map(button => (
            <a key={`${button.label}-${button.url}`} href={button.url} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="flex items-center justify-center gap-2 rounded-md bg-[#4e5058] px-3 py-2 text-sm font-semibold text-white hover:bg-[#6d6f78]">
              {button.label}<ExternalLink className="h-3.5 w-3.5" />
            </a>
          ))}
        </div>
      )}
    </article>
  );
}
