import { useEffect, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { fetchGifs } from '../../services/api';

export default function GifPicker({ onClose, onSelectGif }) {
  const [search, setSearch] = useState('');
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const query = search.trim();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const payload = await fetchGifs(query, 24);
        if (active) setGifs(Array.isArray(payload?.gifs) ? payload.gifs : []);
      } catch (requestError) {
        if (!active) return;
        setGifs([]);
        setError(requestError.message || 'The GIF list could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    }, query ? 400 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search]);

  const handleSelectGif = (gif) => {
    if (!gif?.url) return;
    onSelectGif({
      url: gif.url,
      previewUrl: gif.previewUrl || gif.url,
      filename: gif.title || 'GIPHY GIF',
      mimetype: 'image/gif',
      type: 'gif',
      source: 'giphy',
      sourceId: gif.id,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="GIF picker" onMouseDown={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#1e293b] shadow-2xl shadow-black/50" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/[0.08] p-4">
          <div><h2 className="text-lg font-semibold text-[#f8fafc]">Choose a GIF</h2><p className="text-xs text-[#64748b]">Search GIPHY or choose a trending GIF</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-[#94a3b8] transition-colors hover:bg-white/[0.08] hover:text-white" aria-label="Close GIF picker"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-4">
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#94a3b8]" />
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="GIPHY'de ara…" className="w-full rounded-xl border border-white/[0.07] bg-[#111827] py-2.5 pl-10 pr-4 text-[#f8fafc] outline-none transition-colors placeholder:text-[#64748b] focus:border-[#3b82f6]" autoFocus />
          </label>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="flex h-52 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#60a5fa]" /></div>
          ) : error ? (
            <div className="flex h-52 items-center justify-center px-8 text-center text-sm leading-6 text-[#fca5a5]">{error}</div>
          ) : gifs.length ? (
            <div className="columns-2 gap-2 md:columns-3">
              {gifs.map(gif => (
                <button key={gif.id} type="button" onClick={() => handleSelectGif(gif)} className="group relative mb-2 block w-full break-inside-avoid overflow-hidden rounded-xl bg-[#111827] text-left transition hover:ring-2 hover:ring-[#60a5fa]">
                  <img src={gif.previewUrl || gif.url} alt={gif.title || 'GIF'} className="h-auto w-full object-cover" loading="lazy" />
                  <span className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/85 to-transparent px-2 pb-2 pt-8 text-xs font-medium text-white transition-transform group-hover:translate-y-0">Choose</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-52 items-center justify-center text-sm text-[#94a3b8]">No GIFs found.</div>
          )}
        </div>

        <div className="border-t border-white/[0.08] p-3 text-center"><p className="text-xs font-semibold tracking-wide text-[#64748b]">Powered by GIPHY</p></div>
      </div>
    </div>
  );
}
