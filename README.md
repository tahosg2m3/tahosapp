# tahosapp — Messaging, Voice Chat and Communities

[Official website](https://tahosapp.com.tr/) · [Web app](https://tahosapp.com.tr/app/) · [Features](https://tahosapp.com.tr/ozellikler/) · [Security](https://tahosapp.com.tr/guvenlik/)

**tahosapp** is an independent, full-stack, real-time messaging, voice chat and community platform for the web and Windows desktop.

It includes servers, channels, direct messages, voice/video communication, screen sharing, roles, moderation tools and a desktop application. This repository is the official public source-code repository linked from [tahosapp.com.tr](https://tahosapp.com.tr/).

## ✨ Features

* 💬 Real-time text messaging
* 👥 Servers, channels and direct messages
* 🎙️ Voice channels and push-to-talk
* 📹 Camera and screen sharing
* 🛡️ Roles, permissions and moderation tools
* 🧵 Threads, replies, reactions and polls
* 📎 File attachments, GIFs and voice messages
* 🔔 Notifications and unread messages
* 🔍 Message search
* 🤖 AutoMod and custom slash commands
* 📅 Server events and RSVP system
* 🎵 Spotify listening invites with synchronized playback
* 🌙 Light, Dark and Midnight themes
* 🖥️ Windows, macOS and Linux desktop application

## 🛠️ Tech Stack

**Frontend**

* React 18
* Vite
* Tailwind CSS
* Socket.IO Client
* PeerJS

**Backend**

* Node.js
* Express
* Socket.IO
* PeerJS Server
* JWT
* Argon2id

**Database**

* SQLite

**Desktop**

* Electron

## 🚀 Getting Started

### Requirements

* Node.js 20.19+
* npm
* SMTP account for email verification

### Installation

```bash
git clone https://github.com/tahosg2m3/tahosapp.git
cd tahosapp
npm install
```

Create:

```text
backend/.env
```

using `backend/.env.example` as a template.

Then start the project:

```bash
npm run dev
```

Default services:

```text
Frontend   http://localhost:5173
Backend    http://localhost:3001
PeerJS     http://localhost:9000
```

### Spotify listening invites

Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add your backend callback URL (for example, `http://127.0.0.1:3001/api/spotify/callback` for local development), and set these values in `backend/.env`:

```text
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3001/api/spotify/callback
```

Without any Spotify credentials, users can paste a Spotify track URL from the music button and send a rich invitation powered by Spotify oEmbed. Every recipient opens the track in their own Spotify app, and no Premium subscription is required for link invitations. If OAuth is configured, each user connects their own account to share the currently playing track; Spotify Premium and an active device are required only for automatic “Listen Along” playback at the shared position.

## 📦 Build

Web:

```bash
npm run build:frontend
```

Desktop:

```bash
npm run build:electron
```

Everything:

```bash
npm run build
```

## 🔐 Security

Passwords are protected with **Argon2id**, authentication uses **JWT**, and application data can be encrypted using **AES-256-GCM**.

For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## 🌐 Languages

* [English](README.md)
* [Türkçe](README.tr.md)

## Project Status

tahosapp is an independent open-source communication platform under active development.

---

**Made by [tahosg2m3](https://github.com/tahosg2m3)**
