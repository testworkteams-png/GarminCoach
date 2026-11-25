(function () {
  "use strict";

  const OVERRIDE_KEY = "garmincoach_theme_override_v1";
  const CALM_KEY = "garmincoach_theme_calm_v1";
  const BANNER_DISMISS_KEY = "garmincoach_theme_banner_dismiss_v1";
  const WEATHER_CACHE_KEY = "garmincoach_weather_theme_cache_v1";
  const WEATHER_TTL_MS = 20 * 60 * 1000;

  // Resmi Diyanet İşleri Başkanlığı takvim tarihleri (1. gün başlangıç tarihleri; birden fazla Ramazan içeren yıllar dahil)
  const DIYANET_HOLIDAYS = {
    2025: { ramazan: ["2025-03-30"], kurban: ["2025-06-06"] },
    2026: { ramazan: ["2026-03-20"], kurban: ["2026-05-27"] },
    2027: { ramazan: ["2027-03-09"], kurban: ["2027-05-16"] },
    2028: { ramazan: ["2028-02-26"], kurban: ["2028-05-05"] },
    2029: { ramazan: ["2029-02-14"], kurban: ["2029-04-24"] },
    2030: { ramazan: ["2030-02-04"], kurban: ["2030-04-13"] },
    2031: { ramazan: ["2031-01-24"], kurban: ["2031-04-02"] },
    2032: { ramazan: ["2032-01-14"], kurban: ["2032-03-22"] },
    2033: { ramazan: ["2033-01-02", "2033-12-23"], kurban: ["2033-03-11"] },
    2034: { ramazan: ["2034-12-12"], kurban: ["2034-03-01"] },
    2035: { ramazan: ["2035-12-01"], kurban: ["2035-02-18"] },
  };

  const HIJRI_YEAR_CACHE = {};
  let HIJRI_FORMATTER = null;
  try {
    HIJRI_FORMATTER = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
      timeZone: "Europe/Istanbul",
      month: "numeric",
      day: "numeric",
    });
  } catch (_) {}

  const THEME_CATALOG = {
    classic: {
      id: "classic",
      category: "base",
      name: "Klasik Garmin Koyu",
      shortLabel: "Klasik Koyu",
      icon: "⚡",
      themeColor: "#04070f",
      particles: "none",
      bannerTitle: "Klasik Performans Kokpiti",
      bannerDesc: "Yüksek kontrastlı standart gece kokpiti.",
    },
    ramazan: {
      id: "ramazan",
      category: "holiday",
      group: "Dini Bayram",
      name: "Ramazan Bayramı",
      shortLabel: "Ramazan Bayramı",
      icon: "🍬",
      themeColor: "#140b24",
      particles: "confetti",
      durationDays: 3,
      bannerTitle: "Ramazan Bayramınız Mübarek Olsun!",
      bannerDesc: "Şekerleme tadında, birlik ve beraberlik dolu huzurlu bir bayram dileriz.",
    },
    kurban: {
      id: "kurban",
      category: "holiday",
      group: "Dini Bayram",
      name: "Kurban Bayramı",
      shortLabel: "Kurban Bayramı",
      icon: "🌙",
      themeColor: "#061612",
      particles: "twinkle",
      durationDays: 4,
      bannerTitle: "Kurban Bayramınız Mübarek Olsun!",
      bannerDesc: "Paylaşma, dayanışma ve birlik beraberlik içinde bereketli bir bayram dileriz.",
    },
    cumhuriyet: {
      id: "cumhuriyet",
      category: "holiday",
      group: "Resmi Bayram",
      name: "Cumhuriyet Bayramı",
      shortLabel: "29 Ekim Cumhuriyet",
      icon: "🇹🇷",
      themeColor: "#16060b",
      particles: "confetti_red",
      durationDays: 1.5,
      bannerTitle: "29 Ekim Cumhuriyet Bayramı Kutlu Olsun!",
      bannerDesc: "Cumhuriyetimizin aydınlık ışığı ve büyük coşkusuyla nice yıllara.",
    },
    nisan23: {
      id: "nisan23",
      category: "holiday",
      group: "Resmi Bayram",
      name: "23 Nisan Çocuk Bayramı",
      shortLabel: "23 Nisan",
      icon: "🎈",
      themeColor: "#071529",
      particles: "confetti",
      durationDays: 1,
      bannerTitle: "23 Nisan Ulusal Egemenlik ve Çocuk Bayramı Kutlu Olsun!",
      bannerDesc: "Neşe, umut ve çocuk coşkusuyla dolu aydınlık bir gün.",
    },
    mayis19: {
      id: "mayis19",
      category: "holiday",
      group: "Resmi Bayram",
      name: "19 Mayıs Gençlik & Spor",
      shortLabel: "19 Mayıs Spor",
      icon: "🔥",
      themeColor: "#091128",
      particles: "spark",
      durationDays: 1,
      bannerTitle: "19 Mayıs Atatürk'ü Anma, Gençlik ve Spor Bayramı Kutlu Olsun!",
      bannerDesc: "Bugün gençlik enerjisi ve spor azmiyle sahalardayız!",
    },
    agustos30: {
      id: "agustos30",
      category: "holiday",
      group: "Resmi Bayram",
      name: "30 Ağustos Zafer Bayramı",
      shortLabel: "30 Ağustos Zafer",
      icon: "🏅",
      themeColor: "#14090d",
      particles: "confetti_gold",
      durationDays: 1,
      bannerTitle: "30 Ağustos Zafer Bayramı Kutlu Olsun!",
      bannerDesc: "Büyük zaferin gururu, azmi ve kararlılığıyla.",
    },
    kasim10: {
      id: "kasim10",
      category: "holiday",
      group: "Anma Günü",
      name: "10 Kasım Atatürk'ü Anma",
      shortLabel: "10 Kasım",
      icon: "🕯️",
      themeColor: "#0a0c10",
      particles: "none",
      durationDays: 1,
      bannerTitle: "10 Kasım Atatürk'ü Anma Günü",
      bannerDesc: "Gazi Mustafa Kemal Atatürk'ü derin saygı, sevgi ve özlemle anıyoruz.",
    },
    yilbasi: {
      id: "yilbasi",
      category: "holiday",
      group: "Özel Gün",
      name: "Yılbaşı Kış Huzuru",
      shortLabel: "Yılbaşı",
      icon: "❄️",
      themeColor: "#061224",
      particles: "snow",
      durationDays: 3,
      bannerTitle: "Mutlu ve Huzurlu Yıllar!",
      bannerDesc: "Karlı kış gecesinin sakinliğinde sağlıklı, güçlü bir yeni yıl dileriz.",
    },
    halloween: {
      id: "halloween",
      category: "holiday",
      group: "Özel Gün",
      name: "Cadılar Bayramı",
      shortLabel: "Cadılar Bayramı",
      icon: "🎃",
      themeColor: "#12071f",
      particles: "halloween",
      durationDays: 2,
      bannerTitle: "Mutlu Cadılar Bayramı!",
      bannerDesc: "Eğlenceli gece koşularında nabzı koruyup balkabaklarını geride bırak!",
    },
    weather_sunny: {
      id: "weather_sunny",
      category: "weather",
      name: "Güneşli · Gün Işığı Modu",
      shortLabel: "Güneşli (Yüksek Kontrast)",
      icon: "☀️",
      themeColor: "#cbd5e1",
      particles: "none",
    },
    weather_night: {
      id: "weather_night",
      category: "weather",
      name: "Açık Yıldızlı Gece",
      shortLabel: "Açık Gece",
      icon: "✨",
      themeColor: "#030714",
      particles: "twinkle",
    },
    weather_cloudy: {
      id: "weather_cloudy",
      category: "weather",
      name: "Kapalı & Bulutlu Mat",
      shortLabel: "Bulutlu",
      icon: "☁️",
      themeColor: "#121822",
      particles: "none",
    },
    weather_fog: {
      id: "weather_fog",
      category: "weather",
      name: "Sisli & Puslu",
      shortLabel: "Sisli",
      icon: "🌫️",
      themeColor: "#141920",
      particles: "none",
    },
    weather_rain: {
      id: "weather_rain",
      category: "weather",
      name: "Yağmurlu Petrol",
      shortLabel: "Yağmurlu",
      icon: "🌧️",
      themeColor: "#04121c",
      particles: "rain",
    },
    weather_snow: {
      id: "weather_snow",
      category: "weather",
      name: "Karlı Buz Kristali",
      shortLabel: "Karlı",
      icon: "🌨️",
      themeColor: "#081526",
      particles: "snow",
    },
    weather_wind: {
      id: "weather_wind",
      category: "weather",
      name: "Rüzgarlı Dinamik",
      shortLabel: "Rüzgarlı",
      icon: "💨",
      themeColor: "#071821",
      particles: "wind",
    },
  };

  let lastSettings = null;
  let lastWeather = null;
  let hourlyTimer = null;

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function getIstanbulParts(dateInput) {
    const dt = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = {};
      fmt.formatToParts(dt).forEach((p) => {
        if (p.type !== "literal") parts[p.type] = p.value;
      });
      const year = Number(parts.year);
      const month = Number(parts.month);
      const day = Number(parts.day);
      const hour = Number(parts.hour) % 24;
      const minute = Number(parts.minute);
      return {
        year,
        month,
        day,
        hour,
        minute,
        dateStr: `${year}-${pad2(month)}-${pad2(day)}`,
      };
    } catch (_) {
      const utcMs = dt.getTime() + 3 * 3600 * 1000;
      const d = new Date(utcMs);
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      return {
        year,
        month,
        day,
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        dateStr: `${year}-${pad2(month)}-${pad2(day)}`,
      };
    }
  }

  function addDaysIso(isoStr, days) {
    const dt = new Date(`${isoStr}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  function diffDaysIso(targetIso, fromIso) {
    const a = Date.parse(`${targetIso}T12:00:00Z`);
    const b = Date.parse(`${fromIso}T12:00:00Z`);
    return Math.round((a - b) / 86400000);
  }

  function computeHijriStartDatesForYear(year) {
    if (HIJRI_YEAR_CACHE[year]) return HIJRI_YEAR_CACHE[year];
    const ramazan = [];
    const kurban = [];
    if (HIJRI_FORMATTER) {
      let cur = `${year}-01-01`;
      const end = `${year + 1}-01-01`;
      while (cur < end) {
        const parts = {};
        HIJRI_FORMATTER.formatToParts(new Date(`${cur}T12:00:00Z`)).forEach((p) => {
          if (p.type !== "literal") parts[p.type] = p.value;
        });
        if (parts.month === "10" && parts.day === "1") ramazan.push(cur);
        if (parts.month === "12" && parts.day === "10") kurban.push(cur);
        cur = addDaysIso(cur, 1);
      }
    }
    HIJRI_YEAR_CACHE[year] = { ramazan, kurban };
    return HIJRI_YEAR_CACHE[year];
  }

  function getReligiousHolidaysForYear(year) {
    const src = DIYANET_HOLIDAYS[year] || computeHijriStartDatesForYear(year);
    const events = [];
    (src.ramazan || []).forEach((start) => {
      events.push({ id: "ramazan", startDate: start, totalDays: 3 });
    });
    (src.kurban || []).forEach((start) => {
      events.push({ id: "kurban", startDate: start, totalDays: 4 });
    });
    return events;
  }

  function getReligiousMatch(ist) {
    const yearsToCheck = [ist.year - 1, ist.year];
    for (const yr of yearsToCheck) {
      const list = getReligiousHolidaysForYear(yr);
      for (const ev of list) {
        const delta = diffDaysIso(ist.dateStr, ev.startDate);
        if (delta >= 0 && delta < ev.totalDays) {
          const dayIndex = delta + 1;
          const theme = THEME_CATALOG[ev.id];
          return {
            ...theme,
            dayIndex,
            totalDays: ev.totalDays,
            startDate: ev.startDate,
            endDate: addDaysIso(ev.startDate, ev.totalDays - 1),
            badgeLabel: `${theme.shortLabel} · ${dayIndex}/${ev.totalDays}. Gün`,
            bannerSubtitle: `${dayIndex}/${ev.totalDays}. Gün · ${theme.bannerDesc}`,
            reason: `${theme.name} (${dayIndex}/${ev.totalDays}. gün, resmi dini takvim)`,
          };
        }
      }
    }
    return null;
  }

  function getNationalOrExtraMatch(ist) {
    const mmdd = `${pad2(ist.month)}-${pad2(ist.day)}`;

    // 29 Ekim Cumhuriyet Bayramı: 28 Ekim 13:00'dan itibaren resmi tatil + 29 Ekim tam gün (1.5 gün)
    if (mmdd === "10-28" && ist.hour >= 13) {
      const t = THEME_CATALOG.cumhuriyet;
      return {
        ...t,
        dayIndex: 1,
        totalDays: 2,
        startDate: `${ist.year}-10-28`,
        endDate: `${ist.year}-10-29`,
        badgeLabel: `${t.shortLabel} · Arifesi`,
        bannerSubtitle: `28 Ekim Arifesi · ${t.bannerDesc}`,
        reason: "29 Ekim Cumhuriyet Bayramı (28 Ekim 13:00 resmi başlangıç)",
      };
    }
    if (mmdd === "10-29") {
      const t = THEME_CATALOG.cumhuriyet;
      return {
        ...t,
        dayIndex: 2,
        totalDays: 2,
        startDate: `${ist.year}-10-28`,
        endDate: `${ist.year}-10-29`,
        badgeLabel: `${t.shortLabel} · 29 Ekim`,
        bannerSubtitle: `29 Ekim · ${t.bannerDesc}`,
        reason: "29 Ekim Cumhuriyet Bayramı (resmi takvim)",
      };
    }

    const fixedOneDay = {
      "04-23": "nisan23",
      "05-19": "mayis19",
      "08-30": "agustos30",
      "11-10": "kasim10",
    };
    if (fixedOneDay[mmdd]) {
      const t = THEME_CATALOG[fixedOneDay[mmdd]];
      return {
        ...t,
        dayIndex: 1,
        totalDays: 1,
        startDate: ist.dateStr,
        endDate: ist.dateStr,
        badgeLabel: t.shortLabel,
        bannerSubtitle: t.bannerDesc,
        reason: `${t.name} (resmi takvim)`,
      };
    }

    return null;
  }

  function getExtraSeasonMatch(ist) {
    const mmdd = `${pad2(ist.month)}-${pad2(ist.day)}`;

    // Yılbaşı: 31 Aralık – 2 Ocak (3 gün)
    if (mmdd === "12-31" || mmdd === "01-01" || mmdd === "01-02") {
      const t = THEME_CATALOG.yilbasi;
      const dayIndex = mmdd === "12-31" ? 1 : mmdd === "01-01" ? 2 : 3;
      const startYear = mmdd === "12-31" ? ist.year : ist.year - 1;
      return {
        ...t,
        dayIndex,
        totalDays: 3,
        startDate: `${startYear}-12-31`,
        endDate: `${startYear + 1}-01-02`,
        badgeLabel: `${t.shortLabel} · ${dayIndex}/3. Gün`,
        bannerSubtitle: `${dayIndex}/3. Gün · ${t.bannerDesc}`,
        reason: `Yılbaşı Kış Teması (${dayIndex}/3. gün)`,
      };
    }

    // Cadılar Bayramı: 30–31 Ekim (2 gün; 28-29 Ekim Cumhuriyet'i asla ezmez)
    if (mmdd === "10-30" || mmdd === "10-31") {
      const t = THEME_CATALOG.halloween;
      const dayIndex = mmdd === "10-30" ? 1 : 2;
      return {
        ...t,
        dayIndex,
        totalDays: 2,
        startDate: `${ist.year}-10-30`,
        endDate: `${ist.year}-10-31`,
        badgeLabel: `${t.shortLabel} · ${dayIndex}/2. Gün`,
        bannerSubtitle: `${dayIndex}/2. Gün · ${t.bannerDesc}`,
        reason: `Cadılar Bayramı (${dayIndex}/2. gün)`,
      };
    }

    return null;
  }

  function resolveHolidayTheme(dateInput) {
    const ist = getIstanbulParts(dateInput || new Date());
    const religious = getReligiousMatch(ist);
    const national = getNationalOrExtraMatch(ist);
    // Dini bayramın 1. günü öncelikli; diğer çakışmalarda resmi bayram günü kendi gününde öne çıkar
    if (national && (!religious || religious.dayIndex > 1)) return national;
    if (religious) return religious;
    return getExtraSeasonMatch(ist);
  }

  function getNextUpcomingHoliday(dateInput) {
    const ist = getIstanbulParts(dateInput || new Date());
    const candidates = [];

    [ist.year, ist.year + 1].forEach((yr) => {
      getReligiousHolidaysForYear(yr).forEach((ev) => {
        candidates.push({ id: ev.id, startDate: ev.startDate });
      });
      candidates.push({ id: "nisan23", startDate: `${yr}-04-23` });
      candidates.push({ id: "mayis19", startDate: `${yr}-05-19` });
      candidates.push({ id: "agustos30", startDate: `${yr}-08-30` });
      candidates.push({ id: "cumhuriyet", startDate: `${yr}-10-28` });
      candidates.push({ id: "halloween", startDate: `${yr}-10-30` });
      candidates.push({ id: "kasim10", startDate: `${yr}-11-10` });
      candidates.push({ id: "yilbasi", startDate: `${yr}-12-31` });
    });

    let best = null;
    for (const c of candidates) {
      const d = diffDaysIso(c.startDate, ist.dateStr);
      if (d > 0 && (!best || d < best.daysLeft)) {
        best = { theme: THEME_CATALOG[c.id], daysLeft: d, startDateStr: c.startDate };
      }
    }
    return best;
  }

  function describeWmoCodeTr(code, isDay) {
    if (code === 0 || code === 1) return isDay ? "Açık & Güneşli" : "Açık Gece";
    if (code === 2) return "Parçalı Bulutlu";
    if (code === 3) return "Kapalı & Bulutlu";
    if (code === 45 || code === 48) return "Sisli / Puslu";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "Yağmurlu";
    if (code >= 71 && code <= 77 || code === 85 || code === 86) return "Kar Yağışlı";
    if (code >= 95) return "Sağanak & Fırtına";
    return "Değişken";
  }

  function resolveWeatherTheme(weather) {
    if (!weather || weather.weather_code == null) return null;
    const code = Number(weather.weather_code);
    const wind = Number(weather.wind_kmh ?? weather.wind_speed_10m ?? 0);
    const isDay = weather.is_day != null ? Number(weather.is_day) === 1 : true;
    const temp = weather.temp_c != null ? `${Math.round(Number(weather.temp_c))}°C` : null;
    const wmoText = describeWmoCodeTr(code, isDay);

    let themeId = "weather_cloudy";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
      themeId = "weather_snow";
    } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) {
      themeId = "weather_rain";
    } else if (code === 45 || code === 48) {
      themeId = "weather_fog";
    } else if (wind >= 25) {
      themeId = "weather_wind";
    } else if (code === 2 || code === 3) {
      themeId = "weather_cloudy";
    } else {
      themeId = isDay ? "weather_sunny" : "weather_night";
    }

    const t = THEME_CATALOG[themeId];
    const cityLabel = weather.city ? `${weather.city} · ` : "";
    const tempLabel = temp ? `${temp} · ` : "";
    const windLabel = wind >= 25 ? ` · ${Math.round(wind)} km/sa rüzgar` : "";
    return {
      ...t,
      badgeLabel: `${t.shortLabel}${temp ? ` · ${temp}` : ""}`,
      reason: `Canlı Hava (${cityLabel}${tempLabel}${wmoText}${windLabel})`,
    };
  }

  function readJsonStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeJsonStorage(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  function buildFallbackWeatherFromSettings(settings) {
    const f0 = settings?.weather_cache?.forecast7d?.[0] || settings?.weather_cache?.forecast_7d?.[0];
    if (!f0) return null;
    const ist = getIstanbulParts(new Date());
    const isDay = ist.hour >= 7 && ist.hour < 18 ? 1 : 0;
    const wCode = f0.weather_code ?? (f0.precip_prob >= 55 || f0.precip_max >= 55 ? 61 : 2);
    return {
      city: settings?.active_city || settings?.default_city || null,
      weather_code: wCode,
      wind_kmh: f0.wind_kmh ?? f0.wind_max ?? 10,
      temp_c: f0.temp_max ?? null,
      is_day: isDay,
      source: "settings_cache",
    };
  }

  async function fetchLiveWeatherForTheme(settings) {
    const lat = Number(settings?.active_lat);
    const lon = Number(settings?.active_lon);
    const city = settings?.active_city || settings?.default_city || null;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return buildFallbackWeatherFromSettings(settings);
    }

    const coordKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = readJsonStorage(WEATHER_CACHE_KEY);
    if (
      cached &&
      cached.coordKey === coordKey &&
      Date.now() - Number(cached.ts || 0) < WEATHER_TTL_MS &&
      cached.weather
    ) {
      return { ...cached.weather, city: city || cached.weather.city };
    }

    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,weather_code,wind_speed_10m,is_day,cloud_cover&timezone=Europe%2FIstanbul`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5500) });
      if (res.ok) {
        const json = await res.json();
        const cur = json?.current;
        if (cur && cur.weather_code != null) {
          const weather = {
            city,
            temp_c: cur.temperature_2m != null ? Number(cur.temperature_2m) : null,
            weather_code: Number(cur.weather_code),
            wind_kmh: Number(cur.wind_speed_10m ?? 0),
            is_day: Number(cur.is_day ?? 1),
            cloud_cover: cur.cloud_cover != null ? Number(cur.cloud_cover) : null,
            source: "open_meteo_live",
          };
          writeJsonStorage(WEATHER_CACHE_KEY, { coordKey, ts: Date.now(), weather });
          return weather;
        }
      }
    } catch (_) {}

    return buildFallbackWeatherFromSettings(settings);
  }

  function getOverride() {
    try {
      return localStorage.getItem(OVERRIDE_KEY) || "auto";
    } catch (_) {
      return "auto";
    }
  }

  function setOverride(mode) {
    const valid = mode === "auto" || Boolean(THEME_CATALOG[mode]);
    const clean = valid ? mode : "auto";
    try {
      localStorage.setItem(OVERRIDE_KEY, clean);
    } catch (_) {}
    applyCurrentTheme();
    return clean;
  }

  function isCalmMode() {
    try {
      return localStorage.getItem(CALM_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function setCalmMode(calm) {
    try {
      localStorage.setItem(CALM_KEY, calm ? "1" : "0");
    } catch (_) {}
    applyCurrentTheme();
    return calm;
  }

  function renderAmbientParticles(particleType) {
    const layer = document.getElementById("theme-ambient-layer");
    if (!layer) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced || isCalmMode() || !particleType || particleType === "none") {
      layer.innerHTML = "";
      layer.dataset.mode = "none";
      return;
    }

    if (layer.dataset.mode === particleType && layer.children.length > 0) return;
    layer.dataset.mode = particleType;

    // Gözü yormayan sakin yoğunluk ve yavaş akış
    const count = particleType === "rain" ? 8 : 6;
    const html = [];

    for (let i = 0; i < count; i++) {
      const left = ((i * 37 + 11) % 92) + 4;
      const delay = -((i * 1.45) % 10).toFixed(2);
      const dur =
        particleType === "rain"
          ? (2.6 + (i % 4) * 0.4).toFixed(2)
          : particleType === "wind"
          ? (7.5 + (i % 3) * 1.5).toFixed(2)
          : (14 + (i % 5) * 1.8).toFixed(2);

      let cls = "theme-particle ";
      let content = "";
      if (particleType === "snow") {
        cls += "tp-snow";
        content = i % 3 === 0 ? "❄" : "•";
      } else if (particleType === "rain") {
        cls += "tp-rain";
      } else if (particleType === "wind") {
        cls += "tp-wind";
      } else if (particleType === "twinkle") {
        cls += "tp-twinkle";
        content = "✦";
      } else if (particleType === "halloween") {
        cls += "tp-twinkle tp-halloween";
        content = i % 4 === 0 ? "✦" : "•";
      } else {
        const pal =
          particleType === "confetti_red"
            ? i % 2 === 0
              ? "tp-red"
              : "tp-gold"
            : particleType === "confetti_gold"
            ? i % 2 === 0
              ? "tp-gold"
              : "tp-red"
            : particleType === "spark"
            ? i % 2 === 0
              ? "tp-cyan"
              : "tp-red"
            : i % 3 === 0
            ? "tp-emerald"
            : i % 3 === 1
            ? "tp-gold"
            : "tp-pink";
        cls += `tp-confetti ${pal}`;
      }

      const top =
        particleType === "twinkle" || particleType === "wind" || particleType === "halloween"
          ? ((i * 29 + 11) % 80) + 8
          : -8;
      html.push(
        `<span class="${cls}" style="left:${left}%; top:${top}%; animation-delay:${delay}s; animation-duration:${dur}s;">${content}</span>`
      );
    }

    layer.innerHTML = html.join("");
  }

  function updateBannerAndSettingsUi(active, overrideMode) {
    const ist = getIstanbulParts(new Date());
    const pillEl = document.getElementById("pill-theme");
    if (pillEl) {
      pillEl.textContent = `${active.icon} ${active.badgeLabel || active.shortLabel}`;
    }

    const firstName = typeof window !== "undefined" && window.__GC_FIRST_NAME ? String(window.__GC_FIRST_NAME) : "";
    const bannerEl = document.getElementById("theme-holiday-banner");
    if (bannerEl) {
      const dismissedDate = (() => {
        try {
          return sessionStorage.getItem(BANNER_DISMISS_KEY);
        } catch (_) {
          return null;
        }
      })();
      const isHolidayActive = active.category === "holiday";
      const hideBanner = !isHolidayActive || dismissedDate === `${ist.dateStr}:${active.id}`;
      bannerEl.classList.toggle("hidden", hideBanner);
      if (!hideBanner) {
        const iconEl = document.getElementById("theme-banner-icon");
        const titleEl = document.getElementById("theme-banner-title");
        const descEl = document.getElementById("theme-banner-desc");
        if (iconEl) iconEl.textContent = active.icon;
        if (titleEl) {
          const baseTitle = active.bannerTitle || active.name;
          titleEl.textContent = firstName && active.id !== "kasim10" ? `${firstName}, ${baseTitle}` : baseTitle;
        }
        if (descEl) descEl.textContent = active.bannerSubtitle || active.bannerDesc || "";
      }
    }

    const badgeEl = document.getElementById("settings-theme-badge");
    if (badgeEl) {
      badgeEl.textContent =
        overrideMode === "auto"
          ? `Otomatik · ${active.shortLabel}`
          : `Önizleme · ${active.shortLabel}`;
      badgeEl.className = `badge ${overrideMode === "auto" ? "badge-ok" : "badge-info"}`;
    }

    const summaryEl = document.getElementById("theme-active-summary");
    if (summaryEl) {
      summaryEl.innerHTML =
        overrideMode === "auto"
          ? `<strong>Otomatik Seçim:</strong> ${escapeStr(active.reason || active.name)}`
          : `<strong>Manuel Önizleme Aktif:</strong> ${escapeStr(active.name)} (Otomatik takvim/hava moduna dönmek için <em>Otomatik</em> butonuna basın)`;
    }

    const upcomingEl = document.getElementById("theme-upcoming-info");
    if (upcomingEl) {
      const nextHol = getNextUpcomingHoliday(new Date());
      if (nextHol) {
        upcomingEl.textContent = `Sıradaki özel gün: ${nextHol.theme.icon} ${nextHol.theme.name} · ${nextHol.daysLeft} gün sonra (${nextHol.startDateStr})`;
      }
    }

    const autoBtn = document.getElementById("btn-theme-auto");
    const classicBtn = document.getElementById("btn-theme-classic");
    const calmBtn = document.getElementById("btn-theme-calm");
    const calmOn = isCalmMode();
    if (autoBtn) autoBtn.classList.toggle("btn-primary", overrideMode === "auto");
    if (classicBtn) classicBtn.classList.toggle("btn-primary", overrideMode === "classic");
    if (calmBtn) {
      calmBtn.classList.toggle("btn-cyan", calmOn);
      calmBtn.textContent = calmOn ? "🌙 Sakin Mod: Efektler Kapalı" : "✨ Sakin Mod: Efektler Açık";
    }

    renderPreviewGrids(overrideMode);
  }

  function escapeStr(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderPreviewGrids(overrideMode) {
    const holGrid = document.getElementById("theme-preview-holidays");
    const wGrid = document.getElementById("theme-preview-weather");
    const holidayIds = ["ramazan", "kurban", "cumhuriyet", "nisan23", "mayis19", "agustos30", "kasim10", "yilbasi", "halloween"];
    const weatherIds = ["weather_sunny", "weather_night", "weather_cloudy", "weather_fog", "weather_rain", "weather_snow", "weather_wind"];

    if (holGrid) {
      holGrid.innerHTML = holidayIds
        .map((id) => {
          const t = THEME_CATALOG[id];
          const activeCls = overrideMode === id ? "active" : "";
          return `<button type="button" class="theme-chip ${activeCls}" onclick="setAppThemeOverride('${id}')">
            <span>${t.icon}</span>
            <span>${escapeStr(t.shortLabel)}</span>
          </button>`;
        })
        .join("");
    }

    if (wGrid) {
      wGrid.innerHTML = weatherIds
        .map((id) => {
          const t = THEME_CATALOG[id];
          const activeCls = overrideMode === id ? "active" : "";
          return `<button type="button" class="theme-chip ${activeCls}" onclick="setAppThemeOverride('${id}')">
            <span>${t.icon}</span>
            <span>${escapeStr(t.shortLabel)}</span>
          </button>`;
        })
        .join("");
    }
  }

  function resolveCurrentTheme(nowInput, weatherInput) {
    const override = getOverride();
    if (override !== "auto" && THEME_CATALOG[override]) {
      const chosen = THEME_CATALOG[override];
      return {
        ...chosen,
        badgeLabel: chosen.shortLabel,
        bannerSubtitle: chosen.bannerDesc || "Önizleme modu aktif.",
        reason: `Manuel Önizleme (${chosen.name})`,
      };
    }

    const holiday = resolveHolidayTheme(nowInput || new Date());
    if (holiday) return holiday;

    const weatherTheme = resolveWeatherTheme(weatherInput);
    if (weatherTheme) return weatherTheme;

    return {
      ...THEME_CATALOG.classic,
      badgeLabel: "Otomatik",
      reason: "Varsayılan Performans Teması",
    };
  }

  function applyCurrentTheme() {
    if (typeof document === "undefined") return null;
    const overrideMode = getOverride();
    const active = resolveCurrentTheme(new Date(), lastWeather);

    document.documentElement.dataset.theme = active.id;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme && active.themeColor) {
      metaTheme.setAttribute("content", active.themeColor);
    }

    renderAmbientParticles(active.particles);
    updateBannerAndSettingsUi(active, overrideMode);
    return active;
  }

  async function refreshFromSettings(settings) {
    lastSettings = settings || lastSettings;
    applyCurrentTheme();
    const fetched = await fetchLiveWeatherForTheme(lastSettings);
    if (fetched) {
      lastWeather = fetched;
      applyCurrentTheme();
    }
  }

  function init() {
    applyCurrentTheme();
    if (!hourlyTimer && typeof setInterval === "function") {
      hourlyTimer = setInterval(() => {
        refreshFromSettings(lastSettings);
      }, 15 * 60 * 1000);
    }
  }

  const hostObj = typeof window !== "undefined" ? window : globalThis;

  hostObj.setAppThemeOverride = function (mode) {
    setOverride(mode);
  };

  hostObj.toggleCalmThemeMode = function () {
    setCalmMode(!isCalmMode());
  };

  hostObj.dismissHolidayBanner = function () {
    const ist = getIstanbulParts(new Date());
    const active = resolveCurrentTheme(new Date(), lastWeather);
    try {
      sessionStorage.setItem(BANNER_DISMISS_KEY, `${ist.dateStr}:${active.id}`);
    } catch (_) {}
    if (typeof document !== "undefined") {
      document.getElementById("theme-holiday-banner")?.classList.add("hidden");
    }
  };

  hostObj.openThemeSettings = function () {
    if (typeof document === "undefined") return;
    const btn = document.querySelector('[data-tab="settings"]');
    if (btn) btn.click();
    setTimeout(() => {
      document.getElementById("theme-settings-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 140);
  };

  hostObj.GarminThemeEngine = {
    init,
    refreshFromSettings,
    resolveHolidayTheme,
    resolveWeatherTheme,
    getNextUpcomingHoliday,
    resolveCurrentTheme,
    applyCurrentTheme,
    setOverride,
    setCalmMode,
    isCalmMode,
    getCatalog: () => THEME_CATALOG,
  };
})();
