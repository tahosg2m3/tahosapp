# tahosapp — Messaging, Voice Chat and Communities

[Official website](https://tahosapp.com.tr/) · [Web app](https://tahosapp.com.tr/app/) · [Features](https://tahosapp.com.tr/ozellikler/) · [Security](https://tahosapp.com.tr/guvenlik/)

**tahosapp** is an independent, full-stack, real-time messaging, voice chat and community platform for the web and Windows desktop.

It includes servers, channels, direct messages, voice/video communication, screen sharing, roles, moderation tools and a desktop application. This repository is the official public source-code repository linked from [tahosapp.com.tr](https://tahosapp.com.tr/).

> **Disclaimer:** This is an independent project and is not affiliated with, endorsed by, or sponsored by Discord Inc.

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
git clone https://github.com/tahosg2m3/discord-clone.git
cd discord-clone
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

## ⚠️ Project Status

This project is primarily intended for **educational and portfolio purposes**.

It is not an official Discord client and does not use Discord's proprietary backend.

---

**Made by [tahosg2m3](https://github.com/tahosg2m3)**
