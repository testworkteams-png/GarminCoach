# GarminCoach Pro — Proje Durum Özeti (`PROJECT_STATUS.md`)

> Bu dosya, yeni bir geliştirme veya Antigravity sohbeti açıldığında uzun sohbet geçmişi taşımadan projenin güncel mimarisini, canlı sürümlerini ve teknik kurallarını tek bakışta aktarmak için hazırlanmıştır.

---

## 1. Canlı Ortam & Temel Bilgiler
- **Canlı Web / PWA:** `https://garmin.alidincerozdemir.com` (GitHub Pages — `main` dalı)
- **GitHub Deposu:** `https://github.com/testworkteams-png/GarminCoach.git`
- **Supabase Proje ID:** `htooqswstuuzslvrgxsx`
- **Ana Kullanıcı (Owner) UUID:** `c4953941-0b4f-42b1-b18c-a3c8693aa32f`
- **Güncel Service Worker Sürümü:** `garmincoach-shell-v64` (`sw.js`)
- **Mimari:** Sıfır derleme (zero-build) Vanilla HTML/CSS/JS + PWA + Capacitor (`capacitor.config.json`) + Supabase PostgreSQL + Deno Edge Functions + `pg_cron`

---

## 2. Ön Yüz Dosya & Sekme Haritası

### Temel Dosyalar
| Dosya | Sorumluluk |
| :--- | :--- |
| `index.html` | Uygulama iskeleti, yan menü/mobil alt bar navigasyonu, sekmeler ve modallar |
| `styles.css` | OLED koyu/açık tema stilleri, barlar, AQI kadranı, Honor/Samsung tarzı vücut bileşenleri |
| `app.js` | Kimlik doğrulama, veri yükleme (`loadAllData`), açılış senkronu (`autoSyncGarminOnLaunch`), Ana Ekran (`#tab-dashboard`), Raporlar (`#tab-weekly`), Antrenman (`#tab-workouts`), Arşiv (`#tab-archive`), Ayarlar (`#tab-settings`), Bildirim çekmecesi |
| `body-scale.js` | Vücut kompozisyonu ölçüm kaydı, tartı ekran görüntüsü AI ayrıştırma, pasta grafik, tıklanabilir metrik geçmiş grafikleri, tek seferlik YZ yorum modalı |
| `health-meds.js` | İlaç & takviye takibi, günlük doz işaretleri, reçete/etiket fotoğrafından AI ilaç okuma |
| `lab-reports.js` | Kan tahlili PDF/görsel AI ayrıştırma (`parse-lab-report`), biyobelirteç eğrileri ve birleşik YZ tahlil özeti |
| `ai-insights.js` | Günlük Active Intelligence özet kartı, beğeni geri bildirimi ve bildirim saati ayarları |
| `theme-engine.js` | Canlı hava/özel gün tabanlı tema motoru (`weather_sunny` vb.) |
| `sw.js` | Offline kabuk önbelleği (`CACHE_NAME = "garmincoach-shell-v64"`) ve Web Share Target (`/share-scale`) yakalayıcı |
| `GEMINI.md` | Antigravity çalışma alanı kuralları; her oturumda `PROJECT_STATUS.md` içeriğini otomatik yükler ve her değişiklikte güncellenmesini zorunlu tutar |
| `PROJECT_STATUS.md` | Güncel mimari, Edge Function sürümleri, `pg_cron` zamanlayıcıları ve sürüm geçmişi referansı |

### Sekme Yapısı (`index.html`)
1. **`#tab-dashboard` (`🏠 Ana Ekran`)**:
   - **Kart `🛡️ Bağışıklık Radarı` (`#immunity-radar-card`):** Ana ekranın en üstünde her zaman açık durumdadır; üst satırda başlık, 14G kişisel baz açıklaması, durum rozeti (`GÜVENDE` / `HAFİF SİNYAL` / `DİKKAT / RİSK` / `YÜKSEK RİSK`) ve sağında 180 derecelik 4 renkli ibreli kadran (`#immunity-needle` + `#immunity-dial-val`) bulunur. 14 günlük kişisel medyan bazlarına göre 3 bağımsız sistemi (Isı & Solunum, Kalp & Otonom, Gece Onarım) değerlendirir; tek metrik tavan koruması, 2+ gün süreklilik çarpanı ve son 36 saatlik ağır antrenman filtresiyle **4 kartlık 2×2 grid** (`🌡️ Isı & Solunum`, `💓 Kalp & Otonom`, `🔋 Gece Onarım`, `🧭 Ayırıcı Karar`) sunar.
   - **Akordeon `⌚ Güncel Biyometri & Kondisyon` (`#home-bars-card`):** Varsayılan kapalı durumdadır; kapalı halinde yalnızca başlık ve `☀️ Günlük Rapor →` butonu görünür. Açıldığında **12'li Stacked Progress Bar Kokpiti (`#home-live-grid`)** listelenir:
     - *Toparlanma & Sinir Sistemi (5 bar):* `😴 Uyku`, `💓 HRV`, `🫀 Dinlenik Nabız`, `🔋 Body Battery`, `🧘 Stres Seviyesi`.
     - *Kondisyon, Sağlık & Günlük Hareket (7 bar):* `🏃 VO₂ Maks` (boş günlerde geriye dönük en güncel kayıt), `🏆 Dayanıklılık Puanı`, `🧬 Sağlık Yaşı`, `🫁 Solunum & Pulse Ox`, `⚡ Bugün (Anlık)` (güncel adım + toplam/aktif kcal + hedef %), `🪜 Çıkılan Kat` (kat/hedef + tırmanış metre + iniş + hedef %; tıklanınca `⚡ Hareket` slaytında `🪜 Kat & Tırmanış` 14G grafiğini açar), `👣 Dünün Kapanışı`.
   - **Akordeon `🌤️ Yürüyüş & AQI` (`#evening-weather-card`):** Varsayılan kapalı durumdadır; kapalı halinde başlık (`🌤️ Yürüyüş & AQI`), güncel saat (`#weather-sum-time`), güncel sıcaklık (`#weather-sum-temp`) ve 4 renkli yatay AQI barı (`#weather-sum-aqi-marker` + `#weather-sum-aqi`) görünür. Açıldığında mevcut saate göre güncellenen AQI kadranı + `🧥 Giyim Tavsiyesi` kutusu (`.aqi-dial-row`), canlı 4'lü hava KPI kartları (`Sıcaklık / Hissedilen`, `Rüzgar / Yağış`, `Gün Doğumu / Batımı`, `Nem / UV İndeksi`), ileriye dönük Altın Saat bandı (`#best-walk-slot-banner`) ve şimdi + 5 saat ileri (toplam 6 saat, gece yarısını geçerse yarının ilk saatlerine taşan ve dar ekranda yatay kaydırılabilen) saatlik şerit (`#hourly-walk-strip` — mevcut saat `.is-current`, yarın başlangıcı `YARIN`, en uygun altın saat `.best` altın vurgulu) listelenir.
   - **Akordeon `🔬 Biyometri, Enerji & Akıllı Özet` (`#lab-carousel-section`):** Varsayılan kapalı durumdadır; kapalı halinde yalnızca başlık ve karusel kart sayısı (`13 Kart`, `#lab-carousel-count-badge`) görünür. Açıldığında (veya üstteki 12 bar satırından biri tıklandığında otomatik açılarak) **13 Slaytlı Karusel** listelenir: `😴 Uyku` (evreler + uyku borcu + 14G), `💗 HRV` (5-dk/14G + baz koridoru), `🫀 Nabız` (2-dk/14G RHR), `🔋 Body Battery` (anlık/14G + olaylar), `🧘 Stres` (dağılım + `14G Gündüz/Gece` & `7G Dağılım` + desteklenirse `Canlı`), `🏃 VO₂ Maks` (yaş skalası + 30G + Ef), `🏆 Dayanıklılık` (katman skalası + aktivite katkı dağılımı + 30G), `🧬 Sağlık Yaşı` (gerçek/güncel/hedef + tüm Garmin bileşen barları: yoğun gün, yoğun dk, RHR, vücut yağ %, VKİ + 30G), `🫁 Solunum & SpO₂` (gece/gündüz + deri sıcaklığı + 14G), `⚡ Hareket` (Bugün/Dün geçişli + `👣 Adım & Kalori` / `🪜 Kat & Tırmanış` 14G grafik seçici), `📈 Trend Lab`, `🧠 Akıllı Özet` (`#active-intel-3x`), `🔗 Vücut Tepkileri`. Üstteki 12 bar satırının her biri tıklandığında akordeonu açıp ilgili karusel slaytına yönlenerek kısa vurgu animasyonu oynatır.
2. **`#tab-body` (`⚖️ Vücut`)**: Güncel kilo/VKİ göstergesi, temel kilo metrikleri, vücut yapısı pasta grafiği, metrik tıklandığında geçmiş trend grafiği ve bildirimlere kaydedilen read-once YZ vücut yorumu.
3. **`#tab-health` (`🩺 Sağlık`)**: İlaç/Takviye düzenleme ve kan tahlili sonuç arşivi.
4. **`#tab-workouts` (`🏋️ Antrenman & Kas`)**: Antrenman geçmişi, anatomik kas ısı haritası, Z1–Z5 nabız bölgeleri, ter/sıvı telafisi.
5. **`#tab-weekly` (`📊 Raporlar`)**: `Günlük · Haftalık · Aylık · Yıllık` alt sekmeli strateji/CEO rapor kokpiti (Sabah Hazırlık skoru, Body Battery halkası, CEO brifingleri).
6. **`#tab-archive` (`🗂️ 30G Doküman & Arşiv`)** & **`#tab-settings` (`⚙️ Ayarlar`)**.

---

## 3. Supabase Veritabanı, Edge Functions & Zamanlayıcılar

### Kullanılan Başlıca Tablolar
- **Profil & Entegrasyon:** `athlete_settings`, `user_integrations`, `user_push_tokens`, `user_settings`
- **Garmin Biyometri & Raporlar:** `daily_biometrics`, `activities`, `weekly_strategies`, `monthly_reports`, `ai_insights`, `notifications`, `sync_logs`
- **Vücut, İlaç & Tahlil:** `body_composition`, `medications`, `medication_logs`, `lab_reports`, `lab_results`, `lab_ai_overview`

### Aktif Edge Functions (`verify_jwt: false`, `import_map: deno.json`)
| Fonksiyon | Güncel Sürüm | Görev & Optimizasyon Notları |
| :--- | :---: | :--- |
| `garmin-coach-engine` | `v23` | Garmin Connect senkronu, 45 dk bellek içi `garminBearerCache`, `yeniAntrenmanKontrol` için `onlyActivities: true`, bugün `00:00–23:00` + yarın `00:00–05:00` (30 saat) anlık hava/AQI/nem/UV slotları (`hourly_slots`) + `sunrise`/`sunset`, tüm `fitness_age_detail` bileşenleri (`vigorous_minutes`, `rhr_value`, `body_fat_value`, `bmi_value`, `potential_age`) + `endurance_detail` & `dailyStress` desteği, günlük/haftalık/aylık rapor & koç soru-cevap (`askCoach`). |
| `ai-insights-engine` | `v3` | Günlük Active Intelligence kartı; önce `ai_insights` + son 1 `activity_id` kontrolü ile aynı gün hızlı önbellek dönüşü (`cached: true`). |
| `parse-scale-screenshot` | `v4` | Honor/Huawei tartı görseli OCR + `analyzeBodyComposition` (`notifications` önbellek kontrolü LLM çağrısı öncesinde çalışır). |
| `parse-lab-report` | `v6` | E-Nabız/hastane kan tahlili PDF OCR, eczane ilaç etiketi OCR ve birleşik laboratuvar özeti. |

### Aktif `pg_cron` Zamanlayıcıları *(Dokunulmamalı)*
| `jobid` | Adı | Takvim | Hedef Action |
| :---: | :--- | :--- | :--- |
| `1` | `garmin_morning_analysis` | `45 4 * * *` | `gunlukGarminAnalizi` |
| `2` | `garmin_silent_sync` | `*/30 * * * *` | `dokumaniSessizGuncelle` |
| `4` | `garmin_weekly_strategy` | `0 17 * * 0` | `haftalikStratejiBulteni` |
| `5` | `garmin_monthly_ceo_report` | `0 18 1 * *` | `aylikCeoRaporu` |
| `6` | `garmin_workout_check` | `*/10 * * * *` | `yeniAntrenmanKontrol` (`onlyActivities: true`) |
| `7` | `ai_insights_daily_dispatch` | `*/15 * * * *` | `ai-insights-engine` → `cronDispatch` |

### Token & Maliyet Optimizasyon Kuralları
- **Gemini modelleri:** Tüm Edge Function'larda yalnızca geçerli Flash ailesi (`models/gemini-2.5-flash-lite`, `models/gemini-2.5-flash`, `models/gemini-2.0-flash`) kullanılır; Gemini 2.5 çağrılarında `thinkingConfig: { thinkingBudget: 0 }` ve işleme özel `maxOutputTokens` sınırları (450–2400) aktiftir.
- **Garmin API & Bearer Cache:** `garminBearerCache` (45 dk TTL, HTTP 401'de sıfırlanır) gereksiz token değişimlerini önler.
- **Ön Yüz Tekilleştirme:**
  - `app.js` → `autoSyncGarminOnLaunch()`: Bugünün kaydı son `15 dakika` içinde güncellenmişse (`daily_biometrics[0].updated_at`) açılışta tekrar `gunlukGarminAnalizi` tetiklemez; 10 dk `sessionStorage` bekleme süresine uyar.
  - `ai-insights.js` → `initForUser()`: Bugünün AI özeti bellekte varsa ek `generateInsight` isteği atmaz.

---

## 4. Geliştirme ve Yayınlama Kuralları (Yeni Sohbet Kılavuzu)
1. **Service Worker Sürümü:** Ön yüz dosyalarında (`index.html`, `styles.css`, `*.js`) herhangi bir değişiklik yapıldığında `sw.js` içindeki `CACHE_NAME` değerini mutlaka artırın (`garmincoach-shell-v64` → `garmincoach-shell-v65`).
2. **Edge Function Dağıtımı:** Supabase MCP `deploy_edge_function` çağrılarında her zaman `import_map_path: "deno.json"` (içeriği `deno.json` ile birlikte) ve `verify_jwt: false` parametrelerini verin.
3. **Doğrulama:** Push öncesinde JavaScriptCore (`/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`) ile sözdizimi/smoke testi ve HTML `id` eşleşme kontrolü çalıştırın; GitHub Pages yayını (~18 sn) sonrası `https://garmin.alidincerozdemir.com/sw.js` üzerinden yeni sürümü doğrulayın.
4. **Sohbet Hijyeni:** Antigravity'de yeni bir özellik eklerken yeni sohbet açıp *"PROJECT_STATUS.md dosyasını oku, ..."* diyerek başlamak gereksiz bağlam ve token tüketimini önler.

---

## 5. Son Tamamlanan Sürümler
- **`v64`:** `🛡️ Bağışıklık Radarı` (`#immunity-radar-card`) akordeondan çıkarılıp her zaman açık karta dönüştürüldü; başlığın yanına 180 derecelik 4 renkli ibreli durum kadranı (`#immunity-needle`, `#immunity-dial-val`) eklendi.
- **`712a6d9` (`v63`):** Ana ekranın en üstüne varsayılan kapalı **`🛡️ Bağışıklık Radarı`** (`#immunity-radar-card`) akordeonu eklendi; 14G kişisel medyan bazları, tek-sistem yanlış alarm koruması, 2G süreklilik çarpanı ve 36 saatlik ağır antrenman yorgunluğu filtresiyle günlük hastalık risk yüzdesini hesaplar ve açıldığında 4 kart (`🌡️ Isı & Solunum`, `💓 Kalp & Otonom`, `🔋 Gece Onarım`, `🧭 Ayırıcı Karar`) sunar.
- **`617625d` (`v62`):** `🔬 Biyometri, Enerji & Akıllı Özet` karusel bölümü (`#lab-carousel-section`) varsayılan kapalı akordeona alındı (kapalıyken yalnızca başlık ve `13 Kart` rozeti görünür; üstteki 12 bar satırından biri tıklandığında otomatik açılıp ilgili slayta gider).
- **`258ee29` (`v61`):** `🌤️ Yürüyüş & AQI` akordeonu açıldığında üstteki saat/sıcaklık çipleri (`.weather-acc-chips`) ve yatay AQI barı (`.weather-aqi-bar-row`) gizlenerek açık görünümde tekrar kaldırıldı.
- **`acdd0bf` (`v60`):** Hava & AQI akordeonu başlığı `🌤️ Yürüyüş & AQI` olarak yenilendi; kapalı halinde başlık + saat/sıcaklık çipleri ve 4 renkli yatay AQI barı (`#weather-sum-aqi-marker`) gösterilir hale getirildi.
- **`bd4f6bf` (`v59` / `garmin-coach-engine v23`):** Hava/AQI saatlik şeridi şimdi + 5 saat ileri (toplam 6 saat, gece yarısında yarının ilk saatlerine taşan ve dar ekranda yatay kaydırılabilen) yapıya geçirildi; `Aktif Pencere` kutusu kaldırılarak `Gün Doğumu / Batımı` birleştirildi ve 4. KPI kutusuna `💧 Nem / ☀️ UV İndeksi` eklendi.
- **`v58` (`garmin-coach-engine v22`):** Hava & AQI bölümü (`#evening-weather-card`) tüm günü (`00:00–23:00`) kapsayan varsayılan kapalı akordeona dönüştürüldü (kapalı halde yalnızca güncel saat, sıcaklık ve AQI görünür); saatlik şerit yalnızca mevcut saatten `23:00`'e kadar ileriye doğru akacak şekilde filtrelendi, mevcut saat `.is-current` camgöbeği çerçeveli, en uygun Altın Saat `.best` altın vurgulu yapıldı.
- **`c78ec76` (`v57`):** `#tab-dashboard` bölüm sırası güncellendi (`#evening-weather-card` üstte, 13 slaytlı `#lab-carousel-section` altta); `⌚ Güncel Biyometri & Kondisyon` (`#home-bars-card`) varsayılan kapalı akordeona dönüştürüldü (kapalı halde yalnızca başlık ve `☀️ Günlük Rapor →` butonu görünür).
- **`v56` (`garmin-coach-engine v21`):** `⚡ Bugün (Anlık)` barının altına `🪜 Çıkılan Kat` satırı eklendi (tıklanınca `⚡ Hareket` slaytında `🪜 Kat & Tırmanış` 14G grafiğini açar); `🧘 Stres` slaytına `7G Dağılım` yığınlı bar görünümü (+ `dailyStress` hazır olduğunda `Canlı`), `🏆 Dayanıklılık` slaytına aktivite katkı dağılımı, `🧬 Sağlık Yaşı` slaytına Garmin'in tüm gerçek alt bileşenleri (`vigorous_minutes`, `body_fat_value`, `potential_age`) eklendi.
- **`954d267` (`v55`):** `#lab-carousel-section` 13 slayta çıkarıldı (😴 Uyku, 💗 HRV, 🫀 Nabız, 🔋 Body Battery, 🧘 Stres, 🏃 VO₂ Maks, 🏆 Dayanıklılık, 🧬 Sağlık Yaşı, 🫁 Solunum & SpO₂, ⚡ Hareket Bugün/Dün, 📈 Trend Lab, 🧠 Akıllı Özet, 🔗 Vücut Tepkileri); `#home-live-grid` içindeki tüm bar satırlarına 1'e 1 slayt yönlendirmesi + pulse vurgu + `›` ipucu eklendi, İngilizce etiketler Türkçeleştirildi ve `fitness_age_detail` anahtar hatası giderildi.
- **`942fa38` (`v54`):** Gemini `thinkingBudget: 0` & model güncellemesi, `maxOutputTokens` sınırları, `garminBearerCache`, `onlyActivities` modu, ön yüz açılış tekilleştirme ve 4 Edge Function dağıtımı.
- **`f08a90c` (`v53`):** AQI kadranı sağına sıkıştırılmış `Giyim Tavsiyesi` kutusu ve mobil düzeni.
- **`bc44a5b` (`v52`):** `⚡ Bugün (Anlık)` adım/kalori barı, `VO₂ Maks` & `Dayanıklılık Puanı` geriye dönük doldurma + uygulama açılışında otomatik güncelleme.
- **`81c407c` (`v51`):** Ana ekranda alt alta dizilen gruplu ilerleme barları.
- **`98f6c61` (`v50`):** Canlı Ana Ekran (`#tab-dashboard`) ile `Günlük / Haftalık / Aylık / Yıllık` Raporlar (`#tab-weekly`) ayrımı.
- **`9580c69` (`v49`):** İlaç yönetme modalında mobil yatay taşma düzeltmesi.
- **`7d0de23` (`v48`):** Tek seferlik Vücut Kompozisyonu YZ Yorumu modalı ve bildirimlere kayıt.
