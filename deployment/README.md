# tahosapp bağlantı yapılandırması

Kurulum paketi oluşturulurken `app-config.json` dosyası uygulamanın içine eklenir.
Bu dosyada parola, SMTP şifresi, JWT anahtarı veya başka bir gizli bilgi tutulmaz.

## Şimdiki yerel sürüm

`mode` değeri `local` olduğunda masaüstü uygulaması paketlenmiş yerel backend'i
görünür bir terminal açmadan `127.0.0.1:3001` üzerinde, PeerJS servisini ise
`127.0.0.1:9000` üzerinde başlatır. Her bilgisayarın verileri birbirinden ayrıdır.

## İnternet sunucusuna geçiş

1. Merkezi backend, Socket.IO ve PeerJS servislerini HTTPS/WSS arkasında yayınla.
2. `app-config.remote.example.json` dosyasını örnek alarak `app-config.json`
   içindeki `mode` değerini `remote` yap.
3. `apiOrigin`, `socketUrl` ve PeerJS alanlarını kendi alan adlarınla değiştir.
4. `npm run build` komutuyla yeni kurulum ve otomatik güncelleme paketlerini oluştur.

Uzak mod yalnız HTTPS adreslerini ve güvenli PeerJS bağlantısını kabul eder.
Uzak modda son kullanıcı bilgisayarında paketlenmiş backend başlatılmaz.
Yapılandırma değişikliği mevcut kurulum dosyasını geriye dönük değiştirmez;
yeni bir sürüm numarasıyla yeni kurulum/güncelleme paketi üretilmelidir.

## Canlı sunucuyu güncelleme

Normal bir güncelleme için PowerShell'de proje klasöründe yalnızca şunları çalıştır:

```powershell
git add .
git commit -m "feat: guncelleme aciklamasi"
npm run release:production
```

Son komut masaüstü paketini ve güncelleme doğrulama dosyalarını üretir, commit'i
GitHub'a gönderir, ardından backend + web + masaüstü güncellemesini canlı sunucuya
yükler. Yeni servis sağlık kontrolünü
geçemezse sunucu otomatik olarak önceki çalışan sürüme döner. Veritabanı,
yüklenen dosyalar ve `.env` sunucu sürüm klasörünün dışında tutulduğu için
dağıtım sırasında silinmez veya üzerine yazılmaz.

GitHub'a göndermeden yalnızca sunucuyu güncellemek istersen:

```powershell
npm run deploy:production
```

Normal dağıtım imzalı Android APK'yı `mobile/releases` klasöründen alır ve
`/downloads/tahosapp-Android-latest.apk` adresinde yayınlar. Windows için web
sitesinde yalnız küçük `tahosapp-Online-Setup-latest.exe` bulunur. Bu çevrimiçi
kurucu çalıştırıldığında mimariye uygun sıkıştırılmış uygulama paketini
`/updates/windows/` adresinden indirir ve bilgisayara kurar. Android APK eksikse
önce `npm run build:android:apk` çalıştırılmalıdır.

Yalnız daha önce oluşturulmuş belirli bir masaüstü paketini göndermek için:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deployment/deploy.ps1 -InstallerPath "release\tahosapp-Online-Setup-1.3.1.exe"
```

Kurulu Windows uygulaması açılıştan kısa süre sonra ve her 30 dakikada bir
`https://tahosapp.com.tr/updates/windows/native.yml` adresini denetler. Yeni paket
SHA-512 doğrulamasından geçtikten sonra arka planda indirilir. Bir saniyeden uzun
indirmelerde markalı ilerleme penceresi görünür; çok kısa güncellemelerde uygulama
doğrudan yeniden başlatılır. Kurulum, kaldırma ve açılış pencereleri de tahosapp
tasarımını kullanır.

`latest.yml`, 1.3.0 ve daha eski masaüstü sürümlerinin küçük çevrimiçi EXE ile
1.3.1'e geçebilmesi için paket alanı çıkarılmış uyumluluk manifestidir. 1.3.1 ve
sonraki sürümler `native.yml` kullanarak sıkıştırılmış paketi uygulama içinde
indirir ve sessiz güncelleme uygular.

## Brevo ile e-posta gönderimi

SMTP bilgilerini proje içindeki `backend/.env` dosyasına gir:

```dotenv
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=brevo_smtp_login
SMTP_PASS=brevo_smtp_key
MAIL_FROM="tahosapp <dogrulanmis-gonderen@alanadiniz.com>"
```

`SMTP_USER`, Brevo'nun SMTP ayarlarındaki **Login** değeridir. `SMTP_PASS` için
**SMTP key** kullan; API anahtarı veya Brevo hesap parolası bu alana girilmez.
`MAIL_FROM`, Brevo'da doğruladığın gönderen e-posta adresini içermelidir; SMTP
kullanıcı adından farklı olabilir ve ayrıca girilmesi zorunludur. `587` portunda
`SMTP_SECURE=false` kullanılır; backend bağlantıyı STARTTLS ile şifrelemeyi zorunlu
tutar.

Bu bilgileri frontend'e veya `app-config.json` dosyasına yazma; `backend/.env`
sunucu tarafındaki gizli yapılandırmadır. Yerel backend çalışıyorsa dosyayı
kaydettikten sonra yeniden başlat. Tarayıcıda Brevo'ya giriş yapmak backend'in
SMTP kimlik doğrulamasını yapılandırmaz.

Yalnızca bu SMTP ayarlarını canlı sunucuya aktarmak istediğinde:

```powershell
npm run smtp:production
```

Bu komut yalnızca `SMTP_*` ve `MAIL_FROM` satırlarını aktarır, Brevo SMTP bağlantısını
sunucudan sınar ve geçici sır dosyasını bilgisayardan kaldırır. Bağlantı kontrolü
e-posta göndermez.

## Google ile giriş

Google Cloud Console içinde bir OAuth uygulaması oluştur ve aşağıdaki geri dönüş
adresini birebir ekle:

```text
https://api.tahosapp.com.tr/api/auth/social/google/callback
```

Canlı backend'in `.env` dosyasına şu değerleri gir:

```dotenv
SOCIAL_AUTH_BASE_URL=https://api.tahosapp.com.tr
SOCIAL_AUTH_WEB_URL=https://tahosapp.com.tr/app/
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Anahtarlar yalnız backend'de tutulur. Eksik olduklarında giriş ve kayıt ekranındaki
ilgili düğmeler pasif görünür. Değerleri ekledikten sonra backend servisini yeniden
başlatmak yeterlidir; aynı akış web ve masaüstü uygulamasında kullanılır.
