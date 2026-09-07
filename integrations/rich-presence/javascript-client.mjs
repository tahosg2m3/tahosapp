/**
 * Dependency-free Rich Presence client for Node.js 18+, Electron and modern browsers.
 * This client talks directly to tahosapp's first-party API.
 */
export class RichPresenceClient {
  constructor({ token, apiUrl = 'http://127.0.0.1:3001/api', heartbeatIntervalMs = 30_000 } = {}) {
    if (!token) throw new Error('A Rich Presence integration token is required.');
    this.token = token;
    this.apiUrl = String(apiUrl).replace(/\/$/, '');
    this.heartbeatIntervalMs = Math.max(15_000, Number(heartbeatIntervalMs) || 30_000);
    this.sessionId = null;
    this.currentActivity = null;
    this.heartbeatTimer = null;
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Presence ${this.token}`,
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Rich Presence request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async setActivity(activity) {
    const sessionId = String(activity?.sessionId || 'primary');
    this.currentActivity = { ...activity, sessionId, ttlSeconds: activity?.ttlSeconds || 120 };
    const payload = await this.request('/rich-presence', {
      method: 'PUT',
      body: JSON.stringify(this.currentActivity),
    });
    this.sessionId = sessionId;
    this.startHeartbeat();
    return payload.activity;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat().catch(error => console.warn('Rich Presence heartbeat failed:', error.message));
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  async heartbeat() {
    if (!this.sessionId) return null;
    try {
      const payload = await this.request('/rich-presence/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ sessionId: this.sessionId, ttlSeconds: 120 }),
      });
      return payload.activity;
    } catch (error) {
      // Backend yeniden başlatıldıysa bellekteki etkinlik oturumu kaybolur.
      // İstemci son etkinliği otomatik yeniden yayınlar.
      if (error.status === 404 && this.currentActivity) {
        const payload = await this.request('/rich-presence', {
          method: 'PUT',
          body: JSON.stringify(this.currentActivity),
        });
        return payload.activity;
      }
      throw error;
    }
  }

  async clear() {
    this.stopHeartbeat();
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = null;
    this.currentActivity = null;
    await this.request(`/rich-presence/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }
}

export default RichPresenceClient;
