const SUPABASE_URL = "https://htooqswstuuzslvrgxsx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5_1RDXV8unnW9ttkHEA_HQ_n8fJrt4I";
const ENGINE_URL = `${SUPABASE_URL}/functions/v1/garmin-coach-engine`;
const AUTH_STORAGE_KEY = "garmincoach_auth_session_v1";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const TAB_TITLES = {
  dashboard: "Sabah Biyometri & Akşam Hava Kokpiti",
  workouts: "Antrenman & Anatomik Kas Laboratuvarı",
  weekly: "Pazar Yönetici Kokpiti & Haftalık Strateji",
  archive: "30 Günlük Kayan Doküman & Sınırsız E-Tablo",
  settings: "Hibrit Konum & Otomasyon Komuta Merkezi",
};

const state = {
  settings: null,
  biometrics: [],
  activities: [],
  weekly: null,
  syncLogs: [],
  selectedActivityId: null,
  activityFilter: "ALL",
  trendMode: "hrv",
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
  liveWorkout: {
    setsCompleted: [],
    restLeft: 60,
    restTotal: 60,
    timerId: null,
    startedAt: null,
  },
  auth: {
    authenticated: false,
    username: "ali",
    token: null,
    isCustom: false,
  },
};

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
      if (titleEl && TAB_TITLES[target]) titleEl.textContent = TAB_TITLES[target];
      if (target === "workouts" && state.map) {
        setTimeout(() => state.map.invalidateSize(), 120);
      }
    });
  });
}

async function loadAllData() {
  const [settingsRes, bioRes, actRes, weekRes, logsRes] = await Promise.all([
    sb.from("athlete_settings").select("*").eq("id", 1).single(),
    sb.from("daily_biometrics").select("*").order("log_date", { ascending: false }).limit(60),
    sb.from("activities").select("*").order("start_time_local", { ascending: false }).limit(25),
    sb.from("weekly_strategies").select("*").order("week_start_date", { ascending: false }).limit(1),
    sb.from("sync_logs").select("*").order("created_at", { ascending: false }).limit(20),
  ]);

  if (settingsRes.data) state.settings = settingsRes.data;
  if (bioRes.data) state.biometrics = bioRes.data;
  if (actRes.data) {
    state.activities = actRes.data;
    if (!state.selectedActivityId && state.activities.length > 0) {
      state.selectedActivityId = state.activities[0].activity_id;
    }
  }
  if (weekRes.data?.[0]) state.weekly = weekRes.data[0];
  if (logsRes.data) state.syncLogs = logsRes.data;

  renderAll();

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
  renderArchive();
  renderSettings();
}

function renderTopbar() {
  const s = state.settings;
  const latest = state.biometrics[0];
  if (s) {
    const age = new Date().getFullYear() - (s.birth_year || 1988);
    document.getElementById("side-athlete-sub").textContent =
      `${s.birth_year} (${age} yaş) · ${s.base_rhr} atım/dk · ${s.base_hrv_min}–${s.base_hrv_max} denge`;
    const srcMap = {
      LIVE_GPS: "Canlı GPS",
      GARMIN_GPS: "Garmin GPS",
      GPS_ACTIVITY: "Garmin GPS",
      MANUAL: "Manuel",
      DEFAULT: "Varsayılan",
    };
    const srcLabel = srcMap[s.location_source] || "Varsayılan";
    document.getElementById("pill-location").textContent = `📍 ${s.active_city} (${srcLabel})`;
  }
  if (latest) {
    document.getElementById("pill-date").textContent = latest.log_date;
    document.getElementById("side-readiness-chip").textContent = `${latest.readiness_score ?? "--"}/100`;
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
  if (!latest) return;

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
  document.getElementById("weather-source-label").textContent = `${w.city || "Ümraniye"} · ${w.source || "MET Norway + Open-Meteo AQI"}`;

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
    <div class="coach-block" style="border-left-color:#38bdf8;"><h4>Kuvvet & Dambıl Planı (6–10 kg)</h4><p>${escapeHtml(brief.strength_prescription || "--")}</p></div>
    <div class="coach-block" style="border-left-color:#f59e0b;"><h4>17:00–21:00 Akşam Yürüyüşü</h4><p>${escapeHtml(brief.evening_walk_plan || "--")}</p></div>
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
  const rhr7 = computeAvg(recent7.map((d) => d.rhr));
  const hrvDelta = hrv7 != null && latest.hrv_nightly_avg != null ? (latest.hrv_nightly_avg - hrv7).toFixed(1) : null;
  const rhrDelta = rhr7 != null && latest.rhr != null ? (latest.rhr - rhr7).toFixed(1) : null;
  const flags = Array.isArray(latest.red_flags) ? latest.red_flags : [];

  const morningMsg = flags.length
    ? `⚠️ ${flags[0].message}. Hazırlık skoru ${latest.readiness_score ?? "--"}/100 olsa da yoğun dambıl yüklemesi yerine Z1–Z2 yürüyüş ve hidrasyon öncelikli.`
    : `Kalp Dengesi (HRV) ${latest.hrv_nightly_avg ?? "--"} puan (${hrvDelta != null ? (Number(hrvDelta) >= 0 ? "+" : "") + hrvDelta + " vs 7G" : "normal"}), Dinlenik Nabız ${latest.rhr ?? "--"} atım/dk (${rhrDelta != null ? (Number(rhrDelta) >= 0 ? "+" : "") + rhrDelta : "--"}). ${Number(latest.readiness_score) >= 80 ? "Yüksek yoğunluk veya 6 kg dambıl blokları için yeşil ışık." : "Kontrollü tempo önerilir."}`;

  const lastAct = state.activities[0];
  let workoutMsg = "Henüz kaydedilmiş antrenman bulunamadı.";
  let workoutBadge = "Beklemede";
  if (lastAct) {
    const waterMl = Number(lastAct.session_comparison?.water_ml || 260);
    const rehydMl = Math.round(waterMl * 1.5);
    const dist = Number(lastAct.distance_meters || 0);
    const durMin = Math.max(1, Number(lastAct.duration_seconds || 0) / 60);
    const ef = dist > 500 && lastAct.avg_hr ? ((dist / durMin) / Number(lastAct.avg_hr)).toFixed(2) : null;
    workoutBadge = String(lastAct.start_time_local || "").slice(5, 16).replace("T", " ");
    workoutMsg = `${lastAct.activity_name} (${fmtDuration(lastAct.duration_seconds)}, ${lastAct.avg_hr ?? "--"} atım/dk). Ter kaybı ${waterMl} ml → %150 rehidrasyon hedefi ${rehydMl} ml.${ef ? ` Aerobik Verimlilik (Ef): ${ef}.` : ` Yük: ${lastAct.training_load ?? "--"}.`}`;
  }

  const te = latest.raw_payload?.telemetry_extra || {};
  const w = latest.evening_weather || {};
  const bbCur = te.bb_current ?? latest.body_battery_min ?? "--";
  const highStressPct = Math.round((te.stress_breakdown?.high_pct || 0) + (te.stress_breakdown?.med_pct || 0));
  const targetSteps = 10000;
  const remSteps = Math.max(0, targetSteps - Number(latest.steps || 0));
  const nightMsg = `Güncel Body Battery ${bbCur}/100 · Gün içi orta/yüksek stres oranı %${highStressPct}. ${remSteps > 0 ? `10K adım için ${remSteps} adım kaldı (${w.temp_c ?? "--"}°C · ${w.dial_level || "SARI"}). ` : "Günlük adım hedefi tamamlandı! "}22:30 öncesi ekran kesip 7.5+ saat uykuya hazırlan.`;

  box.innerHTML = `
    <div class="intel-card" style="border-top:3px solid #00e5a3;">
      <div class="intel-card-head">
        <div class="intel-card-title">🌅 Sabah Uyanış Analizi</div>
        <span class="badge badge-ok mono">Hazırlık ${latest.readiness_score ?? "--"}</span>
      </div>
      <p class="card-sub" style="color:var(--text); line-height:1.5;">${escapeHtml(morningMsg)}</p>
      <div class="card-sub mono">BB Maks ${latest.body_battery_max ?? "--"} · Uyku ${latest.sleep_score ?? "--"}/100</div>
    </div>
    <div class="intel-card" style="border-top:3px solid #38bdf8;">
      <div class="intel-card-head">
        <div class="intel-card-title">🏃 Antrenman Sonrası İçgörü</div>
        <span class="badge badge-info mono">${escapeHtml(workoutBadge)}</span>
      </div>
      <p class="card-sub" style="color:var(--text); line-height:1.5;">${escapeHtml(workoutMsg)}</p>
      <div class="card-sub mono">TE ${lastAct?.aerobic_te ?? "-"} Aer / ${lastAct?.anaerobic_te ?? "-"} Ana · BB ${lastAct?.session_comparison?.bb_impact ?? "--"}</div>
    </div>
    <div class="intel-card" style="border-top:3px solid #a78bfa;">
      <div class="intel-card-head">
        <div class="intel-card-title">🌙 Gece & Uyku Öncesi</div>
        <span class="badge badge-warn mono">21:00+ Protokol</span>
      </div>
      <p class="card-sub" style="color:var(--text); line-height:1.5;">${escapeHtml(nightMsg)}</p>
      <div class="card-sub mono">Adım: ${(latest.steps || 0).toLocaleString("tr-TR")} · Uyku Stresi ${latest.sleep_stress_avg ?? "--"}</div>
    </div>
  `;
}

function renderCorrelationMatrix() {
  const grid = document.getElementById("correlation-matrix-grid");
  const badge = document.getElementById("corr-sample-badge");
  if (!grid || !state.biometrics.length) return;

  const rows = [...state.biometrics].reverse(); // oldest -> newest
  if (badge) badge.textContent = `${rows.length} gün örneklem`;

  const pairsList = [
    {
      title: "Uyku Stresi ↔ Gece HRV",
      desc: "Düşük uyku stresi daha yüksek toparlayıcı HRV ile eşleşiyor mu?",
      res: computePearsonCorr(rows.map((d) => [Number(d.sleep_stress_avg), Number(d.hrv_nightly_avg)])),
      goodSign: -1,
    },
    {
      title: "Body Battery Şarjı ↔ Sabah Hazırlık",
      desc: "Gece kazanılan BB enerjisi sabah skorunu ne kadar belirliyor?",
      res: computePearsonCorr(rows.map((d) => [Number(d.body_battery_charged ?? d.body_battery_max), Number(d.readiness_score)])),
      goodSign: 1,
    },
    {
      title: "Uyku Süresi (Saat) ↔ Sabah Hazırlık",
      desc: "Toplam uyku süresi hazırlık puanına nasıl yansıyor?",
      res: computePearsonCorr(rows.map((d) => [d.sleep_seconds != null ? d.sleep_seconds / 3600 : NaN, Number(d.readiness_score)])),
      goodSign: 1,
    },
    {
      title: "Günlük Adım ↔ Ertesi Gün RHR",
      desc: "Adım hacmi arttığında ertesi sabah dinlenik nabız nasıl tepki veriyor?",
      res: computePearsonCorr(
        rows.slice(0, -1).map((d, i) => [Number(d.steps), Number(rows[i + 1]?.rhr)])
      ),
      goodSign: -1,
    },
  ];

  grid.innerHTML = pairsList
    .map((item) => {
      const r = item.res.r;
      if (r == null) {
        return `<div class="corr-card"><div class="corr-head"><strong>${escapeHtml(item.title)}</strong><span class="mono">--</span></div><p class="card-sub">Yeterli veri yok (min 3 gün).</p></div>`;
      }
      const absR = Math.abs(r);
      const strength = absR >= 0.6 ? "Güçlü" : absR >= 0.35 ? "Orta" : "Zayıf";
      const dir = r >= 0 ? "Pozitif İlişki" : "Ters İlişki";
      const aligned = r * item.goodSign > 0;
      const color = absR < 0.2 ? "#94a3b8" : aligned ? "#00e5a3" : "#f59e0b";
      return `
        <div class="corr-card">
          <div class="corr-head">
            <strong style="font-size:13px;">${escapeHtml(item.title)}</strong>
            <span class="corr-r mono" style="color:${color};">r = ${r >= 0 ? "+" : ""}${r.toFixed(2)}</span>
          </div>
          <div class="bar-track" style="margin-bottom:6px;">
            <div class="bar-fill" style="width:${Math.round(absR * 100)}%; background:${color};"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11.5px; margin-bottom:4px;">
            <span style="color:${color}; font-weight:600;">${strength} · ${dir}</span>
            <span class="card-sub mono">n = ${item.res.n} gün</span>
          </div>
          <p class="card-sub">${escapeHtml(item.desc)}</p>
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
      <div class="kpi-value mono" style="color:#38bdf8;">${curEf != null ? curEf.toFixed(2) : "--"}</div>
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
      <div class="kpi-value mono" style="color:#a78bfa;">${count14} Seans</div>
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

function renderDeepTelemetry(latest) {
  const te = latest?.raw_payload?.telemetry_extra;
  if (!te) {
    document.getElementById("bb-events-list").innerHTML = `<p class="card-sub">Derin Garmin telemetrisi için sağ üstten "↻ Senkronize Et" butonuna basın.</p>`;
    document.getElementById("deep-telemetry-cards").innerHTML = "";
    return;
  }

  // 1. Body Battery Current & Events
  const bbCur = te.bb_current ?? latest.body_battery_min ?? "--";
  const bbBadge = document.getElementById("bb-current-badge");
  bbBadge.textContent = `🔋 Kalan: ${bbCur}/100 · Uyku +${te.bb_during_sleep ?? "--"}`;
  bbBadge.className = `badge ${Number(bbCur) >= 40 ? "badge-ok" : Number(bbCur) >= 20 ? "badge-warn" : "badge-crit"}`;

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
  document.getElementById("bb-events-list").innerHTML = events.length
    ? events
        .map((ev) => {
          const pos = ev.impact >= 0;
          const icon = ev.type === "SLEEP" ? "😴" : ev.type === "ACTIVITY" ? "🏃" : "⚡";
          const labelTr = ev.label === "STRESSFUL_PERIOD" ? "Yüksek Stres Periyodu" : ev.label === "SLEEP" ? "Gece Uykusu Şarjı" : ev.label;
          return `
          <div class="event-row">
            <div>${icon} <strong>${escapeHtml(labelTr)}</strong> <span class="card-sub mono">(${escapeHtml(ev.start_tr)} · ${ev.duration_min} dk)</span></div>
            <span class="badge ${pos ? "badge-ok" : "badge-warn"} mono">${pos ? "+" : ""}${ev.impact} BB</span>
          </div>`;
        })
        .join("")
    : `<p class="card-sub">Bugün için Body Battery olay kaydı yok.</p>`;

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
      <div class="mini-box-val mono" style="color:#00e5a3;">${met.total_kcal ?? "--"} kcal</div>
      <div class="card-sub">BMR ${met.bmr_kcal ?? "--"} + Aktif ${met.active_kcal ?? "--"} · Aktif ${met.active_min ?? 0} dk / Sedanter ${Math.round((met.sedentary_min || 0) / 60)} sa</div>
    </div>
    <div class="mini-box">
      <div class="mini-box-lbl">Çıkılan Kat & Rakım</div>
      <div class="mini-box-val mono" style="color:#38bdf8;">${fl.ascended ?? "--"} / ${fl.goal ?? 10} Kat</div>
      <div class="card-sub">Tırmanış +${fl.meters_up ?? "--"} m · Ortam Rakımı ${fl.altitude_m ?? "--"} m</div>
    </div>
    <div class="mini-box">
      <div class="mini-box-lbl">Fitness Yaşı Potansiyeli</div>
      <div class="mini-box-val mono" style="color:#a78bfa;">${fa.current_age ?? "--"} → ${fa.achievable_age ?? "--"} Yaş</div>
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
    return;
  }

  if (!filtered.some((a) => a.activity_id === state.selectedActivityId)) {
    state.selectedActivityId = filtered[0].activity_id;
  }

  listEl.innerHTML = filtered
    .map((a) => {
      const selected = a.activity_id === state.selectedActivityId;
      const km = a.distance_meters && Number(a.distance_meters) > 0 ? `${(Number(a.distance_meters) / 1000).toFixed(2)} km` : "Kuvvet";
      const icon = a.activity_type === "strength_training" ? "🏋️" : a.activity_type === "running" ? "🏃" : "🚶";
      return `
      <div class="activity-item ${selected ? "selected" : ""}" onclick="selectActivity(${a.activity_id})">
        <div>
          <div style="font-weight:700; font-size:13.5px;">${icon} ${escapeHtml(a.activity_name)}</div>
          <div class="card-sub">${escapeHtml(fmtIstanbulDateTime(a.start_time_local))} · ${escapeHtml(a.location_name || "Ümraniye")}</div>
        </div>
        <div style="text-align:right;">
          <div class="mono" style="font-weight:700; color:#00e5a3;">${escapeHtml(km)}</div>
          <div class="card-sub">${fmtDuration(a.duration_seconds)} · ${a.avg_hr ?? "--"} atım/dk</div>
        </div>
      </div>`;
    })
    .join("");

  const act = state.activities.find((a) => a.activity_id === state.selectedActivityId) || filtered[0];
  if (!act) return;

  document.getElementById("selected-act-title").textContent = act.activity_name;
  document.getElementById("selected-act-sub").textContent =
    `${fmtIstanbulDateTime(act.start_time_local)} · Aerobic TE ${act.aerobic_te ?? "-"} / Anaerobic ${act.anaerobic_te ?? "-"}`;

  const distKm = act.distance_meters && Number(act.distance_meters) > 0 ? `${(Number(act.distance_meters) / 1000).toFixed(2)} km` : "Evde Kuvvet";
  document.getElementById("selected-act-kpis").innerHTML = `
    <div class="mini-box"><div class="mini-box-lbl">Süre</div><div class="mini-box-val mono">${fmtDuration(act.duration_seconds)}</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Mesafe / Mod</div><div class="mini-box-val mono">${escapeHtml(distKm)}</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Ort / Maks Nabız</div><div class="mini-box-val mono">${act.avg_hr ?? "--"} / ${act.max_hr ?? "--"}</div></div>
    <div class="mini-box"><div class="mini-box-lbl">Kalori / Yük</div><div class="mini-box-val mono">${act.calories ?? "--"} · ${act.training_load ?? "--"}</div></div>
  `;

  const ai = act.ai_post_workout_analysis || {};
  const cmp = act.session_comparison || {};
  const waterInfo = cmp.water_ml ? `💧 Tahmini Ter/Su Kaybı: ${cmp.water_ml} ml` : "";
  const bbInfo = cmp.bb_impact != null ? ` · 🔋 Body Battery: ${cmp.bb_impact}` : "";
  document.getElementById("selected-act-ai").innerHTML = `
    <div class="coach-block"><h4>Seans Değerlendirmesi</h4><p>${escapeHtml(ai.summary || "--")} ${escapeHtml(waterInfo + bbInfo)}</p></div>
    <div class="coach-block" style="border-left-color:#38bdf8;"><h4>Geçmiş Seans Kıyaslaması</h4><p>${escapeHtml(cmp.verdict || ai.highlight || "--")}</p></div>
    <div class="coach-block" style="border-left-color:#a78bfa;"><h4>Sonraki Adım</h4><p>${escapeHtml(ai.next_step || "--")}</p></div>
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
                <td class="mono" style="color:#00e5a3;">${s.volume_kg} kg</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
  } else {
    setsCard.style.display = "none";
  }

  renderKochlerRotationAndPRs();
  renderLiveWorkoutUI();
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
      <div class="mini-box-val mono" style="color:#38bdf8;">${climbDelta != null ? `${climbDelta >= 0 ? "+" : ""}${Math.round(climbDelta)} atım/dk` : "--"}</div>
      <div class="card-sub">Yokuş ${avgClimb ? Math.round(avgClimb) : "--"} · Düz ${avgFlat ? Math.round(avgFlat) : "--"} atım/dk</div>
    </div>
    <div class="mini-box">
      <div class="mini-box-lbl">Tempo & Tırmanış</div>
      <div class="mini-box-val mono" style="color:#a78bfa;">${paceMinKm.toFixed(1)} dk/km</div>
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

window.loadKochlerPreset = function (rotId) {
  const rot = KOCHLER_ROTATIONS.find((r) => r.id === rotId);
  if (!rot) return;
  const sel = document.getElementById("live-ex-select");
  const wInp = document.getElementById("live-weight");
  const sInp = document.getElementById("live-sets");
  const rInp = document.getElementById("live-reps");
  if (sel) sel.value = rot.defaultEx;
  if (wInp) wInp.value = String(rot.weight);
  if (sInp) sInp.value = String(rot.sets);
  if (rInp) rInp.value = String(rot.reps);
  renderLiveWorkoutUI();
  showToast(`✓ ${rot.title} (${rot.weight} kg) Canlı Koç'a yüklendi!`);
};

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
          <button type="button" class="btn btn-sm ${r.id === bestRot.id ? "btn-primary" : ""}" style="width:100%;" onclick="loadKochlerPreset('${r.id}')">⚡ Yükle (${r.weight} kg)</button>
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
                <td class="mono" style="color:#00e5a3;">${p.bestVol > 0 ? `${p.bestVol} kg` : `${p.bestTotReps} tekrar`}</td>
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

  const rawWater = act.session_comparison?.water_ml;
  const isEstimated = !rawWater;
  const durMin = Math.round((Number(act.duration_seconds || 1800)) / 60);
  const sweatLossMl = Number(rawWater) || Math.round(durMin * ((Number(act.avg_hr || 105) >= 125) ? 9.5 : 6.8));
  const targetMl = Math.round(sweatLossMl * 1.5);
  const glasses = (targetMl / 250).toFixed(1);
  const first30Ml = Math.round(targetMl * 0.5);
  const next2hMl = targetMl - first30Ml;
  const needsElectrolyte = sweatLossMl > 400 || (Number(act.duration_seconds || 0) > 2700);

  const actDay = String(act.start_time_local || "").slice(0, 10);
  const refDay = state.biometrics[0]?.log_date || actDay;
  const sameDayActs = state.activities.filter((a) => String(a.start_time_local || "").slice(0, 10) === refDay);
  const dailyRehyd = sameDayActs.reduce((sum, a) => {
    const ml = Number(a.session_comparison?.water_ml) || Math.round((Number(a.duration_seconds || 0) / 60) * 7.2);
    return sum + Math.round(ml * 1.5);
  }, 0);

  if (dailyBadge) {
    dailyBadge.textContent = sameDayActs.length
      ? `Bugün (${refDay.slice(5)}): +${dailyRehyd} ml`
      : `Seans Hedefi: ${targetMl} ml`;
  }

  panel.innerHTML = `
    <div class="rehydration-grid">
      <div class="mini-box">
        <div class="mini-box-lbl">Net Ter Kaybı</div>
        <div class="mini-box-val mono" style="color:#38bdf8;">${sweatLossMl} ml</div>
        <div class="card-sub">${isEstimated ? "Nabız/Süre Tahmini" : "Garmin /waterEstimated"}</div>
      </div>
      <div class="mini-box">
        <div class="mini-box-lbl">%150 Telafi Hedefi</div>
        <div class="mini-box-val mono" style="color:#00e5a3;">${targetMl} ml</div>
        <div class="card-sub">~${glasses} su bardağı (250 ml)</div>
      </div>
      <div class="mini-box">
        <div class="mini-box-lbl">İlk 30 Dakika</div>
        <div class="mini-box-val mono" style="color:#a78bfa;">${first30Ml} ml</div>
        <div class="card-sub">Hemen antrenman bitiminde</div>
      </div>
      <div class="mini-box">
        <div class="mini-box-lbl">Sonraki 2 Saat</div>
        <div class="mini-box-val mono">${next2hMl} ml</div>
        <div class="card-sub">Yudum yudum dağıtarak</div>
      </div>
    </div>
    <div class="coach-block mt-16" style="border-left-color:${needsElectrolyte ? "#f59e0b" : "#38bdf8"}; margin-bottom:0;">
      <h4>${needsElectrolyte ? "⚡ Elektrolit + Maden Suyu Uyarısı" : "💧 Sade Hidrasyon Yeterli"}</h4>
      <p>${
        needsElectrolyte
          ? `Ter kaybı ${sweatLossMl} ml (${durMin} dk). Sadece su yerine 1 şişe doğal maden suyu (~400 mg sodyum/magnezyum) ekle.`
          : `Hafif-orta ter kaybı (${sweatLossMl} ml). İlk 30 dakikada ${first30Ml} ml içmen toparlanma nabzını hızlandırır.`
      }${sameDayActs.length > 1 ? ` · Bugünkü ${sameDayActs.length} seans toplamı: ${dailyRehyd} ml ekstra sıvı.` : ""}</p>
    </div>
  `;
}

function playRestBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [880, 1174].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, ctx.currentTime + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.16 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.16);
      osc.stop(ctx.currentTime + idx * 0.16 + 0.15);
    });
  } catch {
    // Ses tarayıcı tarafından engellenirse sessiz devam et
  }
}

function formatMmSs(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const r = String(s % 60).padStart(2, "0");
  return `${m}:${r}`;
}

window.renderLiveWorkoutUI = function () {
  const lw = state.liveWorkout;
  const totalVol = lw.setsCompleted.reduce((acc, s) => acc + s.volume_kg, 0);
  const targetSets = Number(document.getElementById("live-sets")?.value || 4);

  const tonBadge = document.getElementById("live-tonnage-badge");
  if (tonBadge) tonBadge.textContent = `${totalVol} kg Tonaj · ${lw.setsCompleted.length} Set`;

  const statusEl = document.getElementById("live-set-status");
  if (statusEl) {
    statusEl.textContent = lw.timerId
      ? `Dinlenme Sayacı · Set ${lw.setsCompleted.length} / ${targetSets}`
      : lw.setsCompleted.length
      ? `Sıradaki Set ${lw.setsCompleted.length + 1} / ${targetSets} Hazır`
      : `Hazır · Hedef ${targetSets} Set`;
  }

  const timerVal = document.getElementById("live-timer-val");
  if (timerVal) timerVal.textContent = formatMmSs(lw.restLeft);

  const timerBar = document.getElementById("live-timer-bar");
  if (timerBar) {
    const pct = lw.restTotal > 0 ? Math.min(100, Math.round((lw.restLeft / lw.restTotal) * 100)) : 0;
    timerBar.style.width = `${pct}%`;
    timerBar.style.background = lw.restLeft <= 10 && lw.timerId ? "#00e5a3" : "#38bdf8";
  }

  const listEl = document.getElementById("live-completed-list");
  if (listEl) {
    listEl.innerHTML = lw.setsCompleted.length
      ? lw.setsCompleted
          .map(
            (s, i) => `
          <div class="live-set-item">
            <div><strong class="mono">#${i + 1}</strong> ${escapeHtml(s.exercise)} <span class="badge badge-info">${escapeHtml(s.muscle)}</span></div>
            <div class="mono" style="color:#00e5a3;">${s.weight_kg} kg x ${s.reps} (${s.volume_kg} kg)</div>
          </div>`
          )
          .reverse()
          .join("")
      : `<p class="card-sub" style="text-align:center;">Set tamamla butonuna bastığında 60 sn dinlenme sayacı otomatik başlar.</p>`;
  }
};

function startRestTimer(sec) {
  const lw = state.liveWorkout;
  if (lw.timerId) clearInterval(lw.timerId);
  lw.restLeft = sec;
  lw.restTotal = Math.max(sec, 60);
  lw.timerId = setInterval(() => {
    lw.restLeft -= 1;
    if (lw.restLeft <= 0) {
      clearInterval(lw.timerId);
      lw.timerId = null;
      lw.restLeft = 0;
      playRestBeep();
      showToast("⏰ Dinlenme bitti — sıradaki sete geç!");
    }
    renderLiveWorkoutUI();
  }, 1000);
  renderLiveWorkoutUI();
}

window.completeLiveSet = function () {
  const exRaw = document.getElementById("live-ex-select")?.value || "Dumbbell Flye|Göğüs";
  const [exercise, muscle] = exRaw.split("|");
  const weight_kg = Math.max(1, Number(document.getElementById("live-weight")?.value || 6));
  const reps = Math.max(1, Number(document.getElementById("live-reps")?.value || 15));

  if (!state.liveWorkout.startedAt) state.liveWorkout.startedAt = Date.now();
  state.liveWorkout.setsCompleted.push({
    exercise,
    muscle,
    weight_kg,
    reps,
    volume_kg: Math.round(weight_kg * reps),
  });

  startRestTimer(60);
  showToast(`✓ ${exercise} (${weight_kg} kg x ${reps}) eklendi`);
};

window.adjustRestTimer = function (delta) {
  const lw = state.liveWorkout;
  const nextSec = Math.max(5, (lw.timerId ? lw.restLeft : 60) + delta);
  startRestTimer(nextSec);
};

window.skipRestTimer = function () {
  const lw = state.liveWorkout;
  if (lw.timerId) clearInterval(lw.timerId);
  lw.timerId = null;
  lw.restLeft = 0;
  renderLiveWorkoutUI();
  showToast("Sıradaki set için hazır!");
};

window.resetLiveSession = function () {
  const lw = state.liveWorkout;
  if (lw.timerId) clearInterval(lw.timerId);
  lw.timerId = null;
  lw.setsCompleted = [];
  lw.restLeft = 60;
  lw.restTotal = 60;
  lw.startedAt = null;
  renderLiveWorkoutUI();
};

window.saveLiveSession = async function () {
  const sets = state.liveWorkout.setsCompleted;
  if (!sets.length) {
    showToast("Önce en az 1 set tamamlayın.");
    return;
  }

  const grouped = new Map();
  for (const s of sets) {
    const key = `${s.exercise}|${s.muscle}|${s.weight_kg}|${s.reps}`;
    const prev = grouped.get(key) || { exercise: s.exercise, muscle: s.muscle, sets: 0, reps: s.reps, weight_kg: s.weight_kg, volume_kg: 0 };
    prev.sets += 1;
    prev.volume_kg += s.volume_kg;
    grouped.set(key, prev);
  }
  const custom_sets = Array.from(grouped.values());
  const names = [...new Set(sets.map((s) => s.exercise))].slice(0, 2).join(" & ");
  const avgWeight = Math.round(sets.reduce((a, b) => a + b.weight_kg, 0) / sets.length);
  const avgReps = Math.round(sets.reduce((a, b) => a + b.reps, 0) / sets.length);
  const durationMin = Math.max(10, Math.round((Date.now() - (state.liveWorkout.startedAt || Date.now())) / 60000), sets.length * 3);

  const btn = document.getElementById("btn-save-live");
  if (btn) btn.disabled = true;
  showToast("Canlı kuvvet seansı GarminCoach'a kaydediliyor...");

  try {
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "logWorkout",
        activity_type: "strength_training",
        activity_name: `Canlı Kuvvet: ${names}`,
        duration_min: durationMin,
        weight_kg: avgWeight,
        sets: sets.length,
        reps: avgReps,
        avg_hr: 108,
        custom_sets,
      }),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Kayıt hatası");
    state.selectedActivityId = json.activity.activity_id;
    resetLiveSession();
    await loadAllData();
    showToast("Seans, kas haritası ve sıvı ihtiyacı güncellendi!");
  } catch (err) {
    showToast(`Kayıt hatası: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.selectActivity = function (id) {
  state.selectedActivityId = id;
  renderWorkouts();
};

function renderWeekly() {
  const w = state.weekly;
  if (!w) return;

  document.getElementById("weekly-date-label").textContent = `Hafta başlangıcı: ${w.week_start_date}`;
  document.getElementById("weekly-exec-summary").textContent = w.ai_executive_summary || "";

  const d = w.wow_deltas || {};
  const deltaBadge = (val, unit, inverse = false) => {
    const good = inverse ? val <= 0 : val >= 0;
    const sign = val > 0 ? "+" : "";
    return `<span class="badge ${good ? "badge-ok" : "badge-warn"}">${sign}${val} ${unit} WoW</span>`;
  };

  const kpis = [
    { label: "Haftalık Ort. Kalp Dengesi", val: `${d.hrv_avg_ms ?? "--"} puan`, badge: deltaBadge(d.hrv_delta_ms ?? 0, "puan") },
    { label: "Dinlenik Nabız", val: `${d.rhr_avg_bpm ?? "--"} atım/dk`, badge: deltaBadge(d.rhr_delta_bpm ?? 0, "atım/dk", true) },
    { label: "Uyku / Hazırlık", val: `${d.sleep_avg_score ?? "--"} / ${d.readiness_avg ?? "--"}`, badge: deltaBadge(d.readiness_delta ?? 0, "puan") },
    { label: "Kardiyo Mesafesi", val: `${d.distance_km ?? "--"} km`, badge: deltaBadge(d.distance_delta_km ?? 0, "km") },
    { label: "Kuvvet Seansı (6–10 kg)", val: `${d.strength_sessions ?? "--"} seans`, badge: deltaBadge(d.strength_delta ?? 0, "seans") },
    { label: "Toplam Dambıl Tonajı", val: `${w.cardio_vs_strength?.strength_volume_kg ?? 0} kg`, badge: `<span class="badge badge-info">4x15 Standart</span>` },
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
                <td><span class="badge ${g.status === "PASS" ? "badge-ok" : "badge-warn"}">${escapeHtml(g.status)}</span></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  const mf = w.mvp_and_flags || {};
  document.getElementById("weekly-mvp-flags").innerHTML = `
    <div class="coach-block"><h4>🏆 Haftanın MVP Metriği</h4><p>${escapeHtml(mf.mvp || "--")}</p></div>
    <div class="coach-block" style="border-left-color:#f59e0b;"><h4>⚠️ Dikkat Bayrağı</h4><p>${escapeHtml(mf.attention_flag || "--")}</p></div>
  `;

  const zList = w.zone_distribution || [];
  const zCtx = document.getElementById("weeklyZonesChart");
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
        <div style="font-size:11.5px; color:#00e5a3; font-weight:700;">${escapeHtml(row.focus)}</div>
        <div style="font-size:12px; color:#cbd5e1; flex:1;">${escapeHtml(row.plan)}</div>
        <div class="mono" style="font-size:11px; color:#94a3b8; border-top:1px solid var(--border); padding-top:6px;">
          ${wDay.temp_max != null ? `${wDay.temp_min}–${wDay.temp_max}°C · 💧%${wDay.precip_prob}` : "--"}
        </div>
      </div>`;
    })
    .join("");
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
        <div style="font-size:12.5px; margin-top:4px; color:#cbd5e1;">${escapeHtml(b.ai_daily_brief?.headline || "")}</div>
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
    document.getElementById("inp-birth").value = s.birth_year ?? 1988;
    document.getElementById("inp-rhr-base").value = s.base_rhr ?? 46;
    document.getElementById("inp-rhr-warn").value = s.rhr_warn_threshold ?? 51;
    document.getElementById("inp-hrv-min").value = s.base_hrv_min ?? 59;
    document.getElementById("inp-hrv-warn").value = s.hrv_warn_threshold ?? 48;
    document.getElementById("inp-resp-warn").value = s.resp_warn_threshold ?? 18.0;
    document.getElementById("inp-stress-warn").value = s.sleep_stress_threshold ?? 23;
    document.getElementById("inp-temp-warn").value = s.skin_temp_deviation_threshold ?? 0.4;
    document.getElementById("inp-spo2-warn").value = s.spo2_warn_threshold ?? 91;

    const appAuth = s.weather_cache?.app_auth;
    const authUserEl = document.getElementById("inp-auth-username");
    const authBadgeEl = document.getElementById("settings-auth-badge");
    const activeUser = appAuth?.is_custom && appAuth?.username ? appAuth.username : (state.auth.username || "ali");
    if (authUserEl && document.activeElement !== authUserEl) {
      authUserEl.value = activeUser;
    }
    if (authBadgeEl) {
      const isCustom = Boolean(appAuth?.is_custom || state.auth.isCustom);
      authBadgeEl.textContent = isCustom ? `Özel Şifre Aktif (${activeUser})` : "Varsayılan Giriş";
      authBadgeEl.className = `badge ${isCustom ? "badge-ok" : "badge-info"} mono`;
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
      gpsReadoutEl.innerHTML = `<strong>Aktif Konum:</strong> ${escapeHtml(s.active_city || "Ümraniye")} · <span class="mono">${latTxt}, ${lonTxt}</span> · Kaynak: <strong>${escapeHtml(srcTxt)}</strong>${escapeHtml(liveAcc)}`;
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

window.triggerEngine = async function (action, force = false) {
  try {
    showToast(`Çalıştırılıyor: ${action}...`);
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, force }),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
    await loadAllData();
    showToast(`Tamamlandı: ${action}`);
  } catch (err) {
    showToast(`Hata (${action}): ${err.message}`);
  }
};

window.useLatestGarminGps = async function (silent = false) {
  try {
    if (!silent) showToast("Son Garmin GPS koordinatı alınıyor...");
    document.getElementById("inp-city").value = "";
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_settings",
        manual_city_override: null,
        use_garmin_gps: true,
      }),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Garmin GPS hatası");
    await loadAllData();
    if (!silent) showToast(`Garmin GPS konumu: ${json.loc?.active_city || "Ümraniye"}`);
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
        const res = await fetch(ENGINE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_settings",
            manual_city_override: null,
            live_lat: pos.coords.latitude,
            live_lon: pos.coords.longitude,
            live_city,
            live_accuracy: Math.round(pos.coords.accuracy || 0),
          }),
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
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Kayıt hatası");
    await loadAllData();
    showToast(`Konum: ${json.loc?.active_city || "Ümraniye"} güncellendi`);
  } catch (err) {
    showToast(`Ayar hatası: ${err.message}`);
  }
};

window.askCoachPreset = function (q) {
  document.getElementById("coach-question-input").value = q;
  submitCoachChat(new Event("submit"));
};

window.applyAiSuggestedRotation = function (rotId) {
  const wTabBtn = document.querySelector('[data-tab="workouts"]');
  if (wTabBtn) wTabBtn.click();
  loadKochlerPreset(rotId);
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
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "askCoach", question: q }),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Yanıt alınamadı");
    const r = json.reply || {};
    const items = Array.isArray(r.action_items) && r.action_items.length
      ? `<ul style="margin:6px 0 0 18px; color:#00e5a3;">${r.action_items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : "";
    const modelLabel = String(r.model_used || r.source || "Gemini AI").replace("models/", "");
    const rotNames = {
      chest_arms: "Kochler - Göğüs & Ön Kol",
      shoulders_back: "Kochler - Omuz & Sırt",
      core_legs: "Ab Roller & Squat",
    };
    const rotBtn = r.suggested_rotation && rotNames[r.suggested_rotation]
      ? `<div class="mt-12"><button type="button" class="btn btn-primary btn-sm" onclick="applyAiSuggestedRotation('${escapeHtml(r.suggested_rotation)}')">⚡ Önerilen Rotasyonu (${escapeHtml(rotNames[r.suggested_rotation])}) Canlı Koça Yükle</button></div>`
      : "";
    replyBox.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:6px;"><strong>Koç Yanıtı</strong><span class="badge badge-info mono">${escapeHtml(modelLabel)}</span></div><div>${escapeHtml(r.answer || "")}</div>${items}${rotBtn}`;
  } catch (err) {
    replyBox.innerHTML = `<span style="color:#f87171;">Hata: ${escapeHtml(err.message)}</span>`;
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
  const res = await fetch(ENGINE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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
  const res = await fetch(ENGINE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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
        if (parsed?.token) return { ...parsed, remembered: store === localStorage };
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
  if (pillUser) pillUser.textContent = state.auth.username || "ali";
}

async function completeAuthSuccess(authData, remember) {
  state.auth = {
    authenticated: true,
    username: authData.username || "ali",
    token: authData.token,
    isCustom: Boolean(authData.is_custom),
  };
  saveAuthSession(state.auth, remember);
  updateAuthUiLabels();
  setAuthError("");
  const overlay = document.getElementById("auth-gate-overlay");
  if (overlay) overlay.classList.add("hidden");
  await loadAllData();
}

async function initAuthGate() {
  const hintEl = document.getElementById("auth-default-hint");
  const userInp = document.getElementById("login-username");
  const curSetupInp = document.getElementById("setup-current-pass");
  const overlay = document.getElementById("auth-gate-overlay");
  if (overlay) overlay.classList.remove("hidden");

  try {
    const statusRes = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "authStatus" }),
    });
    const statusJson = await statusRes.json();
    const isCustom = Boolean(statusJson?.is_custom);
    state.auth.isCustom = isCustom;
    state.auth.username = statusJson?.active_username || "ali";

    if (hintEl) {
      if (isCustom) {
        hintEl.innerHTML = `Özel şifre koruması aktif (<strong class="mono">${escapeHtml(state.auth.username)}</strong>). Kokpite girmek için kullanıcı adı ve şifrenizi girin.`;
      } else {
        hintEl.innerHTML = `İlk kurulum varsayılanı: Kullanıcı adı <strong class="mono">ali</strong> · Şifre <strong class="mono">garmin2026</strong>. Aşağıdan hemen kendi kullanıcı adı ve şifrenizi tanımlayabilirsiniz.`;
      }
    }
    if (userInp && !userInp.value && !isCustom) userInp.value = "ali";
    if (curSetupInp) {
      curSetupInp.placeholder = isCustom
        ? "Mevcut şifrenizi girin"
        : "İlk kurulumda boş bırakabilirsiniz";
    }
  } catch (_) {
    if (hintEl) {
      hintEl.textContent = "Giriş durumu kontrol edildi. Lütfen kullanıcı adı ve şifrenizi girin.";
    }
  }

  const saved = getSavedAuthSession();
  if (saved?.token) {
    try {
      const verifyRes = await fetch(ENGINE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verifyAppLogin", token: saved.token }),
      });
      const verifyJson = await verifyRes.json();
      if (verifyRes.ok && verifyJson.authenticated) {
        await completeAuthSuccess(verifyJson, Boolean(saved.remembered));
        return;
      }
    } catch (_) {}
    clearAuthSession();
  }
}

window.submitAppLogin = async function (ev) {
  ev.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const remember = Boolean(document.getElementById("login-remember")?.checked);
  const btn = document.getElementById("auth-login-btn");
  setAuthError("");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verifyAppLogin", username, password }),
    });
    const json = await res.json();
    if (!res.ok || !json.authenticated) {
      throw new Error(json.error || "Kullanıcı adı veya şifre hatalı.");
    }
    document.getElementById("login-password").value = "";
    await completeAuthSuccess(json, remember);
    showToast(`Hoş geldin, ${json.username}!`);
  } catch (err) {
    setAuthError(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.toggleLoginSetupPanel = function () {
  const panel = document.getElementById("auth-inline-setup");
  if (!panel) return;
  panel.classList.toggle("hidden");
  setAuthError("");
};

window.submitInlineCredentialSetup = async function (ev) {
  ev.preventDefault();
  const current_password = document.getElementById("setup-current-pass").value;
  const new_username = document.getElementById("setup-new-user").value.trim();
  const new_password = document.getElementById("setup-new-pass").value;
  const remember = Boolean(document.getElementById("login-remember")?.checked);
  setAuthError("");

  try {
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "updateAppCredentials",
        current_password,
        new_username,
        new_password,
      }),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || "Giriş bilgileri kaydedilemedi.");
    }
    document.getElementById("setup-current-pass").value = "";
    document.getElementById("setup-new-pass").value = "";
    document.getElementById("auth-inline-setup")?.classList.add("hidden");
    await completeAuthSuccess({ ...json, authenticated: true }, remember);
    showToast(`Giriş bilgileriniz güncellendi (${json.username})!`);
  } catch (err) {
    setAuthError(err.message);
  }
};

window.saveAppCredentials = async function (ev) {
  ev.preventDefault();
  const new_username = document.getElementById("inp-auth-username").value.trim();
  const current_password = document.getElementById("inp-auth-current-pass").value;
  const new_password = document.getElementById("inp-auth-new-pass").value;
  const confirmPass = document.getElementById("inp-auth-confirm-pass").value;

  if (new_password !== confirmPass) {
    showToast("Yeni şifreler eşleşmiyor!");
    return;
  }

  try {
    showToast("Giriş bilgileri güncelleniyor...");
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "updateAppCredentials",
        current_password,
        token: state.auth.token,
        new_username,
        new_password,
      }),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || "Bilgiler güncellenemedi.");
    }

    const wasRemembered = Boolean(localStorage.getItem(AUTH_STORAGE_KEY));
    state.auth = {
      authenticated: true,
      username: json.username,
      token: json.token,
      isCustom: true,
    };
    saveAuthSession(state.auth, wasRemembered);
    updateAuthUiLabels();
    document.getElementById("inp-auth-current-pass").value = "";
    document.getElementById("inp-auth-new-pass").value = "";
    document.getElementById("inp-auth-confirm-pass").value = "";
    await loadAllData();
    showToast(`Giriş bilgileri güncellendi: ${json.username}`);
  } catch (err) {
    showToast(`Giriş güncelleme hatası: ${err.message}`);
  }
};

window.logoutApp = function () {
  clearAuthSession();
  state.auth.authenticated = false;
  state.auth.token = null;
  const pwEl = document.getElementById("login-password");
  if (pwEl) pwEl.value = "";
  document.getElementById("auth-inline-setup")?.classList.add("hidden");
  setAuthError("");
  initAuthGate();
};

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  startIstanbulClock();
  renderLiveWorkoutUI();
  initAuthGate();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
});
