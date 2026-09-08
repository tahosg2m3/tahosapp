import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Save, User as UserRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { updateServerProfile } from '../../services/platformApi';
import { getColorForString } from '../../utils/colors';
import { resolveSafeAvatarUrl, resolveSafeMediaUrl } from '../../utils/safeMediaUrl';

const inputClass = 'mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#151d2c] px-3 py-2.5 text-sm text-white outline-none focus:border-[#3b82f6]';

export default function ServerProfileModal({ server, member, user, onUpdated, onClose }) {
  const [nickname, setNickname] = useState(member?.nickname || '');
  const [serverAvatar, setServerAvatar] = useState(member?.serverAvatar || '');
  const [serverBanner, setServerBanner] = useState(member?.serverBanner || '');
  const [serverBio, setServerBio] = useState(member?.serverBio || '');
  const [saving, setSaving] = useState(false);
  const displayName = nickname.trim() || user?.username || 'Üye';
  const avatar = serverAvatar.trim() ? resolveSafeAvatarUrl(serverAvatar) : resolveSafeAvatarUrl(user?.avatar);
  const banner = resolveSafeMediaUrl(serverBanner);

  const save = async event => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await updateServerProfile(server.id, {
        nickname: nickname.trim(),
        serverAvatar: serverAvatar.trim(),
        serverBanner: serverBanner.trim(),
        serverBio: serverBio.trim(),
      });
      onUpdated?.(result.member || result);
      toast.success('Sunucu profilin kaydedildi.');
      onClose?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm">
      <section className="max-h-[calc(100vh-40px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0f172a] shadow-2xl">
        <div className="relative h-28 overflow-hidden bg-gradient-to-r from-[#1d4ed8] to-[#7c3aed]">
          {banner && <img src={banner} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="relative px-6 pb-6">
          <div className="absolute -top-12 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-[#0f172a] text-3xl font-bold text-white" style={{ backgroundColor: getColorForString(displayName) }}>
            {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : displayName[0]?.toUpperCase()}
          </div>
          <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full bg-black/20 p-2 text-white/80 hover:bg-black/30 hover:text-white" aria-label="Kapat"><X className="h-5 w-5" /></button>
          <div className="pt-16">
            <div className="flex items-center gap-2"><UserRound className="h-5 w-5 text-[#60a5fa]" /><h2 className="text-xl font-bold text-white">Sunucu Profili</h2></div>
            <p className="mt-1 text-xs text-[#64748b]">Bu bilgiler yalnızca {server.name} içinde görünür ve tamamen ücretsizdir.</p>
            <form onSubmit={save} className="mt-5 space-y-4">
              <label className="block text-xs font-bold uppercase text-[#94a3b8]">Sunucu takma adı<input maxLength="32" value={nickname} onChange={event => setNickname(event.target.value)} placeholder={user?.username} className={inputClass} /></label>
              <label className="block text-xs font-bold uppercase text-[#94a3b8]">Sunucu avatarı URL’si<input type="url" value={serverAvatar} onChange={event => setServerAvatar(event.target.value)} placeholder="Genel avatarı kullan" className={inputClass} /></label>
              <label className="block text-xs font-bold uppercase text-[#94a3b8]">Sunucu afişi URL’si<input type="url" value={serverBanner} onChange={event => setServerBanner(event.target.value)} placeholder="Genel profil afişini kullan" className={inputClass} /></label>
              <label className="block text-xs font-bold uppercase text-[#94a3b8]">Bu sunucuda hakkımda<textarea rows="3" maxLength="300" value={serverBio} onChange={event => setServerBio(event.target.value)} placeholder="Genel profil açıklamasını kullan" className={`${inputClass} resize-none`} /></label>
              <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2563eb] py-2.5 text-sm font-bold text-white hover:bg-[#1d4ed8] disabled:opacity-50"><Save className="h-4 w-4" /> {saving ? 'Kaydediliyor…' : 'Profili kaydet'}</button>
            </form>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
