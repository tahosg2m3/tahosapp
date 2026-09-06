# tahosapp — Mesajlaşma, Sesli Sohbet ve Topluluk

[Resmî web sitesi](https://tahosapp.com.tr/) · [Web uygulaması](https://tahosapp.com.tr/app/) · [Özellikler](https://tahosapp.com.tr/ozellikler/) · [Güvenlik](https://tahosapp.com.tr/guvenlik/)

**tahosapp**, web ve Windows masaüstü için bağımsız, uçtan uca (full-stack) gerçek zamanlı mesajlaşma, sesli sohbet ve topluluk platformudur.

Sunucular, kanallar, doğrudan mesajlar, sesli/görüntülü iletişim, ekran paylaşımı, roller, moderasyon araçları ve masaüstü uygulaması içerir. Bu depo, [tahosapp.com.tr](https://tahosapp.com.tr/) tarafından bağlantısı verilen resmî ve herkese açık kaynak kodu deposudur.

> **Yasal Uyarı:** Bu bağımsız bir projedir; Discord Inc. ile herhangi bir bağlantısı yoktur, Discord Inc. tarafından desteklenmemekte veya sponsorluk sağlanmamaktadır.

---

## ✨ Özellikler

* 💬 Gerçek zamanlı metin mesajlaşması
* 👥 Sunucular, kanallar ve doğrudan mesajlar
* 🎙️ Sesli kanallar ve bas-konuş (push-to-talk) özelliği
* 📹 Kamera ve ekran paylaşımı
* 🛡️ Roller, izinler ve moderasyon araçları
* 🧵 Konu dizileri (threads), yanıtlar, tepkiler ve anketler
* 📎 Dosya ekleri, GIF'ler ve sesli mesajlar
* 🔔 Bildirimler ve okunmamış mesajlar
* 🔍 Mesaj arama
* 🤖 AutoMod ve özel eğik çizgi (slash) komutları
* 📅 Sunucu etkinlikleri ve katılım durumu (RSVP) sistemi
* 🌙 Açık (Light), Koyu (Dark) ve Gece Yarısı (Midnight) temaları
* 🖥️ Windows, macOS ve Linux masaüstü uygulaması

---

## 🛠️ Teknoloji Yığını

### Frontend

* React 18
* Vite
* Tailwind CSS
* Socket.IO Client
* PeerJS

### Backend

* Node.js
* Express
* Socket.IO
* PeerJS Server
* JWT
* Argon2id

### Veritabanı

* SQLite

### Masaüstü

* Electron

---

## 🚀 Başlarken

### Gereksinimler

* Node.js 20.19+
* npm
* E-posta doğrulaması için bir SMTP hesabı

### Kurulum

```bash
git clone https://github.com/tahosg2m3/discord-clone.git
cd discord-clone
npm install

```

`backend/.env.example` dosyasını şablon olarak kullanarak şu dosyayı oluşturun:

* `backend/.env`

Ardından projeyi başlatın:

```bash
npm run dev

```

### Varsayılan Servisler

* **Frontend:** http://localhost:5173
* **Backend:** http://localhost:3001
* **PeerJS:** http://localhost:9000

---

## 📦 Derleme (Build)

* **Web:**
```bash
npm run build:frontend

```


* **Masaüstü:**
```bash
npm run build:electron

```


* **Tümü:**
```bash
npm run build

```



---

## 🔐 Güvenlik

Parolalar Argon2id ile korunmakta, kimlik doğrulama için JWT kullanılmakta ve uygulama verileri AES-256-GCM kullanılarak şifrelenebilmektedir.

Güvenlik açıkları için lütfen `SECURITY.md` dosyasına göz atın.

---

## 🌐 Diller

* English
* Türkçe

---

## ⚠️ Proje Durumu

Bu proje öncelikli olarak eğitim ve portfolyo amaçlarıyla tasarlanmıştır.

Resmi bir Discord istemcisi değildir ve Discord'un tescilli arka uç altyapısını kullanmaz.

**Geliştiren:** tahosg2m3
