const SUPABASE_URL = "https://htooqswstuuzslvrgxsx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5_1RDXV8unnW9ttkHEA_HQ_n8fJrt4I";
const ENGINE_URL = `${SUPABASE_URL}/functions/v1/garmin-coach-engine`;
const AUTH_STORAGE_KEY = "garmincoach_sb_session_v1";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const TAB_TITLES = {
  dashboard: "Sabah Biyometri & Akşam Hava Kokpiti",
  workouts: "Antrenman & Anatomik Kas Laboratuvarı",
  weekly: "Yönetici Kokpiti · Haftalık & Aylık Raporlar",
  archive: "30 Günlük Kayan Doküman & Sınırsız E-Tablo",
  settings: "Hibrit Konum, Garmin API & Otomasyon Merkezi",
};

const state = {
  settings: null,
  biometrics: [],
  activities: [],
  weekly: null,
  monthly: null,
  notifications: [],
  integration: null,
  syncLogs: [],
  selectedActivityId: null,
  activityFilter: "ALL",
  trendMode: "hrv",
  ceoMode: "weekly",
  charts: {
    trend: null,
    activitySeries: null,
    activityElev: null,
    customCompare: null,
    weeklyZones: null,
    bbIntraday: null,
    hrvNight: null,
    intradayHr: null,
  },
  map: null,
  tileLayer: null,
  mapLayerMode: "dark",
  routeLayer: null,
  auth: {
    authenticated: false,
    userId: null,
    email: null,
    username: "Sporcu",
    accessToken: null,
    refreshToken: null,
  },
};

async function apiCall(payload) {
  let token = state.auth.accessToken;
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session?.access_token) {
      token = data.session.access_token;
      state.auth.accessToken = data.session.access_token;
      state.auth.refreshToken = data.session.refresh_token || state.auth.refreshToken;
    }
  } catch (_) {}

  return fetch(ENGINE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3600);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDuration(sec) {
  if (!sec) return "--";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}s ${m}dk` : `${m} dk`;
}

function fmtIstanbulDateTime(isoStr) {
  if (!isoStr) return "--";
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return String(isoStr).slice(0, 16).replace("T", " ");
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(dt)
    .replace(",", "");
}

function startIstanbulClock() {
  const tick = () => {
    const t = new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    const el = document.getElementById("pill-clock");
    if (el) el.textContent = `${t} TRT`;
  };
  tick();
  setInterval(tick, 15000);
}

function getUserFirstName() {
  const raw = String(state.settings?.display_name || state.auth?.username || "").trim();
  if (!raw || raw.toLowerCase() === "sporcu") return "";
  const first = raw.split(/\s+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

function getTimeGreeting(name) {
  let hr = new Date().getHours();
  try {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hObj = p.find((x) => x.type === "hour");
    if (hObj) hr = Number(hObj.value) % 24;
  } catch (_) {}
  const base = hr >= 5 && hr < 12 ? "Günaydın" : hr < 18 ? "İyi günler" : "İyi akşamlar";
  return name ? `${base}, ${name}` : "Sabah Biyometri & Akşam Hava Kokpiti";
}

function setupTabs() {
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab");
      document.querySelectorAll("[data-tab]").forEach((b) =>
        b.classList.toggle("active", b.getAttribute("data-tab") === target)
      );
      document.querySelectorAll(".tab-panel").forEach((p) =>
        p.classList.toggle("active", p.id === `tab-${target}`)
      );
      const titleEl = document.getElementById("page-title");
      if (titleEl && TAB_TITLES[target]) {
        const fn = getUserFirstName();
        titleEl.textContent = target === "dashboard" && fn ? `${getTimeGreeting(fn)} · Biyometri Kokpiti` : TAB_TITLES[target];
      }
      if (target === "workouts" && state.map) {
        setTimeout(() => state.map.invalidateSize(), 160);
      }
    });
  });
}

async function loadAllData() {
  if (!state.auth.authenticated || !state.auth.userId) return;
  const uid = state.auth.userId;

  const [settingsRes, bioRes, actRes, weekRes, monthRes, notifRes, logsRes, intRes] = await Promise.all([
    sb.from("athlete_settings").select("*").eq("user_id", uid).maybeSingle(),
    sb.from("daily_biometrics").select("*").eq("user_id", uid).order("log_date", { ascending: false }).limit(60),
    sb.from("activities").select("*").eq("user_id", uid).order("start_time_local", { ascending: false }).limit(25),
    sb.from("weekly_strategies").select("*").eq("user_id", uid).order("week_start_date", { ascending: false }).limit(1),
    sb.from("monthly_reports").select("*").eq("user_id", uid).order("month_key", { ascending: false }).limit(1),
    sb.from("notifications").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(25),
    sb.from("sync_logs").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
    apiCall({ action: "getIntegrationStatus" }).then((r) => r.json()).catch(() => null),
  ]);

  state.settings = settingsRes.data || null;
  state.biometrics = bioRes.data || [];
  state.activities = actRes.data || [];
  if (state.activities.length > 0 && !state.activities.some((a) => a.activity_id === state.selectedActivityId)) {
    state.selectedActivityId = state.activities[0].activity_id;
  }
  state.weekly = weekRes.data?.[0] || null;
  state.monthly = monthRes.data?.[0] || null;
  state.notifications = notifRes.data || [];
  state.syncLogs = logsRes.data || [];
  if (intRes?.ok) state.integration = intRes;

  window.GarminThemeEngine?.refreshFromSettings(state.settings);
  window.GarminAiInsights?.initForUser(state.settings, state.auth, sb);
  renderAll();
  renderNotifications();
  renderMonthly();
  updateGarminOnboardingBanner();

  if (!state._autoGpsChecked && state.settings && !state.settings.manual_city_override && state.settings.location_source === "DEFAULT") {
    state._autoGpsChecked = true;
    detectLiveBrowserGps(true);
  }
}

function renderAll() {
  renderTopbar();
  renderDashboard();
  renderWorkouts();
  renderWeekly();
  renderMonthly();
  renderNotifications();
  renderArchive();
  renderSettings();
}

window.openWatchSettings = function () {
  document.querySelector('.nav-btn[data-tab="settings"]')?.click();
  setTimeout(() => {
    const inp = document.getElementById("inp-watch-model");
    if (inp) {
      inp.scrollIntoView({ behavior: "smooth", block: "center" });
      inp.focus();
    }
  }, 140);
};

function renderTopbar() {
  const s = state.settings;
  const latest = state.biometrics[0];
  const firstName = getUserFirstName();
  window.__GC_FIRST_NAME = firstName;

  const sideNameEl = document.getElementById("side-athlete-name");
  if (sideNameEl) sideNameEl.textContent = firstName ? `👋 Merhaba, ${firstName}` : "Sporcu Profili";
  const authPillEl = document.getElementById("pill-auth-user");
  if (authPillEl && firstName) authPillEl.textContent = firstName;

  const dev = s?.weather_cache?.garmin_device || null;
  const watchName = dev?.name || null;
  const watchTxt = watchName ? `⌚ ${watchName}` : "⌚ Garmin Saat (Ayarla)";
  const brandWatchEl = document.getElementById("brand-watch-label");
  if (brandWatchEl) brandWatchEl.textContent = watchTxt;
  const mobileWatchEl = document.getElementById("mobile-watch-pill");
  if (mobileWatchEl) mobileWatchEl.textContent = watchTxt;

  const dashPanel = document.getElementById("tab-dashboard");
  const titleEl = document.getElementById("page-title");
  if (titleEl && dashPanel?.classList.contains("active") && firstName) {
    titleEl.textContent = `${getTimeGreeting(firstName)} · Biyometri Kokpiti`;
  }

  if (s) {
    const age = new Date().getFullYear() - (s.birth_year || 1990);
    document.getElementById("side-athlete-sub").textContent =
      `${s.birth_year ?? "--"} (${age} yaş) · ${s.base_rhr ?? 46} atım/dk · ${s.base_hrv_min ?? 59}–${s.base_hrv_max ?? 74} denge`;
    const srcMap = {
      LIVE_GPS: "Canlı GPS",
      GARMIN_GPS: "Garmin GPS",
      GPS_ACTIVITY: "Garmin GPS",
      MANUAL: "Manuel",
      DEFAULT: "Varsayılan",
    };
    const srcLabel = srcMap[s.location_source] || "Varsayılan";
    document.getElementById("pill-location").textContent = `📍 ${s.active_city || s.default_city || "--"} (${srcLabel})`;
  }
  if (latest) {
    document.getElementById("pill-date").textContent = latest.log_date;
    document.getElementById("side-readiness-chip").textContent = `${latest.readiness_score ?? "--"}/100`;
  } else {
    document.getElementById("pill-date").textContent = new Date().toISOString().slice(0, 10);
    document.getElementById("side-readiness-chip").textContent = "--/100";
  }
}

function computeClientReadinessComponents(bio) {
  const s = state.settings || {};
  const bb = Math.min(100, Math.max(0, bio.body_battery_max ?? 0));
  const slp = Math.min(100, Math.max(0, bio.sleep_score ?? 0));

  const hrvVal = bio.hrv_nightly_avg ?? 62;
  const baseMin = Number(s.base_hrv_min ?? 59);
  const baseMax = Number(s.base_hrv_max ?? 74);
  const hrvWarn = Number(s.hrv_warn_threshold ?? 48);
  const hrvExt = Number(s.hrv_extreme_threshold ?? 40);
  const peak = Math.round((baseMin + baseMax) / 2);
  let hrvScore = 85;
  if (hrvVal >= peak) hrvScore = 100;
  else if (hrvVal >= baseMin) hrvScore = Math.round(85 + ((hrvVal - baseMin) / Math.max(1, peak - baseMin)) * 15);
  else if (hrvVal >= hrvWarn) hrvScore = Math.round(60 + ((hrvVal - hrvWarn) / Math.max(1, baseMin - hrvWarn)) * 25);
  else if (hrvVal >= hrvExt) hrvScore = Math.round(30 + ((hrvVal - hrvExt) / Math.max(1, hrvWarn - hrvExt)) * 30);
  else hrvScore = Math.max(10, 30 - (hrvExt - hrvVal) * 2);

  const rhrVal = bio.rhr ?? 46;
  const baseRhr = Number(s.base_rhr ?? 46);
  const rhrWarn = Number(s.rhr_warn_threshold ?? 51);
  const rhrExt = Number(s.rhr_extreme_threshold ?? 55);
  let rhrScore = 100;
  if (rhrVal <= baseRhr) rhrScore = 100;
  else if (rhrVal <= rhrWarn) rhrScore = Math.round(100 - ((rhrVal - baseRhr) / Math.max(1, rhrWarn - baseRhr)) * 35);
  else if (rhrVal <= rhrExt) rhrScore = Math.round(65 - ((rhrVal - rhrWarn) / Math.max(1, rhrExt - rhrWarn)) * 35);
  else rhrScore = Math.max(10, 30 - (rhrVal - rhrExt) * 4);

  return [
    { label: "Body Battery Maks (%30)", raw: `${bb}/100`, score: bb, color: "#00e5a3" },
    { label: "Uyku Skoru (%30)", raw: `${slp}/100`, score: slp, color: "#38bdf8" },
    { label: "Kalp Dengesi · HRV (%25)", raw: `${hrvVal} puan`, score: hrvScore, color: "#a78bfa" },
    { label: "Dinlenik Nabız (%15)", raw: `${rhrVal} atım/dk`, score: rhrScore, color: "#f59e0b" },
  ];
}

function renderSleepDebtAndBedtime() {
  const box = document.getElementById("sleep-debt-box");
  if (!box) return;
  const recentSleep = state.biometrics.slice(0, 7).filter((d) => Number(d.sleep_seconds || 0) > 0);
  if (!recentSleep.length) {
    box.innerHTML = `<span class="card-sub">Uyku borcu hesabı için veri bekleniyor.</span>`;
    return;
  }
  const targetH = 7.5;
  const avgH = recentSleep.reduce((s, d) => s + Number(d.sleep_seconds) / 3600, 0) / recentSleep.length;
  const netDebtH = Math.max(
    0,
    recentSleep.reduce((s, d) => s + (targetH - Number(d.sleep_seconds) / 3600), 0)
  );
  const bedtime = netDebtH >= 4 ? "22:15" : netDebtH >= 2 ? "22:45" : "23:15";
  const statusClr = netDebtH >= 4 ? "#f59e0b" : netDebtH >= 2 ? "#38bdf8" : "#00e5a3";
  box.innerHTML = `
    <div>
      😴 <strong>7G Uyku Ort:</strong> <span class="mono">${avgH.toFixed(1)} sa</span> ·
      <strong>Uyku Borcu:</strong> <span class="mono" style="color:${statusClr};">${netDebtH.toFixed(1)} sa</span>
      <span class="card-sub">(Hedef ${targetH} sa/gece)</span>
    </div>
    <span class="badge ${netDebtH >= 4 ? "badge-warn" : "badge-ok"} mono">🌙 En Geç Yatış: ${bedtime}</span>
  `;
}

function describeRedFlag(f) {
  const val = f?.value != null ? f.value : "--";
  const thr = f?.threshold != null ? f.threshold : "--";
  const m = String(f?.metric || "").toUpperCase();
  if (m === "SLEEP_STRESS") {
    return `Uyku Stresi ${val} (Eşik ≥${thr}): Gece sinir sistemi tam gevşeyememiş (geç akşam yemeği, kafein veya birikmiş yorgunluk etkisi olabilir). Bugün zorlayıcı setlerden kaçınıp Z2 yürüyüş ve erken uyku hedefle.`;
  }
  if (m === "RHR") {
    return `Dinlenik Nabız ${val} atım/dk (Sınır ≥${thr} atım/dk): Kalp normal seviyesinin üzerinde çalışıyor; yorgunluk veya başlangıç aşamasında stres/enfeksiyon göstergesi olabilir. Yüksek nabızlı yüklenmeyi ertele.`;
  }
  if (m === "HRV") {
    return `Kalp Dengesi ${val} puan (Sınır ≤${thr} puan): Vücut tam dinlenememiş ve stres altında. Ağırlık/sprint yükünü düşürüp hafif esneme ve ek dinlenmeye odaklan.`;
  }
  if (m === "RESP") {
    return `Gece Solunumu ${val} nefes/dk (Sınır ≥${thr} nefes/dk): Solunum hızı normalin üstünde seyretmiş; uyku kalitesi ve toparlanma verimi düşmüş olabilir. Kontrollü tempoda kal.`;
  }
  if (m === "SKIN_TEMP") {
    return `Deri Sıcaklığı +${val}°C (Eşik ≥+${thr}°C): Vücut ısısı sapması normalden yüksek; olası inflamasyon veya hastalık sinyali olabilir. Ağırlık yükünü hafifletip sıvı alımını artır.`;
  }
  if (m === "SPO2") {
    return `Gece SpO2 %${val} (Eşik ≤%${thr}): Oksijen satürasyonu kişisel eşiğin altında kalmış; oda havalandırması veya yorgunluk etkili olabilir. Açık havada Z2 tempoyu aşma.`;
  }
  return `${f?.message || "Fizyolojik eşik aşıldı"}: Bugün antrenman şiddetini vücut sinyaline göre bir kademe düşür.`;
}

function renderDashboard() {
  const latest = state.biometrics[0];
  const s = state.settings || {};
  if (!latest) {
    document.getElementById("red-alert-banner")?.classList.add("hidden");
    document.getElementById("readiness-score").textContent = "--";
    document.getElementById("readiness-status-label").textContent = "VERİ BEKLENİYOR";
    document.getElementById("bb-ring-label").textContent = "Enerji --";
    document.getElementById("readiness-badge").textContent = "--";
    document.getElementById("readiness-breakdown").innerHTML = `<p class="card-sub">İlk verinizi görmek için Ayarlar'dan Garmin API bağlayın veya "+ Günlük Veri Ekle" butonunu kullanın.</p>`;
    document.getElementById("sleep-total-label").textContent = "--";
    document.getElementById("sleep-hypnogram").innerHTML = "";
    document.getElementById("sleep-legend").innerHTML = "";
    document.getElementById("sleep-debt-box").innerHTML = "";
    document.getElementById("ai-daily-blocks").innerHTML = `<p class="card-sub">Henüz günlük rapor oluşmadı.</p>`;
    document.getElementById("bb-events-list").innerHTML = `<p class="card-sub">Henüz Body Battery verisi yok.</p>`;
    document.getElementById("deep-telemetry-cards").innerHTML = "";
    document.getElementById("active-intel-3x").innerHTML = `<p class="card-sub">Günlük veriler geldikçe özet kartlar burada görünür.</p>`;
    document.getElementById("correlation-matrix-grid").innerHTML = `<p class="card-sub">Etki analizi için en az 3 günlük kayıt gerekir.</p>`;
    return;
  }

  // Red / Warn Alert Banner
  const banner = document.getElementById("red-alert-banner");
  const iconEl = document.getElementById("red-alert-icon");
  const titleEl = document.getElementById("red-alert-title");
  const textEl = document.getElementById("red-alert-text");
  const badgeEl = document.getElementById("red-alert-badge");
  const flags = Array.isArray(latest.red_flags) ? latest.red_flags : [];

  if (flags.length > 0) {
    const isCritical = flags.some((f) => f.severity === "CRITICAL") || flags.length >= 3;
    banner.classList.remove("hidden");
    banner.classList.toggle("alert-warn", !isCritical);
    if (iconEl) iconEl.textContent = isCritical ? "🚨" : "⚠️";
    if (titleEl) {
      titleEl.textContent = isCritical
        ? `Kritik Toparlanma Alarmı · ${flags.length} Eşik Aşıldı`
        : `Fizyolojik Dikkat Uyarısı · ${flags.length} Metrik Eşik Dışında`;
    }
    if (badgeEl) {
      badgeEl.className = `badge ${isCritical ? "badge-crit" : "badge-warn"}`;
      badgeEl.textContent = isCritical
        ? "Aktif Dinlenme Günü"
        : flags.length === 1
          ? "Kontrollü Tempo"
          : "Hafif Antrenman";
    }
    if (textEl) {
      textEl.innerHTML = flags
        .map((f) => {
          const full = describeRedFlag(f);
          const idx = full.indexOf(":");
          const head = idx > 0 ? full.slice(0, idx + 1) : "";
          const body = idx > 0 ? full.slice(idx + 1) : full;
          return `<div class="alert-flag-item">${head ? `<strong>${escapeHtml(head)}</strong>` : ""}${escapeHtml(body)}</div>`;
        })
        .join("");
    }
  } else {
    banner.classList.add("hidden");
    banner.classList.remove("alert-warn");
  }

  // Dual Ring Readiness & Body Battery
  const score = latest.readiness_score ?? 0;
  const bbMax = latest.body_battery_max ?? 0;
  const ringR = document.getElementById("ring-readiness");
  const ringBB = document.getElementById("ring-bb");
  const c1 = 2 * Math.PI * 72;
  const c2 = 2 * Math.PI * 54;
  ringR.style.strokeDashoffset = String(c1 * (1 - score / 100));
  ringBB.style.strokeDashoffset = String(c2 * (1 - bbMax / 100));

  const ringColor = score >= 80 ? "#00e5a3" : score >= 60 ? "#38bdf8" : score >= 45 ? "#f59e0b" : "#ef4444";
  ringR.style.stroke = ringColor;

  document.getElementById("readiness-score").textContent = score;
  const stLbl = document.getElementById("readiness-status-label");
  stLbl.textContent = latest.readiness_status || "OPTIMAL";
  stLbl.style.color = ringColor;
  document.getElementById("bb-ring-label").textContent = `BB ${bbMax}/100`;

  const badge = document.getElementById("readiness-badge");
  badge.textContent = score >= 80 ? "Yeşil Işık" : score >= 60 ? "Kontrollü" : "Toparlanma";
  badge.className = `badge ${score >= 80 ? "badge-ok" : score >= 60 ? "badge-info" : "badge-warn"}`;

  const components = computeClientReadinessComponents(latest);
  document.getElementById("readiness-breakdown").innerHTML = components
    .map(
      (c) => `
      <div>
        <div class="bar-row-head"><span>${escapeHtml(c.label)}</span><strong class="mono" style="color:${c.color}">${escapeHtml(c.raw)}</strong></div>
        <div class="bar-track"><div class="bar-fill" style="width:${c.score}%; background:${c.color}"></div></div>
      </div>`
    )
    .join("");

  // Sleep Architecture Strip
  const deep = latest.deep_sleep_seconds || 5800;
  const light = latest.light_sleep_seconds || 14200;
  const rem = latest.rem_sleep_seconds || 6200;
  const awake = latest.awake_seconds || 420;
  const totalS = deep + light + rem + awake;
  document.getElementById("sleep-total-label").textContent = fmtDuration(latest.sleep_seconds || totalS);
  document.getElementById("sleep-hypnogram").innerHTML = `
    <div style="width:${(deep / totalS) * 100}%; background:#6366f1;" title="Derin"></div>
    <div style="width:${(light / totalS) * 100}%; background:#38bdf8;" title="Hafif"></div>
    <div style="width:${(rem / totalS) * 100}%; background:#00e5a3;" title="REM"></div>
    <div style="width:${(awake / totalS) * 100}%; background:#f59e0b;" title="Uyanık"></div>
  `;
  document.getElementById("sleep-legend").innerHTML = `
    <span>🟣 Derin ${fmtDuration(deep)}</span>
    <span>🔵 Hafif ${fmtDuration(light)}</span>
    <span>🟢 REM ${fmtDuration(rem)}</span>
    <span>🟠 Uyanık ${Math.round(awake / 60)} dk</span>
  `;
  renderSleepDebtAndBedtime();

  // 180° AQI Semicircle Gauge & Hourly Strip
  const w = latest.evening_weather || {};
  const aqi = Number(w.aqi_max ?? 25);
  document.getElementById("weather-source-label").textContent = `${w.city || s.active_city || s.default_city || "--"} · ${w.source || "MET Norway + Open-Meteo AQI"}`;

  // Map AQI 0..100 to -82deg..+82deg
  const clampedAqi = Math.min(100, Math.max(0, aqi));
  const angle = -82 + (clampedAqi / 100) * 164;
  document.getElementById("aqi-needle").setAttribute("transform", `rotate(${angle.toFixed(1)} 105 102)`);
  document.getElementById("aqi-dial-val").textContent = `${aqi} AQI`;

  const dialLbl = w.dial_level || "YEŞİL";
  const dialBadge = document.getElementById("aqi-dial-badge");
  dialBadge.textContent = `${dialLbl} · PM2.5 ${w.pm25_max ?? "--"}`;
  dialBadge.className = `badge ${dialLbl === "YEŞİL" ? "badge-ok" : dialLbl === "SARI" ? "badge-warn" : dialLbl === "TURUNCU" ? "badge-orange" : "badge-crit"}`;

  document.getElementById("evening-weather-stats").innerHTML = `
    <div class="mini-box"><div class="mini-box-lbl">Sıcaklık / Hissedilen</div><div class="mini-box-val mono">${w.temp_c ?? "--"}° / ${w.feels_like_c ?? "--"}°</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Rüzgar / Yağış</div><div class="mini-box-val mono">${w.wind_kmh ?? "--"} km/s · %${w.precip_prob ?? 0}</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Gün Batımı</div><div class="mini-box-val mono">🌇 ${w.sunset ?? "--"}</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Pencere</div><div class="mini-box-val mono">17:00–21:00</div></div>
  `;

  const slots = Array.isArray(w.hourly_slots) && w.hourly_slots.length
    ? w.hourly_slots
    : [
        { hour: "17:00", temp_c: w.temp_c ?? 13, wind_kmh: w.wind_kmh ?? 12, precip_prob: w.precip_prob ?? 15, aqi: w.aqi_max ?? 28, dial_level: dialLbl },
        { hour: "18:00", temp_c: w.temp_c ?? 13, wind_kmh: w.wind_kmh ?? 12, precip_prob: w.precip_prob ?? 15, aqi: w.aqi_max ?? 28, dial_level: dialLbl },
        { hour: "19:00", temp_c: w.temp_c ?? 12, wind_kmh: w.wind_kmh ?? 12, precip_prob: w.precip_prob ?? 15, aqi: w.aqi_max ?? 28, dial_level: dialLbl },
        { hour: "20:00", temp_c: w.temp_c ?? 12, wind_kmh: w.wind_kmh ?? 12, precip_prob: w.precip_prob ?? 15, aqi: w.aqi_max ?? 28, dial_level: dialLbl },
        { hour: "21:00", temp_c: w.temp_c ?? 11, wind_kmh: w.wind_kmh ?? 12, precip_prob: w.precip_prob ?? 15, aqi: w.aqi_max ?? 28, dial_level: dialLbl },
      ];
  const scoreSlot = (sl) =>
    (sl.aqi ?? 30) * 1.2 +
    (sl.precip_prob ?? 10) * 0.65 +
    (sl.wind_kmh ?? 12) * 0.9 +
    Math.abs((sl.temp_c ?? 15) - 16) * 1.5;
  let bestSlot = slots[0];
  let bestPenalty = Infinity;
  for (const sl of slots) {
    const p = scoreSlot(sl);
    if (p < bestPenalty) { bestPenalty = p; bestSlot = sl; }
  }
  const bestBanner = document.getElementById("best-walk-slot-banner");
  if (bestBanner && bestSlot) {
    bestBanner.innerHTML = `🎯 <strong>Altın Saat (${escapeHtml(bestSlot.hour)}):</strong> AQI ${bestSlot.aqi} (${escapeHtml(bestSlot.dial_level || dialLbl)}) · Rüzgar ${bestSlot.wind_kmh ?? "--"} km/s · ${bestSlot.temp_c}°C (Yağış %${bestSlot.precip_prob})`;
  }
  document.getElementById("hourly-walk-strip").innerHTML = slots
    .map((slot) => {
      const isBest = slot.hour === bestSlot.hour;
      const dotCol = slot.aqi <= 25 ? "#10b981" : slot.aqi <= 50 ? "#f59e0b" : slot.aqi <= 75 ? "#fb923c" : "#ef4444";
      return `
      <div class="hour-pill ${isBest ? "best" : ""}">
        <div class="mono" style="font-weight:700;">${escapeHtml(slot.hour)}</div>
        <div class="mono" style="color:var(--text-secondary); margin:2px 0;">${slot.temp_c}°C</div>
        <div style="font-size:10px; color:var(--text-muted);">💧%${slot.precip_prob} · ${slot.wind_kmh ?? "--"}km</div>
        <div style="font-size:10.5px; color:${dotCol}; font-weight:700;">● ${slot.aqi}</div>
      </div>`;
    })
    .join("");

  document.getElementById("evening-clothing-advice").innerHTML =
    `🧥 <strong>Katman Reçetesi:</strong> ${escapeHtml(w.clothing_advice || "Hafif katmanlı yürüyüş kıyafeti.")}`;

  // 6 Baseline Corridors (Compact Mobile-First)
  const rhrWarn = s.rhr_warn_threshold ?? 51;
  const hrvWarn = s.hrv_warn_threshold ?? 48;
  const respWarn = Number(s.resp_warn_threshold ?? 18.0);
  const stressWarn = s.sleep_stress_threshold ?? 23;
  const tempWarn = Number(s.skin_temp_deviation_threshold ?? 0.4);
  const spo2Warn = s.spo2_warn_threshold ?? 91;

  const pctClamp = (v) => Math.min(95, Math.max(5, Math.round(v)));
  const corridors = [
    {
      title: "Dinlenik Nabız",
      val: `${latest.rhr ?? "--"} atım/dk`,
      meta: `Normal ${s.base_rhr ?? 46} · Sınır ≥${rhrWarn}`,
      pos: pctClamp((((latest.rhr ?? 46) - 40) / 20) * 100),
      ok: (latest.rhr ?? 46) < rhrWarn,
    },
    {
      title: "Kalp Dengesi (HRV)",
      val: `${latest.hrv_nightly_avg ?? "--"} puan`,
      meta: `Normal ${s.base_hrv_min ?? 59}–${s.base_hrv_max ?? 74} · Sınır ≤${hrvWarn}`,
      pos: pctClamp(((80 - (latest.hrv_nightly_avg ?? 62)) / 45) * 100),
      ok: (latest.hrv_nightly_avg ?? 62) > hrvWarn,
    },
    {
      title: "Solunum Hızı",
      val: `${latest.sleep_respiration_avg ?? "--"} nefes/dk`,
      meta: `Normal <${respWarn} nefes/dk`,
      pos: pctClamp((((latest.sleep_respiration_avg ?? 15.5) - 12) / 8) * 100),
      ok: Number(latest.sleep_respiration_avg ?? 15.5) < respWarn,
    },
    {
      title: "Uyku Stresi",
      val: `${latest.sleep_stress_avg ?? "--"} puan`,
      meta: `Normal <${stressWarn} puan`,
      pos: pctClamp((((latest.sleep_stress_avg ?? 17) - 10) / 20) * 100),
      ok: Number(latest.sleep_stress_avg ?? 17) < stressWarn,
    },
    {
      title: "Deri Sıcaklığı",
      val: `${Number(latest.skin_temp_deviation ?? 0) >= 0 ? "+" : ""}${latest.skin_temp_deviation ?? "0.0"}°C`,
      meta: `Normal <+${tempWarn}°C`,
      pos: pctClamp((((Number(latest.skin_temp_deviation ?? 0) + 0.3) / 1.0)) * 100),
      ok: Number(latest.skin_temp_deviation ?? 0) < tempWarn,
    },
    {
      title: "Oksijen · Kondisyon",
      val: `%${latest.spo2_avg ?? "--"} · ${latest.vo2_max ?? "--"}`,
      meta: `En Düşük %${latest.spo2_min ?? "--"} · Yaş ${latest.fitness_age ?? "--"}`,
      pos: pctClamp(((100 - Number(latest.spo2_avg ?? 96)) / 12) * 100),
      ok: Number(latest.spo2_avg ?? 96) > spo2Warn,
    },
  ];

  document.getElementById("baseline-cards").innerHTML = corridors
    .map(
      (c) => `
      <div class="corridor-card">
        <div class="corridor-top">
          <span class="corridor-title">${escapeHtml(c.title)}</span>
          <span class="badge ${c.ok ? "badge-ok" : "badge-warn"}">${c.ok ? "Normal" : "Uyarı"}</span>
        </div>
        <div class="corridor-val mono">${escapeHtml(c.val)}</div>
        <div class="corridor-track">
          <div class="corridor-marker" style="left:${c.pos}%; border-color:${c.ok ? "#00e5a3" : "#f59e0b"}"></div>
        </div>
        <div class="corridor-meta">${escapeHtml(c.meta)}</div>
      </div>`
    )
    .join("");

  // AI Daily Brief
  const brief = latest.ai_daily_brief || {};
  document.getElementById("ai-headline").textContent = brief.headline || "Günün Performans Koçu Reçetesi";
  document.getElementById("ai-source-tag").textContent =
    brief.source && brief.source !== "LOCAL_DETERMINISTIC"
      ? `Gemini 3 Flash AI (${String(brief.source).replace("models/", "")})`
      : "Yerel Deterministik Performans Koçu";
  const trDays = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
  const dIdx = new Date(`${latest.log_date}T12:00:00Z`).getUTCDay();
  document.getElementById("today-weekday-badge").textContent = trDays[dIdx] || "Bugün";

  document.getElementById("ai-daily-blocks").innerHTML = `
    <div class="coach-block"><h4>Fizyolojik Durum</h4><p>${escapeHtml(brief.morning_coach_note || "--")}</p></div>
    <div class="coach-block" style="border-left-color:var(--cyan);"><h4>Kuvvet & Dambıl Planı (6–10 kg)</h4><p>${escapeHtml(brief.strength_prescription || "--")}</p></div>
    <div class="coach-block" style="border-left-color:var(--amber);"><h4>17:00–21:00 Akşam Yürüyüşü</h4><p>${escapeHtml(brief.evening_walk_plan || "--")}</p></div>
  `;

  renderTrendChart();
  renderDeepTelemetry(latest);
  renderActiveIntelligence3x(latest);
  renderCorrelationMatrix();
  renderAcwrAndEf();
  renderCustomCompareChart();
}

function computeAvg(arr) {
  const vals = arr.filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function computePearsonCorr(pairs) {
  const clean = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = clean.length;
  if (n < 3) return { r: null, n };
  let sx = 0, sy = 0;
  for (const [x, y] of clean) { sx += x; sy += y; }
  const mx = sx / n;
  const my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const [x, y] of clean) {
    const dx = x - mx;
    const dy = y - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return { r: denom < 1e-9 ? 0 : num / denom, n };
}

function renderActiveIntelligence3x(latest) {
  const box = document.getElementById("active-intel-3x");
  if (!box || !latest) return;

  const recent7 = state.biometrics.slice(0, 7);
  const hrv7 = computeAvg(recent7.map((d) => d.hrv_nightly_avg));
  const hrvDelta = hrv7 != null && latest.hrv_nightly_avg != null ? (latest.hrv_nightly_avg - hrv7).toFixed(1) : null;
  const flags = Array.isArray(latest.red_flags) ? latest.red_flags : [];

  const morningMsg = flags.length
    ? `⚠️ ${flags[0].message}. Hazırlık puanın ${latest.readiness_score ?? "--"}/100; bugün ağır ağırlık yerine hafif tempolu yürüyüş ve bol su tüketimi daha uygun.`
    : `Gece toparlanman (kalp dengesi) ${latest.hrv_nightly_avg ?? "--"} puan${hrvDelta != null ? ` (son 7 güne göre ${Number(hrvDelta) >= 0 ? "+" : ""}${hrvDelta})` : ""}, dinlenik nabzın ${latest.rhr ?? "--"} atım/dk. ${Number(latest.readiness_score) >= 80 ? "Bugün güçlü bir antrenman için hazırsın." : "Bugün orta ve kontrollü tempoda kalman iyi olur."}`;

  const lastAct = state.activities[0];
  let workoutMsg = "Henüz kaydedilmiş antrenman bulunamadı.";
  let workoutBadge = "Beklemede";
  if (lastAct) {
    const waterMl = Math.max(200, Math.round((Number(lastAct.session_comparison?.water_ml || 250)) / 50) * 50);
    const waterCups = Math.max(1, Math.round((waterMl / 250) * 2) / 2);
    const dist = Number(lastAct.distance_meters || 0);
    const durMin = Math.max(1, Number(lastAct.duration_seconds || 0) / 60);
    const ef = dist > 500 && lastAct.avg_hr ? ((dist / durMin) / Number(lastAct.avg_hr)).toFixed(2) : null;
    const efNote = ef
      ? ` Kalp-tempo uyumu: ${ef} (${Number(ef) >= 0.85 ? "iyi" : "normal"}).`
      : lastAct.training_load != null
        ? ` Antrenman yükü: ${lastAct.training_load}.`
        : "";
    workoutBadge = String(lastAct.start_time_local || "").slice(5, 16).replace("T", " ");
    workoutMsg = `${lastAct.activity_name} (${fmtDuration(lastAct.duration_seconds)}, ort. ${lastAct.avg_hr ?? "--"} atım/dk). Toparlanma için ~${waterMl} ml (${waterCups} bardak) su içmen yeterli.${efNote}`;
  }

  const te = latest.raw_payload?.telemetry_extra || {};
  const w = latest.evening_weather || {};
  const bbCur = te.bb_current ?? latest.body_battery_min ?? "--";
  const highStressPct = Math.round((te.stress_breakdown?.high_pct || 0) + (te.stress_breakdown?.med_pct || 0));
  const targetSteps = 10000;
  const remSteps = Math.max(0, targetSteps - Number(latest.steps || 0));
  const dialMapTr = {
    "YEŞİL": "hava temiz",
    "SARI": "hava orta",
    "TURUNCU": "hava biraz kirli",
    "KIRMIZI": "hava sağlıksız",
  };
  const aqiPlainTr = dialMapTr[String(w.dial_level || "").toLocaleUpperCase("tr-TR")] || "hava orta";
  const nightMsg = `Kalan enerjin ${bbCur}/100 · Bugün zamanının %${highStressPct}'i stresli geçti. ${remSteps > 0 ? `10.000 adım hedefine ${remSteps.toLocaleString("tr-TR")} adım kaldı (dışarısı ${w.temp_c ?? "--"}°C, ${aqiPlainTr}). ` : "Günlük 10.000 adım hedefini tamamladın! "}22:30 öncesi ekranı bırakıp 7,5+ saat uykuya hazırlan.`;

  box.innerHTML = `
    <div class="intel-card" style="border-top:3px solid #00e5a3;">
      <div class="intel-card-head">
        <div class="intel-card-title">🌅 Sabah Durumu</div>
        <span class="badge badge-ok mono">Hazırlık ${latest.readiness_score ?? "--"}/100</span>
      </div>
      <p class="card-sub" style="color:var(--text); line-height:1.5;">${escapeHtml(morningMsg)}</p>
      <div class="card-sub mono">En Yüksek Enerji: ${latest.body_battery_max ?? "--"}/100 · Uyku Puanı: ${latest.sleep_score ?? "--"}/100</div>
    </div>
    <div class="intel-card" style="border-top:3px solid #38bdf8;">
      <div class="intel-card-head">
        <div class="intel-card-title">🏃 Son Antrenman Özeti</div>
        <span class="badge badge-info mono">${escapeHtml(workoutBadge)}</span>
      </div>
      <p class="card-sub" style="color:var(--text); line-height:1.5;">${escapeHtml(workoutMsg)}</p>
      <div class="card-sub mono">Dayanıklılık etkisi: ${lastAct?.aerobic_te ?? "-"} · Güç etkisi: ${lastAct?.anaerobic_te ?? "-"} · Harcanan enerji: ${lastAct?.session_comparison?.bb_impact ?? "--"} puan</div>
    </div>
    <div class="intel-card" style="border-top:3px solid #a78bfa;">
      <div class="intel-card-head">
        <div class="intel-card-title">🌙 Akşam &amp; Uyku Hazırlığı</div>
        <span class="badge badge-warn mono">Akşam Planı</span>
      </div>
      <p class="card-sub" style="color:var(--text); line-height:1.5;">${escapeHtml(nightMsg)}</p>
      <div class="card-sub mono">Bugünkü Adım: ${(latest.steps || 0).toLocaleString("tr-TR")} · Gece Uyku Stresi: ${latest.sleep_stress_avg ?? "--"}</div>
    </div>
  `;
}

function renderCorrelationMatrix() {
  const grid = document.getElementById("correlation-matrix-grid");
  const badge = document.getElementById("corr-sample-badge");
  if (!grid || !state.biometrics.length) return;

  const rows = [...state.biometrics].reverse(); // oldest -> newest
  if (badge) badge.textContent = `${rows.length} günlük veri`;

  const pairsList = [
    {
      title: "Gece Stresi → Gece Toparlanması",
      res: computePearsonCorr(rows.map((d) => [Number(d.sleep_stress_avg), Number(d.hrv_nightly_avg)])),
      goodSign: -1,
      getInsight: (r) => {
        if (r <= -0.35) return "Gece stresin düştükçe vücudun gece daha iyi toparlanıyor. Akşam sakinliği doğrudan fayda sağlıyor.";
        if (r >= 0.35) return "Stresli gecelerde toparlanma puanın beklenmedik şekilde yüksek kalmış veya veri karışık görünüyor.";
        return "Gece stresi ile uyku toparlanması arasında şu an belirgin bir bağ görünmüyor.";
      },
    },
    {
      title: "Gece Enerji Şarjı → Sabah Zindeliği",
      res: computePearsonCorr(rows.map((d) => [Number(d.body_battery_charged ?? d.body_battery_max), Number(d.readiness_score)])),
      goodSign: 1,
      getInsight: (r) => {
        if (r >= 0.35) return "Gece enerjin ne kadar iyi dolarsa sabah zindeliğin de o kadar yüksek oluyor.";
        if (r <= -0.35) return "Gece enerji şarjın artmasına rağmen sabah zindeliğin düşmüş görünüyor; uyku kalitesi etkili olabilir.";
        return "Gece enerji şarjı ile sabah zindeliği arasında şu an net bir bağ görünmüyor.";
      },
    },
    {
      title: "Uyku Süresi → Sabah Zindeliği",
      res: computePearsonCorr(rows.map((d) => [d.sleep_seconds != null ? d.sleep_seconds / 3600 : NaN, Number(d.readiness_score)])),
      goodSign: 1,
      getInsight: (r) => {
        if (r >= 0.35) return "Uyku süren uzadıkça sabah kendini daha zinde ve hazır hissediyorsun.";
        if (r <= -0.35) return "Uzun uyuduğun günlerde bile sabah yorgun kalkabiliyorsun; uyku kalitesi süreden daha önemli olabilir.";
        return "Uyku süresi tek başına sabah zindeliğini belirgin şekilde değiştirmiyor.";
      },
    },
    {
      title: "Günlük Adım → Ertesi Sabah Nabzı",
      res: computePearsonCorr(
        rows.slice(0, -1).map((d, i) => [Number(d.steps), Number(rows[i + 1]?.rhr)])
      ),
      goodSign: -1,
      getInsight: (r) => {
        if (r <= -0.35) return "Daha çok yürüdüğün günlerin ertesi sabahı nabzın düşüyor; hareket vücudunu iyi destekliyor.";
        if (r >= 0.35) return "Yoğun adım attığın günlerin ertesi sabahı nabzın biraz yükseliyor; vücut ekstra dinlenme istiyor olabilir.";
        if (r >= 0.2) return "Adım arttığında ertesi sabah nabzın hafif yükselebiliyor ama belirgin bir yorgunluk işareti yok.";
        return "Günlük adım sayısı ertesi sabah dinlenik nabzını belirgin şekilde değiştirmiyor.";
      },
    },
  ];

  grid.innerHTML = pairsList
    .map((item) => {
      const r = item.res.r;
      if (r == null) {
        return `<div class="corr-card"><div class="corr-head"><strong>${escapeHtml(item.title)}</strong><span class="mono">--</span></div><p class="card-sub">Yeterli veri yok (en az 3 günlük kayıt gerekir).</p></div>`;
      }
      const absR = Math.abs(r);
      const strength = absR >= 0.6 ? "Güçlü Etki" : absR >= 0.35 ? "Orta Etki" : absR >= 0.2 ? "Zayıf Etki" : "Belirgin Etki Yok";
      const aligned = r * item.goodSign > 0;
      const color = absR < 0.2 ? "#94a3b8" : aligned ? "#00e5a3" : "#f59e0b";
      return `
        <div class="corr-card">
          <div class="corr-head">
            <strong style="font-size:13px;">${escapeHtml(item.title)}</strong>
            <span class="corr-r mono" style="color:${color}; white-space:nowrap;">Etki: %${Math.round(absR * 100)}</span>
          </div>
          <div class="bar-track" style="margin-bottom:6px;">
            <div class="bar-fill" style="width:${Math.round(absR * 100)}%; background:${color};"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11.5px; margin-bottom:4px;">
            <span style="color:${color}; font-weight:600;">${strength}</span>
            <span class="card-sub mono">${item.res.n} günlük veri</span>
          </div>
          <p class="card-sub" style="color:var(--text-secondary); line-height:1.45;">${escapeHtml(item.getInsight(r))}</p>
        </div>
      `;
    })
    .join("");
}

function renderAcwrAndEf() {
  const strip = document.getElementById("acwr-ef-strip");
  const acwrBadge = document.getElementById("perf-acwr-badge");
  if (!strip) return;

  const refDateStr = state.biometrics[0]?.log_date;
  const refMs = refDateStr ? new Date(`${refDateStr}T23:59:59Z`).getTime() : Date.now();
  const dayMs = 86400000;

  let acute7 = 0;
  let load28 = 0;
  let earliest28Ms = refMs;
  let count14 = 0;
  let kcal14 = 0;

  for (const a of state.activities) {
    const tMs = new Date(a.start_time_local).getTime();
    if (!Number.isFinite(tMs)) continue;
    const diffDays = (refMs - tMs) / dayMs;
    const trLoad = Number(a.training_load) || Math.round((Number(a.duration_seconds || 0) / 60) * ((Number(a.avg_hr || 105)) / 95));
    if (diffDays >= -1 && diffDays <= 7) acute7 += trLoad;
    if (diffDays >= -1 && diffDays <= 14) {
      count14 += 1;
      kcal14 += Number(a.calories || 0);
    }
    if (diffDays >= -1 && diffDays <= 28) {
      load28 += trLoad;
      if (tMs < earliest28Ms) earliest28Ms = tMs;
    }
  }

  const observedDays = Math.max(7, Math.min(28, Math.ceil((refMs - earliest28Ms) / dayMs) + 1));
  const weeksInWindow = Math.max(1, observedDays / 7);
  const chronicWeekly = load28 / weeksInWindow;
  const acwr = chronicWeekly > 0 ? acute7 / chronicWeekly : 1.0;

  let acwrStatus = "Sweet Spot (Optimal)";
  let acwrCls = "badge-ok";
  let acwrColor = "#00e5a3";
  if (acwr < 0.8) {
    acwrStatus = "Düşük Yüklenme (<0.80)";
    acwrCls = "badge-info";
    acwrColor = "#38bdf8";
  } else if (acwr > 1.5) {
    acwrStatus = "Aşırı Yük Riski (>1.50)";
    acwrCls = "badge-crit";
    acwrColor = "#ef4444";
  } else if (acwr > 1.3) {
    acwrStatus = "Hızlı Yük Artışı (1.31–1.50)";
    acwrCls = "badge-warn";
    acwrColor = "#f59e0b";
  }

  if (acwrBadge) {
    acwrBadge.textContent = `ACWR ${acwr.toFixed(2)} · ${acwrStatus}`;
    acwrBadge.className = `badge ${acwrCls} mono`;
  }

  // Aerobic Efficiency Factor: Ef = (speed m/min) / avg_hr
  const cardioActs = state.activities.filter(
    (a) => Number(a.distance_meters || 0) > 500 && Number(a.duration_seconds || 0) > 300 && Number(a.avg_hr || 0) > 50
  );
  const calcEf = (a) => (Number(a.distance_meters) / (Number(a.duration_seconds) / 60)) / Number(a.avg_hr);
  const curEf = cardioActs[0] ? calcEf(cardioActs[0]) : null;
  const prevEf = cardioActs[1] ? calcEf(cardioActs[1]) : null;
  const efDelta = curEf != null && prevEf != null ? curEf - prevEf : null;

  strip.innerHTML = `
    <div class="card">
      <div class="kpi-label">ACWR (Akut : Kronik Yük Oranı)</div>
      <div class="kpi-value mono" style="color:${acwrColor};">${acwr.toFixed(2)}</div>
      <div class="card-sub">7G Akut Yük: <strong class="mono">${Math.round(acute7)}</strong> · Haftalık Baz: <strong class="mono">${Math.round(chronicWeekly)}</strong> (${observedDays}G)</div>
      <div class="bar-track mt-16"><div class="bar-fill" style="width:${Math.min(100, Math.round((acwr / 1.8) * 100))}%; background:${acwrColor};"></div></div>
      <div class="card-sub" style="margin-top:6px;">Hedef bölge: <strong>0.80 – 1.30</strong></div>
    </div>
    <div class="card">
      <div class="kpi-label">Aerobik Verimlilik (Ef = Hız/Nabız)</div>
      <div class="kpi-value mono" style="color:var(--cyan);">${curEf != null ? curEf.toFixed(2) : "--"}</div>
      <div class="card-sub">${
        cardioActs[0]
          ? `Son: ${escapeHtml(cardioActs[0].activity_name)} (${cardioActs[0].avg_hr} atım/dk)`
          : "Kardiyo yürüyüş/koşu verisi bekleniyor"
      }</div>
      <div class="card-sub mono" style="margin-top:8px; color:${efDelta != null && efDelta >= 0 ? "#00e5a3" : "#f59e0b"};">
        ${efDelta != null ? `Önceki seansa göre: ${efDelta >= 0 ? "+" : ""}${efDelta.toFixed(3)} ${efDelta >= 0 ? "↑ Form artışı" : "↓"}` : "Kıyaslama için 2+ kardiyo seansı gerekli"}
      </div>
    </div>
    <div class="card">
      <div class="kpi-label">14 Günlük Antrenman Hacmi</div>
      <div class="kpi-value mono" style="color:var(--purple);">${count14} Seans</div>
      <div class="card-sub">Aktif Seans Kalorisi: <strong class="mono">${kcal14.toLocaleString("tr-TR")} kcal</strong></div>
      <div class="card-sub" style="margin-top:8px;">Toplam senkronize Garmin aktivitesi: <strong class="mono">${state.activities.length}</strong></div>
    </div>
  `;
}

const CUSTOM_METRIC_META = {
  hrv_nightly_avg: { label: "Kalp Dengesi · HRV (puan)", color: "#00e5a3", get: (d) => d.hrv_nightly_avg },
  readiness_score: { label: "Sabah Hazırlık Skoru", color: "#38bdf8", get: (d) => d.readiness_score },
  body_battery_max: { label: "Body Battery Maks", color: "#22d3ee", get: (d) => d.body_battery_max },
  sleep_score: { label: "Uyku Skoru", color: "#a78bfa", get: (d) => d.sleep_score },
  sleep_hours: { label: "Uyku Süresi (saat)", color: "#818cf8", get: (d) => (d.sleep_seconds != null ? Number((d.sleep_seconds / 3600).toFixed(2)) : null) },
  steps: { label: "Günlük Adım", color: "#0ea5e9", get: (d) => d.steps },
  active_kilocalories: { label: "Aktif Kalori (kcal)", color: "#f97316", get: (d) => d.active_kilocalories },
  rhr: { label: "Dinlenik Nabız (atım/dk)", color: "#f43f5e", get: (d) => d.rhr },
  sleep_stress_avg: { label: "Uyku Stresi", color: "#f59e0b", get: (d) => d.sleep_stress_avg },
  vo2_max: { label: "VO2 Max", color: "#10b981", get: (d) => d.vo2_max },
};

window.applyCustomPreset = function (x1, x2, btn) {
  const s1 = document.getElementById("custom-x1");
  const s2 = document.getElementById("custom-x2");
  if (s1) s1.value = x1;
  if (s2) s2.value = x2;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
  }
  renderCustomCompareChart();
};

window.renderCustomCompareChart = function () {
  const ctx = document.getElementById("customCompareChart");
  if (!ctx || !state.biometrics.length) return;
  const x1Key = document.getElementById("custom-x1")?.value || "hrv_nightly_avg";
  const x2Key = document.getElementById("custom-x2")?.value || "sleep_stress_avg";
  const chartType = document.getElementById("custom-chart-type")?.value || "line";
  const m1 = CUSTOM_METRIC_META[x1Key] || CUSTOM_METRIC_META.hrv_nightly_avg;
  const m2 = CUSTOM_METRIC_META[x2Key] || CUSTOM_METRIC_META.sleep_stress_avg;

  const last14 = [...state.biometrics].slice(0, 14).reverse();
  if (state.charts.customCompare) state.charts.customCompare.destroy();

  state.charts.customCompare = new Chart(ctx, {
    type: chartType,
    data: {
      labels: last14.map((d) => String(d.log_date).slice(5)),
      datasets: [
        {
          label: m1.label,
          data: last14.map((d) => m1.get(d)),
          borderColor: m1.color,
          backgroundColor: chartType === "bar" ? `${m1.color}99` : `${m1.color}22`,
          fill: chartType === "line",
          tension: 0.35,
          yAxisID: "y",
        },
        {
          label: m2.label,
          data: last14.map((d) => m2.get(d)),
          borderColor: m2.color,
          backgroundColor: chartType === "bar" ? `${m2.color}99` : `${m2.color}22`,
          fill: false,
          tension: 0.35,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#cbd5e1" } } },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } },
        y: { position: "left", ticks: { color: m1.color }, grid: { color: "rgba(148,163,184,0.08)" } },
        y1: { position: "right", ticks: { color: m2.color }, grid: { drawOnChartArea: false } },
      },
    },
  });
};

function formatBbEventLabel(ev) {
  const raw = String(ev?.label || "").trim();
  const upper = raw.toUpperCase();
  const evType = String(ev?.type || "").trim().toUpperCase();
  const isEmptyOrNone = !raw || upper === "NONE" || upper === "UNKNOWN" || upper === "NULL";

  if (upper === "STRESSFUL_PERIOD" || (isEmptyOrNone && evType === "STRESS")) return "Yüksek Stres Harcaması";
  if (upper === "RESTFUL_PERIOD" || (isEmptyOrNone && evType === "RECOVERY")) return "Dinlenme / Toparlanma";
  if (evType === "NAP" || upper === "NAP") return "Kısa Şekerleme Şarjı";
  if (evType === "SLEEP" || upper === "SLEEP") return "Gece Uykusu Şarjı";
  if (evType === "ACTIVITY") {
    return !isEmptyOrNone && upper !== "ACTIVITY" && upper !== "EXERCISE" ? raw : "Antrenman Harcaması";
  }
  if (isEmptyOrNone) {
    return Number(ev?.impact) >= 0 ? "Dinlenme Şarjı" : "Gün İçi Enerji Harcaması";
  }
  return raw.includes("_") ? raw.replace(/_/g, " ") : raw;
}

function getBbEventIcon(ev) {
  const evType = String(ev?.type || "").trim().toUpperCase();
  if (evType === "SLEEP") return "😴";
  if (evType === "NAP") return "💤";
  if (evType === "ACTIVITY") return "🏃";
  if (evType === "RECOVERY") return "🌿";
  return "⚡";
}

function formatBbDurationTr(mins) {
  const m = Number(mins);
  if (!Number.isFinite(m) || m <= 0) return "-- dk";
  if (m < 60) return `${Math.round(m)} dk`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem > 0 ? `${h} sa ${rem} dk` : `${h} sa`;
}

function renderDeepTelemetry(latest) {
  const te = latest?.raw_payload?.telemetry_extra;
  if (!te) {
    document.getElementById("bb-events-list").innerHTML = `<p class="card-sub">Derin Garmin telemetrisi için sağ üstten "↻ Senkronize Et" butonuna basın.</p>`;
    document.getElementById("deep-telemetry-cards").innerHTML = "";
    return;
  }

  // 1. Body Battery Current & Events
  const bbCur = te.bb_current ?? latest.body_battery_min ?? "--";
  const bbCurNum = Number(bbCur);
  const hasBbCur = bbCur !== "--" && Number.isFinite(bbCurNum);
  const bbStatusTr = hasBbCur ? (bbCurNum >= 50 ? "İyi seviye" : bbCurNum >= 25 ? "Orta seviye" : "Düşük — dinlen") : "--";
  const bbColor = hasBbCur ? (bbCurNum >= 50 ? "#00e5a3" : bbCurNum >= 25 ? "#f59e0b" : "#ef4444") : "var(--text)";

  const bbBadge = document.getElementById("bb-current-badge");
  bbBadge.textContent = `🔋 Kalan: ${bbCur}/100 · Uyku +${te.bb_during_sleep ?? "--"}`;
  bbBadge.className = `badge ${hasBbCur && bbCurNum >= 40 ? "badge-ok" : hasBbCur && bbCurNum >= 20 ? "badge-warn" : "badge-crit"}`;

  const bbSeries = Array.isArray(te.bb_series) ? te.bb_series : [];
  const bbCtx = document.getElementById("bbIntradayChart");
  if (bbCtx) {
    if (state.charts.bbIntraday) state.charts.bbIntraday.destroy();
    state.charts.bbIntraday = new Chart(bbCtx, {
      type: "line",
      data: {
        labels: bbSeries.map((p) => p.time),
        datasets: [{
          label: "Body Battery",
          data: bbSeries.map((p) => p.bb),
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56,189,248,0.16)",
          fill: true,
          tension: 0.35,
          pointRadius: 1.5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { min: 0, max: 100, ticks: { color: "#38bdf8" }, grid: { color: "rgba(148,163,184,0.08)" } },
        },
      },
    });
  }

  const events = Array.isArray(te.bb_events) ? te.bb_events : [];
  const charged = latest.body_battery_charged ?? te.bb_during_sleep ?? null;
  const drained = latest.body_battery_drained ?? (te.bb_at_wake != null && hasBbCur ? Math.max(0, Number(te.bb_at_wake) - bbCurNum) : null);

  const drainReasons = [];
  const negEvents = events.filter((ev) => Number(ev?.impact) < 0);
  const negLabelsLower = new Set();
  for (const ev of negEvents) {
    const lbl = formatBbEventLabel(ev);
    negLabelsLower.add(lbl.toLowerCase());
    drainReasons.push(`${lbl} (${ev.impact} puan)`);
  }

  const todayDate = String(latest.log_date || "").slice(0, 10);
  const todayActs = (state.activities || []).filter((a) => String(a.start_time_local || "").slice(0, 10) === todayDate);
  for (const act of todayActs) {
    const actName = String(act.activity_name || "").trim();
    if (actName && !negLabelsLower.has(actName.toLowerCase())) {
      drainReasons.push(actName);
    }
  }

  const bbSb = te.stress_breakdown || {};
  const medHighStressPct = Math.round((bbSb.high_pct || 0) + (bbSb.med_pct || 0));
  const activityPct = Math.round(bbSb.activity_pct || 0);
  if (medHighStressPct > 0) drainReasons.push(`gün içi stres (%${medHighStressPct} orta/yüksek)`);
  if (activityPct > 0) drainReasons.push(`fiziksel hareket (%${activityPct})`);

  const bbMet = te.metabolism || {};
  const activeMinTotal = Math.round((bbMet.active_min || 0) + (bbMet.highly_active_min || 0));
  if (activeMinTotal > 0) drainReasons.push(`${activeMinTotal} dk aktif hareket`);
  if (Number(latest.steps) > 0) drainReasons.push(`${Number(latest.steps).toLocaleString("tr-TR")} adım`);

  const drainSummaryText = drainReasons.length
    ? `Harcama kaynakları: ${drainReasons.slice(0, 3).join(" · ")}`
    : "Gün içi bazal metabolizma ve rutin hareketlere harcandı.";

  const bbSummaryHtml = `
    <div style="display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px;">
      <div class="mini-box">
        <div class="mini-box-lbl">Kalan Pil</div>
        <div class="mini-box-val mono" style="color:${bbColor};">${bbCur}/100</div>
        <div class="card-sub">${escapeHtml(bbStatusTr)}</div>
      </div>
      <div class="mini-box">
        <div class="mini-box-lbl">Toplam Şarj</div>
        <div class="mini-box-val mono" style="color:var(--emerald);">${charged != null ? `+${charged}` : "--"} puan</div>
        <div class="card-sub">${te.bb_at_wake != null ? `Uyanışta ${te.bb_at_wake} puan` : "Uyku ve dinlenme"}</div>
      </div>
      <div class="mini-box">
        <div class="mini-box-lbl">Harcanan</div>
        <div class="mini-box-val mono" style="color:var(--orange);">${drained != null ? `-${drained}` : "--"} puan</div>
        <div class="card-sub">${latest.body_battery_max != null ? `Maks ${latest.body_battery_max} → Anlık ${bbCur}` : "Gün içi enerji kaybı"}</div>
      </div>
    </div>
    <div class="event-row" style="justify-content:flex-start; background:rgba(56,189,248,0.06); border-color:rgba(56,189,248,0.2);">
      <div><strong style="color:var(--text);">⚡ Neye Harcandı?</strong> <span class="card-sub" style="color:var(--text-secondary);">${escapeHtml(drainSummaryText)}</span></div>
    </div>
  `;

  const bbEventsHtml = events.length
    ? events
        .map((ev) => {
          const pos = Number(ev.impact) >= 0;
          const icon = getBbEventIcon(ev);
          const labelTr = formatBbEventLabel(ev);
          const durTr = formatBbDurationTr(ev.duration_min);
          return `
          <div class="event-row">
            <div>${icon} <strong>${escapeHtml(labelTr)}</strong> <span class="card-sub mono">(${escapeHtml(ev.start_tr || "--:--")} · ${escapeHtml(durTr)})</span></div>
            <span class="badge ${pos ? "badge-ok" : "badge-warn"} mono">${pos ? "+" : ""}${ev.impact} puan</span>
          </div>`;
        })
        .join("")
    : `<p class="card-sub">Bugün için Body Battery olay kaydı yok.</p>`;

  document.getElementById("bb-events-list").innerHTML = bbSummaryHtml + bbEventsHtml;

  // 2. Night 5-Min HRV Wave & Stress Breakdown
  const baseHrv = te.hrv_baseline;
  document.getElementById("hrv-peak-badge").textContent =
    `5-Dk Tepe: ${te.hrv_5min_high ?? "--"} puan${baseHrv ? ` · Normal ${baseHrv.balancedLow}–${baseHrv.balancedUpper}` : ""}`;

  const hrvReadings = Array.isArray(te.hrv_readings) ? te.hrv_readings : [];
  const hrvNCtx = document.getElementById("hrvNightChart");
  if (hrvNCtx) {
    if (state.charts.hrvNight) state.charts.hrvNight.destroy();
    state.charts.hrvNight = new Chart(hrvNCtx, {
      type: "line",
      data: {
        labels: hrvReadings.map((r) => r.time),
        datasets: [{
          label: "5-Dk Kalp Dengesi (puan)",
          data: hrvReadings.map((r) => r.val),
          borderColor: "#00e5a3",
          backgroundColor: "rgba(0,229,163,0.14)",
          fill: true,
          tension: 0.35,
          pointRadius: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { ticks: { color: "#00e5a3" }, grid: { color: "rgba(148,163,184,0.08)" } },
        },
      },
    });
  }

  const sbData = te.stress_breakdown || {};
  document.getElementById("stress-max-label").textContent = `Maks Stres: ${sbData.max_stress ?? "--"} (${sbData.qualifier || "BALANCED"})`;
  const rPct = sbData.rest_pct || 0;
  const lPct = sbData.low_pct || 0;
  const mPct = sbData.med_pct || 0;
  const hPct = sbData.high_pct || 0;
  const aPct = sbData.activity_pct || 0;
  document.getElementById("stress-breakdown-bar").innerHTML = `
    <div style="width:${rPct}%; background:#38bdf8;" title="Dinlenme"></div>
    <div style="width:${lPct}%; background:#00e5a3;" title="Düşük Stres"></div>
    <div style="width:${mPct}%; background:#f59e0b;" title="Orta Stres"></div>
    <div style="width:${hPct}%; background:#ef4444;" title="Yüksek Stres"></div>
    <div style="width:${aPct}%; background:#a78bfa;" title="Aktivite"></div>
  `;
  document.getElementById("stress-breakdown-legend").innerHTML = `
    <span>🔵 Dinlenme %${Math.round(rPct)}</span>
    <span>🟢 Düşük %${Math.round(lPct)}</span>
    <span>🟠 Orta %${Math.round(mPct)}</span>
    <span>🔴 Yüksek %${Math.round(hPct)}</span>
    <span>🟣 Aktivite %${Math.round(aPct)}</span>
  `;

  // 3. Intraday 2-min HR Chart
  document.getElementById("intraday-rhr-badge").textContent = `7G Ort Nabız: ${te.rhr_7d_avg ?? "--"} atım/dk`;
  const hrPts = Array.isArray(te.intraday_hr) ? te.intraday_hr : [];
  const hrCtx = document.getElementById("intradayHrChart");
  if (hrCtx) {
    if (state.charts.intradayHr) state.charts.intradayHr.destroy();
    state.charts.intradayHr = new Chart(hrCtx, {
      type: "line",
      data: {
        labels: hrPts.map((p) => p.time),
        datasets: [{
          label: "Nabız (atım/dk)",
          data: hrPts.map((p) => p.hr),
          borderColor: "#f43f5e",
          backgroundColor: "rgba(244,63,94,0.12)",
          fill: true,
          tension: 0.3,
          pointRadius: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 9 }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { ticks: { color: "#f43f5e" }, grid: { color: "rgba(148,163,184,0.08)" } },
        },
      },
    });
  }

  // 4. Metabolism, Floors, Fitness Age Target, Respiration & Sleep Insight
  const met = te.metabolism || {};
  const fl = te.floors || {};
  const fa = te.fitness_age_detail || {};
  const wr = te.waking_respiration || {};
  const si = te.sleep_insights || {};
  document.getElementById("deep-telemetry-cards").innerHTML = `
    <div class="mini-box">
      <div class="mini-box-lbl">Toplam Metabolizma</div>
      <div class="mini-box-val mono" style="color:var(--emerald);">${met.total_kcal ?? "--"} kcal</div>
      <div class="card-sub">BMR ${met.bmr_kcal ?? "--"} + Aktif ${met.active_kcal ?? "--"} · Aktif ${met.active_min ?? 0} dk / Sedanter ${Math.round((met.sedentary_min || 0) / 60)} sa</div>
    </div>
    <div class="mini-box">
      <div class="mini-box-lbl">Çıkılan Kat & Rakım</div>
      <div class="mini-box-val mono" style="color:var(--cyan);">${fl.ascended ?? "--"} / ${fl.goal ?? 10} Kat</div>
      <div class="card-sub">Tırmanış +${fl.meters_up ?? "--"} m · Ortam Rakımı ${fl.altitude_m ?? "--"} m</div>
    </div>
    <div class="mini-box">
      <div class="mini-box-lbl">Fitness Yaşı Potansiyeli</div>
      <div class="mini-box-val mono" style="color:var(--purple);">${fa.current_age ?? "--"} → ${fa.achievable_age ?? "--"} Yaş</div>
      <div class="card-sub">Kronolojik ${fa.chronological_age ?? 38} · Yoğun Gün ${fa.vigorous_days ?? "--"} / ${fa.vigorous_target ?? 3}</div>
    </div>
    <div class="mini-box">
      <div class="mini-box-lbl">Gündüz Solunum & Uyku İçgörüsü</div>
      <div class="mini-box-val mono">${wr.avg ?? "--"} nefes/dk (${wr.min ?? "--"}–${wr.max ?? "--"})</div>
      <div class="card-sub">${escapeHtml((si.feedback || "BALANCED").replace(/_/g, " "))}</div>
    </div>
  `;
}

window.switchTrendMode = function (mode, btn) {
  state.trendMode = mode;
  btn.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  renderTrendChart();
};

function renderTrendChart() {
  const last14 = [...state.biometrics].slice(0, 14).reverse();
  const ctx = document.getElementById("hrvRhrChart");
  if (!ctx) return;
  if (state.charts.trend) state.charts.trend.destroy();

  let datasets = [];
  if (state.trendMode === "hrv") {
    datasets = [
      {
        label: "Kalp Dengesi · HRV (puan)",
        data: last14.map((d) => d.hrv_nightly_avg),
        borderColor: "#00e5a3",
        backgroundColor: "rgba(0,229,163,0.14)",
        tension: 0.35,
        fill: true,
        yAxisID: "y",
      },
      {
        label: "Dinlenik Nabız (atım/dk)",
        data: last14.map((d) => d.rhr),
        borderColor: "#38bdf8",
        tension: 0.35,
        yAxisID: "y1",
      },
    ];
  } else if (state.trendMode === "readiness") {
    datasets = [
      {
        label: "Sabah Hazırlık",
        data: last14.map((d) => d.readiness_score),
        borderColor: "#00e5a3",
        backgroundColor: "rgba(0,229,163,0.14)",
        tension: 0.35,
        fill: true,
        yAxisID: "y",
      },
      {
        label: "Uyku Skoru",
        data: last14.map((d) => d.sleep_score),
        borderColor: "#a78bfa",
        tension: 0.35,
        yAxisID: "y",
      },
    ];
  } else {
    datasets = [
      {
        label: "Günlük Adım",
        data: last14.map((d) => d.steps),
        borderColor: "#38bdf8",
        backgroundColor: "rgba(56,189,248,0.14)",
        tension: 0.35,
        fill: true,
        yAxisID: "y",
      },
      {
        label: "Uyku Stresi",
        data: last14.map((d) => d.sleep_stress_avg),
        borderColor: "#f59e0b",
        tension: 0.35,
        yAxisID: "y1",
      },
    ];
  }

  state.charts.trend = new Chart(ctx, {
    type: "line",
    data: { labels: last14.map((d) => d.log_date.slice(5)), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#cbd5e1" } } },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } },
        y: { position: "left", ticks: { color: "#00e5a3" }, grid: { color: "rgba(148,163,184,0.08)" } },
        y1: {
          display: state.trendMode !== "readiness",
          position: "right",
          ticks: { color: "#38bdf8" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

function renderDualAnatomySvg(heatmap) {
  const hm = heatmap || {};
  const col = (v) => (!v ? "#1e293b" : v >= 85 ? "#ef4444" : v >= 60 ? "#f59e0b" : "#00e5a3");
  const clickAttr = (name) => `onclick="selectMuscle('${name}', ${hm[name] || 0})"`;
  return `
  <div class="anatomy-svgs">
    <svg width="135" height="215" viewBox="0 0 140 220" aria-label="Ön Anatomi">
      <text x="70" y="13" text-anchor="middle" fill="#64748b" font-size="10" font-weight="700">ÖN (ANTERİOR)</text>
      <circle cx="70" cy="30" r="12" fill="#334155"/>
      <ellipse class="muscle-part" ${clickAttr("Omuz")} cx="38" cy="58" rx="13" ry="10" fill="${col(hm["Omuz"])}"/>
      <ellipse class="muscle-part" ${clickAttr("Omuz")} cx="102" cy="58" rx="13" ry="10" fill="${col(hm["Omuz"])}"/>
      <rect class="muscle-part" ${clickAttr("Göğüs")} x="49" y="50" width="20" height="24" rx="6" fill="${col(hm["Göğüs"])}"/>
      <rect class="muscle-part" ${clickAttr("Göğüs")} x="71" y="50" width="20" height="24" rx="6" fill="${col(hm["Göğüs"])}"/>
      <rect class="muscle-part" ${clickAttr("Ön Kol")} x="22" y="71" width="13" height="44" rx="6" fill="${col(hm["Ön Kol"])}"/>
      <rect class="muscle-part" ${clickAttr("Ön Kol")} x="105" y="71" width="13" height="44" rx="6" fill="${col(hm["Ön Kol"])}"/>
      <rect class="muscle-part" ${clickAttr("Core")} x="51" y="78" width="38" height="40" rx="8" fill="${col(hm["Core"])}"/>
      <rect class="muscle-part" ${clickAttr("Bacak")} x="48" y="123" width="19" height="82" rx="8" fill="${col(hm["Bacak"])}"/>
      <rect class="muscle-part" ${clickAttr("Bacak")} x="73" y="123" width="19" height="82" rx="8" fill="${col(hm["Bacak"])}"/>
    </svg>
    <svg width="135" height="215" viewBox="0 0 140 220" aria-label="Arka Anatomi">
      <text x="70" y="13" text-anchor="middle" fill="#64748b" font-size="10" font-weight="700">ARKA (POSTERİOR)</text>
      <circle cx="70" cy="30" r="12" fill="#334155"/>
      <ellipse class="muscle-part" ${clickAttr("Omuz")} cx="38" cy="58" rx="13" ry="10" fill="${col(hm["Omuz"])}"/>
      <ellipse class="muscle-part" ${clickAttr("Omuz")} cx="102" cy="58" rx="13" ry="10" fill="${col(hm["Omuz"])}"/>
      <polygon class="muscle-part" ${clickAttr("Sırt")} points="48,50 92,50 84,92 56,92" fill="${col(hm["Sırt"])}"/>
      <rect class="muscle-part" ${clickAttr("Ön Kol")} x="22" y="71" width="13" height="44" rx="6" fill="${col(hm["Ön Kol"])}"/>
      <rect class="muscle-part" ${clickAttr("Ön Kol")} x="105" y="71" width="13" height="44" rx="6" fill="${col(hm["Ön Kol"])}"/>
      <rect class="muscle-part" ${clickAttr("Core")} x="54" y="95" width="32" height="24" rx="6" fill="${col(hm["Core"])}"/>
      <rect class="muscle-part" ${clickAttr("Bacak")} x="48" y="123" width="19" height="82" rx="8" fill="${col(hm["Bacak"])}"/>
      <rect class="muscle-part" ${clickAttr("Bacak")} x="73" y="123" width="19" height="82" rx="8" fill="${col(hm["Bacak"])}"/>
    </svg>
  </div>`;
}

window.selectMuscle = function (name, val) {
  document.getElementById("selected-muscle-badge").textContent = `${name}: %${val} Yük`;
};

window.filterActivities = function (mode, btn) {
  state.activityFilter = mode;
  btn.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  renderWorkouts();
};

function renderWorkouts() {
  const listEl = document.getElementById("activity-list");
  const filtered = state.activities.filter((a) => {
    if (state.activityFilter === "CARDIO") return a.activity_type !== "strength_training";
    if (state.activityFilter === "STRENGTH") return a.activity_type === "strength_training";
    return true;
  });

  if (!filtered.length) {
    listEl.innerHTML = `<p class="card-sub">Bu filtrede antrenman kaydı yok.</p>`;
    document.getElementById("selected-act-title").textContent = "Henüz antrenman kaydı yok";
    document.getElementById("selected-act-sub").textContent = "Garmin saatinizden senkronize edildiğinde veya '+ Antrenman Kaydet' ile eklendiğinde burada görünür.";
    document.getElementById("selected-act-kpis").innerHTML = "";
    document.getElementById("selected-act-ai").innerHTML = "";
    return;
  }

  if (!filtered.some((a) => a.activity_id === state.selectedActivityId)) {
    state.selectedActivityId = filtered[0].activity_id;
  }

  const fallbackCity = state.settings?.default_city || state.settings?.active_city || "--";
  listEl.innerHTML = filtered
    .map((a) => {
      const selected = a.activity_id === state.selectedActivityId;
      const km = a.distance_meters && Number(a.distance_meters) > 0 ? `${(Number(a.distance_meters) / 1000).toFixed(2)} km` : "Kuvvet";
      const icon = a.activity_type === "strength_training" ? "🏋️" : a.activity_type === "running" ? "🏃" : "🚶";
      return `
      <div class="activity-item ${selected ? "selected" : ""}" onclick="selectActivity(${a.activity_id})">
        <div>
          <div style="font-weight:700; font-size:13.5px;">${icon} ${escapeHtml(a.activity_name)}</div>
          <div class="card-sub">${escapeHtml(fmtIstanbulDateTime(a.start_time_local))} · ${escapeHtml(a.location_name || fallbackCity)}</div>
        </div>
        <div style="text-align:right;">
          <div class="mono" style="font-weight:700; color:var(--emerald);">${escapeHtml(km)}</div>
          <div class="card-sub">${fmtDuration(a.duration_seconds)} · ${a.avg_hr ?? "--"} atım/dk</div>
        </div>
      </div>`;
    })
    .join("");

  const act = state.activities.find((a) => a.activity_id === state.selectedActivityId) || filtered[0];
  if (!act) return;

  document.getElementById("selected-act-title").textContent = act.activity_name;
  document.getElementById("selected-act-sub").textContent =
    `${fmtIstanbulDateTime(act.start_time_local)} · Dayanıklılık Etkisi ${act.aerobic_te ?? "-"} / Güç ${act.anaerobic_te ?? "-"}`;

  const distKm = act.distance_meters && Number(act.distance_meters) > 0 ? `${(Number(act.distance_meters) / 1000).toFixed(2)} km` : "Evde Kuvvet";
  document.getElementById("selected-act-kpis").innerHTML = `
    <div class="mini-box"><div class="mini-box-lbl">Süre</div><div class="mini-box-val mono">${fmtDuration(act.duration_seconds)}</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Mesafe / Mod</div><div class="mini-box-val mono">${escapeHtml(distKm)}</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Ort / Maks Nabız</div><div class="mini-box-val mono">${act.avg_hr ?? "--"} / ${act.max_hr ?? "--"}</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Kalori / Yük</div><div class="mini-box-val mono">${act.calories ?? "--"} · ${act.training_load ?? "--"}</div></div>
  `;

  const ai = act.ai_post_workout_analysis || {};
  const cmp = act.session_comparison || {};
  const waterInfo = cmp.water_ml ? `💧 Önerilen Su: ~${Math.max(200, Math.round(Number(cmp.water_ml) / 50) * 50)} ml (~${Math.max(1, Math.round(Number(cmp.water_ml) / 250))} bardak)` : "";
  const bbInfo = cmp.bb_impact != null ? ` · 🔋 Enerji Etkisi: ${cmp.bb_impact}` : "";
  document.getElementById("selected-act-ai").innerHTML = `
    <div class="coach-block"><h4>Seans Değerlendirmesi</h4><p>${escapeHtml(ai.summary || "--")} ${escapeHtml(waterInfo + bbInfo)}</p></div>
    <div class="coach-block" style="border-left-color:var(--cyan);"><h4>Geçmiş Seans Kıyaslaması &amp; Öne Çıkan</h4><p>${escapeHtml(cmp.verdict || ai.highlight || "--")}</p></div>
    ${ai.recovery_plan ? `<div class="coach-block" style="border-left-color:var(--emerald);"><h4>Toparlanma Planı</h4><p>${escapeHtml(ai.recovery_plan)}</p></div>` : ""}
    <div class="coach-block" style="border-left-color:var(--purple);"><h4>Sonraki Adım</h4><p>${escapeHtml(ai.next_step || "--")}</p></div>
  `;

  // Dual Anatomy Muscle Heatmap
  const hm = act.muscle_heatmap || {};
  const entries = Object.entries(hm);
  document.getElementById("muscle-heatmap-box").innerHTML = `
    ${renderDualAnatomySvg(hm)}
    <div class="formula-bars">
      ${
        entries.length
          ? entries
              .map(
                ([m, val]) => `
            <div>
              <div class="bar-row-head"><span>${escapeHtml(m)}</span><strong class="mono">%${val}</strong></div>
              <div class="bar-track"><div class="bar-fill" style="width:${val}%; background:${val >= 85 ? "#ef4444" : val >= 60 ? "#f59e0b" : "#00e5a3"}"></div></div>
            </div>`
              )
              .join("")
          : `<p class="card-sub">Bu seans için kas haritası verisi yok.</p>`
      }
    </div>
  `;

  // HR Zones
  const zones = Array.isArray(act.hr_zones) ? act.hr_zones : [];
  document.getElementById("hr-zones-bars").innerHTML = zones
    .map(
      (z) => `
      <div style="margin-bottom:8px;">
        <div class="bar-row-head"><span>${escapeHtml(z.zone)} · ${escapeHtml(z.label)}</span><strong class="mono">%${z.pct} (${Math.round((z.seconds || 0) / 60)} dk)</strong></div>
        <div class="bar-track"><div class="bar-fill" style="width:${z.pct}%; background:${z.zone === "Z2" ? "#00e5a3" : z.zone === "Z3" ? "#f59e0b" : z.zone === "Z4" ? "#ef4444" : "#38bdf8"}"></div></div>
      </div>`
    )
    .join("");

  renderRehydrationCard(act);

  // Connect+ 5: HR-Zone Color-Gradient GPS Map + Dark / Topo 3D Layer
  const route = act.time_series?.route;
  const ts = act.time_series || {};
  const hrSeries = Array.isArray(ts.hr) ? ts.hr : [];
  if (!state.map && document.getElementById("activity-map")) {
    state.map = L.map("activity-map").setView([act.start_lat || 41.0256, act.start_lon || 29.0963], 14);
    applyMapTileLayer();
  }
  if (state.map) {
    if (state.routeLayer) state.map.removeLayer(state.routeLayer);
    if (Array.isArray(route) && route.length > 1) {
      const fg = L.featureGroup();
      const totalPts = route.length;
      const colorForHr = (hr) => {
        const v = Number(hr ?? act.avg_hr ?? 120);
        if (v >= 152) return "#ef4444";
        if (v >= 135) return "#f59e0b";
        if (v >= 115) return "#00e5a3";
        return "#38bdf8";
      };
      const hrAtPointIdx = (ptIdx) => {
        if (!hrSeries.length) return act.avg_hr ?? 120;
        const hIdx = Math.min(hrSeries.length - 1, Math.floor((ptIdx / Math.max(1, totalPts - 1)) * hrSeries.length));
        return hrSeries[hIdx];
      };

      let curColor = colorForHr(hrAtPointIdx(0));
      let segCoords = [route[0], route[1]];
      for (let i = 1; i < totalPts - 1; i++) {
        const nextColor = colorForHr(hrAtPointIdx(i));
        if (nextColor === curColor) {
          segCoords.push(route[i + 1]);
        } else {
          L.polyline(segCoords, { color: curColor, weight: 5, opacity: 0.92 }).addTo(fg);
          curColor = nextColor;
          segCoords = [route[i], route[i + 1]];
        }
      }
      if (segCoords.length > 1) {
        L.polyline(segCoords, { color: curColor, weight: 5, opacity: 0.92 }).addTo(fg);
      }

      L.circleMarker(route[0], { radius: 7, color: "#00e5a3", fillColor: "#00e5a3", fillOpacity: 1 })
        .bindTooltip("🟢 Başlangıç")
        .addTo(fg);
      L.circleMarker(route[totalPts - 1], { radius: 7, color: "#0f172a", fillColor: "#f8fafc", fillOpacity: 1 })
        .bindTooltip("🏁 Bitiş")
        .addTo(fg);

      if (hrSeries.length) {
        let peakVal = -1;
        let peakIdx = 0;
        hrSeries.forEach((v, idx) => {
          if (Number(v) > peakVal) { peakVal = Number(v); peakIdx = idx; }
        });
        if (peakVal > 0) {
          const rIdx = Math.min(totalPts - 1, Math.round((peakIdx / Math.max(1, hrSeries.length - 1)) * (totalPts - 1)));
          L.circleMarker(route[rIdx], { radius: 7, color: "#fff", weight: 2, fillColor: "#ef4444", fillOpacity: 1 })
            .bindTooltip(`🔥 Tepe Nabız: ${peakVal} atım/dk`)
            .addTo(fg);
        }
      }

      state.routeLayer = fg.addTo(state.map);
      state.map.fitBounds(fg.getBounds(), { padding: [24, 24] });
    } else {
      const lat = act.start_lat || 41.0256;
      const lon = act.start_lon || 29.0963;
      state.routeLayer = L.circleMarker([lat, lon], { radius: 9, color: "#38bdf8", fillColor: "#00e5a3", fillOpacity: 0.7 })
        .bindTooltip("🏋️ İç Mekan Aktivitesi (GPS Rotası Yok)")
        .addTo(state.map);
      state.map.setView([lat, lon], 14);
    }
  }

  // Time Series Chart (HR & Cadence)
  const sCtx = document.getElementById("activitySeriesChart");
  if (state.charts.activitySeries) state.charts.activitySeries.destroy();
  const datasets = [];
  if (Array.isArray(ts.hr) && ts.hr.length) datasets.push({ label: "Nabız (atım/dk)", data: ts.hr, borderColor: "#ef4444", tension: 0.35 });
  if (Array.isArray(ts.cadence) && ts.cadence.length) datasets.push({ label: "Kadans (spm)", data: ts.cadence, borderColor: "#38bdf8", tension: 0.35 });

  state.charts.activitySeries = new Chart(sCtx, {
    type: "line",
    data: { labels: ts.labels || [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#cbd5e1" } } },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } },
      },
    },
  });

  // Elevation & HR Cross-Section Chart
  const elevArr = Array.isArray(ts.elevation_m) ? ts.elevation_m : [];
  const elevCard = document.getElementById("elev-profile-card");
  const elevBadge = document.getElementById("elev-gain-badge");
  const eCtx = document.getElementById("activityElevChart");
  if (elevCard && eCtx) {
    if (elevArr.length > 1) {
      elevCard.style.display = "block";
      let gain = act.elevation_gain != null ? Number(act.elevation_gain) : 0;
      if (!gain) {
        for (let i = 1; i < elevArr.length; i++) {
          const d = Number(elevArr[i]) - Number(elevArr[i - 1]);
          if (d > 0) gain += d;
        }
      }
      if (elevBadge) elevBadge.textContent = `+${Math.round(gain)} m Tırmanış`;
      if (state.charts.activityElev) state.charts.activityElev.destroy();
      const elevDatasets = [
        {
          label: "Rakım (m)",
          data: elevArr,
          borderColor: "#a78bfa",
          backgroundColor: "rgba(167,139,250,0.2)",
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          yAxisID: "y",
        },
      ];
      if (hrSeries.length) {
        elevDatasets.push({
          label: "Nabız (atım/dk)",
          data: hrSeries,
          borderColor: "#f43f5e",
          borderDash: [4, 3],
          tension: 0.35,
          pointRadius: 0,
          yAxisID: "y1",
        });
      }
      state.charts.activityElev = new Chart(eCtx, {
        type: "line",
        data: { labels: ts.labels || elevArr.map((_, i) => `#${i + 1}`), datasets: elevDatasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: "#cbd5e1" } } },
          scales: {
            x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
            y: { position: "left", ticks: { color: "#a78bfa" }, grid: { color: "rgba(148,163,184,0.08)" } },
            y1: { position: "right", display: hrSeries.length > 0, ticks: { color: "#f43f5e" }, grid: { drawOnChartArea: false } },
          },
        },
      });
      renderCardiacDriftAndClimb(act, hrSeries, elevArr, gain);
    } else {
      elevCard.style.display = "none";
      const driftBox = document.getElementById("cardiac-drift-strip");
      if (driftBox) driftBox.innerHTML = "";
    }
  }

  // Exercise Sets Table
  const sets = Array.isArray(act.exercise_sets) ? act.exercise_sets : [];
  const setsCard = document.getElementById("strength-sets-card");
  if (sets.length > 0) {
    setsCard.style.display = "block";
    document.getElementById("strength-sets-table").innerHTML = `
      <table>
        <thead><tr><th>Egzersiz</th><th>Kas</th><th>Set x Tekrar</th><th>Ağırlık</th><th>Hacim</th></tr></thead>
        <tbody>
          ${sets
            .map((s) => {
              const sc = Math.max(1, Number(s.sets || 1));
              const rawR = Number(s.reps || 15);
              const perSet = sc > 1 && rawR >= sc * 4 ? Math.round(rawR / sc) : rawR;
              const totR = s.total_reps || (rawR >= sc * 4 ? rawR : sc * perSet);
              return `<tr>
                <td><strong>${escapeHtml(s.exercise)}</strong></td>
                <td><span class="badge badge-info">${escapeHtml(s.muscle)}</span></td>
                <td class="mono">${sc} x ${perSet} <span class="card-sub">(${totR} top.)</span></td>
                <td class="mono">${s.weight_kg} kg</td>
                <td class="mono" style="color:var(--emerald);">${s.volume_kg} kg</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
  } else {
    setsCard.style.display = "none";
  }

  renderKochlerRotationAndPRs();
}

function renderCardiacDriftAndClimb(act, hrSeries, elevArr, gainM) {
  const box = document.getElementById("cardiac-drift-strip");
  if (!box) return;
  const hrNums = hrSeries.filter((v) => typeof v === "number" && v > 40);
  if (hrNums.length < 8) {
    box.innerHTML = "";
    return;
  }

  const mid = Math.floor(hrNums.length / 2);
  const avg1 = hrNums.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const avg2 = hrNums.slice(mid).reduce((s, v) => s + v, 0) / (hrNums.length - mid);
  const driftPct = ((avg2 - avg1) / Math.max(1, avg1)) * 100;
  const driftGood = Math.abs(driftPct) <= 5.5;

  const climbHrs = [];
  const flatHrs = [];
  const minLen = Math.min(hrSeries.length, elevArr.length);
  for (let i = 1; i < minLen; i++) {
    const h = hrSeries[i];
    const de = Number(elevArr[i]) - Number(elevArr[i - 1]);
    if (typeof h === "number" && h > 40) {
      if (de >= 0.6) climbHrs.push(h);
      else flatHrs.push(h);
    }
  }
  const avgClimb = climbHrs.length ? climbHrs.reduce((s, v) => s + v, 0) / climbHrs.length : null;
  const avgFlat = flatHrs.length ? flatHrs.reduce((s, v) => s + v, 0) / flatHrs.length : null;
  const climbDelta = avgClimb != null && avgFlat != null ? avgClimb - avgFlat : null;
  const distKm = Math.max(0.1, Number(act.distance_meters || 0) / 1000);
  const paceMinKm = Number(act.duration_seconds || 0) / 60 / distKm;

  box.innerHTML = `
    <div class="mini-box">
      <div class="mini-box-lbl">Kardiyak Sürüklenme</div>
      <div class="mini-box-val mono" style="color:${driftGood ? "#00e5a3" : "#f59e0b"};">${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(1)}%</div>
      <div class="card-sub">İlk ${Math.round(avg1)} → Son ${Math.round(avg2)} atım/dk (${driftGood ? "Dayanıklılık İyi" : "Yorgunluk/Isı"})</div>
    </div>
    <div class="mini-box">
      <div class="mini-box-lbl">Yokuş Nabız Maliyeti</div>
      <div class="mini-box-val mono" style="color:var(--cyan);">${climbDelta != null ? `${climbDelta >= 0 ? "+" : ""}${Math.round(climbDelta)} atım/dk` : "--"}</div>
      <div class="card-sub">Yokuş ${avgClimb ? Math.round(avgClimb) : "--"} · Düz ${avgFlat ? Math.round(avgFlat) : "--"} atım/dk</div>
    </div>
    <div class="mini-box">
      <div class="mini-box-lbl">Tempo & Tırmanış</div>
      <div class="mini-box-val mono" style="color:var(--purple);">${paceMinKm.toFixed(1)} dk/km</div>
      <div class="card-sub">+${Math.round(gainM || 0)} m toplam tırmanış</div>
    </div>
  `;
}

const KOCHLER_ROTATIONS = [
  {
    id: "chest_arms",
    title: "Kochler - Göğüs & Ön Kol",
    muscles: ["Göğüs", "Ön Kol"],
    defaultEx: "Dumbbell Flye|Göğüs",
    weight: 10,
    sets: 4,
    reps: 15,
    note: "Dumbbell Flye 4x15 + Hammer Curl 4x15 (10 kg)",
  },
  {
    id: "shoulders_back",
    title: "Kochler - Omuz & Sırt",
    muscles: ["Omuz", "Sırt"],
    defaultEx: "Overhead Press|Omuz",
    weight: 10,
    sets: 4,
    reps: 15,
    note: "Lat Pulldown 4x15 + Overhead Press 4x15 (10 kg)",
  },
  {
    id: "core_legs",
    title: "Ab Roller & Squat",
    muscles: ["Core", "Bacak"],
    defaultEx: "Kneeling Ab Wheel|Core",
    weight: 10,
    sets: 4,
    reps: 15,
    note: "Kneeling Ab Wheel 4x15 + Squat 4x20",
  },
];

function renderKochlerRotationAndPRs() {
  const panel = document.getElementById("kochler-rotation-panel");
  const nextBadge = document.getElementById("kochler-next-badge");
  const prBox = document.getElementById("pr-overload-table");
  if (!panel || !prBox) return;

  const nowMs = Date.now();
  const muscleLastMs = {};
  const muscles6 = ["Göğüs", "Ön Kol", "Omuz", "Sırt", "Core", "Bacak"];

  for (const a of state.activities) {
    const tMs = new Date(a.start_time_local).getTime();
    if (!Number.isFinite(tMs)) continue;
    const hm = a.muscle_heatmap || {};
    for (const m of muscles6) {
      const score = Number(hm[m] || 0);
      const isStr = a.activity_type === "strength_training";
      if ((isStr && score >= 60) || (!isStr && m === "Bacak" && score >= 75)) {
        if (!muscleLastMs[m] || tMs > muscleLastMs[m]) muscleLastMs[m] = tMs;
      }
    }
  }

  const recoveryMap = {};
  for (const m of muscles6) {
    if (!muscleLastMs[m]) {
      recoveryMap[m] = { pct: 100, hrs: null };
    } else {
      const hrs = Math.max(0, (nowMs - muscleLastMs[m]) / 3600000);
      recoveryMap[m] = { pct: Math.min(100, Math.round((hrs / 48) * 100)), hrs: Math.round(hrs) };
    }
  }

  let bestRot = KOCHLER_ROTATIONS[0];
  let bestScore = -1;
  const rotData = KOCHLER_ROTATIONS.map((r) => {
    const avgRec = Math.round(r.muscles.reduce((s, m) => s + (recoveryMap[m]?.pct ?? 100), 0) / r.muscles.length);
    const minRec = Math.min(...r.muscles.map((m) => recoveryMap[m]?.pct ?? 100));
    if (avgRec > bestScore) { bestScore = avgRec; bestRot = r; }
    return { ...r, avgRec, minRec };
  });

  if (nextBadge) {
    nextBadge.textContent = `Sıradaki: ${bestRot.title} (%${bestScore})`;
    nextBadge.className = `badge ${bestScore >= 85 ? "badge-ok" : "badge-warn"}`;
  }

  panel.innerHTML = `
    <div class="rotation-grid">
      ${rotData
        .map(
          (r) => `
        <div class="mini-box" style="border-color:${r.id === bestRot.id ? "rgba(0,229,163,0.45)" : "var(--border)"};">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
            <strong style="font-size:12px;">${escapeHtml(r.title)}</strong>
            <span class="badge ${r.minRec >= 85 ? "badge-ok" : "badge-warn"} mono">%${r.avgRec}</span>
          </div>
          <div class="card-sub" style="margin:4px 0 8px;">${escapeHtml(r.note)}</div>
          <div class="badge ${r.id === bestRot.id ? "badge-ok" : "badge-info"}" style="width:100%; text-align:center;">${r.id === bestRot.id ? "✓ Sıradaki Önerilen" : "Toparlanıyor"}</div>
        </div>`
        )
        .join("")}
    </div>
    <div class="muscle-cool-list">
      ${muscles6
        .map((m) => {
          const rec = recoveryMap[m];
          const col = rec.pct >= 90 ? "#00e5a3" : rec.pct >= 65 ? "#f59e0b" : "#ef4444";
          return `
          <div class="mini-box" style="padding:7px 9px;">
            <div class="bar-row-head" style="font-size:11px;"><span>${escapeHtml(m)}</span><strong class="mono" style="color:${col};">%${rec.pct}</strong></div>
            <div class="bar-track"><div class="bar-fill" style="width:${rec.pct}%; background:${col};"></div></div>
            <div class="card-sub" style="font-size:10px;">${rec.hrs != null ? `${rec.hrs} sa önce` : "Tam hazır"}</div>
          </div>`;
        })
        .join("")}
    </div>
  `;

  // Feature 2: PR & Progressive Overload Table
  const prMap = new Map();
  for (const a of state.activities) {
    const sets = Array.isArray(a.exercise_sets) ? a.exercise_sets : [];
    for (const s of sets) {
      const name = String(s.exercise || "").trim();
      if (!name || name.toUpperCase() === "CARDIO") continue;
      const sc = Math.max(1, Number(s.sets || 1));
      const rawR = Number(s.reps || 15);
      const perSet = sc > 1 && rawR >= sc * 4 ? Math.round(rawR / sc) : rawR;
      const totR = s.total_reps || (rawR >= sc * 4 ? rawR : sc * perSet);
      const wt = Number(s.weight_kg || 0);
      const vol = Number(s.volume_kg || 0);
      const prev = prMap.get(name);
      if (!prev || vol > prev.bestVol || (vol === prev.bestVol && totR > prev.bestTotReps)) {
        prMap.set(name, {
          name,
          muscle: s.muscle || "Core",
          bestWeight: wt,
          bestSets: sc,
          bestPerSet: perSet,
          bestTotReps: totR,
          bestVol: vol,
          lastDate: fmtIstanbulDateTime(a.start_time_local).slice(0, 10),
        });
      }
    }
  }

  const prs = Array.from(prMap.values());
  prBox.innerHTML = prs.length
    ? `
      <table>
        <thead><tr><th>Hareket</th><th>Rekor (SetxTekrar)</th><th>En Yüksek Hacim</th><th>Sıradaki Hedef</th></tr></thead>
        <tbody>
          ${prs
            .map(
              (p) => `<tr>
                <td><strong>${escapeHtml(p.name)}</strong><div class="card-sub">${escapeHtml(p.muscle)} · ${escapeHtml(p.lastDate)}</div></td>
                <td class="mono">${p.bestSets} x ${p.bestPerSet} (${p.bestWeight > 0 ? `${p.bestWeight} kg` : "Vücut Ağırlığı"})</td>
                <td class="mono" style="color:var(--emerald);">${p.bestVol > 0 ? `${p.bestVol} kg` : `${p.bestTotReps} tekrar`}</td>
                <td><span class="badge badge-info mono">${p.bestVol > 0 ? `Hedef ${p.bestVol + 30} kg (+2 tekrar)` : `Hedef ${p.bestTotReps + 4} toplam tekrar`}</span></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`
    : `<p class="card-sub">Kuvvet seti geçmişi eklendikçe PR ve sıradaki yük hedefi otomatik oluşur.</p>`;
}

function applyMapTileLayer() {
  if (!state.map) return;
  if (state.tileLayer) state.map.removeLayer(state.tileLayer);
  const mode = state.mapLayerMode || "dark";
  const cfg =
    mode === "topo"
      ? {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
          attr: "&copy; Esri Topographic",
          className: "",
          nextBtn: "🛰️ Uydu Görünümü",
        }
      : mode === "sat"
      ? {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          attr: "&copy; Esri World Imagery",
          className: "",
          nextBtn: "🌑 Dark Görünüm",
        }
      : {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
          attr: "&copy; Esri · OpenStreetMap",
          className: "map-tiles-dark",
          nextBtn: "🗻 Topo 3D Görünüm",
        };
  state.tileLayer = L.tileLayer(cfg.url, {
    attribution: cfg.attr,
    maxZoom: 19,
    className: cfg.className,
  }).addTo(state.map);
  const btn = document.getElementById("btn-map-layer");
  if (btn) btn.textContent = cfg.nextBtn;
}

window.toggleMapLayer = function () {
  const order = ["dark", "topo", "sat"];
  const idx = order.indexOf(state.mapLayerMode || "dark");
  state.mapLayerMode = order[(idx + 1) % order.length];
  applyMapTileLayer();
};

function renderRehydrationCard(act) {
  const panel = document.getElementById("rehydration-panel");
  const dailyBadge = document.getElementById("rehydration-daily-badge");
  if (!panel || !act) return;

  const rawWater = Number(act.session_comparison?.water_ml);
  const durMin = Math.max(1, Math.round(Number(act.duration_seconds || 1800) / 60));
  const avgHr = Number(act.avg_hr || 105);
  const estMl = rawWater > 0 ? Math.round(rawWater) : Math.round(durMin * (avgHr >= 135 ? 8 : 5.5));
  const targetMl = Math.max(200, Math.round(estMl / 50) * 50);
  const glasses = Math.max(1, Math.round((targetMl / 250) * 2) / 2);
  const needsElectrolyte = targetMl >= 600 || durMin >= 60;

  if (dailyBadge) {
    dailyBadge.textContent = `~${targetMl} ml (${glasses} bardak)`;
  }

  panel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:10px 14px; border-radius:12px; background:var(--panel-soft); border:1px solid var(--border);">
      <div style="display:flex; align-items:baseline; gap:8px;">
        <strong class="mono" style="font-size:18px; color:var(--emerald);">~${targetMl} ml</strong>
        <span class="card-sub">· ${glasses} su bardağı (250 ml)</span>
      </div>
      <span class="card-sub">${
        needsElectrolyte
          ? "Uzun/yoğun seans: suya ek 1 şişe doğal maden suyu ekleyebilirsin."
          : "Antrenman sonrası yudum yudum su içmen toparlanma için yeterli."
      }</span>
    </div>
  `;
}

window.selectActivity = function (id) {
  state.selectedActivityId = id;
  renderWorkouts();
};

window.switchCeoMode = function (mode) {
  state.ceoMode = mode === "monthly" ? "monthly" : "weekly";
  const weeklyBtn = document.getElementById("ceo-btn-weekly");
  const monthlyBtn = document.getElementById("ceo-btn-monthly");
  const weeklyView = document.getElementById("ceo-weekly-view");
  const monthlyView = document.getElementById("ceo-monthly-view");
  if (weeklyBtn) weeklyBtn.classList.toggle("active", state.ceoMode === "weekly");
  if (monthlyBtn) monthlyBtn.classList.toggle("active", state.ceoMode === "monthly");
  if (weeklyView) weeklyView.classList.toggle("hidden", state.ceoMode !== "weekly");
  if (monthlyView) monthlyView.classList.toggle("hidden", state.ceoMode !== "monthly");
  if (state.ceoMode === "monthly") renderMonthly();
};

function renderWeekly() {
  const w = state.weekly;
  if (!w) {
    document.getElementById("weekly-date-label").textContent = "Henüz haftalık rapor oluşturulmadı";
    document.getElementById("weekly-exec-summary").textContent = "Haftalık yönetici özetini görmek için sağ üstteki 'Bülteni Yenile' butonuna basın.";
    document.getElementById("weekly-wow-grid").innerHTML = "";
    document.getElementById("weekly-scorecard").innerHTML = "";
    document.getElementById("weekly-mvp-flags").innerHTML = "";
    document.getElementById("weekly-cardio-strength").innerHTML = "";
    document.getElementById("weekly-schedule-cards").innerHTML = "";
    return;
  }

  document.getElementById("weekly-date-label").textContent = `Hafta başlangıcı: ${w.week_start_date}`;
  document.getElementById("weekly-exec-summary").textContent = w.ai_executive_summary || "";

  const d = w.wow_deltas || {};
  const deltaBadge = (val, unit, inverse = false) => {
    const good = inverse ? val <= 0 : val >= 0;
    const sign = val > 0 ? "+" : "";
    return `<span class="badge ${good ? "badge-ok" : "badge-warn"}">${sign}${val} ${unit}</span>`;
  };

  const kpis = [
    { label: "Haftalık Ort. Toparlanma", val: `${d.hrv_avg_ms ?? "--"} puan`, badge: deltaBadge(d.hrv_delta_ms ?? 0, "puan") },
    { label: "Dinlenik Nabız", val: `${d.rhr_avg_bpm ?? "--"} atım/dk`, badge: deltaBadge(d.rhr_delta_bpm ?? 0, "atım/dk", true) },
    { label: "Uyku / Hazırlık", val: `${d.sleep_avg_score ?? "--"} / ${d.readiness_avg ?? "--"}`, badge: deltaBadge(d.readiness_delta ?? 0, "puan") },
    { label: "Kardiyo Mesafesi", val: `${d.distance_km ?? "--"} km`, badge: deltaBadge(d.distance_delta_km ?? 0, "km") },
    { label: "Kuvvet Seansı", val: `${d.strength_sessions ?? "--"} seans`, badge: deltaBadge(d.strength_delta ?? 0, "seans") },
    { label: "Toplam Dambıl Hacmi", val: `${w.cardio_vs_strength?.strength_volume_kg ?? 0} kg`, badge: `<span class="badge badge-info">Kuvvet</span>` },
  ];

  document.getElementById("weekly-wow-grid").innerHTML = kpis
    .map(
      (k) => `
      <div class="corridor-card">
        <div class="corridor-top"><span class="card-sub">${escapeHtml(k.label)}</span>${k.badge}</div>
        <div class="corridor-val mono">${escapeHtml(k.val)}</div>
      </div>`
    )
    .join("");

  const goals = w.cardio_vs_strength?.goal_scorecard || [];
  document.getElementById("weekly-scorecard").innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Hedef</th><th>Beklenen</th><th>Gerçekleşen</th><th>Durum</th></tr></thead>
        <tbody>
          ${goals
            .map(
              (g) => `<tr>
                <td>${escapeHtml(g.goal)}</td>
                <td class="mono">${escapeHtml(g.target)}</td>
                <td class="mono">${escapeHtml(g.actual)}</td>
                <td><span class="badge ${g.status === "PASS" ? "badge-ok" : "badge-warn"}">${g.status === "PASS" ? "TAMAM" : "DİKKAT"}</span></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  const mf = w.mvp_and_flags || {};
  document.getElementById("weekly-mvp-flags").innerHTML = `
    <div class="coach-block"><h4>🏆 Haftanın En Güçlü Değeri</h4><p>${escapeHtml(mf.mvp || "--")}</p></div>
    <div class="coach-block" style="border-left-color:var(--amber);"><h4>⚠️ Dikkat Edilmesi Gerekenler</h4><p>${escapeHtml(mf.attention_flag || "--")}</p></div>
  `;

  const zList = w.zone_distribution || [];
  const zCtx = document.getElementById("weeklyZonesChart");
  if (zCtx) {
    if (state.charts.weeklyZones) state.charts.weeklyZones.destroy();
    state.charts.weeklyZones = new Chart(zCtx, {
      type: "bar",
      data: {
        labels: zList.map((z) => z.zone),
        datasets: [{ label: "Dakika", data: zList.map((z) => z.minutes), backgroundColor: ["#64748b", "#00e5a3", "#38bdf8", "#f59e0b", "#ef4444"], borderRadius: 8 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: "#cbd5e1" }, grid: { display: false } }, y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } } },
      },
    });
  }

  const cs = w.cardio_vs_strength || {};
  document.getElementById("weekly-cardio-strength").innerHTML = `
    <div class="weather-kpis">
      <div class="mini-box"><div class="mini-box-lbl">Kardiyo</div><div class="mini-box-val mono">${cs.cardio_sessions ?? 0} seans · ${cs.cardio_minutes ?? 0} dk</div></div>
      <div class="mini-box"><div class="mini-box-lbl">Kuvvet (Dambıl)</div><div class="mini-box-val mono">${cs.strength_sessions ?? 0} seans · ${cs.strength_minutes ?? 0} dk</div></div>
    </div>
  `;

  const sched = w.weekly_schedule || [];
  const fc = w.weather_forecast_7d || [];
  const todayDayTr = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long" }).format(new Date());
  document.getElementById("weekly-schedule-cards").innerHTML = sched
    .map((row, i) => {
      const wDay = fc[i] || {};
      const isToday = row.day.toLowerCase() === todayDayTr.toLowerCase();
      return `
      <div class="day-card ${isToday ? "today-card" : ""}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>${escapeHtml(row.day)}</strong>
          <span class="badge badge-info">${escapeHtml(row.intensity)}</span>
        </div>
        <div style="font-size:11.5px; color:var(--emerald); font-weight:700;">${escapeHtml(row.focus)}</div>
        <div style="font-size:12px; color:var(--text-secondary); flex:1;">${escapeHtml(row.plan)}</div>
        <div class="mono" style="font-size:11px; color:var(--text-muted); border-top:1px solid var(--border); padding-top:6px;">
          ${wDay.temp_max != null ? `${wDay.temp_min}–${wDay.temp_max}°C · 💧%${wDay.precip_prob}` : "--"}
        </div>
      </div>`;
    })
    .join("");
}

function renderMonthly() {
  const m = state.monthly;
  const periodEl = document.getElementById("monthly-period-label");
  const trajBadge = document.getElementById("monthly-trajectory-badge");
  const headlineEl = document.getElementById("monthly-ceo-headline");
  const whereEl = document.getElementById("monthly-where-boxes");
  const kpiGrid = document.getElementById("monthly-kpi-grid");
  const calGrid = document.getElementById("monthly-consistency-grid");
  const actBox = document.getElementById("monthly-actions-box");
  if (!headlineEl || !kpiGrid) return;

  if (!m) {
    if (periodEl) periodEl.textContent = "Henüz aylık yönetici raporu üretilmedi";
    if (trajBadge) {
      trajBadge.textContent = "Hazır Bekliyor";
      trajBadge.className = "badge badge-info";
    }
    headlineEl.textContent = "Son 30 günün özetini görmek için sağ üstteki 'Aylık CEO Raporunu Oluştur' butonuna tıklayın.";
    if (whereEl) whereEl.innerHTML = "";
    kpiGrid.innerHTML = "";
    if (calGrid) calGrid.innerHTML = `<p class="card-sub" style="grid-column:1/-1;">Veri oluşturulduğunda 30 günlük takvim burada görünür.</p>`;
    if (actBox) actBox.innerHTML = "";
    return;
  }

  const k = m.kpis || {};
  const mom = m.mom_deltas || {};
  const brief = m.ceo_brief || {};
  const traj = brief.trajectory || "Dengede";
  if (periodEl) periodEl.textContent = `Dönem: ${m.month_key} · Son 30 günde ${k.days_recorded ?? 0} kayıtlı gün, ${k.workouts_count ?? 0} antrenman (${k.total_km ?? 0} km)`;
  if (trajBadge) {
    trajBadge.textContent = traj;
    trajBadge.className = `badge ${traj === "Yükselişte" ? "badge-ok" : traj === "Dikkat Gerektiriyor" ? "badge-warn" : "badge-info"}`;
  }
  headlineEl.textContent = brief.verdict_headline || "--";

  if (whereEl) {
    whereEl.innerHTML = `
      <div class="coach-block"><h4>📍 Neredeyiz?</h4><p>${escapeHtml(brief.where_we_are || "--")}</p></div>
      <div class="coach-block" style="border-left-color:var(--cyan);"><h4>🧭 Nereye Gidiyoruz?</h4><p>${escapeHtml(brief.where_we_are_going || "--")}</p></div>
    `;
  }

  const trendBadge = (item, unit) => {
    if (!item || item.current == null) return `<span class="badge badge-info">Veri Bekleniyor</span>`;
    if (item.previous == null) return `<span class="badge badge-info">İlk 30G Baz</span>`;
    const st = item.status || "STABLE";
    const sign = item.delta > 0 ? "+" : "";
    const arrow = st === "IMPROVING" ? "↑ Gelişiyor" : st === "DECLINING" ? "↓ Geriliyor" : "→ Stabil";
    const cls = st === "IMPROVING" ? "badge-ok" : st === "DECLINING" ? "badge-warn" : "badge-info";
    return `<span class="badge ${cls}">${arrow} (${sign}${item.delta} ${unit})</span>`;
  };

  const kpiCards = [
    { label: "Ortalama Hazırlık", val: mom.readiness?.current != null ? `${mom.readiness.current}/100` : "--", item: mom.readiness, unit: "puan" },
    { label: "Ortalama Uyku Puanı", val: mom.sleep?.current != null ? `${mom.sleep.current}/100` : "--", item: mom.sleep, unit: "puan" },
    { label: "Gece Toparlanması", val: mom.hrv?.current != null ? `${mom.hrv.current} puan` : "--", item: mom.hrv, unit: "puan" },
    { label: "Dinlenik Nabız", val: mom.rhr?.current != null ? `${mom.rhr.current} atım/dk` : "--", item: mom.rhr, unit: "atım" },
    { label: "Kondisyon (VO2 Max)", val: mom.vo2_max?.current != null ? `${mom.vo2_max.current}` : "--", item: mom.vo2_max, unit: "" },
    { label: "Günlük Ort. Adım", val: mom.steps?.current != null ? Number(mom.steps.current).toLocaleString("tr-TR") : "--", item: mom.steps, unit: "adım" },
  ];

  kpiGrid.innerHTML = kpiCards
    .map(
      (c) => `
      <div class="corridor-card">
        <div class="corridor-top"><span class="card-sub">${escapeHtml(c.label)}</span>${trendBadge(c.item, c.unit)}</div>
        <div class="corridor-val mono">${escapeHtml(c.val)}</div>
        <div class="card-sub">Önceki 30 gün: ${c.item?.previous != null ? escapeHtml(String(c.item.previous)) : "--"}</div>
      </div>`
    )
    .join("");

  const cal = Array.isArray(m.consistency_calendar) ? m.consistency_calendar : [];
  if (calGrid) {
    calGrid.innerHTML = cal.length
      ? cal
          .map((d) => {
            const cls = d.level === "peak" ? "hm-peak" : d.level === "good" ? "hm-good" : d.level === "moderate" ? "hm-moderate" : d.level === "low" ? "hm-low" : "hm-empty";
            const tooltip = `${d.date}: Hazırlık ${d.readiness_score ?? "--"}, ${d.workouts_count || 0} antrenman${d.workout_names?.length ? ` (${d.workout_names.join(", ")})` : ""}`;
            return `
            <div class="heatmap-cell ${cls}" title="${escapeHtml(tooltip)}">
              <strong class="mono">${d.day_num}</strong>
              <span style="font-size:10px; opacity:0.9;">${d.workouts_count > 0 ? `🏃${d.workouts_count}` : d.readiness_score != null ? `${d.readiness_score}` : "·"}</span>
            </div>`;
          })
          .join("")
      : `<p class="card-sub" style="grid-column:1/-1;">Takvim verisi henüz yok.</p>`;
  }

  if (actBox) {
    const actions = Array.isArray(brief.ceo_actions) ? brief.ceo_actions : [];
    actBox.innerHTML = `
      <div class="coach-block"><h4>🏆 Ayın En Büyük Kazanımı</h4><p>${escapeHtml(brief.biggest_win || "--")}</p></div>
      <div class="coach-block" style="border-left-color:var(--amber);"><h4>⚠️ En Büyük Risk</h4><p>${escapeHtml(brief.biggest_risk || "--")}</p></div>
      <div class="coach-block" style="border-left-color:var(--purple);">
        <h4>🎯 Gelecek Ay İçin 3 CEO Aksiyonu</h4>
        <ul style="margin:6px 0 0 18px; color:var(--text-secondary); font-size:13px;">
          ${actions.map((a) => `<li>${escapeHtml(a)}</li>`).join("") || "<li>Düzenli uyku ve antrenman ritmini koru.</li>"}
        </ul>
      </div>
    `;
  }
}

function renderNotifications() {
  const listEl = document.getElementById("notif-list");
  const badgeEl = document.getElementById("notif-unread-badge");
  const list = Array.isArray(state.notifications) ? state.notifications : [];
  const unread = list.filter((n) => !n.read_at).length;

  if (badgeEl) {
    badgeEl.textContent = String(unread);
    badgeEl.classList.toggle("hidden", unread === 0);
  }
  if (!listEl) return;

  if (!list.length) {
    listEl.innerHTML = `<p class="card-sub">Henüz bildirim yok. Sabah uyku raporu veya yeni Garmin antrenmanında burada görünecek.</p>`;
    return;
  }

  listEl.innerHTML = list
    .map((n) => {
      const timeStr = fmtIstanbulDateTime(n.created_at);
      return `
      <div class="notif-item ${n.read_at ? "" : "unread"}" onclick="openNotificationItem('${escapeHtml(n.id)}')">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:4px;">
          <strong style="font-size:12.5px;">${escapeHtml(n.title)}</strong>
          <span class="card-sub mono" style="font-size:10px; white-space:nowrap;">${escapeHtml(timeStr)}</span>
        </div>
        <div class="card-sub" style="color:var(--text-secondary); line-height:1.4;">${escapeHtml(n.body)}</div>
      </div>`;
    })
    .join("");
}

window.toggleNotifDrawer = function () {
  const drawer = document.getElementById("notif-drawer");
  if (!drawer) return;
  drawer.classList.toggle("hidden");
};

window.markAllNotifsRead = async function () {
  try {
    await apiCall({ action: "markNotificationsRead" });
    state.notifications = (state.notifications || []).map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
    renderNotifications();
  } catch (_) {}
};

window.openNotificationItem = async function (id) {
  const n = (state.notifications || []).find((x) => x.id === id);
  if (!n) return;
  if (!n.read_at) {
    n.read_at = new Date().toISOString();
    renderNotifications();
    apiCall({ action: "markNotificationsRead", notification_id: id }).catch(() => {});
  }
  document.getElementById("notif-drawer")?.classList.add("hidden");

  const targetTab = n.payload?.tab || (n.type === "WORKOUT_REPORT" ? "workouts" : n.type === "WEEKLY_CEO" || n.type === "MONTHLY_CEO" ? "weekly" : "dashboard");
  const tabBtn = document.querySelector(`[data-tab="${targetTab}"]`);
  if (tabBtn) tabBtn.click();

  if (n.activity_id) {
    state.selectedActivityId = Number(n.activity_id);
    renderWorkouts();
  }
  if (n.type === "MONTHLY_CEO" || n.payload?.mode === "monthly") {
    switchCeoMode("monthly");
  } else if (n.type === "WEEKLY_CEO" || n.payload?.mode === "weekly") {
    switchCeoMode("weekly");
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (n.payload?.focus_card === "ai-daily-insight-card") {
    window.focusAiInsightCard?.();
  }
  if (targetTab === "workouts" && state.map) {
    setTimeout(() => state.map.invalidateSize(), 200);
  }
};

window.openGarminSetupTab = function () {
  const settingsBtn = document.querySelector('[data-tab="settings"]');
  if (settingsBtn) settingsBtn.click();
  setTimeout(() => {
    document.getElementById("garmin-integration-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 150);
};

function updateGarminOnboardingBanner() {
  const banner = document.getElementById("garmin-setup-banner");
  if (!banner) return;
  const integ = state.integration;
  const needsSetup = Boolean(integ && !integ.has_garmin_key && integ.connection_status !== "CONNECTED");
  banner.classList.toggle("hidden", !needsSetup);
}

window.renderArchive = function () {
  const q = (document.getElementById("archive-search")?.value || "").trim().toLowerCase();
  const filtered = state.biometrics.filter((b) =>
    !q || b.log_date.includes(q) || (b.readiness_status || "").toLowerCase().includes(q) || (b.ai_daily_brief?.headline || "").toLowerCase().includes(q)
  );

  const rolling30 = filtered.slice(0, 30);
  document.getElementById("rolling-doc-list").innerHTML = rolling30
    .map(
      (b) => `
      <div class="doc-entry">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong class="mono">${b.log_date}</strong>
          <span class="badge ${b.readiness_score >= 80 ? "badge-ok" : b.readiness_score >= 60 ? "badge-info" : "badge-warn"}">Hazırlık ${b.readiness_score}/100</span>
        </div>
        <div class="card-sub" style="margin-top:4px;">
          BB ${b.body_battery_max ?? "--"} · Uyku ${b.sleep_score ?? "--"} · Kalp Dengesi ${b.hrv_nightly_avg ?? "--"} puan · Nabız ${b.rhr ?? "--"} atım/dk · Solunum ${b.sleep_respiration_avg ?? "--"} · Stres ${b.sleep_stress_avg ?? "--"}
        </div>
        <div style="font-size:12.5px; margin-top:4px; color:var(--text-secondary);">${escapeHtml(b.ai_daily_brief?.headline || "")}</div>
      </div>`
    )
    .join("");

  document.getElementById("biometrics-archive-table").innerHTML = `
    <table>
      <thead><tr><th>Tarih</th><th>Hazırlık</th><th>BB</th><th>Uyku</th><th>HRV</th><th>RHR</th><th>Solunum</th><th>Stres</th><th>SpO2</th><th>Adım</th></tr></thead>
      <tbody>
        ${filtered
          .map(
            (b) => `<tr>
              <td class="mono">${b.log_date}</td>
              <td class="mono"><strong>${b.readiness_score ?? "--"}</strong></td>
              <td class="mono">${b.body_battery_max ?? "--"}</td>
              <td class="mono">${b.sleep_score ?? "--"}</td>
              <td class="mono">${b.hrv_nightly_avg ?? "--"} puan</td>
              <td class="mono">${b.rhr ?? "--"} atım/dk</td>
              <td class="mono">${b.sleep_respiration_avg ?? "--"}</td>
              <td class="mono">${b.sleep_stress_avg ?? "--"}</td>
              <td class="mono">%${b.spo2_avg ?? "--"}</td>
              <td class="mono">${b.steps ?? "--"}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
};

function renderSettings() {
  const s = state.settings;
  if (s) {
    document.getElementById("inp-city").value = s.manual_city_override || "";
    const watchEl = document.getElementById("inp-watch-model");
    if (watchEl && document.activeElement !== watchEl) {
      watchEl.value = s.weather_cache?.garmin_device?.name || "";
    }
    document.getElementById("inp-birth").value = s.birth_year ?? 1990;
    document.getElementById("inp-rhr-base").value = s.base_rhr ?? 46;
    document.getElementById("inp-rhr-warn").value = s.rhr_warn_threshold ?? 51;
    document.getElementById("inp-hrv-min").value = s.base_hrv_min ?? 59;
    document.getElementById("inp-hrv-warn").value = s.hrv_warn_threshold ?? 48;
    document.getElementById("inp-resp-warn").value = s.resp_warn_threshold ?? 18.0;
    document.getElementById("inp-stress-warn").value = s.sleep_stress_threshold ?? 23;
    document.getElementById("inp-temp-warn").value = s.skin_temp_deviation_threshold ?? 0.4;
    document.getElementById("inp-spo2-warn").value = s.spo2_warn_threshold ?? 91;

    const authUserEl = document.getElementById("inp-auth-username");
    const authBadgeEl = document.getElementById("settings-auth-badge");
    const activeUser = s.display_name || state.auth.username || "Sporcu";
    if (authUserEl && document.activeElement !== authUserEl) {
      authUserEl.value = activeUser;
    }
    if (authBadgeEl) {
      authBadgeEl.textContent = state.auth.email || activeUser || "Aktif Oturum";
      authBadgeEl.className = "badge badge-ok mono";
    }

    const gpsReadoutEl = document.getElementById("settings-gps-readout");
    if (gpsReadoutEl) {
      const srcMap = {
        LIVE_GPS: "Canlı Cihaz GPS",
        GARMIN_GPS: "Son Garmin Saat GPS",
        GPS_ACTIVITY: "Garmin GPS",
        MANUAL: "Manuel Şehir",
        DEFAULT: "Varsayılan",
      };
      const srcTxt = srcMap[s.location_source] || s.location_source || "Varsayılan";
      const latTxt = s.active_lat != null ? Number(s.active_lat).toFixed(5) : "--";
      const lonTxt = s.active_lon != null ? Number(s.active_lon).toFixed(5) : "--";
      const liveAcc = s.weather_cache?.live_gps?.accuracy ? ` · ±${s.weather_cache.live_gps.accuracy}m` : "";
      gpsReadoutEl.innerHTML = `<strong>Aktif Konum:</strong> ${escapeHtml(s.active_city || s.default_city || "Belirlenmedi")} · <span class="mono">${latTxt}, ${lonTxt}</span> · Kaynak: <strong>${escapeHtml(srcTxt)}</strong>${escapeHtml(liveAcc)}`;
    }
  }

  const integ = state.integration;
  const baseEl = document.getElementById("inp-garmin-base");
  const gBadge = document.getElementById("settings-garmin-status-badge");
  const gHint = document.getElementById("settings-garmin-hint");
  if (baseEl && document.activeElement !== baseEl) {
    baseEl.value = integ?.garmin_api_base_url || "https://personal.connectapi.garmin.com";
  }
  if (gBadge && integ) {
    const connected = integ.connection_status === "CONNECTED";
    const hasErr = integ.connection_status === "ERROR";
    gBadge.textContent = connected
      ? "Bağlı & Aktif"
      : hasErr
      ? "Bağlantı Hatası"
      : integ.has_garmin_key
      ? "Anahtar Kayıtlı"
      : "Kurulum Bekliyor";
    gBadge.className = `badge ${connected ? "badge-ok" : hasErr ? "badge-crit" : "badge-warn"} mono`;
  }
  if (gHint && integ) {
    if (integ.connection_status === "CONNECTED") {
      gHint.innerHTML = `✅ Garmin API bağlı (<strong>${escapeHtml(integ.garmin_key_hint || "Anahtar kayıtlı")}</strong>)${integ.has_personal_gemini_key ? " · Kişisel Gemini anahtarı aktif" : " · Ortak AI koçu aktif"}.`;
    } else if (integ.connection_status === "ERROR") {
      gHint.innerHTML = `⚠️ Son bağlantı denemesi başarısız: <strong>${escapeHtml(integ.last_error || "API yanıt vermedi")}</strong>`;
    } else if (integ.has_garmin_key) {
      gHint.innerHTML = `🔑 Anahtar kayıtlı (${escapeHtml(integ.garmin_key_hint || "Kasa")}). Bağlantıyı test edip ilk veriyi çekmek için butona basın.`;
    } else {
      gHint.textContent = "Sabah uyku raporları, anlık nabız/enerji ve otomatik antrenman analizleri için kendi Garmin API bilgilerinizi girin.";
    }
  }

  document.getElementById("sync-logs-table").innerHTML = `
    <table>
      <thead><tr><th>Zaman</th><th>Görev</th><th>Durum</th></tr></thead>
      <tbody>
        ${state.syncLogs
          .map(
            (l) => `<tr>
              <td class="mono">${String(l.created_at).slice(0, 19).replace("T", " ")}</td>
              <td class="mono">${escapeHtml(l.job_type)}</td>
              <td><span class="badge ${l.status === "OK" ? "badge-ok" : "badge-info"}">${escapeHtml(l.status)}</span></td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

window.saveGarminIntegration = async function (ev) {
  ev.preventDefault();
  const baseUrl = document.getElementById("inp-garmin-base").value.trim();
  const garminKey = document.getElementById("inp-garmin-key").value.trim();
  const geminiKey = document.getElementById("inp-gemini-key").value.trim();
  const btn = document.getElementById("btn-save-garmin");
  if (btn) btn.disabled = true;

  try {
    showToast("Garmin API bağlantısı test ediliyor ve veriler çekiliyor...");
    const payload = {
      action: "saveGarminIntegration",
      garmin_api_base_url: baseUrl,
      sync_now: true,
    };
    if (garminKey) payload.garmin_api_key = garminKey;
    if (geminiKey) payload.gemini_api_key = geminiKey;

    const res = await apiCall(payload);
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || "Garmin API bağlantısı kurulamadı.");
    }
    document.getElementById("inp-garmin-key").value = "";
    document.getElementById("inp-gemini-key").value = "";
    await loadAllData();
    showToast("Garmin API bağlandı ve ilk verileriniz çekildi!");
  } catch (err) {
    await loadAllData().catch(() => {});
    showToast(`Bağlantı hatası: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.triggerEngine = async function (action, force = false) {
  try {
    showToast(`Çalıştırılıyor: ${action}...`);
    const res = await apiCall({ action, force });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
    await loadAllData();
    if (action === "aylikCeoRaporu") switchCeoMode("monthly");
    showToast(`Tamamlandı: ${action}`);
  } catch (err) {
    showToast(`Hata (${action}): ${err.message}`);
  }
};

window.useLatestGarminGps = async function (silent = false) {
  try {
    if (!silent) showToast("Son Garmin GPS koordinatı alınıyor...");
    document.getElementById("inp-city").value = "";
    const res = await apiCall({
      action: "update_settings",
      manual_city_override: null,
      use_garmin_gps: true,
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Garmin GPS hatası");
    await loadAllData();
    if (!silent) showToast(`Garmin GPS konumu: ${json.loc?.active_city || "Güncellendi"}`);
  } catch (err) {
    if (!silent) showToast(`Konum hatası: ${err.message}`);
  }
};

async function reverseGeocodeClientTr(lat, lon) {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=tr`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) {
      const g = await r.json();
      const admins = g?.localityInfo?.administrative || [];
      const district = admins.find((x) => x?.adminLevel === 6)?.name || "";
      const city = admins.find((x) => x?.adminLevel === 4)?.name || g?.city || g?.principalSubdivision || "";
      const locality = g?.locality || "";
      if (locality && district && locality !== district) return `${locality}, ${district}`;
      if (district && city && district !== city) return `${district}, ${city}`;
      if (district || locality || city) return String(district || locality || city);
    }
  } catch (_) {}

  try {
    const pr = await fetch(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (pr.ok) {
      const ph = await pr.json();
      const p = ph?.features?.[0]?.properties || {};
      const sub = p.district || p.locality || "";
      const dist = p.city || p.county || p.state || "";
      if (sub && dist && sub !== dist) return `${sub}, ${dist}`;
      if (dist || sub) return String(dist || sub);
    }
  } catch (_) {}

  return null;
}

window.detectLiveBrowserGps = async function (silent = false) {
  if (!("geolocation" in navigator)) {
    if (!silent) showToast("Tarayıcı GPS desteklemiyor; son Garmin GPS kullanılıyor.");
    await useLatestGarminGps(silent);
    return;
  }
  if (!silent) showToast("Cihazın canlı GPS konumu alınıyor...");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        document.getElementById("inp-city").value = "";
        const live_city = await reverseGeocodeClientTr(pos.coords.latitude, pos.coords.longitude);
        const res = await apiCall({
          action: "update_settings",
          manual_city_override: null,
          live_lat: pos.coords.latitude,
          live_lon: pos.coords.longitude,
          live_city,
          live_accuracy: Math.round(pos.coords.accuracy || 0),
        });
        const json = await res.json();
        if (!res.ok || json.ok === false) throw new Error(json.error || "Konum güncellenemedi");
        await loadAllData();
        if (!silent) showToast(`Canlı GPS konumu: ${json.loc?.active_city || "Güncellendi"}`);
      } catch (err) {
        if (!silent) showToast(`Canlı konum hatası: ${err.message}`);
      }
    },
    async () => {
      if (!silent) showToast("Tarayıcı konum izni verilmedi; son Garmin GPS konumuna geçildi.");
      await useLatestGarminGps(silent);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
};

window.quickSetCity = async function (city) {
  if (!city) {
    await detectLiveBrowserGps(false);
    return;
  }
  document.getElementById("inp-city").value = city;
  await saveSettings(new Event("submit"));
};

window.saveSettings = async function (ev) {
  ev.preventDefault();
  const watchModel = (document.getElementById("inp-watch-model")?.value || "").trim();
  const payload = {
    action: "update_settings",
    manual_city_override: document.getElementById("inp-city").value.trim() || null,
    birth_year: Number(document.getElementById("inp-birth").value),
    base_rhr: Number(document.getElementById("inp-rhr-base").value),
    rhr_warn_threshold: Number(document.getElementById("inp-rhr-warn").value),
    base_hrv_min: Number(document.getElementById("inp-hrv-min").value),
    hrv_warn_threshold: Number(document.getElementById("inp-hrv-warn").value),
    resp_warn_threshold: Number(document.getElementById("inp-resp-warn").value),
    sleep_stress_threshold: Number(document.getElementById("inp-stress-warn").value),
    skin_temp_deviation_threshold: Number(document.getElementById("inp-temp-warn").value),
    spo2_warn_threshold: Number(document.getElementById("inp-spo2-warn").value),
  };
  try {
    showToast("Ayarlar ve konum güncelleniyor...");
    const res = await apiCall(payload);
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Kayıt hatası");

    const curWatch = state.settings?.weather_cache?.garmin_device?.name || "";
    if (state.auth.userId && watchModel !== curWatch) {
      const { data: freshRow } = await sb
        .from("athlete_settings")
        .select("weather_cache")
        .eq("user_id", state.auth.userId)
        .maybeSingle();
      const nextCache = { ...(freshRow?.weather_cache || state.settings?.weather_cache || {}) };
      if (watchModel) {
        nextCache.garmin_device = {
          ...(nextCache.garmin_device || {}),
          name: watchModel,
          source: "user_settings",
          updated_at: new Date().toISOString(),
        };
      } else {
        delete nextCache.garmin_device;
      }
      await sb.from("athlete_settings").update({ weather_cache: nextCache }).eq("user_id", state.auth.userId);
    }

    await loadAllData();
    showToast(`Ayarlar kaydedildi · Konum: ${json.loc?.active_city || payload.manual_city_override || "Güncellendi"}`);
  } catch (err) {
    showToast(`Ayar hatası: ${err.message}`);
  }
};

window.askCoachPreset = function (q) {
  document.getElementById("coach-question-input").value = q;
  submitCoachChat(new Event("submit"));
};

window.applyAiSuggestedRotation = function () {
  const wTabBtn = document.querySelector('[data-tab="workouts"]');
  if (wTabBtn) wTabBtn.click();
  setTimeout(() => {
    document.getElementById("kochler-rotation-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 150);
};

window.submitCoachChat = async function (ev) {
  ev.preventDefault();
  const inp = document.getElementById("coach-question-input");
  const q = inp.value.trim();
  if (!q) return;
  const replyBox = document.getElementById("coach-chat-reply");
  replyBox.style.display = "block";
  replyBox.innerHTML = `<span class="card-sub">Gemini AI verilerini analiz ediyor...</span>`;
  try {
    const res = await apiCall({ action: "askCoach", question: q });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Yanıt alınamadı");
    const r = json.reply || {};
    const items = Array.isArray(r.action_items) && r.action_items.length
      ? `<ul style="margin:6px 0 0 18px; color:var(--emerald);">${r.action_items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : "";
    const modelLabel = String(r.model_used || r.source || "Gemini AI").replace("models/", "");
    const rotNames = {
      chest_arms: "Kochler - Göğüs & Ön Kol",
      shoulders_back: "Kochler - Omuz & Sırt",
      core_legs: "Ab Roller & Squat",
    };
    const rotBtn = r.suggested_rotation && rotNames[r.suggested_rotation]
      ? `<div class="mt-12"><button type="button" class="btn btn-primary btn-sm" onclick="applyAiSuggestedRotation()">💪 Önerilen Rotasyonu (${escapeHtml(rotNames[r.suggested_rotation])}) Gör</button></div>`
      : "";
    replyBox.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:6px;"><strong>Koç Yanıtı</strong><span class="badge badge-info mono">${escapeHtml(modelLabel)}</span></div><div>${escapeHtml(r.answer || "")}</div>${items}${rotBtn}`;
  } catch (err) {
    replyBox.innerHTML = `<span style="color:var(--red);">Hata: ${escapeHtml(err.message)}</span>`;
  }
};

window.openWorkoutModal = () => document.getElementById("workout-modal").classList.add("open");
window.openBiometricModal = () => {
  document.getElementById("b-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("biometric-modal").classList.add("open");
};
window.closeModals = () => {
  document.getElementById("workout-modal").classList.remove("open");
  document.getElementById("biometric-modal").classList.remove("open");
};

window.toggleWorkoutFields = () => {
  const t = document.getElementById("w-type").value;
  const isStr = t === "strength_training";
  document.querySelectorAll(".strength-only").forEach((el) => (el.style.display = isStr ? "block" : "none"));
  document.querySelectorAll(".cardio-only").forEach((el) => (el.style.display = isStr ? "none" : "block"));
};

window.submitWorkoutModal = async (ev) => {
  ev.preventDefault();
  const payload = {
    action: "logWorkout",
    activity_type: document.getElementById("w-type").value,
    duration_min: Number(document.getElementById("w-dur").value),
    weight_kg: Number(document.getElementById("w-weight").value),
    sets: Number(document.getElementById("w-sets").value),
    reps: Number(document.getElementById("w-reps").value),
    distance_km: Number(document.getElementById("w-dist").value),
    avg_hr: Number(document.getElementById("w-hr").value),
  };
  closeModals();
  showToast("Antrenman kaydediliyor...");
  const res = await apiCall(payload);
  const json = await res.json();
  if (json.ok) {
    state.selectedActivityId = json.activity.activity_id;
    await loadAllData();
    showToast("Antrenman ve kas haritası güncellendi!");
  } else {
    showToast(`Hata: ${json.error}`);
  }
};

window.submitBiometricModal = async (ev) => {
  ev.preventDefault();
  const payload = {
    action: "upsertBiometric",
    log_date: document.getElementById("b-date").value,
    body_battery_max: Number(document.getElementById("b-bb").value),
    sleep_score: Number(document.getElementById("b-sleep").value),
    hrv_nightly_avg: Number(document.getElementById("b-hrv").value),
    rhr: Number(document.getElementById("b-rhr").value),
    steps: Number(document.getElementById("b-steps").value),
  };
  closeModals();
  showToast("Biyometri kaydediliyor...");
  const res = await apiCall(payload);
  const json = await res.json();
  if (json.ok) {
    await loadAllData();
    showToast(`Hazırlık skoru hesaplandı: ${json.bio.readiness_score}/100`);
  } else {
    showToast(`Hata: ${json.error}`);
  }
};

window.exportCsv = function () {
  const headers = ["log_date", "readiness_score", "body_battery_max", "sleep_score", "hrv_nightly_avg", "rhr", "sleep_respiration_avg", "sleep_stress_avg", "skin_temp_deviation", "spo2_avg", "steps"];
  const rows = state.biometrics.map((b) => headers.map((h) => b[h] ?? "").join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `GarminCoach_GunlukVeriler_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
};

function getSavedAuthSession() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.access_token && parsed?.refresh_token) {
          return { ...parsed, remembered: store === localStorage };
        }
      }
    } catch (_) {}
  }
  return null;
}

function saveAuthSession(session, remember) {
  clearAuthSession();
  const store = remember ? localStorage : sessionStorage;
  try {
    store.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch (_) {}
}

function clearAuthSession() {
  try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (_) {}
  try { sessionStorage.removeItem(AUTH_STORAGE_KEY); } catch (_) {}
}

function setAuthError(msg) {
  const errEl = document.getElementById("auth-error-msg");
  if (!errEl) return;
  if (!msg) {
    errEl.textContent = "";
    errEl.classList.add("hidden");
  } else {
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
  }
}

function updateAuthUiLabels() {
  const pillUser = document.getElementById("pill-auth-user");
  if (pillUser) pillUser.textContent = state.auth.username || "Sporcu";
}

async function initNativePushIfAvailable() {
  if (state._pushInitialized) return;
  const push = window.Capacitor?.Plugins?.PushNotifications;
  if (!push || !state.auth.authenticated) return;
  state._pushInitialized = true;
  try {
    let perm = await push.checkPermissions();
    if (perm.receive === "prompt") {
      perm = await push.requestPermissions();
    }
    if (perm.receive !== "granted") return;

    push.addListener("registration", async (token) => {
      if (!token?.value) return;
      try {
        await apiCall({
          action: "registerPushToken",
          fcm_token: token.value,
          platform: window.Capacitor?.getPlatform?.() || "android",
          device_name: navigator.userAgent.slice(0, 80),
        });
      } catch (_) {}
    });

    push.addListener("pushNotificationReceived", () => {
      loadAllData().catch(() => {});
    });

    push.addListener("pushNotificationActionPerformed", (action) => {
      const data = action?.notification?.data || {};
      loadAllData()
        .then(() => {
          if (data.tab) {
            document.querySelector(`[data-tab="${data.tab}"]`)?.click();
          }
          if (data.activity_id) {
            state.selectedActivityId = Number(data.activity_id);
            renderWorkouts();
          }
          if (data.mode === "monthly" || data.type === "MONTHLY_CEO") {
            switchCeoMode("monthly");
          } else if (data.mode === "weekly" || data.type === "WEEKLY_CEO") {
            switchCeoMode("weekly");
          }
        })
        .catch(() => {});
    });

    await push.register();
  } catch (_) {}
}

async function completeAuthSuccess(sessionData, remember) {
  const rawSess = sessionData?.session || sessionData;
  if (!rawSess?.access_token || !rawSess?.refresh_token) {
    throw new Error("Geçersiz oturum yanıtı.");
  }

  const { data: sbData, error: sbErr } = await sb.auth.setSession({
    access_token: rawSess.access_token,
    refresh_token: rawSess.refresh_token,
  });
  if (sbErr || !sbData?.session) {
    throw new Error(sbErr?.message || "Oturum doğrulanamadı.");
  }

  const activeSess = sbData.session;
  const u = sessionData?.user || activeSess.user || {};
  const displayName =
    u.display_name ||
    u.user_metadata?.display_name ||
    (u.email ? String(u.email).split("@")[0] : "Sporcu");

  state.auth = {
    authenticated: true,
    userId: u.id || activeSess.user?.id || null,
    email: u.email || activeSess.user?.email || null,
    username: displayName,
    accessToken: activeSess.access_token,
    refreshToken: activeSess.refresh_token,
  };

  saveAuthSession(
    {
      access_token: activeSess.access_token,
      refresh_token: activeSess.refresh_token,
      user: {
        id: state.auth.userId,
        email: state.auth.email,
        display_name: displayName,
      },
    },
    remember
  );

  updateAuthUiLabels();
  setAuthError("");
  const overlay = document.getElementById("auth-gate-overlay");
  if (overlay) overlay.classList.add("hidden");
  await loadAllData();
  initNativePushIfAvailable();
}

window.switchAuthMode = function (mode) {
  const isReg = mode === "register";
  const tabLogin = document.getElementById("auth-tab-login");
  const tabReg = document.getElementById("auth-tab-register");
  const formLogin = document.getElementById("auth-login-form");
  const formReg = document.getElementById("auth-register-form");
  const hintEl = document.getElementById("auth-default-hint");

  if (tabLogin) tabLogin.classList.toggle("active", !isReg);
  if (tabReg) tabReg.classList.toggle("active", isReg);
  if (formLogin) formLogin.classList.toggle("hidden", isReg);
  if (formReg) formReg.classList.toggle("hidden", !isReg);
  setAuthError("");

  if (hintEl) {
    hintEl.innerHTML = isReg
      ? "Kendi ücretsiz hesabınızı açın, ardından <strong>Ayarlar &rarr; Garmin API</strong> kısmından kendi saatinizin verilerini bağlayın."
      : "Hesabınızla giriş yapın (mevcut sahipseniz e-posta veya kullanıcı adınızı girebilirsiniz).";
  }
};

async function initAuthGate() {
  const overlay = document.getElementById("auth-gate-overlay");
  if (overlay) overlay.classList.remove("hidden");
  switchAuthMode("login");

  const saved = getSavedAuthSession();
  if (saved?.access_token && saved?.refresh_token) {
    const hintEl = document.getElementById("auth-default-hint");
    if (hintEl) hintEl.textContent = "Kayıtlı oturum doğrulanıyor...";
    try {
      await completeAuthSuccess(saved, Boolean(saved.remembered));
      return;
    } catch (_) {
      clearAuthSession();
      switchAuthMode("login");
    }
  }
}

window.submitAppLogin = async function (ev) {
  ev.preventDefault();
  const identifier = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const remember = Boolean(document.getElementById("login-remember")?.checked);
  const btn = document.getElementById("auth-login-btn");
  setAuthError("");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action: "loginUser", identifier, password }),
    });
    const json = await res.json();
    if (!res.ok || !json.authenticated || !json.session) {
      throw new Error(json.error || "E-posta/kullanıcı adı veya şifre hatalı.");
    }
    document.getElementById("login-password").value = "";
    await completeAuthSuccess(json, remember);
    showToast(`Hoş geldin, ${json.user?.display_name || identifier}!`);
  } catch (err) {
    setAuthError(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.submitUserRegister = async function (ev) {
  ev.preventDefault();
  const display_name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const birthVal = document.getElementById("reg-birth").value;
  const default_city = document.getElementById("reg-city").value.trim() || "İstanbul";
  const remember = Boolean(document.getElementById("reg-remember")?.checked);
  const btn = document.getElementById("auth-reg-btn");
  setAuthError("");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        action: "registerUser",
        display_name,
        email,
        password,
        birth_year: birthVal ? Number(birthVal) : 1990,
        default_city,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok || !json.session) {
      throw new Error(json.error || "Hesap oluşturulamadı.");
    }
    document.getElementById("reg-password").value = "";
    await completeAuthSuccess(json, remember);
    showToast("Hesabınız oluşturuldu! Şimdi Garmin API bilgilerinizi bağlayabilirsiniz.");
    openGarminSetupTab();
  } catch (err) {
    setAuthError(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.saveAppCredentials = async function (ev) {
  ev.preventDefault();
  const display_name = document.getElementById("inp-auth-username").value.trim();
  const current_password = document.getElementById("inp-auth-current-pass").value;
  const new_password = document.getElementById("inp-auth-new-pass").value;
  const confirmPass = document.getElementById("inp-auth-confirm-pass").value;

  if (new_password && new_password !== confirmPass) {
    showToast("Yeni şifreler eşleşmiyor!");
    return;
  }

  try {
    showToast("Hesap bilgileri güncelleniyor...");
    const res = await apiCall({
      action: "updateAppCredentials",
      display_name,
      current_password,
      new_password,
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || "Bilgiler güncellenemedi.");
    }

    const wasRemembered = Boolean(localStorage.getItem(AUTH_STORAGE_KEY));
    if (json.session?.access_token && json.session?.refresh_token) {
      await sb.auth.setSession({
        access_token: json.session.access_token,
        refresh_token: json.session.refresh_token,
      });
      state.auth.accessToken = json.session.access_token;
      state.auth.refreshToken = json.session.refresh_token;
    }
    if (json.display_name || display_name) {
      state.auth.username = json.display_name || display_name;
    }
    saveAuthSession(
      {
        access_token: state.auth.accessToken,
        refresh_token: state.auth.refreshToken,
        user: {
          id: state.auth.userId,
          email: state.auth.email,
          display_name: state.auth.username,
        },
      },
      wasRemembered
    );
    updateAuthUiLabels();
    document.getElementById("inp-auth-current-pass").value = "";
    document.getElementById("inp-auth-new-pass").value = "";
    document.getElementById("inp-auth-confirm-pass").value = "";
    await loadAllData();
    showToast(`Hesap bilgileri güncellendi: ${state.auth.username}`);
  } catch (err) {
    showToast(`Güncelleme hatası: ${err.message}`);
  }
};

window.logoutApp = async function () {
  try {
    await sb.auth.signOut();
  } catch (_) {}
  clearAuthSession();
  state.auth = {
    authenticated: false,
    userId: null,
    email: null,
    username: "Sporcu",
    accessToken: null,
    refreshToken: null,
  };
  state.settings = null;
  state.biometrics = [];
  state.activities = [];
  state.weekly = null;
  state.monthly = null;
  state.notifications = [];
  state.integration = null;
  state.syncLogs = [];
  state.selectedActivityId = null;
  state._autoGpsChecked = false;
  state._pushInitialized = false;

  document.getElementById("notif-drawer")?.classList.add("hidden");
  document.getElementById("garmin-setup-banner")?.classList.add("hidden");
  document.getElementById("red-alert-banner")?.classList.add("hidden");
  window.__GC_FIRST_NAME = "";
  const brandEl = document.getElementById("brand-watch-label");
  if (brandEl) brandEl.textContent = "⌚ Garmin Saat Bağlanıyor";
  const mWatchEl = document.getElementById("mobile-watch-pill");
  if (mWatchEl) mWatchEl.textContent = "⌚ Garmin Saat";
  const sideNameEl = document.getElementById("side-athlete-name");
  if (sideNameEl) sideNameEl.textContent = "Sporcu Profili";
  const titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = TAB_TITLES.dashboard;
  const subEl = document.getElementById("side-athlete-sub");
  if (subEl) subEl.textContent = "Profil yükleniyor...";
  const locEl = document.getElementById("pill-location");
  if (locEl) locEl.textContent = "📍 Yükleniyor...";
  const chipEl = document.getElementById("side-readiness-chip");
  if (chipEl) chipEl.textContent = "--/100";

  window.GarminThemeEngine?.refreshFromSettings(null);
  window.GarminAiInsights?.reset();
  renderNotifications();
  renderAll();
  updateAuthUiLabels();

  const pwEl = document.getElementById("login-password");
  if (pwEl) pwEl.value = "";
  setAuthError("");
  initAuthGate();
};

document.addEventListener("DOMContentLoaded", () => {
  window.GarminThemeEngine?.init();
  setupTabs();
  startIstanbulClock();
  initAuthGate();
  document.addEventListener("click", (e) => {
    const drawer = document.getElementById("notif-drawer");
    if (drawer && !drawer.classList.contains("hidden") && !e.target.closest(".notif-wrap")) {
      drawer.classList.add("hidden");
    }
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
});
