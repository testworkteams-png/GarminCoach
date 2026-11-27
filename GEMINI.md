# GarminCoach Pro — Çalışma Alanı Kuralları (`GEMINI.md`)

Bu çalışma alanındaki her yeni oturumda aşağıdaki kurallar otomatik olarak geçerlidir.

## 1. Proje Hafızası & Zorunlu Güncelleme Kuralı
- Her ön yüz değişikliği, yeni modül/sekme eklemesi, `sw.js` (`CACHE_NAME`) sürüm artışı, Supabase tablo/şema değişikliği veya Edge Function dağıtımının **aynı commit'i içinde** `PROJECT_STATUS.md` dosyasını mutlaka güncelle:
  - Güncel Service Worker sürümünü (`garmincoach-shell-vXX`) ve değişen Edge Function sürümlerini güncel tut.
  - Yeni eklenen dosya, sekme, tablo, zamanlayıcı veya optimizasyon kurallarını ilgili bölümlere ekle.
  - **"Son Tamamlanan Sürümler"** listesinin en üstüne yeni commit/sürüm özetini ekle.

## 2. Dağıtım ve Güvenlik Standartları
- **Ön Yüz Önbelleği:** `index.html`, `styles.css` veya `*.js` dosyaları değiştiğinde `sw.js` içindeki `CACHE_NAME` sürümünü mutlaka bir artır. Push sonrası `https://garmin.alidincerozdemir.com/sw.js` üzerinden canlı sürümü doğrula.
- **Supabase Edge Functions:** `deploy_edge_function` çağrılarında mutlaka `verify_jwt: false` ve `import_map_path: "deno.json"` (`deno.json` dosyasıyla birlikte) kullan.
- **Zamanlayıcılar (`pg_cron`):** Kullanıcı açıkça istemedikçe `cron.job` zamanlayıcılarına dokunma, silme veya durdurma.
- **Dil & Doğrulama:** Kullanıcıya Türkçe yanıt ver; commit öncesinde `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc` ve HTML `id` eşleşme kontrollerini çalıştır.

## 3. Güncel Proje Durumu
@[PROJECT_STATUS.md](./PROJECT_STATUS.md)
