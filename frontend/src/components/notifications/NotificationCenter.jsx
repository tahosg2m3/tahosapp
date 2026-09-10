import { useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, CheckCheck, X } from 'lucide-react';
import { useSocket } from '../../context/SocketContext';
import { FEEDBACK_SOUND_IDS, playFeedbackSound } from '../../services/feedbackSoundService';

function formatNotificationTime(timestamp) {
  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export default function NotificationCenter() {
  const { socket } = useSocket();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [permission, setPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  useEffect(() => {
    if (!socket) return undefined;

    const receiveNotification = (notification) => {
      const nextNotification = {
        id: notification.id || `${notification.messageId || Date.now()}-${Math.random()}`,
        title: notification.title || 'New message',
        body: notification.body || '',
        timestamp: notification.timestamp || Date.now(),
        ...notification,
      };

      setNotifications(previous => [nextNotification, ...previous].slice(0, 50));
      playFeedbackSound(FEEDBACK_SOUND_IDS.MESSAGE);

      if (document.hidden && Notification.permission === 'granted') {
        new Notification(nextNotification.title, {
          body: nextNotification.body,
          icon: nextNotification.icon,
          tag: nextNotification.channelId || nextNotification.id,
        });
      }
    };

    socket.on('notification:new', receiveNotification);
    return () => socket.off('notification:new', receiveNotification);
  }, [socket]);

  const unreadCount = notifications.filter(item => !item.read).length;
  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  const visibleNotifications = useMemo(() => notifications.slice(0, 12), [notifications]);

  return (
    <div className="fixed right-5 top-4 z-[80]">
      <button
        type="button"
        onClick={() => {
          setIsOpen(previous => !previous);
          setNotifications(previous => previous.map(item => ({ ...item, read: true })));
        }}
        aria-label="Notifications"
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.09] bg-[#151b27]/95 text-[#cbd5e1] shadow-xl backdrop-blur transition hover:bg-[#243045] hover:text-white"
      >
        {unreadCount ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <section className="absolute right-0 mt-2 w-[340px] overflow-hidden rounded-xl border border-white/[0.09] bg-[#111827] shadow-2xl">
          <header className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-[#f8fafc]">Notifications</h2>
              <p className="text-[11px] text-[#94a3b8]">Mentions and new messages</p>
            </div>
            <button
              type="button"
              onClick={() => setNotifications([])}
              className="rounded-md p-1.5 text-[#94a3b8] hover:bg-white/[0.07] hover:text-white"
              title="Clear all"
            >
              <CheckCheck className="h-4 w-4" />
            </button>
          </header>

          {permission === 'default' && (
            <button
              type="button"
              onClick={requestPermission}
              className="mx-3 mt-3 w-[calc(100%-1.5rem)] rounded-lg bg-[#2563eb] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1d4ed8]"
            >
              Allow desktop notifications
            </button>
          )}

          <div className="max-h-[420px] overflow-y-auto p-2 custom-scrollbar">
            {visibleNotifications.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-[#64748b]">You have no notifications yet.</p>
            ) : visibleNotifications.map(notification => (
              <article key={notification.id} className="group relative rounded-lg px-3 py-2.5 hover:bg-white/[0.06]">
                <p className="pr-6 text-xs font-bold text-[#e2e8f0]">{notification.title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-[#94a3b8]">{notification.body}</p>
                <time className="mt-1 block text-[10px] text-[#64748b]">{formatNotificationTime(notification.timestamp)}</time>
                <button
                  type="button"
                  onClick={() => setNotifications(previous => previous.filter(item => item.id !== notification.id))}
                  className="absolute right-2 top-2 hidden rounded p-1 text-[#64748b] hover:bg-white/[0.08] hover:text-white group-hover:block"
                  title="Dismiss notification"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
