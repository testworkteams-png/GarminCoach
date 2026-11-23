# GarminCoach Pro (Web + PWA + Android APK + Supabase)

Eski Google Apps Script (`Kod.gs`) + Google E-Tablo + Google Doküman mimarisinin **Supabase PostgreSQL + Edge Functions + pg_cron + OLED Dark Mode Web/APK** olarak baştan tasarlanmış tam sürümüdür.

## Mimari Özeti
- **Veritabanı (Supabase PostgreSQL):** `athlete_settings`, `daily_biometrics`, `activities`, `weekly_strategies`, `sync_logs` tabloları + `calculate_readiness_score` fonksiyonu.
- **Arka Plan Motoru (`garmin-coach-engine` Edge Function + `pg_cron`):**
  - `aktifKonumuBelirle`: Manuel şehir override (`Ayarlar!B2`) → Son 5 gün GPS >15 km → Varsayılan `Ümraniye (41.0256, 29.0963)`.
  - `havaMotoruVeAksamKadran`: MET Norway + Open-Meteo + 17:00–21:00 Avrupa AQI & PM2.5 4 bölmeli kadran (Yeşil/Sarı/Turuncu/Kırmızı) + gün batımı + katmanlı kıyafet önerisi.
  - `gunlukGarminAnalizi` & `dokumaniSessizGuncelle`: Gece 00:00–07:30 koruması, 13:00 Akıllı HRV Bekleyicisi, Kırmızı Alarm penceresi (23:00–08:30 dışı).
  - `haftalikStratejiBulteni`: Pazar Yönetici Kokpiti, WoW deltalar, Z1–Z5 bölgeleri, hedef karnesi, 7 günlük hava reçeteli Pazartesi–Pazar programı.
- **Ön Yüz (Sıfır Derleme Web + PWA + Capacitor APK):** `index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`.

## Supabase Gizli Anahtarlarını (Secrets) Ekleme
Uygulama şu an canlı hava/AQI ve veritabanı motoruyla çalışmaktadır. Gerçek Garmin ve Gemini API çağrıları için Supabase Dashboard → **Edge Functions → garmin-coach-engine → Secrets** bölümüne şu anahtarları ekleyin:
- `GARMIN_API_KEY`
- `GARMIN_API_BASE_URL` (Garmin Personal API proxy adresiniz)
- `GEMINI_API_KEY`

## Web / Vercel Yayına Alma
Bu klasörü doğrudan `https://github.com/testworkteams-png/GarminCoach.git` reposuna pushlayıp Vercel'e bağlayabilirsiniz (Framework Preset: **Other**, Build Command: boş, Output Directory: `.`).

## Android APK Oluşturma (Capacitor)
Bilgisayarınızda Node.js ve Android Studio kurulu olduğunda proje klasöründe şu komutları çalıştırın:
```bash
npm install
npx cap add android
npx cap sync android
npx cap open android
```
Android Studio açıldığında **Build → Build Bundle(s) / APK(s) → Build APK(s)** adımıyla `.apk` dosyanızı alabilirsiniz.
