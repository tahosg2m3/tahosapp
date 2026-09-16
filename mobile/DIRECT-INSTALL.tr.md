# tahosapp — Android'e doğrudan kurulum

Android uygulamasını APK dosyasından kurabilirsin. Hazır dosya: `mobile/releases/tahosapp-android-1.3.2.apk`. Uygulama Android 7.0 ve üzerini destekler.

## Telefona kurma

1. Hazırlanan `.apk` dosyasını Android telefonunun **İndirilenler** klasörüne kopyala.
2. Telefonda **Dosyalar > İndirilenler** bölümünden APK'ya dokun.
3. Android izin isterse **Ayarlar** düğmesine dokun ve dosyayı açtığın uygulama için **Bu kaynaktan izin ver** seçeneğini aç. Menü adları telefon markasına göre değişebilir.
4. Kurulum ekranına dönüp **Yükle**, ardından **Aç** düğmesine dokun.
5. tahosapp hesabınla giriş yap. Sesli veya görüntülü sohbeti kullanırken istenen mikrofon ve kamera izinlerini ver.

Yalnızca hazırlanan tahosapp APK'sını kullan. Play Protect tarama önerirse taramanın tamamlanmasını bekle; korumayı kapatman gerekmez. [Google'ın mağaza dışından kurulum açıklaması](https://support.google.com/android/answer/9457058?hl=tr), [Play Protect açıklaması](https://support.google.com/android/answer/2812853?hl=tr).

## Yeni sürüme geçme

Yeni APK'yı aynı şekilde aç ve **Güncelle** düğmesine dokun. Mevcut uygulamayı önce kaldırmana gerek yok. Mağaza üzerinden otomatik güncelleme yapılmadığı için yeni APK sürümlerini elle kurarsın.

Güncellemenin kabul edilmesi için geliştirici aynı uygulama kimliğini ve imzalama anahtarını kullanmalı, sürüm kodunu artırmalıdır. İmza uyuşmazlığı varsa uygulamayı kaldırmadan önce doğru imzalı APK'yı iste; kaldırma işlemi telefondaki uygulama verilerini siler. [Android güncelleme koşulları](https://developer.android.com/google/play/app-updates).

## Kurulum açılmıyorsa

- **Paket çözümlenemedi:** Dosyanın tamamen aktarıldığını kontrol et ve APK'yı yeniden aktar.
- **Uygulama yüklenmedi:** Telefonda yeterli boş alan bulunduğunu ve Android sürümünün uygulamayı desteklediğini kontrol et. Daha önce tahosapp kuruluysa imza veya sürüm uyuşmazlığı olabilir.
- **Kurulum yönetici tarafından engellendi:** İş veya okul tarafından yönetilen cihazlarda yönetici kısıtlaması olabilir; kişisel cihazında dene.
- **Mikrofon/kamera çalışmıyor:** Telefonun **Ayarlar > Uygulamalar > tahosapp > İzinler** bölümünü kontrol et.

Bu dosya Android APK kurulumu içindir; APK dosyası iPhone'a kurulmaz.

## Bu sürümdeki mobil özellikler

- Sunucular, kanallar, doğrudan mesajlar ve arkadaşlar için telefon gezinmesi
- Metin, dosya, GIF ve sesli mesaj gönderimi
- Mikrofon ve kamera ile sesli/görüntülü görüşme
- Telefon arka plana alındığında devam eden sesli görüşme bildirimi
- Telefon güvenli alanları ve ekran klavyesiyle uyumlu arayüz

Ekran paylaşımı gönderme, passkey ile giriş ve uygulama tamamen kapalıyken anlık bildirim bu ilk Android paketinde kapalıdır. Başka kullanıcıların ekran paylaşımları izlenebilir. Uygulamayı son uygulamalar ekranından kapatırsan devam eden sesli görüşme de sonlanır.

## Yeni APK oluşturma

Proje bilgisayarında `npm run build:android:apk` komutu yeni imzalı APK'yı `mobile/releases` klasörüne çıkarır. `mobile/signing` klasörü daha sonraki sürümlerin mevcut kurulumun üzerine güncelleme olarak kurulabilmesi için gereklidir. Bu klasörü herkese açık bir yere yükleme; güvenli bir yedeğini sakla.
