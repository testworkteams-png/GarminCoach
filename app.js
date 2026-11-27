const SUPABASE_URL = "https://htooqswstuuzslvrgxsx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5_1RDXV8unnW9ttkHEA_HQ_n8fJrt4I";
const ENGINE_URL = `${SUPABASE_URL}/functions/v1/garmin-coach-engine`;
const AUTH_STORAGE_KEY = "garmincoach_sb_session_v1";
const PUBLIC_REGISTRATION_ENABLED = false;
const ALERT_ACK_STORAGE_KEY = "garmincoach_ack_alerts_v1";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const TAB_TITLES = {
  dashboard: "Ana Ekran · Güncel Biyometri",
  body: "Vücut Kompozisyonu · Honor Scale 2",
  health: "Sağlık Merkezi · Faz 2",
  workouts: "Antrenman & Anatomik Kas Laboratuvarı",
  weekly: "Raporlar · Günlük, Haftalık, Aylık & Yıllık",
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
  hrvChartMode: "night",
  hrChartMode: "intraday",
  bbChartMode: "intraday",
  stressChartMode: "trend14",
  moveDayMode: "today",
  moveChartMode: "steps",
  ceoMode: "daily",
  _activeAlertSig: null,
  _labSlideIndex: 0,
  charts: {
    trend: null,
    activitySeries: null,
    activityElev: null,
    customCompare: null,
    weeklyZones: null,
    yearlyTrend: null,
    bbIntraday: null,
    hrvNight: null,
    intradayHr: null,
    labSleep: null,
    labStress: null,
    labVo2: null,
    labEndurance: null,
    labFitAge: null,
    labRespSpo2: null,
    labMove: null,
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

function fmtDateDmy(val) {
  if (!val) return "--.--.----";
  if (val instanceof Date) {
    return new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(val);
  }
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(val);
}

function startIstanbulClock() {
  const tick = () => {
    const t = new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    const el = document.getElementById("pill-clock");
    if (el) el.textContent = t;
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
  const base =
    hr >= 5 && hr < 12 ? "Günaydın" :
    hr >= 12 && hr < 18 ? "Tünaydın" :
    hr >= 18 && hr < 23 ? "İyi akşamlar" :
    "İyi geceler";
  return name ? `${base}, ${name}` : "Ana Ekran";
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
        titleEl.textContent = target === "dashboard" && fn ? getTimeGreeting(fn) : TAB_TITLES[target];
      }
      if (target === "dashboard") {
        requestAnimationFrame(syncLabCarouselHeight);
      }
      if (target === "weekly") {
        requestAnimationFrame(() => window.switchCeoMode(state.ceoMode || "daily"));
      }
      if (target === "body") {
        requestAnimationFrame(() => window.GarminBodyScale?.onTabShown?.());
      }
      if (target === "health") {
        requestAnimationFrame(() => window.GarminLabs?.onTabShown?.());
      }
      if (target === "workouts" && state.map) {
        setTimeout(() => state.map.invalidateSize(), 160);
      }
    });
  });
}

function getIstanbulTodayIso() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch (_) {
    return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  }
}

async function autoSyncGarminOnLaunch() {
  if (!state.auth.authenticated || !state.auth.userId) return;
  if (state._autoSyncInFlight) return;

  const COOLDOWN_MS = 10 * 60 * 1000;
  const MIN_RETRY_MS = 60 * 1000;
  const uid = state.auth.userId;
  const storageKey = `garmin_auto_sync_${uid}`;
  const todayStr = getIstanbulTodayIso();
  const latestDate = state.biometrics?.[0]?.log_date || "";
  const needsToday = latestDate !== todayStr;

  let lastSyncTs = 0;
  try {
    if (typeof sessionStorage !== "undefined") {
      lastSyncTs = Number(sessionStorage.getItem(storageKey) || 0);
    }
  } catch (_) {}

  const elapsed = Number.isFinite(lastSyncTs) && lastSyncTs > 0 ? Date.now() - lastSyncTs : Infinity;
  if (elapsed < MIN_RETRY_MS) return;
  if (!needsToday && elapsed < COOLDOWN_MS) return;

  const latestUpdatedMs = state.biometrics?.[0]?.updated_at ? Date.parse(state.biometrics[0].updated_at) : 0;
  if (!needsToday && Number.isFinite(latestUpdatedMs) && Date.now() - latestUpdatedMs < 15 * 60 * 1000) {
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(storageKey, String(Date.now()));
      }
    } catch (_) {}
    return;
  }

  state._autoSyncInFlight = true;
  const metaEl = typeof document !== "undefined" ? document.getElementById("home-live-meta") : null;
  const prevMeta = metaEl ? metaEl.textContent : "";
  if (metaEl) metaEl.textContent = "↻ Saat verileri güncelleniyor...";

  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(storageKey, String(Date.now()));
    }
  } catch (_) {}

  try {
    const res = await apiCall({ action: "gunlukGarminAnalizi", silent: true, force: true });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok !== false) {
      const [bioRes, actRes] = await Promise.all([
        sb.from("daily_biometrics").select("*").eq("user_id", uid).order("log_date", { ascending: false }).limit(365),
        sb.from("activities").select("*").eq("user_id", uid).order("start_time_local", { ascending: false }).limit(200),
      ]);
      if (Array.isArray(bioRes.data)) state.biometrics = bioRes.data;
      if (Array.isArray(actRes.data)) state.activities = actRes.data;
      renderAll();
    } else if (metaEl && prevMeta) {
      metaEl.textContent = prevMeta;
    }
  } catch (_) {
    if (metaEl && prevMeta) metaEl.textContent = prevMeta;
  } finally {
    state._autoSyncInFlight = false;
  }
}

async function loadAllData() {
  if (!state.auth.authenticated || !state.auth.userId) return;
  const uid = state.auth.userId;

  const [settingsRes, bioRes, actRes, weekRes, monthRes, notifRes, logsRes, intRes] = await Promise.all([
    sb.from("athlete_settings").select("*").eq("user_id", uid).maybeSingle(),
    sb.from("daily_biometrics").select("*").eq("user_id", uid).order("log_date", { ascending: false }).limit(365),
    sb.from("activities").select("*").eq("user_id", uid).order("start_time_local", { ascending: false }).limit(200),
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
  window.GarminBodyScale?.initForUser(state.auth, sb);
  window.GarminMeds?.initForUser(state.auth, sb);
  window.GarminLabs?.initForUser(state.auth, sb);
  renderAll();
  renderNotifications();
  renderMonthly();
  updateGarminOnboardingBanner();

  if (!state._autoGpsChecked && state.settings && !state.settings.manual_city_override && state.settings.location_source === "DEFAULT") {
    state._autoGpsChecked = true;
    detectLiveBrowserGps(true);
  }

  autoSyncGarminOnLaunch();
}

function renderAll() {
  renderTopbar();
  renderDashboard();
  renderWorkouts();
  renderWeekly();
  renderMonthly();
  renderYearly();
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
    titleEl.textContent = getTimeGreeting(firstName);
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
    const locEl = document.getElementById("pill-location");
    if (locEl) {
      locEl.textContent = `📍 ${s.active_city || s.default_city || "--"}`;
      locEl.title = `Konum Kaynağı: ${srcLabel} · Yenilemek için tıklayın`;
    }
  }
  const shortDate = (d) => fmtDateDmy(d).slice(0, 5);
  if (latest) {
    document.getElementById("pill-date").textContent = shortDate(latest.log_date);
    document.getElementById("side-readiness-chip").textContent = `${latest.readiness_score ?? "--"}/100`;
  } else {
    document.getElementById("pill-date").textContent = shortDate(new Date());
    document.getElementById("side-readiness-chip").textContent = "--/100";
  }

  const weatherPill = document.getElementById("pill-weather");
  const w = latest?.evening_weather || null;
  if (weatherPill) {
    const nowHr = new Date().getHours();
    const liveSlot = Array.isArray(w?.hourly_slots)
      ? w.hourly_slots.find((sl) => (sl?.day_offset ?? 0) === 0 && parseInt(String(sl?.hour || "").slice(0, 2), 10) === nowHr)
      : null;
    const effTemp = liveSlot?.temp_c ?? w?.temp_c;
    const effFeels = liveSlot?.feels_like_c ?? w?.feels_like_c;
    const effProb = Number(liveSlot?.precip_prob ?? w?.precip_prob ?? 0);
    if (w && effTemp != null) {
      const icon = effProb >= 50 ? "🌧" : effProb >= 25 ? "🌦" : (nowHr >= 20 || nowHr < 6) ? "🌙" : "☀️";
      const tempVal = Math.round(Number(effTemp));
      weatherPill.textContent = `${icon} ${tempVal}°C`;
      weatherPill.title = `${w.city || s?.active_city || ""} · Hissedilen ${effFeels ?? tempVal}°C · Yağış %${effProb}`;
      weatherPill.classList.remove("hidden");
    } else {
      weatherPill.classList.add("hidden");
    }
  }
  const readinessPill = document.getElementById("pill-readiness");
  if (readinessPill) {
    if (latest && latest.readiness_score != null) {
      const sc = Math.round(Number(latest.readiness_score));
      const cls = sc >= 75 ? "pill-score-ok" : sc >= 55 ? "pill-score-warn" : "pill-score-crit";
      readinessPill.className = `pill mono ${cls}`;
      readinessPill.textContent = `⚡ ${sc}`;
      readinessPill.title = `Günlük Hazırlık Skoru: ${sc}/100`;
    } else {
      readinessPill.className = "pill mono hidden";
    }
  }
}

window.scrollToWeatherCard = function () {
  const dashBtn = document.querySelector('[data-tab="dashboard"]');
  if (dashBtn && !document.getElementById("tab-dashboard")?.classList.contains("active")) {
    dashBtn.click();
  }
  window.toggleWeatherAccordion?.(true);
  setTimeout(() => {
    const el = document.getElementById("evening-weather-card") || document.getElementById("evening-weather-stats") || document.getElementById("weather-source-label");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 120);
};

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

function renderSleepDebtAndBedtime(targetId = "sleep-debt-box") {
  const box = document.getElementById(targetId);
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

function getRedFlagsSignature(logDate, flags) {
  const parts = (flags || [])
    .map((f) => `${f?.metric || ""}:${f?.value ?? ""}:${f?.severity || ""}`)
    .sort()
    .join(",");
  return `${logDate || ""}|${parts}`;
}

function clearRedAlertUi() {
  state._activeAlertSig = null;
  document.getElementById("red-alert-banner")?.classList.add("hidden");
  document.getElementById("red-alert-banner")?.classList.remove("alert-warn");
  document.getElementById("btn-alerts-toggle")?.classList.add("hidden");
  document.getElementById("alerts-drawer")?.classList.add("hidden");
}

function fmtSleepHoursCompact(sec) {
  if (!sec || !Number.isFinite(Number(sec))) return "--";
  const mins = Math.round(Number(sec) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}s ${m}dk`;
}

function renderHomeLiveCockpit(latest) {
  const liveGridEl = document.getElementById("home-live-grid");
  const metaEl = document.getElementById("home-live-meta");
  const s = state.settings || {};

  if (!latest) {
    if (metaEl) metaEl.textContent = "İlk Garmin saat verisi bekleniyor";
    if (liveGridEl) {
      liveGridEl.innerHTML = `<p class="card-sub">Güncel biyometri verisi için sağ üstten <strong>↻ Senkronize Et</strong> butonuna basın veya Ayarlar'dan Garmin bağlantısını yapın.</p>`;
    }
    return;
  }

  const prev = state.biometrics[1] || null;
  const te = latest.raw_payload?.telemetry_extra || {};
  const met = te.metabolism || {};
  const fa = te.fitness_age_detail || {};
  const clampPct = (v, min = 8, max = 100) => Math.max(min, Math.min(max, Math.round(v)));

  if (metaEl) {
    const todaySteps = Number(latest.steps || 0).toLocaleString("tr-TR");
    const activeKcal = latest.active_kilocalories ?? met.active_kcal;
    const kcalPart = activeKcal != null ? ` · ${Number(activeKcal).toLocaleString("tr-TR")} aktif kcal` : "";
    const rScore = latest.readiness_score != null ? ` · Hazırlık ${latest.readiness_score}/100` : "";
    metaEl.textContent = `${latest.log_date} · Bugün ${todaySteps} adım${kcalPart}${rScore}`;
  }

  if (!liveGridEl) return;

  const sleepScore = latest.sleep_score != null ? Number(latest.sleep_score) : null;
  const hrvVal = latest.hrv_nightly_avg != null ? Number(latest.hrv_nightly_avg) : null;
  const baseLow = Number(s.base_hrv_min ?? te.hrv_baseline?.balancedLow ?? 59);
  const baseHigh = Number(s.base_hrv_max ?? te.hrv_baseline?.balancedUpper ?? 74);
  const hrvStatusMap = { BALANCED: "Dengeli", UNBALANCED: "Dengesiz", LOW: "Düşük", POOR: "Zayıf" };
  const hrvRaw = String(latest.hrv_status || "").toUpperCase();
  const hrvStatus = hrvStatusMap[hrvRaw] || (hrvVal == null ? "Veri yok" : hrvVal >= baseLow ? "Dengeli" : hrvVal >= (s.hrv_warn_threshold ?? 48) ? "Sınırda" : "Düşük");

  const rhrVal = latest.rhr != null ? Number(latest.rhr) : null;
  const bbCur = te.bb_current ?? latest.body_battery_max ?? null;
  const bbNum = bbCur != null ? Number(bbCur) : null;

  const stressVal = latest.stress_avg != null ? Number(latest.stress_avg) : null;
  const stressStatus = stressVal == null ? "Veri yok" : stressVal <= 25 ? "Düşük" : stressVal <= 50 ? "Orta" : "Yüksek";

  const allBio = Array.isArray(state.biometrics) && state.biometrics.length ? state.biometrics : [latest];

  const vo2Rec = allBio.find((r) => r && r.vo2_max != null) || latest;
  const vo2Val = vo2Rec.vo2_max != null ? Number(vo2Rec.vo2_max) : null;
  const vo2Status = vo2Val == null ? "Veri yok" : vo2Val >= 50 ? "Üstün" : vo2Val >= 42 ? "İyi" : "Orta";
  const shortVo2Date = String(vo2Rec.log_date || "").length >= 10
    ? `${String(vo2Rec.log_date).slice(8, 10)}.${String(vo2Rec.log_date).slice(5, 7)}`
    : "--";

  const endRec = allBio.find((r) => r && r.endurance_score != null) || latest;
  const endVal = endRec.endurance_score != null ? Number(endRec.endurance_score) : null;
  const shortEndDate = String(endRec.log_date || "").length >= 10
    ? `${String(endRec.log_date).slice(8, 10)}.${String(endRec.log_date).slice(5, 7)}`
    : "--";
  const endTierText = endVal == null
    ? "Veri yok"
    : endVal >= 6600
      ? `Üstün (6.600+) · ${shortEndDate}`
      : endVal >= 5800
        ? `İyi (5.800 – 6.599) · ${shortEndDate}`
        : endVal >= 5100
          ? `Ara (5.100 – 5.799) · ${shortEndDate}`
          : `Başlangıç (<5.100) · ${shortEndDate}`;

  const fitAgeRec =
    allBio.find(
      (r) =>
        r &&
        (r.raw_payload?.telemetry_extra?.fitness_age_detail?.current_age != null ||
          r.raw_payload?.telemetry_extra?.fitness_age?.current_age != null ||
          r.fitness_age != null)
    ) || latest;
  const fitFa =
    fitAgeRec.raw_payload?.telemetry_extra?.fitness_age_detail ||
    fitAgeRec.raw_payload?.telemetry_extra?.fitness_age ||
    fa;
  const fitAge = fitFa.current_age ?? fitAgeRec.fitness_age ?? null;
  const chronoAge = Number(fitFa.chronological_age ?? fa.chronological_age ?? (new Date().getFullYear() - Number(s.birth_year || 1988)));
  const ageDiff = fitAge != null && Number.isFinite(chronoAge) ? Number((chronoAge - Number(fitAge)).toFixed(1)) : null;
  const ageDiffText = ageDiff != null && Math.abs(ageDiff) > 0
    ? ` (${String(Math.abs(ageDiff)).replace(".", ",")} yaş ${ageDiff >= 0 ? "genç" : "yüksek"})`
    : "";

  const spo2Val = latest.spo2_avg != null ? Number(latest.spo2_avg) : null;
  const spo2Warn = Number(s.spo2_warn_threshold ?? 91);
  const spo2Status = spo2Val == null && latest.sleep_respiration_avg == null
    ? "Veri yok"
    : spo2Val == null || spo2Val >= 94
      ? "Normal"
      : spo2Val > spo2Warn
        ? "İyi"
        : "Dikkat";
  const respSubParts = [
    latest.sleep_respiration_avg != null ? `${String(latest.sleep_respiration_avg).replace(".", ",")} dk⁻¹` : "Gece Takibi",
    spo2Val != null ? `SpO₂ %${Math.round(spo2Val)}` : null,
  ].filter(Boolean);

  const todayRec = latest;
  const todayTe = todayRec.raw_payload?.telemetry_extra || {};
  const todayMet = todayTe.metabolism || {};
  const todayFl = todayTe.floors || {};
  const todaySteps = Number(todayRec.steps || 0);
  const todayStepPct = Math.min(100, Math.round((todaySteps / 10000) * 100));
  const todayActiveKcal = todayRec.active_kilocalories ?? todayMet.active_kcal ?? null;
  const todayTotalKcal =
    todayMet.total_kcal ??
    (todayActiveKcal != null ? Number(todayActiveKcal) + Number(todayMet.bmr_kcal || 1680) : null);
  const todayFloorGoal = Number(todayFl.goal ?? 10);
  const todayFloorsNum = todayFl.ascended != null ? Number(todayFl.ascended) : null;
  const todayFloorPct = todayFloorsNum != null ? Math.round((todayFloorsNum / Math.max(1, todayFloorGoal)) * 100) : 0;
  const todayFloorMetaParts = [
    todayFl.meters_up != null ? `+${String(todayFl.meters_up).replace(".", ",")} m` : null,
    todayFl.descended != null ? `İniş ${String(todayFl.descended).replace(".", ",")}` : null,
    todayFloorsNum != null ? `Hedef %${todayFloorPct}` : "Veri bekleniyor",
  ].filter(Boolean);
  const todayCalText = todayTotalKcal != null
    ? `${Number(todayTotalKcal).toLocaleString("tr-TR")} kcal${todayActiveKcal != null ? ` · ${Number(todayActiveKcal).toLocaleString("tr-TR")} aktif` : ""}`
    : todayActiveKcal != null
      ? `${Number(todayActiveKcal).toLocaleString("tr-TR")} aktif kcal`
      : "-- kcal";

  const closingRec = prev || latest;
  const closingTe = closingRec.raw_payload?.telemetry_extra || {};
  const closingMet = closingTe.metabolism || {};
  const closingFl = closingTe.floors || {};
  const closingSteps = Number(closingRec.steps || 0);
  const closingStepPct = Math.min(100, Math.round((closingSteps / 10000) * 100));
  const closingActive = closingRec.active_kilocalories ?? closingMet.active_kcal ?? null;
  const closingTotalKcal =
    closingMet.total_kcal ??
    (closingActive != null ? Number(closingActive) + Number(closingMet.bmr_kcal || 1680) : null);
  const closingFloors = closingFl.ascended ?? 0;

  const renderBarRow = (row) => `
    <button type="button" class="home-bar-row" onclick="focusHomeMetric('${escapeHtml(row.key)}')">
      <div class="home-bar-head">
        <span class="home-bar-label">${escapeHtml(row.label)}</span>
        <span class="home-bar-value">
          <strong class="mono">${escapeHtml(row.val)}</strong>
          ${row.meta ? ` <span class="home-bar-meta">(${escapeHtml(row.meta)})</span>` : ""}
          <span class="home-bar-chevron" aria-hidden="true">›</span>
        </span>
      </div>
      <div class="home-bar-track">
        <div class="home-bar-fill" style="width:${row.pct}%; background:${row.color};"></div>
      </div>
    </button>`;

  const group1 = [
    {
      key: "sleep",
      label: "😴 Uyku",
      val: fmtSleepHoursCompact(latest.sleep_seconds),
      meta: `Skor: ${sleepScore ?? "--"}`,
      pct: sleepScore != null ? clampPct(sleepScore, 8, 100) : 12,
      color: "#6366f1",
    },
    {
      key: "hrv",
      label: "💗 HRV",
      val: hrvVal != null ? `${hrvVal} ms` : "--",
      meta: `${hrvStatus} · Baz: ${baseLow}–${baseHigh}`,
      pct: hrvVal != null ? clampPct((hrvVal / 95) * 100, 12, 100) : 12,
      color: "#10b981",
    },
    {
      key: "hr",
      label: "🫀 Dinlenik Nabız",
      val: rhrVal != null ? `${rhrVal} bpm` : "--",
      meta: latest.min_hr && latest.max_hr ? `Dinlenik · ${latest.min_hr}–${latest.max_hr}` : "Dinlenik",
      pct: rhrVal != null ? clampPct(((95 - rhrVal) / 55) * 100, 18, 100) : 15,
      color: "#ec4899",
    },
    {
      key: "bb",
      label: "🔋 Body Battery",
      val: bbNum != null ? `${bbNum} / 100` : "--",
      meta: `Sabah Maks: ${latest.body_battery_max ?? "--"}`,
      pct: bbNum != null ? clampPct(bbNum, 8, 100) : 10,
      color: "#0ea5e9",
    },
    {
      key: "stress",
      label: "🧘 Stres Seviyesi",
      val: stressVal != null ? `${stressVal} / 100` : "--",
      meta: stressStatus,
      pct: stressVal != null ? clampPct(stressVal, 8, 100) : 10,
      color: "#f59e0b",
    },
  ];

  const group2 = [
    {
      key: "vo2",
      label: "🏃 VO₂ Maks",
      val: vo2Val != null ? String(vo2Val).replace(".", ",") : "--",
      meta: `${vo2Status} · ${shortVo2Date}`,
      pct: vo2Val != null ? clampPct(((vo2Val - 25) / 40) * 100, 18, 100) : 15,
      color: "#10b981",
    },
    {
      key: "endurance",
      label: "🏆 Dayanıklılık Puanı",
      val: endVal != null ? endVal.toLocaleString("tr-TR") : "--",
      meta: endTierText,
      pct: endVal != null ? clampPct(((endVal - 3000) / 5500) * 100, 16, 100) : 15,
      color: "#f97316",
    },
    {
      key: "fitness_age",
      label: "🧬 Sağlık Yaşı",
      val: fitAge != null ? `${String(fitAge).replace(".", ",")} Yaş` : "--",
      meta: `Gerçek Yaş: ${chronoAge}${ageDiffText}`,
      pct: fitAge != null ? clampPct(((chronoAge + 10 - Number(fitAge)) / 20) * 100, 22, 100) : 20,
      color: "#0d9488",
    },
    {
      key: "resp_spo2",
      label: "🫁 Solunum & Pulse Ox",
      val: spo2Status,
      meta: respSubParts.join(" · "),
      pct: spo2Val != null ? clampPct(spo2Val, 20, 100) : 88,
      color: "#06b6d4",
    },
    {
      key: "today_live",
      label: "⚡ Bugün (Anlık)",
      val: `${todaySteps.toLocaleString("tr-TR")} adım`,
      meta: `${todayCalText} · Hedef %${todayStepPct}`,
      pct: clampPct(todayStepPct, 8, 100),
      color: "#38bdf8",
    },
    {
      key: "floors",
      label: "🪜 Çıkılan Kat",
      val: todayFloorsNum != null ? `${String(todayFloorsNum).replace(".", ",")} / ${todayFloorGoal} kat` : "--",
      meta: todayFloorMetaParts.join(" · "),
      pct: todayFloorsNum != null ? clampPct((todayFloorsNum / Math.max(1, todayFloorGoal)) * 100, 8, 100) : 10,
      color: "#a78bfa",
    },
    ...(prev
      ? [
          {
            key: "steps",
            label: "👣 Dünün Kapanışı",
            val: `${closingSteps.toLocaleString("tr-TR")} adım`,
            meta: `${closingTotalKcal != null ? `${Number(closingTotalKcal).toLocaleString("tr-TR")} kcal` : "-- kcal"} · ${closingFloors} kat · Hedef %${closingStepPct}`,
            pct: clampPct(closingStepPct, 8, 100),
            color: "#22c55e",
          },
        ]
      : []),
  ];

  liveGridEl.innerHTML = `
    <div class="home-bars-section-title">TOPARLANMA &amp; SİNİR SİSTEMİ</div>
    ${group1.map(renderBarRow).join("")}
    <div class="home-bars-divider"></div>
    <div class="home-bars-section-title">KONDİSYON, SAĞLIK &amp; GÜNLÜK HAREKET</div>
    ${group2.map(renderBarRow).join("")}`;
}

window.toggleHomeBarsAccordion = function (forceOpen) {
  const card = document.getElementById("home-bars-card");
  const btn = document.getElementById("home-bars-acc-toggle");
  if (!card) return;
  const nextOpen = typeof forceOpen === "boolean" ? forceOpen : !card.classList.contains("is-open");
  card.classList.toggle("is-open", nextOpen);
  if (btn) btn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
};

window.toggleWeatherAccordion = function (forceOpen) {
  const card = document.getElementById("evening-weather-card");
  const btn = document.getElementById("weather-acc-toggle");
  if (!card) return;
  const nextOpen = typeof forceOpen === "boolean" ? forceOpen : !card.classList.contains("is-open");
  card.classList.toggle("is-open", nextOpen);
  if (btn) btn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
};

window.openDailyReportView = function () {
  document.querySelector('[data-tab="weekly"]')?.click();
  window.switchCeoMode?.("daily");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.focusHomeMetric = function (key) {
  const carousel = document.getElementById("lab-carousel-section");
  if (!carousel) return;
  const map = {
    sleep: { slide: 0 },
    hrv: { slide: 1 },
    hr: { slide: 2 },
    bb: { slide: 3 },
    stress: { slide: 4 },
    vo2: { slide: 5 },
    endurance: { slide: 6 },
    fitness_age: { slide: 7 },
    resp_spo2: { slide: 8 },
    today_live: { slide: 9, moveDay: "today", moveChart: "steps" },
    floors: { slide: 9, moveDay: "today", moveChart: "floors" },
    steps: { slide: 9, moveDay: "yesterday", moveChart: "steps" },
    calories: { slide: 9, moveDay: "today", moveChart: "steps" },
    intensity: { slide: 9, moveDay: "today", moveChart: "steps" },
  };
  const cfg = map[key] || { slide: 0 };
  if (cfg.moveChart) {
    window.switchMoveChartMode?.(cfg.moveChart);
  }
  if (cfg.moveDay) {
    window.switchMoveDay?.(cfg.moveDay);
  }
  window.goToLabSlide?.(cfg.slide);
  carousel.scrollIntoView({ behavior: "smooth", block: "start" });

  const targetCard = carousel.querySelector(`.lab-carousel-slide[data-slide="${cfg.slide}"] > .card`);
  if (targetCard) {
    targetCard.classList.remove("lab-slide-pulse");
    void targetCard.offsetWidth;
    targetCard.classList.add("lab-slide-pulse");
    clearTimeout(targetCard._pulseTimer);
    targetCard._pulseTimer = setTimeout(() => {
      targetCard.classList.remove("lab-slide-pulse");
    }, 980);
  }
};

function clearLabCarouselEmpty() {
  const labChartKeys = [
    "bbIntraday",
    "hrvNight",
    "intradayHr",
    "labSleep",
    "labStress",
    "labVo2",
    "labEndurance",
    "labFitAge",
    "labRespSpo2",
    "labMove",
  ];
  for (const k of labChartKeys) {
    if (state.charts[k]) {
      state.charts[k].destroy();
      state.charts[k] = null;
    }
  }
  const setHtml = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };
  const setText = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };
  setText("lab-sleep-badge", "Skor --");
  setHtml("lab-sleep-kpis", "");
  setText("lab-sleep-total-label", "--");
  setHtml("lab-sleep-hypnogram", "");
  setHtml("lab-sleep-legend", "");
  setHtml("lab-sleep-debt-box", "");
  const sleepIns = document.getElementById("lab-sleep-insight-box");
  if (sleepIns) { sleepIns.textContent = ""; sleepIns.classList.add("hidden"); }

  setText("hrv-peak-badge", "Tepe -- ms");
  setHtml("lab-hrv-kpis", "");
  setHtml("lab-hrv-corridor", "");

  setText("intraday-rhr-badge", "7G RHR: --");
  setHtml("lab-hr-kpis", "");

  setText("bb-current-badge", "🔋 --");
  setHtml("bb-events-list", `<p class="card-sub">Henüz Body Battery verisi yok.</p>`);

  setText("lab-stress-badge", "--");
  setHtml("lab-stress-kpis", "");
  setText("stress-max-label", "Maks --");
  setHtml("stress-breakdown-bar", "");
  setHtml("stress-breakdown-legend", "");

  setText("lab-vo2-badge", "--");
  setHtml("lab-vo2-scale", "");
  setHtml("lab-vo2-kpis", "");

  setText("lab-endurance-badge", "--");
  setHtml("lab-endurance-scale", "");
  setHtml("lab-endurance-kpis", "");
  setHtml("lab-endurance-contributors", "");

  setText("lab-fitage-badge", "--");
  setHtml("lab-fitage-trio", "");
  setHtml("lab-fitage-factors", "");

  setText("lab-resp-badge", "--");
  setHtml("lab-resp-kpis", "");
  const tempNote = document.getElementById("lab-resp-temp-note");
  if (tempNote) { tempNote.textContent = ""; tempNote.classList.add("hidden"); }

  setText("lab-move-badge", "--");
  setHtml("lab-move-compare", "");
  setHtml("lab-move-kpis", "");

  setHtml("active-intel-3x", `<p class="card-sub">Günlük veriler geldikçe özet kartlar burada görünür.</p>`);
  setHtml("correlation-matrix-grid", `<p class="card-sub">Etki analizi için en az 3 günlük kayıt gerekir.</p>`);
}

function renderDashboard() {
  const latest = state.biometrics[0];
  const s = state.settings || {};
  renderHomeLiveCockpit(latest);
  if (!latest) {
    clearRedAlertUi();
    document.getElementById("readiness-score").textContent = "--";
    document.getElementById("readiness-status-label").textContent = "VERİ BEKLENİYOR";
    document.getElementById("bb-ring-label").textContent = "Enerji --";
    const legReadVal = document.getElementById("ring-legend-val-readiness");
    if (legReadVal) legReadVal.textContent = "--/100";
    const legBbVal = document.getElementById("ring-legend-val-bb");
    if (legBbVal) legBbVal.textContent = "--/100";
    document.getElementById("readiness-badge").textContent = "--";
    document.getElementById("readiness-breakdown").innerHTML = `<p class="card-sub">İlk verinizi görmek için Ayarlar'dan Garmin API bağlayın veya "+ Günlük Veri Ekle" butonunu kullanın.</p>`;
    document.getElementById("sleep-total-label").textContent = "--";
    document.getElementById("sleep-hypnogram").innerHTML = "";
    document.getElementById("sleep-legend").innerHTML = "";
    document.getElementById("sleep-debt-box").innerHTML = "";
    document.getElementById("ai-daily-blocks").innerHTML = `<p class="card-sub">Henüz günlük rapor oluşmadı.</p>`;
    clearLabCarouselEmpty();
    return;
  }

  // Red / Warn Alert Banner + Header "İkazlar" Drawer
  const banner = document.getElementById("red-alert-banner");
  const iconEl = document.getElementById("red-alert-icon");
  const titleEl = document.getElementById("red-alert-title");
  const textEl = document.getElementById("red-alert-text");
  const badgeEl = document.getElementById("red-alert-badge");
  const alertsBtn = document.getElementById("btn-alerts-toggle");
  const alertsBtnIcon = document.getElementById("alerts-btn-icon");
  const alertsCountBadge = document.getElementById("alerts-count-badge");
  const alertsDrawerTitle = document.getElementById("alerts-drawer-title");
  const alertsDrawerList = document.getElementById("alerts-drawer-list");
  const alertsDrawerAckBtn = document.getElementById("btn-alerts-drawer-ack");
  const flags = Array.isArray(latest.red_flags) ? latest.red_flags : [];

  if (flags.length > 0) {
    const isCritical = flags.some((f) => f.severity === "CRITICAL") || flags.length >= 3;
    const sig = getRedFlagsSignature(latest.log_date, flags);
    state._activeAlertSig = sig;
    let isAcked = false;
    try {
      isAcked = localStorage.getItem(ALERT_ACK_STORAGE_KEY) === sig;
    } catch (_) {}

    const itemsHtml = flags
      .map((f) => {
        const full = describeRedFlag(f);
        const idx = full.indexOf(":");
        const head = idx > 0 ? full.slice(0, idx + 1) : "";
        const body = idx > 0 ? full.slice(idx + 1) : full;
        return { head, body, itemCrit: f?.severity === "CRITICAL" };
      });

    if (banner) {
      banner.classList.toggle("hidden", isAcked);
      banner.classList.toggle("alert-warn", !isCritical);
    }
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
      textEl.innerHTML = itemsHtml
        .map(({ head, body }) => `<div class="alert-flag-item">${head ? `<strong>${escapeHtml(head)}</strong>` : ""}${escapeHtml(body)}</div>`)
        .join("");
    }

    if (alertsBtn) {
      alertsBtn.classList.remove("hidden");
      alertsBtn.classList.toggle("alerts-critical", isCritical);
      alertsBtn.classList.toggle("alerts-acked", isAcked);
    }
    if (alertsBtnIcon) alertsBtnIcon.textContent = isCritical ? "🚨" : "⚠️";
    if (alertsCountBadge) {
      alertsCountBadge.className = `badge ${isCritical ? "badge-crit" : "badge-warn"}`;
      alertsCountBadge.textContent = String(flags.length);
    }
    if (alertsDrawerTitle) {
      alertsDrawerTitle.textContent = isCritical ? "🚨 Kritik İkazlar" : "⚠️ İkazlar";
    }
    if (alertsDrawerAckBtn) {
      alertsDrawerAckBtn.classList.toggle("hidden", isAcked);
    }
    if (alertsDrawerList) {
      alertsDrawerList.innerHTML =
        itemsHtml
          .map(
            ({ head, body, itemCrit }) =>
              `<div class="alerts-drawer-item${itemCrit || isCritical ? " critical" : ""}">${head ? `<strong>${escapeHtml(head)}</strong>` : ""}${escapeHtml(body)}</div>`
          )
          .join("") +
        (isAcked
          ? `<div class="card-sub" style="padding:2px 4px;">✓ Bu uyarıları inceledin; gün içinde buradan tekrar bakabilirsin.</div>`
          : "");
    }
  } else {
    clearRedAlertUi();
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

  const ringColor = score >= 80 ? "#00e5a3" : score >= 60 ? "#22c55e" : score >= 45 ? "#f59e0b" : "#ef4444";
  const bbColor = "#38bdf8";
  ringR.style.stroke = ringColor;
  ringBB.style.stroke = bbColor;

  const legReadCard = document.getElementById("ring-legend-card-readiness");
  if (legReadCard) legReadCard.style.borderLeftColor = ringColor;
  const arrowReadGroup = document.getElementById("ring-arrow-readiness");
  if (arrowReadGroup) {
    arrowReadGroup.setAttribute("stroke", ringColor);
    const arrowDot = arrowReadGroup.querySelector("circle");
    if (arrowDot) arrowDot.setAttribute("fill", ringColor);
  }
  const legReadDot = document.getElementById("ring-legend-dot-readiness");
  if (legReadDot) legReadDot.style.background = ringColor;
  const legReadVal = document.getElementById("ring-legend-val-readiness");
  if (legReadVal) {
    legReadVal.textContent = `${score}/100`;
    legReadVal.style.color = ringColor;
  }
  const legBbDot = document.getElementById("ring-legend-dot-bb");
  if (legBbDot) legBbDot.style.background = bbColor;
  const legBbVal = document.getElementById("ring-legend-val-bb");
  if (legBbVal) {
    legBbVal.textContent = `${bbMax}/100`;
    legBbVal.style.color = bbColor;
  }

  const readinessTrMap = { OPTIMAL: "OPTİMAL", MODERATE: "ORTA", LOW: "DÜŞÜK", CRITICAL: "KRİTİK" };
  const rawStatus = latest.readiness_status || (score >= 80 ? "OPTIMAL" : score >= 60 ? "MODERATE" : score >= 45 ? "LOW" : "CRITICAL");
  document.getElementById("readiness-score").textContent = score;
  const stLbl = document.getElementById("readiness-status-label");
  stLbl.textContent = readinessTrMap[rawStatus] || rawStatus;
  stLbl.style.color = ringColor;
  document.getElementById("bb-ring-label").textContent = `BB ${bbMax}`;

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

  // All-Day Live AQI Semicircle Gauge & Forward-Looking 6-Hour Strip (Now + 5h)
  const w = latest.evening_weather || {};
  const nowDt = new Date();
  const nowHour = nowDt.getHours();
  const nowMin = nowDt.getMinutes();
  const nowTimeStr = `${String(nowHour).padStart(2, "0")}:${String(nowMin).padStart(2, "0")}`;
  const dialByAqi = (val) => (val > 75 ? "KIRMIZI" : val > 50 ? "TURUNCU" : val > 25 ? "SARI" : "YEŞİL");
  const badgeClsFor = (lvl) =>
    lvl === "YEŞİL" ? "badge-ok" : lvl === "SARI" ? "badge-warn" : lvl === "TURUNCU" ? "badge-orange" : "badge-crit";

  const rawSlots = Array.isArray(w.hourly_slots) ? w.hourly_slots : [];
  const slotByAbsHour = new Map();
  for (const sl of rawSlots) {
    const hr = parseInt(String(sl?.hour || "").slice(0, 2), 10);
    if (!Number.isFinite(hr)) continue;
    const dayOffset = Number(sl?.day_offset || 0);
    const absHr = dayOffset * 24 + hr;
    if (!slotByAbsHour.has(absHr)) slotByAbsHour.set(absHr, sl);
  }

  const fbTemp = w.temp_c ?? 13;
  const fbFeels = w.feels_like_c ?? fbTemp;
  const fbHumidity = w.humidity ?? null;
  const fbUv = w.uv_index ?? null;
  const fbWind = w.wind_kmh ?? 12;
  const fbPrecip = w.precip_prob ?? 10;
  const fbAqi = Number(w.aqi_max ?? 25);
  const fbPm25 = w.pm25_max ?? null;
  const fbDial = w.dial_level || dialByAqi(fbAqi);

  const slots = [];
  let lastKnown = slotByAbsHour.get(nowHour) || null;
  for (let step = 0; step < 6; step++) {
    const absHr = nowHour + step;
    const h = absHr % 24;
    const dayOffset = absHr >= 24 ? 1 : 0;
    const found = slotByAbsHour.get(absHr);
    if (found) {
      lastKnown = found;
      slots.push({ ...found, day_offset: dayOffset });
    } else {
      const ref = lastKnown || {};
      const refAqi = Number(ref.aqi ?? fbAqi);
      slots.push({
        hour: `${String(h).padStart(2, "0")}:00`,
        day_offset: dayOffset,
        temp_c: ref.temp_c ?? fbTemp,
        feels_like_c: ref.feels_like_c ?? fbFeels,
        humidity: ref.humidity ?? fbHumidity,
        uv_index: ref.uv_index ?? fbUv,
        wind_kmh: ref.wind_kmh ?? fbWind,
        precip_prob: ref.precip_prob ?? fbPrecip,
        aqi: refAqi,
        pm25: ref.pm25 ?? fbPm25,
        dial_level: ref.dial_level || dialByAqi(refAqi),
      });
    }
  }

  const currentSlot = slots[0];
  const curAqi = Number(currentSlot?.aqi ?? w.aqi_max ?? 25);
  const curPm25 = currentSlot?.pm25 ?? w.pm25_max ?? "--";
  const curTemp = currentSlot?.temp_c ?? w.temp_c ?? "--";
  const curFeels = currentSlot?.feels_like_c ?? w.feels_like_c ?? curTemp;
  const curHumidity = currentSlot?.humidity ?? w.humidity ?? null;
  const curUv = currentSlot?.uv_index ?? w.uv_index ?? null;
  const curWind = currentSlot?.wind_kmh ?? w.wind_kmh ?? "--";
  const curPrecip = currentSlot?.precip_prob ?? w.precip_prob ?? 0;
  const curDialLbl = currentSlot?.dial_level || w.dial_level || dialByAqi(curAqi);

  const humText = curHumidity != null ? `%${Math.round(Number(curHumidity))}` : "--";
  const uvText = curUv != null ? Number(curUv).toFixed(1).replace(/\.0$/, "") : "--";

  const sumTimeEl = document.getElementById("weather-sum-time");
  if (sumTimeEl) sumTimeEl.textContent = `🕒 ${nowTimeStr}`;
  const sumTempEl = document.getElementById("weather-sum-temp");
  if (sumTempEl) sumTempEl.textContent = `🌡️ ${curTemp !== "--" ? `${curTemp}°C` : "--°C"}`;
  const sumAqiEl = document.getElementById("weather-sum-aqi");
  if (sumAqiEl) {
    sumAqiEl.textContent = `${curAqi} AQI · ${curDialLbl}`;
    sumAqiEl.className = `badge mono ${badgeClsFor(curDialLbl)}`;
  }

  document.getElementById("weather-source-label").textContent = `${w.city || s.active_city || s.default_city || "--"} · ${w.source || "MET Norway + Open-Meteo AQI"}`;

  // Map AQI 0..100 to -82deg..+82deg
  const clampedAqi = Math.min(100, Math.max(0, curAqi));
  const angle = -82 + (clampedAqi / 100) * 164;
  document.getElementById("aqi-needle").setAttribute("transform", `rotate(${angle.toFixed(1)} 105 102)`);
  document.getElementById("aqi-dial-val").textContent = `${curAqi} AQI`;

  const dialBadge = document.getElementById("aqi-dial-badge");
  dialBadge.textContent = `${curDialLbl} · PM2.5 ${curPm25}`;
  dialBadge.className = `badge ${badgeClsFor(curDialLbl)}`;

  document.getElementById("evening-weather-stats").innerHTML = `
    <div class="mini-box"><div class="mini-box-lbl">Sıcaklık / Hissedilen</div><div class="mini-box-val mono">${curTemp}° / ${curFeels}°</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Rüzgar / Yağış</div><div class="mini-box-val mono">${curWind} km/s · %${curPrecip}</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Gün Doğumu / Batımı</div><div class="mini-box-val mono">🌅 ${w.sunrise ?? "--"} · 🌇 ${w.sunset ?? "--"}</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Nem / UV İndeksi</div><div class="mini-box-val mono">💧 ${humText} · ☀️ UV ${uvText}</div></div>
  `;

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
    bestBanner.innerHTML = `🎯 <strong>Altın Saat (${escapeHtml(bestSlot.hour)}):</strong> AQI ${bestSlot.aqi} (${escapeHtml(bestSlot.dial_level || curDialLbl)}) · Rüzgar ${bestSlot.wind_kmh ?? "--"} km/s · ${bestSlot.temp_c}°C (Yağış %${bestSlot.precip_prob})`;
  }
  document.getElementById("hourly-walk-strip").innerHTML = slots
    .map((slot, idx) => {
      const isCurrent = idx === 0;
      const isBest = slot === bestSlot;
      const isTomorrowStart = slot.day_offset === 1 && slot.hour === "00:00";
      const dotCol = slot.aqi <= 25 ? "#10b981" : slot.aqi <= 50 ? "#f59e0b" : slot.aqi <= 75 ? "#fb923c" : "#ef4444";
      const tagsHtml = isCurrent || isBest || isTomorrowStart
        ? `<div class="hour-pill-tags">${isCurrent ? '<span class="hour-tag now">ŞİMDİ</span>' : ""}${isTomorrowStart ? '<span class="hour-tag next">YARIN</span>' : ""}${isBest ? '<span class="hour-tag gold">★ ALTIN</span>' : ""}</div>`
        : "";
      return `
      <div class="hour-pill ${isCurrent ? "is-current" : ""} ${isBest ? "best" : ""}">
        ${tagsHtml}
        <div class="mono" style="font-weight:700;">${escapeHtml(slot.hour)}</div>
        <div class="mono" style="color:var(--text-secondary); margin:2px 0;">${slot.temp_c}°C</div>
        <div style="font-size:10px; color:var(--text-muted);">💧%${slot.precip_prob} · ${slot.wind_kmh ?? "--"}km</div>
        <div style="font-size:10.5px; color:${dotCol}; font-weight:700;">● ${slot.aqi}</div>
      </div>`;
    })
    .join("");

  document.getElementById("evening-clothing-advice").innerHTML =
    `<div class="clothing-side-title">🧥 Giyim Tavsiyesi</div><div class="clothing-side-text">${escapeHtml(w.clothing_advice || "Hafif katmanlı yürüyüş kıyafeti.")}</div>`;

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
  requestAnimationFrame(syncLabCarouselHeight);
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

function translateStressQualifier(q) {
  const key = String(q || "").trim().toUpperCase();
  const map = {
    BALANCED: "Dengeli",
    CALM: "Sakin",
    STRESSFUL: "Stresli",
    VERY_STRESSFUL: "Çok Stresli",
    MODERATE: "Orta",
    RESTFUL: "Dinlendirici",
    LOW: "Düşük",
    HIGH: "Yüksek",
  };
  return map[key] || "Normal";
}

function translateSleepInsight(feedback, insight) {
  const fbMap = {
    POSITIVE_LONG_AND_RECOVERING: "Uzun ve toparlayıcı uyku — sinir sistemi iyi dinlendi",
    POSITIVE_LONG_AND_DEEP: "Uzun ve derin uyku — fiziksel onarım güçlü gerçekleşti",
    POSITIVE_LONG_AND_CONTINUOUS: "Uzun ve kesintisiz uyku — uyku bütünlüğü yüksek",
    POSITIVE_REFRESHING: "Dinlendirici uyku — sabah taze uyanma sağladı",
    POSITIVE_OPTIMAL_STRUCTURE: "Dengeli uyku evresi dağılımı (Derin + REM uyumlu)",
    POSITIVE_GOOD_SLEEP: "Kaliteli ve dengeli bir gece uykusu",
    POSITIVE_RECOVERY: "Gece boyunca toparlanma odaklı uyku",
    NEGATIVE_SHORT: "Uyku süresi hedefin altında kaldı — erken yatış faydalı olur",
    NEGATIVE_RESTLESS: "Gece uykusu yer yer bölünmüş — uyku öncesi ekranı azalt",
    NEGATIVE_LOW_REM: "REM uykusu düşük kaldı — zihinsel toparlanma sınırlı",
    NEGATIVE_LOW_DEEP: "Derin uyku oranı düşük — akşam kafein ve geç öğünü sınırla",
    NEGATIVE_HIGH_STRESS: "Gece uyku stresi yüksek — dinlenme kalitesi düşmüş",
    NEGATIVE_POOR: "Yetersiz uyku kalitesi — bugün temponu kontrollü tut",
  };
  const inMap = {
    POSITIVE_STRESSFUL_DAY: "Stresli bir günü iyi bir gece uykusuyla dengeledin.",
    POSITIVE_ACTIVE_DAY: "Aktif bir günün ardından vücut güzel toparlandı.",
    POSITIVE_EXERCISE: "Antrenman sonrası onarım uykusu verimli geçti.",
    NEGATIVE_STRESSFUL_DAY: "Gün içi yoğun stres gece uykusuna da bir miktar yansıdı.",
    NEGATIVE_LATE_BEDTIME: "Geç yatış uyku derinliğini sınırlamış olabilir.",
    NEGATIVE_ALCOHOL_OR_LATE_MEAL: "Akşam geç saat yükü gece dinlenmesini zorlaştırdı.",
  };
  const fbKey = String(feedback || "").trim().toUpperCase();
  const inKey = String(insight || "").trim().toUpperCase();
  const fbText =
    fbMap[fbKey] ||
    (fbKey.startsWith("POSITIVE") ? "İyi ve toparlayıcı gece uykusu" : fbKey.startsWith("NEGATIVE") ? "Uyku kalitesi gelişime açık" : "");
  const inText = inMap[inKey] || "";
  if (!fbText && !inText) return "";
  return inText ? `${fbText}. ${inText}` : fbText;
}

function translateBbFeedback(fb) {
  const key = String(fb || "").trim().toUpperCase();
  if (!key || key === "NONE") return "";
  const map = {
    GOOD_RECOVERY: "İyi gece toparlanması sağlandı",
    HIGH_DRAIN: "Gün içinde enerji tüketimi yüksekti",
    LOW_CHARGE: "Gece şarjı sınırlı kaldı",
    BALANCED_DAY: "Gün içi enerji kullanımı dengeli",
    EXERCISE_DRAIN: "Antrenman belirgin enerji harcaması yaptı",
    STRESS_DRAIN: "Stres kaynaklı enerji düşüşü gözlendi",
  };
  return map[key] || "";
}

function renderMiniKpiBoxes(items) {
  return (items || [])
    .map(
      (it) => `
      <div class="mini-box">
        <div class="mini-box-lbl">${escapeHtml(it.label)}</div>
        <div class="mini-box-val mono"${it.color ? ` style="color:${it.color};"` : ""}>${escapeHtml(it.val)}</div>
        ${it.sub ? `<div class="card-sub">${escapeHtml(it.sub)}</div>` : ""}
      </div>`
    )
    .join("");
}

function renderLabChart(chartKey, canvasId, config) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (state.charts[chartKey]) state.charts[chartKey].destroy();
  state.charts[chartKey] = new Chart(ctx, config);
}

function computePaddedBounds(values, minPad = 2, hardMin = null, hardMax = null) {
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return {};
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const pad = Math.max(minPad, (hi - lo) * 0.25);
  let sMin = Number((lo - pad).toFixed(1));
  let sMax = Number((hi + pad).toFixed(1));
  if (hardMin != null) sMin = Math.max(hardMin, sMin);
  if (hardMax != null) sMax = Math.min(hardMax, sMax);
  return { suggestedMin: sMin, suggestedMax: sMax };
}

function setActiveChipGroup(attr, val) {
  document.querySelectorAll(`#lab-carousel-section [${attr}]`).forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute(attr) === val);
  });
}

function renderSegmentedScale({ title, currentLabel, bands, value, nextTargetText }) {
  if (!bands?.length) return "";
  const totalMin = bands[0].min;
  const totalMax = bands[bands.length - 1].max;
  const span = Math.max(1, totalMax - totalMin);
  const hasVal = value != null && Number.isFinite(Number(value));
  const clampedPct = hasVal ? Math.max(2, Math.min(98, ((Number(value) - totalMin) / span) * 100)) : 50;
  const activeBand = hasVal
    ? bands.find((b, i) => (i === bands.length - 1 ? Number(value) >= b.min : Number(value) >= b.min && Number(value) < b.max)) ||
      (Number(value) < totalMin ? bands[0] : bands[bands.length - 1])
    : null;

  return `
    <div class="lab-scale-wrap">
      <div class="lab-scale-head">
        <span style="color:var(--text-secondary); font-weight:600;">${escapeHtml(title)}</span>
        <strong class="mono" style="color:${activeBand?.color || "var(--text)"};">${escapeHtml(currentLabel)}</strong>
      </div>
      <div class="lab-scale-bar">
        ${bands
          .map((b) => {
            const w = ((b.max - b.min) / span) * 100;
            const isAct = activeBand && activeBand.label === b.label;
            return `<div class="lab-scale-seg${isAct ? " active" : ""}" style="width:${w.toFixed(2)}%; background:${b.color};" title="${escapeHtml(b.label)}"></div>`;
          })
          .join("")}
        ${hasVal ? `<div class="lab-scale-marker" style="left:${clampedPct.toFixed(1)}%; border-color:${activeBand?.color || "var(--emerald)"};"></div>` : ""}
      </div>
      <div class="lab-scale-labels">
        ${bands.map((b) => `<span>${escapeHtml(b.label)}</span>`).join("")}
      </div>
      ${nextTargetText ? `<div class="lab-scale-foot">${escapeHtml(nextTargetText)}</div>` : ""}
    </div>`;
}

function renderLabSleepSlide(latest) {
  const te = latest?.raw_payload?.telemetry_extra || {};
  const si = te.sleep_insights || {};
  const sleepScore = latest.sleep_score != null ? Number(latest.sleep_score) : null;

  const badge = document.getElementById("lab-sleep-badge");
  if (badge) {
    badge.textContent = sleepScore != null ? `Skor ${sleepScore}/100` : "Skor --";
    badge.className = `badge mono ${sleepScore == null ? "badge-info" : sleepScore >= 80 ? "badge-ok" : sleepScore >= 60 ? "badge-warn" : "badge-crit"}`;
  }

  const deep = Number(latest.deep_sleep_seconds || 0);
  const light = Number(latest.light_sleep_seconds || 0);
  const rem = Number(latest.rem_sleep_seconds || 0);
  const awake = Number(latest.awake_seconds || 0);
  const totalStages = deep + light + rem + awake;
  const restorativePct = totalStages > 0 ? Math.round(((deep + rem) / totalStages) * 100) : null;

  const kpisEl = document.getElementById("lab-sleep-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = renderMiniKpiBoxes([
      {
        label: "Toplam Uyku",
        val: fmtSleepHoursCompact(latest.sleep_seconds || totalStages),
        sub: sleepScore != null ? `Skor ${sleepScore}/100` : "Hedef 7,5 sa",
        color: "#818cf8",
      },
      {
        label: "Derin + REM",
        val: restorativePct != null ? `%${restorativePct}` : "--",
        sub: totalStages > 0 ? `${fmtSleepHoursCompact(deep + rem)} onarıcı` : "Evre verisi yok",
        color: "#00e5a3",
      },
      {
        label: "Gece Uyku Stresi",
        val: latest.sleep_stress_avg != null ? `${Math.round(Number(latest.sleep_stress_avg))} puan` : "--",
        sub: `Normal <${state.settings?.sleep_stress_threshold ?? 23}`,
        color: "#38bdf8",
      },
    ]);
  }

  const totalLbl = document.getElementById("lab-sleep-total-label");
  if (totalLbl) totalLbl.textContent = fmtDuration(latest.sleep_seconds || totalStages);

  const hypEl = document.getElementById("lab-sleep-hypnogram");
  const legEl = document.getElementById("lab-sleep-legend");
  if (totalStages > 0) {
    if (hypEl) {
      hypEl.innerHTML = `
        <div style="width:${(deep / totalStages) * 100}%; background:#6366f1;" title="Derin"></div>
        <div style="width:${(light / totalStages) * 100}%; background:#38bdf8;" title="Hafif"></div>
        <div style="width:${(rem / totalStages) * 100}%; background:#00e5a3;" title="REM"></div>
        <div style="width:${(awake / totalStages) * 100}%; background:#f59e0b;" title="Uyanık"></div>`;
    }
    if (legEl) {
      legEl.innerHTML = `
        <span>🟣 Derin ${fmtDuration(deep)}</span>
        <span>🔵 Hafif ${fmtDuration(light)}</span>
        <span>🟢 REM ${fmtDuration(rem)}</span>
        <span>🟠 Uyanık ${Math.round(awake / 60)} dk</span>`;
    }
  } else {
    if (hypEl) hypEl.innerHTML = "";
    if (legEl) legEl.innerHTML = `<span class="card-sub">Bu gün için detaylı uyku evresi kaydı bulunamadı.</span>`;
  }

  renderSleepDebtAndBedtime("lab-sleep-debt-box");

  const insightEl = document.getElementById("lab-sleep-insight-box");
  if (insightEl) {
    const insText = translateSleepInsight(si.feedback, si.insight);
    if (insText) {
      insightEl.textContent = `💡 ${insText}`;
      insightEl.classList.remove("hidden");
    } else {
      insightEl.textContent = "";
      insightEl.classList.add("hidden");
    }
  }

  const last14 = [...state.biometrics].slice(0, 14).reverse();
  renderLabChart("labSleep", "labSleepChart", {
    type: "bar",
    data: {
      labels: last14.map((d) => String(d.log_date || "").slice(5)),
      datasets: [
        {
          type: "line",
          label: "Uyku Skoru",
          order: 0,
          data: last14.map((d) => (d.sleep_score != null ? Number(d.sleep_score) : null)),
          borderColor: "#00e5a3",
          backgroundColor: "rgba(0,229,163,0.12)",
          tension: 0.35,
          pointRadius: 2.5,
          spanGaps: true,
          yAxisID: "y1",
        },
        {
          type: "bar",
          label: "Uyku (saat)",
          order: 1,
          data: last14.map((d) => (d.sleep_seconds ? Number((Number(d.sleep_seconds) / 3600).toFixed(2)) : null)),
          backgroundColor: "rgba(99,102,241,0.48)",
          borderColor: "#818cf8",
          borderWidth: 1,
          borderRadius: 5,
          yAxisID: "y",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
        y: { position: "left", min: 0, max: 11, ticks: { color: "#818cf8" }, grid: { color: "rgba(148,163,184,0.08)" } },
        y1: { position: "right", min: 30, max: 100, ticks: { color: "#00e5a3" }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

window.switchHrvChartMode = function (mode, btn) {
  state.hrvChartMode = mode === "trend" ? "trend" : "night";
  setActiveChipGroup("data-hrv-mode", state.hrvChartMode);
  if (state.biometrics[0]) renderLabHrvSlide(state.biometrics[0]);
  requestAnimationFrame(syncLabCarouselHeight);
};

function renderLabHrvSlide(latest) {
  const te = latest?.raw_payload?.telemetry_extra || {};
  const s = state.settings || {};
  const baseHrv = te.hrv_baseline || {};
  const lowBand = Number(baseHrv.balancedLow ?? s.base_hrv_min ?? 59);
  const highBand = Number(baseHrv.balancedUpper ?? s.base_hrv_max ?? 74);
  const hrvVal = latest.hrv_nightly_avg != null ? Number(latest.hrv_nightly_avg) : null;
  const weekly7 = latest.hrv_weekly_avg ?? computeAvg(state.biometrics.slice(0, 7).map((d) => d.hrv_nightly_avg));
  const hrvStatusMap = { BALANCED: "Dengeli", UNBALANCED: "Dengesiz", LOW: "Düşük", POOR: "Zayıf" };
  const hrvRaw = String(latest.hrv_status || "").toUpperCase();
  const hrvStatusTr = hrvStatusMap[hrvRaw] || (hrvVal == null ? "Veri yok" : hrvVal >= lowBand ? "Dengeli" : "Sınırda");

  const peakBadge = document.getElementById("hrv-peak-badge");
  if (peakBadge) {
    peakBadge.textContent = `5-Dk Tepe: ${te.hrv_5min_high ?? "--"} ms · ${hrvStatusTr}`;
    peakBadge.className = `badge ${hrvStatusTr === "Dengeli" ? "badge-ok" : "badge-warn"}`;
  }

  const kpisEl = document.getElementById("lab-hrv-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = renderMiniKpiBoxes([
      {
        label: "Dün Gece",
        val: hrvVal != null ? `${hrvVal} ms` : "--",
        sub: hrvStatusTr,
        color: "#00e5a3",
      },
      {
        label: "7G Ort",
        val: weekly7 != null ? `${Math.round(Number(weekly7))} ms` : "--",
        sub: hrvVal != null && weekly7 != null ? `Fark ${hrvVal - Math.round(Number(weekly7)) >= 0 ? "+" : ""}${Math.round(hrvVal - Number(weekly7))} ms` : "Haftalık denge",
        color: "#38bdf8",
      },
      {
        label: "5-Dk Tepe",
        val: te.hrv_5min_high != null ? `${te.hrv_5min_high} ms` : "--",
        sub: `Baz ${lowBand}–${highBand}`,
        color: "#a78bfa",
      },
    ]);
  }

  const corrEl = document.getElementById("lab-hrv-corridor");
  if (corrEl) {
    const minScale = Math.max(25, Math.min(lowBand - 22, hrvVal != null ? hrvVal - 8 : lowBand - 20));
    const maxScale = Math.max(highBand + 20, hrvVal != null ? hrvVal + 8 : highBand + 20);
    const lowUpper = Number(baseHrv.lowUpper ?? s.hrv_warn_threshold ?? 48);
    corrEl.innerHTML = renderSegmentedScale({
      title: `Kişisel Baz Koridoru (${lowBand}–${highBand} ms)`,
      currentLabel: hrvVal != null ? `${hrvVal} ms · ${hrvStatusTr}` : "--",
      value: hrvVal,
      bands: [
        { label: `Düşük <${lowUpper}`, min: minScale, max: lowUpper, color: "#ef4444" },
        { label: `Sınırda`, min: lowUpper, max: lowBand, color: "#f59e0b" },
        { label: `Dengeli ${lowBand}–${highBand}`, min: lowBand, max: highBand, color: "#00e5a3" },
        { label: "Yüksek", min: highBand, max: maxScale, color: "#38bdf8" },
      ],
      nextTargetText:
        hrvVal != null && hrvVal < lowBand
          ? `Dengeli baz (${lowBand} ms) sınırına +${Math.round(lowBand - hrvVal)} ms uzaklıkta.`
          : "Otonom sinir sistemi kişisel denge aralığında.",
    });
  }

  setActiveChipGroup("data-hrv-mode", state.hrvChartMode);
  if (state.hrvChartMode === "trend") {
    const last14 = [...state.biometrics].slice(0, 14).reverse();
    renderLabChart("hrvNight", "hrvNightChart", {
      type: "line",
      data: {
        labels: last14.map((d) => String(d.log_date || "").slice(5)),
        datasets: [
          {
            label: "Gece HRV (ms)",
            data: last14.map((d) => d.hrv_nightly_avg),
            borderColor: "#00e5a3",
            backgroundColor: "rgba(0,229,163,0.14)",
            fill: true,
            tension: 0.35,
            pointRadius: 2.5,
            spanGaps: true,
          },
          {
            label: "7G Ortalama",
            data: last14.map((d) => d.hrv_weekly_avg),
            borderColor: "#38bdf8",
            borderDash: [4, 3],
            tension: 0.35,
            pointRadius: 0,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { ticks: { color: "#00e5a3" }, grid: { color: "rgba(148,163,184,0.08)" } },
        },
      },
    });
  } else {
    const hrvReadings = Array.isArray(te.hrv_readings) ? te.hrv_readings : [];
    renderLabChart("hrvNight", "hrvNightChart", {
      type: "line",
      data: {
        labels: hrvReadings.map((r) => r.time),
        datasets: [
          {
            label: "5-Dk HRV (ms)",
            data: hrvReadings.map((r) => r.val),
            borderColor: "#00e5a3",
            backgroundColor: "rgba(0,229,163,0.14)",
            fill: true,
            tension: 0.35,
            pointRadius: 1,
          },
        ],
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
}

window.switchHrChartMode = function (mode, btn) {
  state.hrChartMode = mode === "rhr14" ? "rhr14" : "intraday";
  setActiveChipGroup("data-hr-mode", state.hrChartMode);
  if (state.biometrics[0]) renderLabHrSlide(state.biometrics[0]);
  requestAnimationFrame(syncLabCarouselHeight);
};

function renderLabHrSlide(latest) {
  const te = latest?.raw_payload?.telemetry_extra || {};
  const s = state.settings || {};
  const baseRhr = Number(s.base_rhr ?? 46);
  const rhrVal = latest.rhr != null ? Number(latest.rhr) : null;
  const rhr7 = te.rhr_7d_avg ?? computeAvg(state.biometrics.slice(0, 7).map((d) => d.rhr));

  const rhrBadge = document.getElementById("intraday-rhr-badge");
  if (rhrBadge) {
    rhrBadge.textContent = `7G Ort: ${rhr7 != null ? Math.round(Number(rhr7)) : "--"} bpm`;
  }

  const kpisEl = document.getElementById("lab-hr-kpis");
  if (kpisEl) {
    const diff = rhrVal != null ? rhrVal - baseRhr : null;
    kpisEl.innerHTML = renderMiniKpiBoxes([
      {
        label: "Dinlenik Nabız",
        val: rhrVal != null ? `${rhrVal} bpm` : "--",
        sub: diff != null ? `Baz ${baseRhr} (${diff > 0 ? `+${diff}` : diff})` : `Baz ${baseRhr}`,
        color: rhrVal != null && rhrVal <= baseRhr + 2 ? "#00e5a3" : "#f59e0b",
      },
      {
        label: "7G Ortalama",
        val: rhr7 != null ? `${Math.round(Number(rhr7))} bpm` : "--",
        sub: `Uyarı ≥${s.rhr_warn_threshold ?? 51} bpm`,
        color: "#38bdf8",
      },
      {
        label: "Günlük Min–Maks",
        val: latest.min_hr != null && latest.max_hr != null ? `${latest.min_hr}–${latest.max_hr}` : "--",
        sub: "bpm aralık",
        color: "#f43f5e",
      },
    ]);
  }

  setActiveChipGroup("data-hr-mode", state.hrChartMode);
  if (state.hrChartMode === "rhr14") {
    const last14 = [...state.biometrics].slice(0, 14).reverse();
    const vals = last14.map((d) => d.rhr).filter((v) => v != null);
    const bounds = computePaddedBounds([...vals, baseRhr], 3, 35, 90);
    renderLabChart("intradayHr", "intradayHrChart", {
      type: "line",
      data: {
        labels: last14.map((d) => String(d.log_date || "").slice(5)),
        datasets: [
          {
            label: "Dinlenik Nabız (bpm)",
            data: last14.map((d) => d.rhr),
            borderColor: "#f43f5e",
            backgroundColor: "rgba(244,63,94,0.12)",
            fill: true,
            tension: 0.35,
            pointRadius: 2.5,
            spanGaps: true,
          },
          {
            label: `Kişisel Baz (${baseRhr})`,
            data: last14.map(() => baseRhr),
            borderColor: "#38bdf8",
            borderDash: [4, 4],
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { ...bounds, ticks: { color: "#f43f5e" }, grid: { color: "rgba(148,163,184,0.08)" } },
        },
      },
    });
  } else {
    const hrPts = Array.isArray(te.intraday_hr) ? te.intraday_hr : [];
    renderLabChart("intradayHr", "intradayHrChart", {
      type: "line",
      data: {
        labels: hrPts.map((p) => p.time),
        datasets: [
          {
            label: "Nabız (atım/dk)",
            data: hrPts.map((p) => p.hr),
            borderColor: "#f43f5e",
            backgroundColor: "rgba(244,63,94,0.12)",
            fill: true,
            tension: 0.3,
            pointRadius: 1,
          },
        ],
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
}

window.switchBbChartMode = function (mode, btn) {
  state.bbChartMode = mode === "trend14" ? "trend14" : "intraday";
  setActiveChipGroup("data-bb-mode", state.bbChartMode);
  if (state.biometrics[0]) renderLabBbSlide(state.biometrics[0]);
  requestAnimationFrame(syncLabCarouselHeight);
};

function renderLabBbSlide(latest) {
  const te = latest?.raw_payload?.telemetry_extra || {};
  const bbCur = te.bb_current ?? latest.body_battery_min ?? "--";
  const bbCurNum = Number(bbCur);
  const hasBbCur = bbCur !== "--" && Number.isFinite(bbCurNum);
  const bbStatusTr = hasBbCur ? (bbCurNum >= 50 ? "İyi seviye" : bbCurNum >= 25 ? "Orta seviye" : "Düşük — dinlen") : "--";
  const bbColor = hasBbCur ? (bbCurNum >= 50 ? "#00e5a3" : bbCurNum >= 25 ? "#f59e0b" : "#ef4444") : "var(--text)";

  const bbBadge = document.getElementById("bb-current-badge");
  if (bbBadge) {
    bbBadge.textContent = `🔋 Kalan: ${bbCur}/100 · Uyku +${te.bb_during_sleep ?? "--"}`;
    bbBadge.className = `badge ${hasBbCur && bbCurNum >= 40 ? "badge-ok" : hasBbCur && bbCurNum >= 20 ? "badge-warn" : "badge-crit"}`;
  }

  setActiveChipGroup("data-bb-mode", state.bbChartMode);
  if (state.bbChartMode === "trend14") {
    const last14 = [...state.biometrics].slice(0, 14).reverse();
    renderLabChart("bbIntraday", "bbIntradayChart", {
      type: "bar",
      data: {
        labels: last14.map((d) => String(d.log_date || "").slice(5)),
        datasets: [
          {
            type: "line",
            label: "Sabah Maks",
            order: 0,
            data: last14.map((d) => (d.body_battery_max != null ? Number(d.body_battery_max) : null)),
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56,189,248,0.16)",
            fill: true,
            tension: 0.35,
            pointRadius: 2.5,
            spanGaps: true,
          },
          {
            type: "bar",
            label: "Gece Şarjı (+)",
            order: 1,
            data: last14.map((d) => (d.body_battery_charged != null ? Number(d.body_battery_charged) : null)),
            backgroundColor: "rgba(0,229,163,0.42)",
            borderColor: "#00e5a3",
            borderWidth: 1,
            borderRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { min: 0, max: 100, ticks: { color: "#38bdf8" }, grid: { color: "rgba(148,163,184,0.08)" } },
        },
      },
    });
  } else {
    const bbSeries = Array.isArray(te.bb_series) ? te.bb_series : [];
    renderLabChart("bbIntraday", "bbIntradayChart", {
      type: "line",
      data: {
        labels: bbSeries.map((p) => p.time),
        datasets: [
          {
            label: "Body Battery",
            data: bbSeries.map((p) => p.bb),
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56,189,248,0.16)",
            fill: true,
            tension: 0.35,
            pointRadius: 1.5,
          },
        ],
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
  const bbFbTr = translateBbFeedback(te.bb_feedback);

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
      <div><strong style="color:var(--text);">⚡ Neye Harcandı?</strong> <span class="card-sub" style="color:var(--text-secondary);">${escapeHtml(drainSummaryText)}${bbFbTr ? ` · ${escapeHtml(bbFbTr)}` : ""}</span></div>
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

  const bbListEl = document.getElementById("bb-events-list");
  if (bbListEl) bbListEl.innerHTML = bbSummaryHtml + bbEventsHtml;
}

window.switchStressChartMode = function (mode, btn) {
  const te = state.biometrics[0]?.raw_payload?.telemetry_extra || {};
  const hasIntraday = Array.isArray(te.stress_series) && te.stress_series.length > 0;
  state.stressChartMode =
    mode === "breakdown7" ? "breakdown7" : mode === "intraday" && hasIntraday ? "intraday" : "trend14";
  setActiveChipGroup("data-stress-mode", state.stressChartMode);
  if (state.biometrics[0]) renderLabStressSlide(state.biometrics[0]);
  requestAnimationFrame(syncLabCarouselHeight);
};

function renderLabStressSlide(latest) {
  const te = latest?.raw_payload?.telemetry_extra || {};
  const sbData = te.stress_breakdown || {};
  const qualTr = translateStressQualifier(sbData.qualifier);
  const stressVal = latest.stress_avg != null ? Number(latest.stress_avg) : null;
  const sleepStress = latest.sleep_stress_avg != null ? Number(latest.sleep_stress_avg) : null;
  const stressStatus = stressVal == null ? "Veri yok" : stressVal <= 25 ? "Düşük" : stressVal <= 50 ? "Orta" : "Yüksek";

  const badge = document.getElementById("lab-stress-badge");
  if (badge) {
    badge.textContent = stressVal != null ? `${stressVal}/100 · ${qualTr}` : qualTr;
    badge.className = `badge mono ${stressVal == null ? "badge-info" : stressVal <= 35 ? "badge-ok" : stressVal <= 55 ? "badge-warn" : "badge-crit"}`;
  }

  const kpisEl = document.getElementById("lab-stress-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = renderMiniKpiBoxes([
      {
        label: "Günlük Ort",
        val: stressVal != null ? `${stressVal} / 100` : "--",
        sub: stressStatus,
        color: "#f59e0b",
      },
      {
        label: "Gece Uyku Stresi",
        val: sleepStress != null ? `${Math.round(sleepStress)} puan` : "--",
        sub: `Normal <${state.settings?.sleep_stress_threshold ?? 23}`,
        color: "#38bdf8",
      },
      {
        label: "Maks Stres",
        val: sbData.max_stress != null ? `${sbData.max_stress}` : "--",
        sub: qualTr,
        color: "#ef4444",
      },
    ]);
  }

  const maxLbl = document.getElementById("stress-max-label");
  if (maxLbl) maxLbl.textContent = `Maks Stres: ${sbData.max_stress ?? "--"} · ${qualTr}`;

  const rPct = sbData.rest_pct || 0;
  const lPct = sbData.low_pct || 0;
  const mPct = sbData.med_pct || 0;
  const hPct = sbData.high_pct || 0;
  const aPct = sbData.activity_pct || 0;
  const barEl = document.getElementById("stress-breakdown-bar");
  if (barEl) {
    barEl.innerHTML = `
      <div style="width:${rPct}%; background:#38bdf8;" title="Dinlenme"></div>
      <div style="width:${lPct}%; background:#00e5a3;" title="Düşük Stres"></div>
      <div style="width:${mPct}%; background:#f59e0b;" title="Orta Stres"></div>
      <div style="width:${hPct}%; background:#ef4444;" title="Yüksek Stres"></div>
      <div style="width:${aPct}%; background:#a78bfa;" title="Aktivite"></div>
    `;
  }
  const legEl = document.getElementById("stress-breakdown-legend");
  if (legEl) {
    legEl.innerHTML = `
      <span>🔵 Dinlenme %${Math.round(rPct)}</span>
      <span>🟢 Düşük %${Math.round(lPct)}</span>
      <span>🟠 Orta %${Math.round(mPct)}</span>
      <span>🔴 Yüksek %${Math.round(hPct)}</span>
      <span>🟣 Aktivite %${Math.round(aPct)}</span>
    `;
  }

  const stressSeries = Array.isArray(te.stress_series) ? te.stress_series : [];
  const intradayBtn = document.getElementById("btn-stress-intraday");
  if (intradayBtn) intradayBtn.classList.toggle("hidden", stressSeries.length === 0);
  if (stressSeries.length === 0 && state.stressChartMode === "intraday") {
    state.stressChartMode = "trend14";
  }
  setActiveChipGroup("data-stress-mode", state.stressChartMode);

  if (state.stressChartMode === "intraday" && stressSeries.length > 0) {
    renderLabChart("labStress", "labStressChart", {
      type: "line",
      data: {
        labels: stressSeries.map((p) => p.time),
        datasets: [
          {
            label: "Canlı Stres",
            data: stressSeries.map((p) => p.stress),
            borderColor: "#f59e0b",
            backgroundColor: "rgba(245,158,11,0.16)",
            fill: true,
            tension: 0.3,
            pointRadius: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 9 }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { min: 0, max: 100, ticks: { color: "#f59e0b" }, grid: { color: "rgba(148,163,184,0.08)" } },
        },
      },
    });
  } else if (state.stressChartMode === "breakdown7") {
    const sbDays = [...state.biometrics]
      .filter((d) => d?.raw_payload?.telemetry_extra?.stress_breakdown?.rest_pct != null)
      .slice(0, 7)
      .reverse();
    const chartDays = sbDays.length ? sbDays : [...state.biometrics].slice(0, 7).reverse();
    renderLabChart("labStress", "labStressChart", {
      type: "bar",
      data: {
        labels: chartDays.map((d) => String(d.log_date || "").slice(5)),
        datasets: [
          {
            label: "Dinlenme %",
            data: chartDays.map((d) => Math.round(Number(d?.raw_payload?.telemetry_extra?.stress_breakdown?.rest_pct ?? 0))),
            backgroundColor: "rgba(56,189,248,0.82)",
          },
          {
            label: "Düşük %",
            data: chartDays.map((d) => Math.round(Number(d?.raw_payload?.telemetry_extra?.stress_breakdown?.low_pct ?? 0))),
            backgroundColor: "rgba(0,229,163,0.82)",
          },
          {
            label: "Orta %",
            data: chartDays.map((d) => Math.round(Number(d?.raw_payload?.telemetry_extra?.stress_breakdown?.med_pct ?? 0))),
            backgroundColor: "rgba(245,158,11,0.85)",
          },
          {
            label: "Yüksek %",
            data: chartDays.map((d) => Math.round(Number(d?.raw_payload?.telemetry_extra?.stress_breakdown?.high_pct ?? 0))),
            backgroundColor: "rgba(239,68,68,0.85)",
          },
          {
            label: "Aktivite %",
            data: chartDays.map((d) => Math.round(Number(d?.raw_payload?.telemetry_extra?.stress_breakdown?.activity_pct ?? 0))),
            backgroundColor: "rgba(167,139,250,0.85)",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 10 } } },
        scales: {
          x: { stacked: true, ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { stacked: true, min: 0, max: 100, ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } },
        },
      },
    });
  } else {
    const last14 = [...state.biometrics].slice(0, 14).reverse();
    renderLabChart("labStress", "labStressChart", {
      type: "line",
      data: {
        labels: last14.map((d) => String(d.log_date || "").slice(5)),
        datasets: [
          {
            label: "Günlük Ort Stres",
            data: last14.map((d) => (d.stress_avg != null ? Number(d.stress_avg) : null)),
            borderColor: "#f59e0b",
            backgroundColor: "rgba(245,158,11,0.14)",
            fill: true,
            tension: 0.35,
            pointRadius: 2.5,
            spanGaps: true,
          },
          {
            label: "Gece Uyku Stresi",
            data: last14.map((d) => (d.sleep_stress_avg != null ? Number(d.sleep_stress_avg) : null)),
            borderColor: "#38bdf8",
            tension: 0.35,
            pointRadius: 2,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { min: 0, max: 100, ticks: { color: "#f59e0b" }, grid: { color: "rgba(148,163,184,0.08)" } },
        },
      },
    });
  }
}

function renderLabVo2Slide(latest) {
  const allBio = state.biometrics.length ? state.biometrics : [latest];
  const vo2Rec = allBio.find((r) => r && r.vo2_max != null) || latest;
  const vo2Val = vo2Rec?.vo2_max != null ? Number(vo2Rec.vo2_max) : null;
  const vo2Status = vo2Val == null ? "Veri yok" : vo2Val >= 52 ? "Üstün" : vo2Val >= 47 ? "Mükemmel" : vo2Val >= 42 ? "İyi" : vo2Val >= 35 ? "Orta" : "Zayıf";

  const badge = document.getElementById("lab-vo2-badge");
  if (badge) {
    badge.textContent = vo2Val != null ? `${String(vo2Val).replace(".", ",")} · ${vo2Status}` : "--";
    badge.className = `badge mono ${vo2Val == null ? "badge-info" : vo2Val >= 42 ? "badge-ok" : "badge-warn"}`;
  }

  const vo2Bands = [
    { label: "Zayıf", min: 25, max: 35, color: "#ef4444" },
    { label: "Orta", min: 35, max: 42, color: "#f59e0b" },
    { label: "İyi", min: 42, max: 47, color: "#00e5a3" },
    { label: "Mükemmel", min: 47, max: 52, color: "#38bdf8" },
    { label: "Üstün", min: 52, max: 62, color: "#a78bfa" },
  ];
  let nextText = "";
  if (vo2Val != null) {
    const nextBand = vo2Bands.find((b) => vo2Val < b.max && b.max < 62);
    if (nextBand) {
      const targetBand = vo2Bands[vo2Bands.indexOf(nextBand) + 1];
      if (targetBand) {
        const diff = (targetBand.min - vo2Val).toFixed(1).replace(".", ",");
        nextText = `${targetBand.label} (${String(targetBand.min).replace(".", ",")}) seviyesine +${diff} puan kaldı.`;
      }
    } else {
      nextText = "En üst aerobik kapasite katmanındasın.";
    }
  }

  const scaleEl = document.getElementById("lab-vo2-scale");
  if (scaleEl) {
    scaleEl.innerHTML = renderSegmentedScale({
      title: "Yaş Grubu Aerobik Kapasite Skalası",
      currentLabel: vo2Val != null ? `${String(vo2Val).replace(".", ",")} ml/kg/dk · ${vo2Status}` : "--",
      bands: vo2Bands,
      value: vo2Val,
      nextTargetText: nextText,
    });
  }

  const cardioActs = (state.activities || []).filter(
    (a) => Number(a.distance_meters || 0) > 500 && Number(a.duration_seconds || 0) > 300 && Number(a.avg_hr || 0) > 50
  );
  const lastEf = cardioActs[0]
    ? (Number(cardioActs[0].distance_meters) / (Number(cardioActs[0].duration_seconds) / 60)) / Number(cardioActs[0].avg_hr)
    : null;

  const kpisEl = document.getElementById("lab-vo2-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = renderMiniKpiBoxes([
      {
        label: "Güncel VO₂",
        val: vo2Val != null ? String(vo2Val).replace(".", ",") : "--",
        sub: vo2Status,
        color: "#00e5a3",
      },
      {
        label: "Son Güncelleme",
        val: vo2Rec?.log_date ? fmtDateDmy(vo2Rec.log_date).slice(0, 5) : "--",
        sub: "Garmin MaxMet",
        color: "#38bdf8",
      },
      {
        label: "Aerobik Verimlilik",
        val: lastEf != null ? lastEf.toFixed(2) : "--",
        sub: cardioActs[0] ? cardioActs[0].activity_name : "Kardiyo bekleniyor",
        color: "#a78bfa",
      },
    ]);
  }

  const last30 = [...state.biometrics].slice(0, 30).reverse();
  const vo2Bounds = computePaddedBounds(last30.map((d) => d.vo2_max), 2, 20, 75);
  renderLabChart("labVo2", "labVo2Chart", {
    type: "line",
    data: {
      labels: last30.map((d) => String(d.log_date || "").slice(5)),
      datasets: [
        {
          label: "VO₂ Maks",
          data: last30.map((d) => (d.vo2_max != null ? Number(d.vo2_max) : null)),
          borderColor: "#10b981",
          backgroundColor: "rgba(16,185,129,0.14)",
          fill: true,
          tension: 0.3,
          pointRadius: 2.5,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
        y: { ...vo2Bounds, ticks: { color: "#10b981" }, grid: { color: "rgba(148,163,184,0.08)" } },
      },
    },
  });
}

function renderLabEnduranceSlide(latest) {
  const allBio = state.biometrics.length ? state.biometrics : [latest];
  const endRec = allBio.find((r) => r && r.endurance_score != null) || latest;
  const endDetail =
    endRec?.raw_payload?.telemetry_extra?.endurance_detail ||
    latest?.raw_payload?.telemetry_extra?.endurance_detail ||
    null;
  const endVal = endRec?.endurance_score != null ? Number(endRec.endurance_score) : null;
  const limInt = Number(endDetail?.limits?.intermediate ?? 5100);
  const limTr = Number(endDetail?.limits?.trained ?? 5800);
  const limWell = Number(endDetail?.limits?.well_trained ?? 6600);
  const limSup = Number(endDetail?.limits?.superior ?? 7500);
  const validLimits = limInt < limTr && limTr < limWell && limWell < limSup;
  const t1 = validLimits ? limInt : 5100;
  const t2 = validLimits ? limTr : 5800;
  const t3 = validLimits ? limWell : 6600;
  const t4 = validLimits ? limSup : 7500;

  const endTier =
    endVal == null
      ? "Veri yok"
      : endVal >= t4
        ? "Elit"
        : endVal >= t3
          ? "Üstün"
          : endVal >= t2
            ? "İyi"
            : endVal >= t1
              ? "Ara"
              : "Başlangıç";

  const badge = document.getElementById("lab-endurance-badge");
  if (badge) {
    badge.textContent = endVal != null ? `${endVal.toLocaleString("tr-TR")} · ${endTier}` : "--";
    badge.className = `badge mono ${endVal == null ? "badge-info" : endVal >= t2 ? "badge-ok" : "badge-warn"}`;
  }

  const endBands = [
    { label: "Başlangıç", min: Math.max(2000, t1 - 1600), max: t1, color: "#94a3b8" },
    { label: "Ara", min: t1, max: t2, color: "#38bdf8" },
    { label: "İyi", min: t2, max: t3, color: "#f97316" },
    { label: "Üstün", min: t3, max: t4, color: "#00e5a3" },
    { label: "Elit", min: t4, max: t4 + 1300, color: "#a78bfa" },
  ];
  let nextText = "";
  if (endVal != null) {
    const idx = endBands.findIndex((b) => endVal < b.max);
    if (idx >= 0 && idx < endBands.length - 1) {
      const nextB = endBands[idx + 1];
      nextText = `${nextB.label} (${nextB.min.toLocaleString("tr-TR")}) seviyesine +${(nextB.min - endVal).toLocaleString("tr-TR")} puan kaldı.`;
    } else {
      nextText = "En yüksek dayanıklılık katmanındasın.";
    }
  }

  const scaleEl = document.getElementById("lab-endurance-scale");
  if (scaleEl) {
    scaleEl.innerHTML = renderSegmentedScale({
      title: "Garmin Dayanıklılık Katmanı",
      currentLabel: endVal != null ? `${endVal.toLocaleString("tr-TR")} · ${endTier}` : "--",
      bands: endBands,
      value: endVal,
      nextTargetText: nextText,
    });
  }

  const refMs = latest?.log_date ? new Date(`${latest.log_date}T23:59:59Z`).getTime() : Date.now();
  const acts14 = (state.activities || []).filter((a) => {
    const t = new Date(a.start_time_local).getTime();
    return Number.isFinite(t) && (refMs - t) / 86400000 <= 14;
  });
  const dist14Km = acts14.reduce((s, a) => s + Number(a.distance_meters || 0) / 1000, 0);
  const dur14Min = Math.round(acts14.reduce((s, a) => s + Number(a.duration_seconds || 0) / 60, 0));
  const teVals = acts14.map((a) => a.aerobic_te).filter((v) => v != null && Number(v) > 0).map(Number);
  const avgTe = teVals.length ? teVals.reduce((a, b) => a + b, 0) / teVals.length : null;

  const kpisEl = document.getElementById("lab-endurance-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = renderMiniKpiBoxes([
      {
        label: "Dayanıklılık",
        val: endVal != null ? endVal.toLocaleString("tr-TR") : "--",
        sub: endRec?.log_date ? `${endTier} · ${fmtDateDmy(endRec.log_date).slice(0, 5)}` : endTier,
        color: "#f97316",
      },
      {
        label: "14G Mesafe",
        val: `${dist14Km.toFixed(1).replace(".", ",")} km`,
        sub: `${acts14.length} seans · ${dur14Min} dk`,
        color: "#38bdf8",
      },
      {
        label: "Ort Aerobik TE",
        val: avgTe != null ? avgTe.toFixed(1) : "--",
        sub: "Son 14 gün seansları",
        color: "#00e5a3",
      },
    ]);
  }

  const contribEl = document.getElementById("lab-endurance-contributors");
  if (contribEl) {
    let contribList = Array.isArray(endDetail?.contributors) && endDetail.contributors.length > 0 ? endDetail.contributors : null;
    let contribNote = "Garmin Endurance Score katkıları";

    if (!contribList && Array.isArray(state.activities) && state.activities.length > 0) {
      const actsWindow = state.activities.filter((a) => {
        const t = new Date(a.start_time_local).getTime();
        return Number.isFinite(t) && (refMs - t) / 86400000 <= 30;
      });
      const pool = actsWindow.length ? actsWindow : state.activities;
      const typeLabels = {
        walking: "Yürüyüş",
        running: "Koşu",
        strength_training: "Kuvvet / Dambıl",
        cycling: "Bisiklet",
        hiking: "Doğa Yürüyüşü",
      };
      const buckets = {};
      let totalW = 0;
      for (const a of pool) {
        const lbl = typeLabels[a.activity_type] || "Diğer Aktiviteler";
        const w = Number(a.training_load) > 0 ? Number(a.training_load) : Math.max(10, Math.round(Number(a.duration_seconds || 0) / 60));
        buckets[lbl] = (buckets[lbl] || 0) + w;
        totalW += w;
      }
      if (totalW > 0) {
        contribList = Object.entries(buckets)
          .map(([label, w]) => ({ label, pct: Number(((w / totalW) * 100).toFixed(1)) }))
          .sort((a, b) => b.pct - a.pct);
        contribNote = `Son ${actsWindow.length ? "30 günlük" : "kayıtlı"} antrenman yükü dağılımı`;
      }
    }

    if (contribList?.length) {
      const barColors = ["#f97316", "#38bdf8", "#00e5a3", "#a78bfa", "#f59e0b"];
      contribEl.innerHTML = `
        <div class="lab-contrib-box">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <strong style="font-size:12.5px;">Aktivite Katkı Dağılımı</strong>
            <span class="card-sub">${escapeHtml(contribNote)}</span>
          </div>
          ${contribList
            .map((c, idx) => {
              const col = barColors[idx % barColors.length];
              return `
              <div>
                <div class="bar-row-head"><span>${escapeHtml(c.label)}</span><strong class="mono" style="color:${col};">%${Math.round(Number(c.pct))}</strong></div>
                <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.max(4, Math.round(Number(c.pct))))}%; background:${col};"></div></div>
              </div>`;
            })
            .join("")}
        </div>`;
    } else {
      contribEl.innerHTML = "";
    }
  }

  const last30 = [...state.biometrics].slice(0, 30).reverse();
  const endBounds = computePaddedBounds(last30.map((d) => d.endurance_score), 250, 2500, 10000);
  renderLabChart("labEndurance", "labEnduranceChart", {
    type: "line",
    data: {
      labels: last30.map((d) => String(d.log_date || "").slice(5)),
      datasets: [
        {
          label: "Dayanıklılık Puanı",
          data: last30.map((d) => d.endurance_score),
          borderColor: "#f97316",
          backgroundColor: "rgba(249,115,22,0.14)",
          fill: true,
          tension: 0.3,
          pointRadius: 2.5,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
        y: { ...endBounds, ticks: { color: "#f97316" }, grid: { color: "rgba(148,163,184,0.08)" } },
      },
    },
  });
}

function renderLabFitAgeSlide(latest) {
  const s = state.settings || {};
  const allBio = state.biometrics.length ? state.biometrics : [latest];
  const fitRec =
    allBio.find(
      (r) =>
        r &&
        (r.raw_payload?.telemetry_extra?.fitness_age_detail?.current_age != null ||
          r.raw_payload?.telemetry_extra?.fitness_age?.current_age != null ||
          r.fitness_age != null)
    ) || latest;
  const fa = fitRec?.raw_payload?.telemetry_extra?.fitness_age_detail || fitRec?.raw_payload?.telemetry_extra?.fitness_age || {};
  const fitAge = fa.current_age ?? fitRec?.fitness_age ?? null;
  const chronoAge = Number(fa.chronological_age ?? new Date().getFullYear() - Number(s.birth_year || 1988));
  const achAge = fa.achievable_age ?? null;
  const diff = fitAge != null ? Number((chronoAge - Number(fitAge)).toFixed(1)) : null;

  const badge = document.getElementById("lab-fitage-badge");
  if (badge) {
    badge.textContent =
      diff != null
        ? `${String(Math.abs(diff)).replace(".", ",")} yaş ${diff >= 0 ? "genç" : "yüksek"}`
        : "--";
    badge.className = `badge mono ${diff != null && diff >= 0 ? "badge-ok" : "badge-warn"}`;
  }

  const trioEl = document.getElementById("lab-fitage-trio");
  if (trioEl) {
    trioEl.innerHTML = renderMiniKpiBoxes([
      {
        label: "Gerçek Yaş",
        val: `${chronoAge} Yaş`,
        sub: `Doğum ${s.birth_year ?? 1988}`,
        color: "var(--text)",
      },
      {
        label: "Sağlık Yaşı",
        val: fitAge != null ? `${String(fitAge).replace(".", ",")} Yaş` : "--",
        sub: diff != null ? `${diff >= 0 ? "-" : "+"}${String(Math.abs(diff)).replace(".", ",")} yaş fark` : "--",
        color: "#00e5a3",
      },
      {
        label: "Ulaşılabilir Hedef",
        val: achAge != null ? `${String(achAge).replace(".", ",")} Yaş` : "--",
        sub: achAge != null && fitAge != null ? `${String((Number(fitAge) - Number(achAge)).toFixed(1)).replace(".", ",")} yaş potansiyel` : "Hedef yaş",
        color: "#a78bfa",
      },
    ]);
  }

  const vigDays = fa.vigorous_days != null ? Number(fa.vigorous_days) : null;
  const vigTarget = Number(fa.vigorous_target ?? 3);
  const vigPct = vigDays != null ? Math.min(100, Math.round((vigDays / Math.max(1, vigTarget)) * 100)) : 0;
  const vigDaysPot = fa.components?.vigorousDaysAvg?.potential_age;

  const vigMin = fa.vigorous_minutes != null ? Number(fa.vigorous_minutes) : null;
  const vigMinTarget = Number(fa.vigorous_minutes_target ?? 75);
  const vigMinPot = fa.components?.vigorousMinutesAvg?.potential_age;
  const weeklyIntMin = state.biometrics
    .slice(0, 7)
    .reduce((sum, d) => sum + Number(d.moderate_intensity_minutes || 0) + 2 * Number(d.vigorous_intensity_minutes || 0), 0);
  const activeMinVal = vigMin != null ? vigMin : weeklyIntMin;
  const activeMinTarget = vigMin != null ? vigMinTarget : 150;
  const activeMinPct = Math.min(100, Math.round((activeMinVal / Math.max(1, activeMinTarget)) * 100));

  const rhrVal = fa.rhr_value != null ? Number(fa.rhr_value) : (latest.rhr != null ? Number(latest.rhr) : null);
  const baseRhr = Number(s.base_rhr ?? 46);
  const rhrTarget = fa.rhr_target != null ? Number(fa.rhr_target) : baseRhr;
  const rhrPct = rhrVal != null ? Math.max(25, Math.min(100, Math.round(((70 - rhrVal) / Math.max(10, 70 - rhrTarget)) * 100))) : 50;

  const factorRows = [
    {
      label: "Yoğun Gün Ortalaması",
      right: `${vigDays != null ? String(vigDays).replace(".", ",") : "--"} / ${vigTarget} gün${vigDaysPot != null ? ` · Potansiyel ${String(Number(vigDaysPot).toFixed(1)).replace(".", ",")}` : ""}`,
      pct: vigPct,
      color: "#a78bfa",
    },
    {
      label: vigMin != null ? "Haftalık Yoğun Dakika" : "7G Yoğunluk Dakikası",
      right: `${activeMinVal} / ${activeMinTarget} dk${vigMinPot != null ? ` · Potansiyel ${String(Number(vigMinPot).toFixed(1)).replace(".", ",")}` : ""}`,
      pct: activeMinPct,
      color: "#38bdf8",
    },
    {
      label: "Dinlenik Nabız Katkısı",
      right: `${rhrVal != null ? `${rhrVal} bpm` : "--"} (${fa.rhr_target != null ? `Hedef ≤${rhrTarget}` : `Baz ${baseRhr}`})`,
      pct: rhrPct,
      color: "#00e5a3",
    },
  ];

  if (fa.body_fat_value != null) {
    const bfVal = Number(fa.body_fat_value);
    const bfTarget = fa.body_fat_target != null ? Number(fa.body_fat_target) : 17;
    const bfPot = fa.components?.bodyFat?.potential_age;
    const bfPct = Math.max(18, Math.min(100, Math.round((bfTarget / Math.max(5, bfVal)) * 100)));
    factorRows.push({
      label: "Vücut Yağ Oranı",
      right: `%${String(bfVal).replace(".", ",")} → Hedef %${String(bfTarget).replace(".", ",")}${bfPot != null ? ` · Potansiyel ${String(Number(bfPot).toFixed(1)).replace(".", ",")}` : ""}`,
      pct: bfPct,
      color: "#f59e0b",
    });
  }

  if (fa.bmi_value != null) {
    const bmiVal = Number(fa.bmi_value);
    const bmiTarget = fa.bmi_target != null ? Number(fa.bmi_target) : 22.5;
    const bmiPot = fa.components?.bmi?.potential_age;
    const bmiPct = Math.max(20, Math.min(100, Math.round((bmiTarget / Math.max(12, bmiVal)) * 100)));
    factorRows.push({
      label: "Vücut Kitle İndeksi (VKİ)",
      right: `${String(bmiVal).replace(".", ",")} → Hedef ${String(bmiTarget).replace(".", ",")}${bmiPot != null ? ` · Potansiyel ${String(Number(bmiPot).toFixed(1)).replace(".", ",")}` : ""}`,
      pct: bmiPct,
      color: "#06b6d4",
    });
  }

  const factorsEl = document.getElementById("lab-fitage-factors");
  if (factorsEl) {
    factorsEl.innerHTML = factorRows
      .map(
        (fr) => `
      <div>
        <div class="bar-row-head"><span>${escapeHtml(fr.label)}</span><strong class="mono" style="color:${fr.color};">${escapeHtml(fr.right)}</strong></div>
        <div class="bar-track"><div class="bar-fill" style="width:${fr.pct}%; background:${fr.color};"></div></div>
      </div>`
      )
      .join("");
  }

  const last30 = [...state.biometrics].slice(0, 30).reverse();
  const ageSeries = last30.map((d) => {
    const raw =
      d.raw_payload?.telemetry_extra?.fitness_age_detail?.current_age ??
      d.raw_payload?.telemetry_extra?.fitness_age?.current_age ??
      d.fitness_age ??
      null;
    return raw != null ? Number(raw) : null;
  });
  const ageBounds = computePaddedBounds(ageSeries, 1.5, 18, 80);
  renderLabChart("labFitAge", "labFitAgeChart", {
    type: "line",
    data: {
      labels: last30.map((d) => String(d.log_date || "").slice(5)),
      datasets: [
        {
          label: "Sağlık Yaşı",
          data: ageSeries,
          borderColor: "#0d9488",
          backgroundColor: "rgba(13,148,136,0.16)",
          fill: true,
          tension: 0.3,
          pointRadius: 2.5,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
        y: { ...ageBounds, ticks: { color: "#2dd4bf" }, grid: { color: "rgba(148,163,184,0.08)" } },
      },
    },
  });
}

function renderLabRespSpo2Slide(latest) {
  const s = state.settings || {};
  const te = latest?.raw_payload?.telemetry_extra || {};
  const wr = te.waking_respiration || {};
  const spo2Avg = latest.spo2_avg != null ? Number(latest.spo2_avg) : null;
  const spo2Min = latest.spo2_min != null ? Number(latest.spo2_min) : null;
  const spo2Warn = Number(s.spo2_warn_threshold ?? 91);
  const respWarn = Number(s.resp_warn_threshold ?? 18);
  const spo2Status = spo2Avg == null ? "Veri yok" : spo2Avg >= 94 ? "Normal" : spo2Avg > spo2Warn ? "İyi" : "Dikkat";

  const badge = document.getElementById("lab-resp-badge");
  if (badge) {
    badge.textContent = spo2Avg != null ? `SpO₂ %${Math.round(spo2Avg)} · ${spo2Status}` : spo2Status;
    badge.className = `badge mono ${spo2Status === "Normal" || spo2Status === "İyi" ? "badge-ok" : "badge-warn"}`;
  }

  const kpisEl = document.getElementById("lab-resp-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = renderMiniKpiBoxes([
      {
        label: "Ort SpO₂ (Oksijen)",
        val: spo2Avg != null ? `%${Math.round(spo2Avg)}` : "--",
        sub: spo2Status,
        color: "#06b6d4",
      },
      {
        label: "En Düşük SpO₂",
        val: spo2Min != null ? `%${Math.round(spo2Min)}` : "--",
        sub: `Eşik >%${spo2Warn}`,
        color: spo2Min != null && spo2Min <= spo2Warn ? "#f59e0b" : "#38bdf8",
      },
      {
        label: "Gece Solunumu",
        val: latest.sleep_respiration_avg != null ? `${String(latest.sleep_respiration_avg).replace(".", ",")} dk⁻¹` : "--",
        sub: `Normal <${respWarn} nefes/dk`,
        color: "#00e5a3",
      },
      {
        label: "Gündüz Solunumu",
        val: wr.avg != null ? `${wr.avg} nefes/dk` : "--",
        sub: wr.min != null && wr.max != null ? `Aralık ${wr.min}–${wr.max} · Son ${wr.latest ?? "--"}` : "Gün içi ölçüm",
        color: "#a78bfa",
      },
    ]);
  }

  const tempEl = document.getElementById("lab-resp-temp-note");
  if (tempEl) {
    const tempRec = (state.biometrics || []).find((d) => d && d.skin_temp_deviation != null);
    if (tempRec) {
      const tv = Number(tempRec.skin_temp_deviation);
      const isToday = tempRec.log_date === latest.log_date;
      tempEl.textContent = `🌡️ Gece Deri Sıcaklığı Sapması: ${tv >= 0 ? "+" : ""}${String(tv).replace(".", ",")}°C${isToday ? "" : ` (${fmtDateDmy(tempRec.log_date).slice(0, 5)} kaydı)`}`;
      tempEl.classList.remove("hidden");
    } else {
      tempEl.textContent = "";
      tempEl.classList.add("hidden");
    }
  }

  const last14 = [...state.biometrics].slice(0, 14).reverse();
  renderLabChart("labRespSpo2", "labRespSpo2Chart", {
    type: "line",
    data: {
      labels: last14.map((d) => String(d.log_date || "").slice(5)),
      datasets: [
        {
          label: "Ort SpO₂ (%)",
          data: last14.map((d) => (d.spo2_avg != null ? Number(d.spo2_avg) : null)),
          borderColor: "#06b6d4",
          backgroundColor: "rgba(6,182,212,0.14)",
          fill: true,
          tension: 0.35,
          pointRadius: 2.5,
          spanGaps: true,
          yAxisID: "y",
        },
        {
          label: "Gece Solunum (dk⁻¹)",
          data: last14.map((d) => (d.sleep_respiration_avg != null ? Number(d.sleep_respiration_avg) : null)),
          borderColor: "#a78bfa",
          tension: 0.35,
          pointRadius: 2.5,
          spanGaps: true,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
        y: { position: "left", min: 85, max: 100, ticks: { color: "#06b6d4" }, grid: { color: "rgba(148,163,184,0.08)" } },
        y1: { position: "right", min: 11, max: 22, ticks: { color: "#a78bfa" }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

window.switchMoveDay = function (dayMode, btn) {
  const hasPrev = Boolean(state.biometrics[1]);
  state.moveDayMode = dayMode === "yesterday" && hasPrev ? "yesterday" : "today";
  setActiveChipGroup("data-move-day", state.moveDayMode);
  if (state.biometrics[0]) renderLabMoveSlide(state.biometrics[0]);
  requestAnimationFrame(syncLabCarouselHeight);
};

window.switchMoveChartMode = function (mode, btn) {
  state.moveChartMode = mode === "floors" ? "floors" : "steps";
  setActiveChipGroup("data-move-chart", state.moveChartMode);
  if (state.biometrics[0]) renderLabMoveSlide(state.biometrics[0]);
  requestAnimationFrame(syncLabCarouselHeight);
};

function renderLabMoveSlide(latest) {
  const todayRec = latest;
  const yestRec = state.biometrics[1] || null;
  if (!yestRec && state.moveDayMode === "yesterday") {
    state.moveDayMode = "today";
  }
  const yestChip = document.querySelector('#lab-carousel-section [data-move-day="yesterday"]');
  if (yestChip) {
    yestChip.disabled = !yestRec;
    yestChip.style.opacity = yestRec ? "" : "0.45";
  }
  setActiveChipGroup("data-move-day", state.moveDayMode);

  const rec = state.moveDayMode === "yesterday" && yestRec ? yestRec : todayRec;
  const te = rec?.raw_payload?.telemetry_extra || {};
  const met = te.metabolism || {};
  const fl = te.floors || {};

  const steps = Number(rec.steps || 0);
  const stepPct = Math.round((steps / 10000) * 100);
  const remSteps = Math.max(0, 10000 - steps);
  const activeKcal = rec.active_kilocalories ?? met.active_kcal ?? null;
  const totalKcal =
    met.total_kcal ??
    (activeKcal != null ? Number(activeKcal) + Number(met.bmr_kcal || 1680) : null);

  const badge = document.getElementById("lab-move-badge");
  if (badge) {
    badge.textContent = `${rec.log_date ? fmtDateDmy(rec.log_date).slice(0, 5) : "--"} · %${stepPct}`;
    badge.className = `badge mono ${stepPct >= 100 ? "badge-ok" : "badge-info"}`;
  }

  const cmpEl = document.getElementById("lab-move-compare");
  if (cmpEl) {
    if (yestRec) {
      const tSteps = Number(todayRec.steps || 0);
      const ySteps = Number(yestRec.steps || 0);
      const vsPct = ySteps > 0 ? Math.round((tSteps / ySteps) * 100) : null;
      const tMet = todayRec.raw_payload?.telemetry_extra?.metabolism || {};
      const yMet = yestRec.raw_payload?.telemetry_extra?.metabolism || {};
      const tKcal = tMet.total_kcal ?? "--";
      const yKcal = yMet.total_kcal ?? "--";
      cmpEl.innerHTML = `
        <span>⚡ Bugün: <strong class="mono">${tSteps.toLocaleString("tr-TR")}</strong> adım (${tKcal} kcal)</span>
        <span>👣 Dün: <strong class="mono">${ySteps.toLocaleString("tr-TR")}</strong> adım (${yKcal} kcal)${vsPct != null ? ` · Dünün <strong class="mono">%${vsPct}</strong>'i` : ""}</span>`;
    } else {
      cmpEl.innerHTML = `<span>⚡ Bugün: <strong class="mono">${steps.toLocaleString("tr-TR")}</strong> adım</span><span>Dünün kapanış verisi henüz yok.</span>`;
    }
  }

  const activeMin = Number(met.active_min || 0);
  const highActMin = Number(met.highly_active_min || 0);
  const sedH = met.sedentary_min != null ? (Number(met.sedentary_min) / 60).toFixed(1).replace(".", ",") : "--";
  const modInt = Number(rec.moderate_intensity_minutes || 0);
  const vigInt = Number(rec.vigorous_intensity_minutes || 0);

  const kpisEl = document.getElementById("lab-move-kpis");
  if (kpisEl) {
    kpisEl.innerHTML = renderMiniKpiBoxes([
      {
        label: "Adım & 10.000 Hedef",
        val: `${steps.toLocaleString("tr-TR")} (%${stepPct})`,
        sub: remSteps > 0 ? `Hedefe ${remSteps.toLocaleString("tr-TR")} adım kaldı` : "Günlük hedef tamamlandı!",
        color: "#38bdf8",
      },
      {
        label: "Toplam Metabolizma",
        val: totalKcal != null ? `${Number(totalKcal).toLocaleString("tr-TR")} kcal` : "--",
        sub: `BMR ${met.bmr_kcal ?? "--"} + Aktif ${activeKcal ?? "--"} kcal`,
        color: "#00e5a3",
      },
      {
        label: "Çıkılan Kat & Rakım",
        val: `${fl.ascended ?? 0} / ${fl.goal ?? 10} Kat`,
        sub: `İniş ${fl.descended ?? 0} · +${fl.meters_up ?? 0} m · Rakım ${fl.altitude_m ?? "--"} m`,
        color: "#a78bfa",
      },
      {
        label: "Hareket & Yoğunluk",
        val: `${activeMin} dk aktif`,
        sub: `Çok yoğun ${highActMin} dk · Sedanter ${sedH} sa · Yoğunluk ${modInt}+${vigInt} dk`,
        color: "#f59e0b",
      },
    ]);
  }

  const last14 = [...state.biometrics].slice(0, 14).reverse();
  const selDate = rec.log_date;
  setActiveChipGroup("data-move-chart", state.moveChartMode);

  if (state.moveChartMode === "floors") {
    renderLabChart("labMove", "labMoveChart", {
      type: "bar",
      data: {
        labels: last14.map((d) => String(d.log_date || "").slice(5)),
        datasets: [
          {
            type: "line",
            label: "Tırmanış (m)",
            order: 0,
            data: last14.map((d) => {
              const m = d.raw_payload?.telemetry_extra?.floors?.meters_up ?? null;
              return m != null ? Number(m) : null;
            }),
            borderColor: "#38bdf8",
            tension: 0.35,
            pointRadius: 2.5,
            spanGaps: true,
            yAxisID: "y1",
          },
          {
            type: "bar",
            label: "Çıkılan Kat",
            order: 1,
            data: last14.map((d) => {
              const asc = d.raw_payload?.telemetry_extra?.floors?.ascended ?? null;
              return asc != null ? Number(asc) : null;
            }),
            backgroundColor: last14.map((d) => (d.log_date === selDate ? "rgba(0,229,163,0.75)" : "rgba(167,139,250,0.52)")),
            borderColor: last14.map((d) => (d.log_date === selDate ? "#00e5a3" : "#a78bfa")),
            borderWidth: 1,
            borderRadius: 5,
            yAxisID: "y",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { position: "left", beginAtZero: true, ticks: { color: "#a78bfa" }, grid: { color: "rgba(148,163,184,0.08)" } },
          y1: { position: "right", beginAtZero: true, ticks: { color: "#38bdf8" }, grid: { drawOnChartArea: false } },
        },
      },
    });
  } else {
    renderLabChart("labMove", "labMoveChart", {
      type: "bar",
      data: {
        labels: last14.map((d) => String(d.log_date || "").slice(5)),
        datasets: [
          {
            type: "line",
            label: "Aktif kcal",
            order: 0,
            data: last14.map((d) => {
              const k = d.active_kilocalories ?? d.raw_payload?.telemetry_extra?.metabolism?.active_kcal ?? null;
              return k != null ? Number(k) : null;
            }),
            borderColor: "#f97316",
            tension: 0.35,
            pointRadius: 2.5,
            spanGaps: true,
            yAxisID: "y1",
          },
          {
            type: "bar",
            label: "Adım",
            order: 1,
            data: last14.map((d) => (d.steps != null ? Number(d.steps) : null)),
            backgroundColor: last14.map((d) => (d.log_date === selDate ? "rgba(0,229,163,0.75)" : "rgba(56,189,248,0.4)")),
            borderColor: last14.map((d) => (d.log_date === selDate ? "#00e5a3" : "#38bdf8")),
            borderWidth: 1,
            borderRadius: 5,
            yAxisID: "y",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 8 }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { position: "left", ticks: { color: "#38bdf8" }, grid: { color: "rgba(148,163,184,0.08)" } },
          y1: { position: "right", ticks: { color: "#f97316" }, grid: { drawOnChartArea: false } },
        },
      },
    });
  }
}

function renderDeepTelemetry(latest) {
  if (!latest) return;
  renderLabSleepSlide(latest);
  renderLabHrvSlide(latest);
  renderLabHrSlide(latest);
  renderLabBbSlide(latest);
  renderLabStressSlide(latest);
  renderLabVo2Slide(latest);
  renderLabEnduranceSlide(latest);
  renderLabFitAgeSlide(latest);
  renderLabRespSpo2Slide(latest);
  renderLabMoveSlide(latest);
}

window.switchTrendMode = function (mode, btn) {
  state.trendMode = mode;
  if (btn?.parentElement) {
    btn.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
  }
  renderTrendChart();
  requestAnimationFrame(syncLabCarouselHeight);
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
  const validModes = ["daily", "weekly", "monthly", "yearly"];
  state.ceoMode = validModes.includes(mode) ? mode : "daily";
  for (const m of validModes) {
    document.getElementById(`ceo-btn-${m}`)?.classList.toggle("active", state.ceoMode === m);
    document.getElementById(`ceo-${m}-view`)?.classList.toggle("hidden", state.ceoMode !== m);
  }
  if (state.ceoMode === "daily") {
    try {
      renderCustomCompareChart();
    } catch (_) {}
  } else if (state.ceoMode === "weekly") {
    renderWeekly();
  } else if (state.ceoMode === "monthly") {
    renderMonthly();
  } else if (state.ceoMode === "yearly") {
    renderYearly();
  }
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

const TR_MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const TR_MONTHS_LONG = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function fmtMonthLabel(ymKey, longForm = false) {
  const [y, m] = String(ymKey || "").split("-");
  const idx = Number(m) - 1;
  const list = longForm ? TR_MONTHS_LONG : TR_MONTHS_SHORT;
  return idx >= 0 && idx < 12 ? `${list[idx]} ${longForm ? y : y.slice(2)}` : ymKey;
}

function renderYearly() {
  const periodEl = document.getElementById("yearly-period-label");
  const sampleBadge = document.getElementById("yearly-sample-badge");
  const summaryEl = document.getElementById("yearly-exec-summary");
  const kpiGrid = document.getElementById("yearly-kpi-grid");
  const monthsGrid = document.getElementById("yearly-months-grid");
  const chartCanvas = document.getElementById("yearlyTrendChart");
  if (!kpiGrid || !monthsGrid) return;

  const days = Array.isArray(state.biometrics) ? state.biometrics : [];
  const acts = Array.isArray(state.activities) ? state.activities : [];

  if (!days.length) {
    if (sampleBadge) sampleBadge.textContent = "0 gün";
    if (periodEl) periodEl.textContent = "Henüz yıllık veri bulunmuyor";
    if (summaryEl) summaryEl.textContent = "Yıllık performans ve biyometri bilançosu için günlük veriler biriktikçe burada ay-ay özetler ve grafikler oluşur.";
    kpiGrid.innerHTML = "";
    monthsGrid.innerHTML = "";
    if (state.charts.yearlyTrend) {
      state.charts.yearlyTrend.destroy();
      state.charts.yearlyTrend = null;
    }
    return;
  }

  const byMonth = new Map();
  const ensureBucket = (ym) => {
    if (!byMonth.has(ym)) {
      byMonth.set(ym, { days: [], acts: [] });
    }
    return byMonth.get(ym);
  };

  for (const d of days) {
    const ym = String(d.log_date || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) ensureBucket(ym).days.push(d);
  }
  for (const a of acts) {
    const ym = String(a.start_time_local || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym) && byMonth.has(ym)) ensureBucket(ym).acts.push(a);
  }

  const monthKeysAsc = [...byMonth.keys()].sort();
  const monthlyStats = monthKeysAsc.map((ym) => {
    const b = byMonth.get(ym);
    const totalSteps = b.days.reduce((acc, d) => acc + Number(d.steps || 0), 0);
    const totalActiveKcal = b.days.reduce((acc, d) => acc + Number(d.active_kilocalories || 0), 0);
    const avgReadiness = computeAvg(b.days.map((d) => d.readiness_score));
    const avgSleepScore = computeAvg(b.days.map((d) => d.sleep_score));
    const avgSleepHrs = computeAvg(b.days.map((d) => (d.sleep_seconds != null ? Number(d.sleep_seconds) / 3600 : null)));
    const avgHrv = computeAvg(b.days.map((d) => d.hrv_nightly_avg));
    const avgRhr = computeAvg(b.days.map((d) => d.rhr));
    const vo2s = b.days.map((d) => Number(d.vo2_max)).filter((v) => Number.isFinite(v) && v > 0);
    const peakVo2 = vo2s.length ? Math.max(...vo2s) : null;
    return {
      ym,
      daysCount: b.days.length,
      workoutsCount: b.acts.length,
      totalSteps,
      totalActiveKcal,
      avgReadiness,
      avgSleepScore,
      avgSleepHrs,
      avgHrv,
      avgRhr,
      peakVo2,
    };
  });

  const totalDays = days.length;
  const totalSteps = days.reduce((acc, d) => acc + Number(d.steps || 0), 0);
  const estStepKm = Math.round(totalSteps * 0.00075);
  const totalWorkouts = acts.length;
  const totalActiveKcal = days.reduce((acc, d) => acc + Number(d.active_kilocalories || 0), 0);
  const avgReadiness = computeAvg(days.map((d) => d.readiness_score));
  const avgSleepScore = computeAvg(days.map((d) => d.sleep_score));
  const avgSleepHrs = computeAvg(days.map((d) => (d.sleep_seconds != null ? Number(d.sleep_seconds) / 3600 : null)));
  const avgHrv = computeAvg(days.map((d) => d.hrv_nightly_avg));
  const avgRhr = computeAvg(days.map((d) => d.rhr));
  const allVo2 = days.map((d) => Number(d.vo2_max)).filter((v) => Number.isFinite(v) && v > 0);
  const peakVo2 = allVo2.length ? Math.max(...allVo2) : null;

  const bestMonth = monthlyStats
    .filter((m) => m.avgReadiness != null)
    .sort((a, b) => Number(b.avgReadiness) - Number(a.avgReadiness))[0] || null;

  const oldestDate = String(days[days.length - 1]?.log_date || "");
  const newestDate = String(days[0]?.log_date || "");
  if (sampleBadge) sampleBadge.textContent = `${totalDays} gün · ${monthKeysAsc.length} ay`;
  if (periodEl) periodEl.textContent = `Dönem: ${oldestDate} → ${newestDate} (Son 12 ay)`;
  if (summaryEl) {
    const bestPart = bestMonth ? ` En zinde ay: ${fmtMonthLabel(bestMonth.ym, true)} (Ort. ${Math.round(bestMonth.avgReadiness)}/100).` : "";
    summaryEl.textContent = `${monthKeysAsc.length} aylık dönemde ${totalDays} gün ve ${totalWorkouts} antrenman kaydedildi. Günlük ortalama ${(Math.round(totalSteps / Math.max(1, totalDays))).toLocaleString("tr-TR")} adım ile toplam ~${estStepKm.toLocaleString("tr-TR")} km mesafe kat edildi.${bestPart}`;
  }

  const cards = [
    {
      lbl: "Ort. Hazırlık Skoru",
      val: avgReadiness != null ? `${Math.round(avgReadiness)}/100` : "--",
      sub: bestMonth ? `En iyi: ${fmtMonthLabel(bestMonth.ym)} (${Math.round(bestMonth.avgReadiness)})` : `${totalDays} kayıtlı gün`,
      color: "var(--emerald)",
    },
    {
      lbl: "Ort. Uyku & Süre",
      val: avgSleepScore != null ? `${Math.round(avgSleepScore)}/100` : "--",
      sub: avgSleepHrs != null ? `Ort. ${avgSleepHrs.toFixed(1).replace(".", ",")} sa/gece` : "Uyku süresi",
      color: "var(--purple)",
    },
    {
      lbl: "Gece HRV & RHR",
      val: avgHrv != null ? `${Math.round(avgHrv)} ms` : "--",
      sub: `Dinlenik Nabız: ${avgRhr != null ? `${Math.round(avgRhr)} bpm` : "--"}`,
      color: "var(--cyan)",
    },
    {
      lbl: "Toplam Adım & Mesafe",
      val: totalSteps.toLocaleString("tr-TR"),
      sub: `~${estStepKm.toLocaleString("tr-TR")} km · ${(Math.round(totalSteps / Math.max(1, totalDays))).toLocaleString("tr-TR")}/gün`,
      color: "var(--text)",
    },
    {
      lbl: "Antrenman & Efor",
      val: `${totalWorkouts} seans`,
      sub: `${totalActiveKcal.toLocaleString("tr-TR")} aktif kcal`,
      color: "var(--amber)",
    },
    {
      lbl: "Zirve VO2 Max",
      val: peakVo2 != null ? peakVo2.toFixed(1).replace(".", ",") : "--",
      sub: `${monthKeysAsc.length} aylık kapsama`,
      color: "var(--emerald)",
    },
  ];

  kpiGrid.innerHTML = cards
    .map(
      (c) => `
    <div class="corridor-card">
      <div class="corridor-top"><span class="card-sub">${escapeHtml(c.lbl)}</span></div>
      <div class="corridor-val mono" style="color:${c.color};">${escapeHtml(c.val)}</div>
      <div class="card-sub">${escapeHtml(c.sub)}</div>
    </div>`
    )
    .join("");

  const monthlyDesc = [...monthlyStats].reverse();
  monthsGrid.innerHTML = monthlyDesc
    .map((m) => {
      const rVal = m.avgReadiness != null ? Math.round(m.avgReadiness) : null;
      const rCls = rVal == null ? "badge-info" : rVal >= 75 ? "badge-ok" : rVal >= 58 ? "badge-warn" : "badge-crit";
      return `
      <div class="yearly-month-card">
        <div class="yearly-month-head">
          <strong>${escapeHtml(fmtMonthLabel(m.ym, true))}</strong>
          <span class="badge ${rCls} mono">${rVal != null ? `Hazırlık ${rVal}` : `${m.daysCount} gün`}</span>
        </div>
        <div class="yearly-month-metrics">
          <span>😴 Uyku <strong>${m.avgSleepScore != null ? Math.round(m.avgSleepScore) : "--"}</strong> (${m.avgSleepHrs != null ? `${m.avgSleepHrs.toFixed(1).replace(".", ",")}sa` : "--"})</span>
          <span>💓 HRV <strong>${m.avgHrv != null ? Math.round(m.avgHrv) : "--"}</strong> · ❤️ <strong>${m.avgRhr != null ? Math.round(m.avgRhr) : "--"}</strong></span>
          <span>👣 ${m.totalSteps.toLocaleString("tr-TR")} adım · 🏋️ ${m.workoutsCount} antrenman</span>
        </div>
      </div>`;
    })
    .join("");

  if (chartCanvas && typeof Chart !== "undefined") {
    if (state.charts.yearlyTrend) {
      state.charts.yearlyTrend.destroy();
      state.charts.yearlyTrend = null;
    }
    const isSunny = document.documentElement.getAttribute("data-theme") === "weather_sunny";
    const tickColor = isSunny ? "#334155" : "#94a3b8";
    const gridColor = isSunny ? "rgba(15,23,42,0.10)" : "rgba(148,163,184,0.10)";
    const legColor = isSunny ? "#0b1220" : "#cbd5e1";

    state.charts.yearlyTrend = new Chart(chartCanvas, {
      type: "line",
      data: {
        labels: monthlyStats.map((m) => fmtMonthLabel(m.ym, false)),
        datasets: [
          {
            label: "Ort. Hazırlık",
            data: monthlyStats.map((m) => (m.avgReadiness != null ? Math.round(m.avgReadiness) : null)),
            borderColor: "#00e5a3",
            backgroundColor: "rgba(0,229,163,0.12)",
            fill: true,
            tension: 0.3,
            spanGaps: true,
            yAxisID: "y",
          },
          {
            label: "Ort. Uyku Puanı",
            data: monthlyStats.map((m) => (m.avgSleepScore != null ? Math.round(m.avgSleepScore) : null)),
            borderColor: "#a78bfa",
            tension: 0.3,
            spanGaps: true,
            yAxisID: "y",
          },
          {
            label: "Ort. HRV (ms)",
            data: monthlyStats.map((m) => (m.avgHrv != null ? Math.round(m.avgHrv) : null)),
            borderColor: "#38bdf8",
            tension: 0.3,
            spanGaps: true,
            yAxisID: "y1",
          },
          {
            label: "Ort. Nabız (bpm)",
            data: monthlyStats.map((m) => (m.avgRhr != null ? Math.round(m.avgRhr) : null)),
            borderColor: "#f59e0b",
            borderDash: [4, 4],
            tension: 0.3,
            spanGaps: true,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: legColor, boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: tickColor }, grid: { color: gridColor } },
          y: { position: "left", min: 30, max: 100, ticks: { color: tickColor }, grid: { color: gridColor } },
          y1: { position: "right", ticks: { color: tickColor }, grid: { drawOnChartArea: false } },
        },
      },
    });
  }
}

function renderNotifications() {
  const listEl = document.getElementById("notif-list");
  const badgeEl = document.getElementById("notif-unread-badge");
  const readAllBtn = document.getElementById("btn-notif-read-all");
  const clearAllBtn = document.getElementById("btn-notif-clear-all");
  const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rawList = Array.isArray(state.notifications) ? state.notifications : [];
  const list = rawList.filter((n) => !n.read_at || new Date(n.created_at).getTime() >= cutoffMs);
  const unread = list.filter((n) => !n.read_at).length;

  if (badgeEl) {
    badgeEl.textContent = String(unread);
    badgeEl.classList.toggle("hidden", unread === 0);
  }
  if (readAllBtn) readAllBtn.classList.toggle("hidden", unread === 0);
  if (clearAllBtn) clearAllBtn.classList.toggle("hidden", list.length === 0);
  if (!listEl) return;

  if (!list.length) {
    listEl.innerHTML = `<p class="card-sub">Bildirim kutun temiz. Yeni uyku raporu veya antrenman geldiğinde burada görünecek.</p>`;
    return;
  }

  listEl.innerHTML = list
    .map((n) => {
      const timeStr = fmtIstanbulDateTime(n.created_at);
      return `
      <div class="notif-item ${n.read_at ? "" : "unread"}" onclick="openNotificationItem('${escapeHtml(n.id)}')">
        <div class="notif-item-head">
          <strong class="notif-item-title">${escapeHtml(n.title)}</strong>
          <div class="notif-item-meta">
            <span class="card-sub mono" style="font-size:10px; white-space:nowrap;">${escapeHtml(timeStr)}</span>
            <button type="button" class="notif-del-btn" onclick="deleteNotificationItem(event, '${escapeHtml(n.id)}')" title="Bildirimi sil" aria-label="Bildirimi sil">×</button>
          </div>
        </div>
        <div class="card-sub" style="color:var(--text-secondary); line-height:1.4;">${escapeHtml(n.body)}</div>
      </div>`;
    })
    .join("");
}

window.toggleNotifDrawer = function () {
  document.getElementById("alerts-drawer")?.classList.add("hidden");
  const drawer = document.getElementById("notif-drawer");
  if (!drawer) return;
  drawer.classList.toggle("hidden");
};

window.toggleAlertsDrawer = function () {
  document.getElementById("notif-drawer")?.classList.add("hidden");
  const drawer = document.getElementById("alerts-drawer");
  if (!drawer) return;
  drawer.classList.toggle("hidden");
};

window.acknowledgeRedFlags = function () {
  if (state._activeAlertSig) {
    try {
      localStorage.setItem(ALERT_ACK_STORAGE_KEY, state._activeAlertSig);
    } catch (_) {}
  }
  document.getElementById("red-alert-banner")?.classList.add("hidden");
  document.getElementById("alerts-drawer")?.classList.add("hidden");
  document.getElementById("btn-alerts-toggle")?.classList.add("alerts-acked");
  document.getElementById("btn-alerts-drawer-ack")?.classList.add("hidden");
  const listEl = document.getElementById("alerts-drawer-list");
  if (listEl && !listEl.querySelector(".ack-note-done")) {
    const note = document.createElement("div");
    note.className = "card-sub ack-note-done";
    note.style.padding = "2px 4px";
    note.textContent = "✓ Bu uyarıları inceledin; gün içinde buradan tekrar bakabilirsin.";
    listEl.appendChild(note);
  }
  showToast("İkaz onaylandı — üstteki İkazlar menüsünden tekrar inceleyebilirsin.");
};

window.markAllNotifsRead = async function () {
  try {
    await apiCall({ action: "markNotificationsRead" });
    state.notifications = (state.notifications || []).map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
    renderNotifications();
  } catch (_) {}
};

window.deleteNotificationItem = async function (ev, id) {
  if (ev) ev.stopPropagation();
  if (!id || !state.auth?.userId) return;
  const prev = state.notifications || [];
  state.notifications = prev.filter((n) => String(n.id) !== String(id));
  renderNotifications();
  try {
    const { error } = await sb.from("notifications").delete().eq("id", id).eq("user_id", state.auth.userId);
    if (error) throw error;
  } catch (_) {
    state.notifications = prev;
    renderNotifications();
    showToast("Bildirim silinemedi, tekrar dene.");
  }
};

window.clearAllNotifications = async function () {
  if (!state.auth?.userId) return;
  const prev = state.notifications || [];
  if (!prev.length) return;
  state.notifications = [];
  renderNotifications();
  try {
    const { error } = await sb.from("notifications").delete().eq("user_id", state.auth.userId);
    if (error) throw error;
    showToast("Bildirimler temizlendi.");
  } catch (_) {
    state.notifications = prev;
    renderNotifications();
    showToast("Bildirimler temizlenemedi, tekrar dene.");
  }
};

window.refreshNotifications = async function () {
  if (!state.auth?.userId || !sb) return;
  try {
    const { data, error } = await sb
      .from("notifications")
      .select("*")
      .eq("user_id", state.auth.userId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (!error && Array.isArray(data)) {
      state.notifications = data;
      renderNotifications();
    }
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

  const isDailyReport = n.type === "MORNING_REPORT" || n.payload?.focus_card === "ai-daily-insight-card";
  const targetTab = isDailyReport
    ? "weekly"
    : n.payload?.tab || (n.type === "WORKOUT_REPORT" ? "workouts" : n.type === "WEEKLY_CEO" || n.type === "MONTHLY_CEO" ? "weekly" : "dashboard");
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
  } else if (isDailyReport || n.payload?.mode === "daily") {
    switchCeoMode("daily");
  }
  if (n.payload?.kind === "body_ai_commentary" && typeof window.openSavedBodyAiCommentary === "function") {
    window.openSavedBodyAiCommentary(n);
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
    if (btn) { btn.disabled = false; btn.classList.remove("is-loading"); }
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
  window.GarminBodyScale?.closeScaleModal?.();
  window.GarminBodyScale?.closeQuickAddSheet?.();
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
          const isDailyPush = data.type === "MORNING_REPORT" || data.type === "AI_INSIGHT" || data.focus_card === "ai-daily-insight-card";
          const targetTab = isDailyPush ? "weekly" : data.tab;
          if (targetTab) {
            document.querySelector(`[data-tab="${targetTab}"]`)?.click();
          }
          if (data.activity_id) {
            state.selectedActivityId = Number(data.activity_id);
            renderWorkouts();
          }
          if (data.mode === "monthly" || data.type === "MONTHLY_CEO") {
            switchCeoMode("monthly");
          } else if (data.mode === "weekly" || data.type === "WEEKLY_CEO") {
            switchCeoMode("weekly");
          } else if (isDailyPush || data.mode === "daily") {
            switchCeoMode("daily");
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
  const isReg = PUBLIC_REGISTRATION_ENABLED && mode === "register";
  const tabLogin = document.getElementById("auth-tab-login");
  const tabReg = document.getElementById("auth-tab-register");
  const formLogin = document.getElementById("auth-login-form");
  const formReg = document.getElementById("auth-register-form");
  const hintEl = document.getElementById("auth-default-hint");

  const tabsWrap = document.getElementById("auth-tabs");
  if (tabsWrap) tabsWrap.classList.toggle("hidden", !PUBLIC_REGISTRATION_ENABLED);
  if (tabsWrap) tabsWrap.classList.toggle("is-register", isReg);
  if (tabLogin) tabLogin.classList.toggle("active", !isReg);
  if (tabReg) tabReg.classList.toggle("active", isReg);
  if (formLogin) formLogin.classList.toggle("hidden", isReg);
  if (formReg) formReg.classList.toggle("hidden", !isReg);
  setAuthError("");

  if (hintEl) {
    hintEl.textContent = isReg ? "Yeni hesabını oluştur" : "Tekrar hoş geldin";
  }
};

window.toggleAuthPassword = function (inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  if (btn) {
    btn.textContent = show ? "Gizle" : "Göster";
    btn.setAttribute("aria-label", show ? "Şifreyi gizle" : "Şifreyi göster");
  }
};

function hideBootSplash() {
  const splash = document.getElementById("app-boot-splash");
  if (!splash || splash.classList.contains("hidden")) return;
  splash.classList.add("fade-out");
  setTimeout(() => splash.classList.add("hidden"), 260);
}

async function initAuthGate() {
  const overlay = document.getElementById("auth-gate-overlay");
  const bootSub = document.getElementById("boot-splash-text");
  const saved = getSavedAuthSession();

  if (saved?.access_token && saved?.refresh_token) {
    if (bootSub) bootSub.textContent = "Oturum doğrulanıyor...";
    try {
      await completeAuthSuccess(saved, Boolean(saved.remembered));
      hideBootSplash();
      return;
    } catch (_) {
      clearAuthSession();
    }
  }

  if (overlay) overlay.classList.remove("hidden");
  switchAuthMode("login");
  hideBootSplash();
}

window.submitAppLogin = async function (ev) {
  ev.preventDefault();
  const identifier = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const remember = Boolean(document.getElementById("login-remember")?.checked);
  const btn = document.getElementById("auth-login-btn");
  setAuthError("");
  if (btn) { btn.disabled = true; btn.classList.add("is-loading"); }

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
    if (btn) { btn.disabled = false; btn.classList.remove("is-loading"); }
  }
};

window.submitUserRegister = async function (ev) {
  ev.preventDefault();
  if (!PUBLIC_REGISTRATION_ENABLED) {
    setAuthError("Yeni hesap kayıtları geliştirme aşamasında geçici olarak kapalıdır.");
    return;
  }
  const display_name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const birthVal = document.getElementById("reg-birth").value;
  const default_city = document.getElementById("reg-city").value.trim() || "İstanbul";
  const remember = Boolean(document.getElementById("reg-remember")?.checked);
  const btn = document.getElementById("auth-reg-btn");
  setAuthError("");
  if (btn) { btn.disabled = true; btn.classList.add("is-loading"); }

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
    if (btn) { btn.disabled = false; btn.classList.remove("is-loading"); }
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
  clearRedAlertUi();
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
  window.GarminBodyScale?.reset();
  window.GarminMeds?.reset();
  window.GarminLabs?.reset();
  renderNotifications();
  renderAll();
  updateAuthUiLabels();

  const pwEl = document.getElementById("login-password");
  if (pwEl) pwEl.value = "";
  setAuthError("");
  initAuthGate();
};

function initPullToRefresh() {
  const ind = document.getElementById("ptr-indicator");
  if (!ind) return;

  let startX = 0;
  let startY = 0;
  let pulling = false;
  let ready = false;
  let reloading = false;

  const getScrollTop = () => window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

  const resetIndicator = () => {
    pulling = false;
    ready = false;
    ind.classList.remove("ptr-ready");
    if (!reloading) {
      ind.style.opacity = "0";
      ind.style.transform = "translate(-50%, -60px)";
      ind.textContent = "↓ Yenilemek için çek";
    }
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      if (reloading || e.touches.length !== 1 || getScrollTop() > 2) {
        pulling = false;
        return;
      }
      if (e.target.closest("#activity-map, .leaflet-container, .modal-backdrop.open, .bottom-sheet-backdrop.open, .bottom-sheet, #scale-review-modal, #notif-drawer, #alerts-drawer, .lab-carousel-track, .lab-carousel-nav, .hourly-strip, .table-wrap, input, textarea, select")) {
        pulling = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      pulling = true;
      ready = false;
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling || reloading || e.touches.length !== 1) return;
      if (getScrollTop() > 2) {
        resetIndicator();
        return;
      }
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 14 || dy <= Math.abs(dx) * 1.4) {
        if (dy < -10) resetIndicator();
        return;
      }

      const clamped = Math.min(80, Math.round(dy * 0.55));
      const opacity = Math.min(1, Number((dy / 65).toFixed(2)));
      ready = dy >= 72;
      ind.style.opacity = String(opacity);
      ind.style.transform = `translate(-50%, ${clamped - 24}px)`;
      ind.classList.toggle("ptr-ready", ready);
      ind.textContent = ready ? "↻ Bırak, yenilensin" : "↓ Yenilemek için çek";
    },
    { passive: true }
  );

  const onEnd = async () => {
    if (!pulling || reloading) return;
    const shouldRefresh = ready;
    if (!shouldRefresh) {
      resetIndicator();
      return;
    }

    reloading = true;
    pulling = false;
    ready = false;
    ind.classList.remove("ptr-ready");
    ind.classList.add("ptr-refreshing");
    ind.style.opacity = "1";
    ind.style.transform = "translate(-50%, 16px)";
    ind.textContent = "↻ Yenileniyor...";
    window.__GC_SW_REG?.update?.().catch(() => {});

    if (!state.auth?.authenticated) {
      setTimeout(() => window.location.reload(), 180);
      return;
    }

    try {
      await loadAllData();
      showToast("✓ Veriler güncellendi");
    } catch (_) {
      showToast("Yenileme tamamlanamadı.");
    } finally {
      reloading = false;
      ind.classList.remove("ptr-refreshing");
      resetIndicator();
    }
  };

  document.addEventListener("touchend", onEnd, { passive: true });
  document.addEventListener("touchcancel", onEnd, { passive: true });
}

function initCapacitorBackButton() {
  const capApp = window.Capacitor?.Plugins?.App;
  if (!capApp || typeof capApp.addListener !== "function") return;

  try {
    capApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        window.__GC_SW_REG?.update?.().catch(() => {});
      }
    });
  } catch (_) {}

  try {
    capApp.addListener("backButton", () => {
      const hasOpenModal =
        document.getElementById("workout-modal")?.classList.contains("open") ||
        document.getElementById("biometric-modal")?.classList.contains("open") ||
        document.getElementById("scale-review-modal")?.classList.contains("open") ||
        document.getElementById("quick-add-sheet")?.classList.contains("open");
      if (hasOpenModal) {
        window.closeModals?.();
        return;
      }

      const notifDrawer = document.getElementById("notif-drawer");
      if (notifDrawer && !notifDrawer.classList.contains("hidden")) {
        notifDrawer.classList.add("hidden");
        return;
      }

      const alertsDrawer = document.getElementById("alerts-drawer");
      if (alertsDrawer && !alertsDrawer.classList.contains("hidden")) {
        alertsDrawer.classList.add("hidden");
        return;
      }

      const authOverlay = document.getElementById("auth-gate-overlay");
      const onAuthGate = authOverlay && !authOverlay.classList.contains("hidden");
      const dashActive = document.getElementById("tab-dashboard")?.classList.contains("active");

      if (!onAuthGate && !dashActive) {
        document.querySelector('.nav-btn[data-tab="dashboard"]')?.click();
        return;
      }

      capApp.exitApp?.();
    });
  } catch (_) {}
}

function syncLabCarouselHeight() {
  const track = document.getElementById("lab-carousel-track");
  if (!track) return;
  const slides = track.querySelectorAll(".lab-carousel-slide");
  if (!slides.length) return;
  const idx = Math.max(0, Math.min(slides.length - 1, Number(state._labSlideIndex) || 0));
  const activeSlide = slides[idx];
  const card = activeSlide?.querySelector(".card") || activeSlide;
  if (!card) return;
  const h = Math.round(card.offsetHeight);
  if (h > 40) {
    track.style.height = `${h + 2}px`;
  }
}

function updateLabCarouselUi(idx) {
  const track = document.getElementById("lab-carousel-track");
  if (!track) return;
  const slides = track.querySelectorAll(".lab-carousel-slide");
  const total = slides.length;
  if (!total) return;

  const clamped = Math.max(0, Math.min(total - 1, Number(idx) || 0));
  state._labSlideIndex = clamped;

  const counter = document.getElementById("lab-carousel-counter");
  if (counter) counter.textContent = `${clamped + 1} / ${total}`;

  const nav = document.getElementById("lab-carousel-nav");
  if (nav) {
    nav.querySelectorAll(".lab-carousel-tab").forEach((btn, i) => {
      btn.classList.toggle("active", i === clamped);
    });
    const activeTab = nav.querySelector(`.lab-carousel-tab[data-slide="${clamped}"]`);
    if (activeTab) {
      const targetLeft = Math.max(0, activeTab.offsetLeft - (nav.clientWidth - activeTab.offsetWidth) / 2);
      nav.scrollTo({ left: targetLeft, behavior: "smooth" });
    }
  }

  document.querySelectorAll("#lab-carousel-dots .lab-carousel-dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === clamped);
  });

  syncLabCarouselHeight();
}

window.goToLabSlide = function (idx) {
  const track = document.getElementById("lab-carousel-track");
  if (!track) return;
  const slides = track.querySelectorAll(".lab-carousel-slide");
  if (!slides.length) return;
  const clamped = Math.max(0, Math.min(slides.length - 1, Number(idx) || 0));
  const left = Math.max(0, slides[clamped].offsetLeft - slides[0].offsetLeft);
  track.scrollTo({ left, behavior: "smooth" });
  updateLabCarouselUi(clamped);
  try {
    Object.values(state.charts || {}).forEach((c) => c?.resize?.());
  } catch (_) {}
};

window.moveLabCarousel = function (delta) {
  const track = document.getElementById("lab-carousel-track");
  if (!track) return;
  const total = track.querySelectorAll(".lab-carousel-slide").length;
  if (!total) return;
  const next = ((state._labSlideIndex || 0) + Number(delta || 0) + total) % total;
  window.goToLabSlide(next);
};

function initLabCarousel() {
  const track = document.getElementById("lab-carousel-track");
  if (!track || track.dataset.bound === "1") return;
  track.dataset.bound = "1";

  let rafId = 0;
  track.addEventListener(
    "scroll",
    () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const slides = track.querySelectorAll(".lab-carousel-slide");
        if (!slides.length) return;
        const baseOffset = slides[0].offsetLeft;
        const curScroll = track.scrollLeft;
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < slides.length; i++) {
          const dist = Math.abs(slides[i].offsetLeft - baseOffset - curScroll);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        if (bestIdx !== state._labSlideIndex) {
          updateLabCarouselUi(bestIdx);
        }
      });
    },
    { passive: true }
  );

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => syncLabCarouselHeight());
    track.querySelectorAll(".lab-carousel-slide > .card").forEach((card) => ro.observe(card));
  }
  window.addEventListener("resize", syncLabCarouselHeight);

  updateLabCarouselUi(0);
}

document.addEventListener("DOMContentLoaded", () => {
  window.GarminThemeEngine?.init();
  setupTabs();
  initLabCarousel();
  startIstanbulClock();
  initPullToRefresh();
  initCapacitorBackButton();
  initAuthGate();
  setTimeout(hideBootSplash, 10000);
  document.addEventListener("click", (e) => {
    const notifDrawer = document.getElementById("notif-drawer");
    if (notifDrawer && !notifDrawer.classList.contains("hidden") && !notifDrawer.parentElement?.contains(e.target)) {
      notifDrawer.classList.add("hidden");
    }
    const alertsDrawer = document.getElementById("alerts-drawer");
    if (alertsDrawer && !alertsDrawer.classList.contains("hidden") && !alertsDrawer.parentElement?.contains(e.target)) {
      alertsDrawer.classList.add("hidden");
    }
  });
  if ("serviceWorker" in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let swReloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || swReloading) return;
      swReloading = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((reg) => {
        window.__GC_SW_REG = reg;
        reg.update().catch(() => {});
      })
      .catch(() => {});
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        window.__GC_SW_REG?.update?.().catch(() => {});
      }
    });
  }
});
