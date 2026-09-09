import { useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { clearRichPresenceActivity, getRichPresenceSettings, setRichPresenceActivity } from '../../services/api';
import {
  AUTOMATIC_PRESENCE_PREFERENCES_EVENT,
  filterAutomaticPresenceActivities,
  isAutomaticPresenceVoicesionId,
  readAutomaticPresencePreferences,
} from '../../utils/automaticPresencePreferences';

export default function AutomaticRichPresence() {
  const { user } = useAuth();
  const activeVoicesionsRef = useRef(new Set());
  const queueRef = useRef(Promise.resolve());
  const latestSnapshotRef = useRef([]);
  const preferencesRef = useRef(readAutomaticPresencePreferences());

  useEffect(() => {
    const bridge = window.electron?.automaticPresence;
    if (!bridge || !user?.id) return undefined;
    let active = true;
    // Eski sürümün sabit oturum kimlikleri de ilk yayında temizlenir.
    activeVoicesionsRef.current = new Set(['auto-game', 'auto-media']);

    const publishSnapshot = snapshot => {
      latestSnapshotRef.current = Array.isArray(snapshot) ? snapshot : [];
      const activities = filterAutomaticPresenceActivities(latestSnapshotRef.current, preferencesRef.current);
      queueRef.current = queueRef.current.then(async () => {
        if (!active) return;
        const nextVoicesions = new Set(activities.map(activity => activity.sessionId));
        for (const activity of activities) {
          if (!active) return;
          try {
            await setRichPresenceActivity(activity);
          } catch (_) {
            // Paylaşım hesap ayarından kapalıysa veya bağlantı geçici olarak
            // yoksa bir sonraki yaklaşık 3 saniyelik tarama sessizce tekrar dener.
          }
        }
        for (const sessionId of activeVoicesionsRef.current) {
          if (nextVoicesions.has(sessionId)) continue;
          try {
            await clearRichPresenceActivity(sessionId);
          } catch (_) {
            // Sunucuya ulaşılamıyorsa 60 saniyelik TTL eski durumu temizler.
          }
        }
        if (active) activeVoicesionsRef.current = nextVoicesions;
      });
    };

    const handlePreferencesChanged = event => {
      preferencesRef.current = event?.detail || readAutomaticPresencePreferences();
      publishSnapshot(latestSnapshotRef.current);
    };

    const unsubscribe = bridge.onUpdate(publishSnapshot);
    window.addEventListener(AUTOMATIC_PRESENCE_PREFERENCES_EVENT, handlePreferencesChanged);
    Promise.allSettled([bridge.start(), getRichPresenceSettings()])
      .then(([scannerResult, managementResult]) => {
        if (!active) return;
        if (managementResult.status === 'fulfilled') {
          (managementResult.value?.activities || [])
            .filter(activity => isAutomaticPresenceVoicesionId(activity?.sessionId))
            .forEach(activity => activeVoicesionsRef.current.add(activity.sessionId));
        }
        publishSnapshot(scannerResult.status === 'fulfilled' ? scannerResult.value?.activities || [] : []);
      });

    return () => {
      active = false;
      unsubscribe?.();
      window.removeEventListener(AUTOMATIC_PRESENCE_PREFERENCES_EVENT, handlePreferencesChanged);
      bridge.stop().catch(() => {});
      const staleVoicesions = [...activeVoicesionsRef.current];
      activeVoicesionsRef.current = new Set();
      staleVoicesions.forEach(sessionId => clearRichPresenceActivity(sessionId).catch(() => {}));
    };
  }, [user?.id]);

  return null;
}
