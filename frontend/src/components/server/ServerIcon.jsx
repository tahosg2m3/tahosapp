import { useEffect, useRef } from 'react';
import { getColorForString } from '../../utils/colors';

export default function ServerIcon({ server, active, onClick, onPrefetch }) {
  const prefetchTimerRef = useRef(null);
  const color = getColorForString(server.name);
  const initials = server.name.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 2);

  const schedulePrefetch = () => {
    clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = window.setTimeout(() => onPrefetch?.(), 120);
  };

  const cancelPrefetch = () => clearTimeout(prefetchTimerRef.current);

  useEffect(() => () => clearTimeout(prefetchTimerRef.current), []);

  return (
    <div
      className="relative group flex items-center justify-center w-[72px] h-[48px] mb-2 cursor-pointer"
      onMouseEnter={schedulePrefetch}
      onMouseLeave={cancelPrefetch}
    >
      <div className={`absolute left-0 w-1 bg-white rounded-r-md transition-all duration-300 ease-in-out ${active ? 'h-10 opacity-100' : 'h-2 opacity-0 group-hover:h-5 group-hover:opacity-100'}`} />

      <button
        onClick={() => { cancelPrefetch(); onPrefetch?.(); onClick(); }}
        onFocus={schedulePrefetch}
        onBlur={cancelPrefetch}
        className={`w-[48px] h-[48px] flex items-center justify-center overflow-hidden transition-all duration-300 ease-in-out text-white font-medium text-[15px] ${active ? 'rounded-[16px] shadow-sm' : 'rounded-[24px] hover:rounded-[16px] hover:shadow-sm'}`}
        style={{ backgroundColor: active ? '#5865F2' : color }}
      >
        {server.icon ? <img src={server.icon} alt={server.name} className="w-full h-full object-cover" /> : <span>{initials}</span>}
      </button>

      <div className="absolute left-[76px] px-3 py-2 bg-[#111214] text-[#DBDEE1] text-[14px] font-semibold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-all duration-150 scale-95 group-hover:scale-100 shadow-xl flex items-center">
        <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-[#111214] rotate-45" />
        {server.name}
      </div>
    </div>
  );
}
