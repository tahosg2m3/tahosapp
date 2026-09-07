# Independent Rich Presence Integration

TahosApp Rich Presence is a first-party HTTP system that communicates directly with the tahosapp service.

The TahosApp Windows desktop client automatically detects running games and active Windows media sessions, including Spotify and YouTube Music, without requiring this SDK, an account connection, or any user configuration. The SDK below is optional and only needed when an application wants to publish richer custom data such as a level, score, party, or action buttons.

## Quick start

1. Open **Settings → Rich Presence** in TahosApp.
2. Enable activity sharing and create an integration key.
3. Save the key immediately; only its hash is stored and the full key is shown once.
4. Set `TAHOS_PRESENCE_TOKEN` and run `node example.mjs` with Node.js 18 or newer.

The included `javascript-client.mjs` has no dependencies. It publishes the activity and renews the session every 30 seconds. Call `clear()` when the game, application, or song session ends.

## HTTP API

Send the integration key in `Authorization: Presence <token>` or `X-Presence-Token`.

- `PUT /api/rich-presence` — create or replace a session.
- `POST /api/rich-presence/heartbeat` — renew a session.
- `DELETE /api/rich-presence/:sessionId` — end one session.
- `DELETE /api/rich-presence` — end every session owned by the user.
- `GET /api/rich-presence` — inspect the current sessions and limits.

Supported activity types are `playing`, `listening`, `watching`, `working`, `competing`, and `custom`. A user can publish up to five sessions. Session TTL is restricted to 30–900 seconds; 120 seconds is the default.

The payload supports `name`, `details`, `state`, `startedAt`, `endsAt`, large/small images, progress, party size, music metadata, up to eight custom metadata fields, and up to two HTTPS action buttons. All fields are length-limited and sanitized by the server.
