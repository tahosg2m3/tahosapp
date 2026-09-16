import { useEffect, useState } from 'react';
import { API_URL } from '../../config/runtimeConfig';
import { exchangeSocialAuthTicket, fetchSocialAuthProviders } from '../../services/api';

const FALLBACK_PROVIDERS = [
  { id: 'google', label: 'Google', enabled: false },
];

const SOCIAL_ERRORS = {
  cancelled: 'Sosyal giriş iptal edildi.',
  account_banned: 'Bu hesap tahosapp üzerinde kullanılamıyor.',
  verification_failed: 'Sosyal hesap doğrulanamadı. Lütfen tekrar deneyin.',
  provider_error: 'Giriş sağlayıcısı işlemi tamamlayamadı.',
  invalid_request: 'Sosyal giriş isteğinin süresi doldu. Lütfen tekrar deneyin.',
};

function finishLogin(response) {
  localStorage.setItem('user', JSON.stringify(response.user));
  localStorage.setItem('chat_token', response.token);
  window.location.reload();
}

export default function SocialAuthButtons({ mode = 'login', onError }) {
  const [providers, setProviders] = useState(FALLBACK_PROVIDERS);
  const [loadingProvider, setLoadingProvider] = useState('');

  useEffect(() => {
    let active = true;
    fetchSocialAuthProviders()
      .then(payload => {
        if (!active || !Array.isArray(payload.providers)) return;
        const googleProviders = payload.providers.filter(provider => provider.id === 'google');
        setProviders(googleProviders.length ? googleProviders : FALLBACK_PROVIDERS);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const exchange = async ticket => {
      if (!ticket || !active) return;
      setLoadingProvider('exchange');
      try {
        finishLogin(await exchangeSocialAuthTicket(ticket));
      } catch (error) {
        if (active) onError?.(error.message || 'Sosyal giriş tamamlanamadı.');
        setLoadingProvider('');
      }
    };

    const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const webTicket = parameters.get('social_ticket');
    const webError = parameters.get('social_error');
    if (webTicket || webError) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      if (webTicket) void exchange(webTicket);
      else onError?.(SOCIAL_ERRORS[webError] || 'Sosyal giriş tamamlanamadı.');
    }

    const unsubscribe = globalThis.electron?.socialAuth?.onCallback?.(payload => {
      if (payload?.ticket) void exchange(payload.ticket);
      else if (payload?.error) onError?.(SOCIAL_ERRORS[payload.error] || 'Sosyal giriş tamamlanamadı.');
    });
    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [onError]);

  const start = async provider => {
    if (!provider.enabled || loadingProvider) return;
    onError?.('');
    setLoadingProvider(provider.id);
    try {
      if (globalThis.electron?.socialAuth?.start) {
        const result = await globalThis.electron.socialAuth.start(provider.id);
        if (!result?.started) throw new Error('Giriş sayfası açılamadı.');
        setLoadingProvider('');
        return;
      }
      window.location.assign(`${API_URL}/auth/social/${encodeURIComponent(provider.id)}/start?client=web`);
    } catch (error) {
      onError?.(error.message || 'Sosyal giriş başlatılamadı.');
      setLoadingProvider('');
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        {providers.map(provider => (
          <button
            key={provider.id}
            type="button"
            onClick={() => start(provider)}
            disabled={!provider.enabled || Boolean(loadingProvider)}
            title={provider.enabled ? `${provider.label} ile devam et` : `${provider.label} henüz yapılandırılmadı`}
            className="flex min-w-0 items-center justify-center gap-2 rounded border border-white/[0.1] bg-[#1E1F22] px-3 py-2.5 text-sm font-semibold text-[#DBDEE1] transition-colors hover:bg-[#404249] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4285F4] text-xs font-black text-white">{provider.label.slice(0, 1)}</span>
            <span className="truncate">{loadingProvider === provider.id ? 'Açılıyor…' : provider.label}</span>
          </button>
        ))}
      </div>
      {providers.every(provider => !provider.enabled) && (
        <p className="text-center text-[11px] leading-4 text-[#72767D]">Google girişi sunucu anahtarları eklendiğinde etkinleşir.</p>
      )}
      <p className="sr-only">{mode === 'register' ? 'Sosyal hesapla kaydol' : 'Sosyal hesapla giriş yap'}</p>
    </div>
  );
}
