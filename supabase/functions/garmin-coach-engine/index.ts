import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const DEFAULT_LAT = 41.0256;
const DEFAULT_LON = 29.0963;
const DEFAULT_CITY = "Ümraniye";
const DEFAULT_GARMIN_BASE = "https://personal.connectapi.garmin.com";
const OWNER_EMAIL = "ali@garmincoach.local";
const PUBLIC_REGISTRATION_ENABLED = false;

interface IstanbulTime {
  dateStr: string;
  hour: number;
  minute: number;
  dayOfWeekTr: string;
  weekStartDate: string;
  monthKey: string;
}

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getIstanbulNow(): IstanbulTime {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const hour = Number(map.hour === "24" ? 0 : map.hour);
  const minute = Number(map.minute);

  const dayMap: Record<string, { tr: string; offsetFromMon: number }> = {
    Mon: { tr: "Pazartesi", offsetFromMon: 0 },
    Tue: { tr: "Salı", offsetFromMon: 1 },
    Wed: { tr: "Çarşamba", offsetFromMon: 2 },
    Thu: { tr: "Perşembe", offsetFromMon: 3 },
    Fri: { tr: "Cuma", offsetFromMon: 4 },
    Sat: { tr: "Cumartesi", offsetFromMon: 5 },
    Sun: { tr: "Pazar", offsetFromMon: 6 },
  };
  const info = dayMap[map.weekday] ?? { tr: "Pazartesi", offsetFromMon: 0 };

  const baseDate = new Date(`${dateStr}T12:00:00Z`);
  baseDate.setUTCDate(baseDate.getUTCDate() - info.offsetFromMon);
  const weekStartDate = baseDate.toISOString().slice(0, 10);

  return {
    dateStr,
    hour,
    minute,
    dayOfWeekTr: info.tr,
    weekStartDate,
    monthKey: dateStr.slice(0, 7),
  };
}

function shiftDateStr(dateStr: string, deltaDays: number): string {
  const dt = new Date(`${dateStr}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function maskKeyHint(val?: string | null): string | null {
  const s = String(val || "").trim();
  if (!s) return null;
  if (s.length <= 8) return "••••" + s.slice(-2);
  return `${s.slice(0, 5)}••••${s.slice(-4)}`;
}

function calculateReadinessScore(
  bbMax: number | null,
  sleepScore: number | null,
  hrvAvg: number | null,
  rhr: number | null,
  settings?: any
): number {
  let weightSum = 0;
  let total = 0;

  if (bbMax !== null && bbMax !== undefined) {
    const bb = Math.min(100, Math.max(0, bbMax));
    total += bb * 0.30;
    weightSum += 0.30;
  }
  if (sleepScore !== null && sleepScore !== undefined) {
    const slp = Math.min(100, Math.max(0, sleepScore));
    total += slp * 0.30;
    weightSum += 0.30;
  }
  if (hrvAvg !== null && hrvAvg !== undefined) {
    const baseMin = Number(settings?.base_hrv_min ?? 59);
    const baseMax = Number(settings?.base_hrv_max ?? 74);
    const warn = Number(settings?.hrv_warn_threshold ?? 48);
    const ext = Number(settings?.hrv_extreme_threshold ?? 40);
    const peak = Math.round((baseMin + baseMax) / 2);
    let hrvScore = 0;
    if (hrvAvg >= peak) hrvScore = 100;
    else if (hrvAvg >= baseMin) hrvScore = 85 + ((hrvAvg - baseMin) / Math.max(1, peak - baseMin)) * 15;
    else if (hrvAvg >= warn) hrvScore = 60 + ((hrvAvg - warn) / Math.max(1, baseMin - warn)) * 25;
    else if (hrvAvg >= ext) hrvScore = 30 + ((hrvAvg - ext) / Math.max(1, warn - ext)) * 30;
    else hrvScore = Math.max(10, 30 - (ext - hrvAvg) * 2);
    total += hrvScore * 0.25;
    weightSum += 0.25;
  }
  if (rhr !== null && rhr !== undefined) {
    const baseRhr = Number(settings?.base_rhr ?? 46);
    const rhrWarn = Number(settings?.rhr_warn_threshold ?? 51);
    const rhrExt = Number(settings?.rhr_extreme_threshold ?? 55);
    let rhrScore = 0;
    if (rhr <= baseRhr) rhrScore = 100;
    else if (rhr <= rhrWarn) rhrScore = 100 - ((rhr - baseRhr) / Math.max(1, rhrWarn - baseRhr)) * 35;
    else if (rhr <= rhrExt) rhrScore = 65 - ((rhr - rhrWarn) / Math.max(1, rhrExt - rhrWarn)) * 35;
    else rhrScore = Math.max(10, 30 - (rhr - rhrExt) * 4);
    total += rhrScore * 0.15;
    weightSum += 0.15;
  }

  if (weightSum === 0) return 0;
  return Math.min(100, Math.max(0, Math.round(total / weightSum)));
}

function getReadinessStatus(score: number): "OPTIMAL" | "MODERATE" | "LOW" | "CRITICAL" {
  if (score >= 80) return "OPTIMAL";
  if (score >= 60) return "MODERATE";
  if (score >= 45) return "LOW";
  return "CRITICAL";
}

function dialForAqi(aqi: number) {
  if (aqi > 75) return { dial_level: "KIRMIZI", dial_index: 4 };
  if (aqi > 50) return { dial_level: "TURUNCU", dial_index: 3 };
  if (aqi > 25) return { dial_level: "SARI", dial_index: 2 };
  return { dial_level: "YEŞİL", dial_index: 1 };
}

function downsamplePairs(pairs: any[], maxPoints: number, valKey: string) {
  if (!Array.isArray(pairs) || pairs.length === 0) return [];
  const valid = pairs.filter((p) => Array.isArray(p) && p[0] != null && p[1] != null);
  if (valid.length === 0) return [];
  const step = Math.max(1, Math.floor(valid.length / maxPoints));
  const out: any[] = [];
  for (let i = 0; i < valid.length; i += step) {
    const dt = new Date(valid[i][0]);
    const trTime = new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dt);
    out.push({ time: trTime, [valKey]: valid[i][1] });
  }
  return out.slice(0, maxPoints);
}

function resolveEnduranceContributorLabel(c: any): string {
  const txt = [c?.activityTypeName, c?.typeKey, c?.groupName, typeof c?.group === "string" ? c.group : ""]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  if (txt.includes("RUN") || txt.includes("KOŞU")) return "Koşu";
  if (txt.includes("CYCL") || txt.includes("BIK") || txt.includes("BİSİKLET")) return "Bisiklet";
  if (txt.includes("HIKE") || txt.includes("HIKING") || txt.includes("TREK")) return "Doğa Yürüyüşü";
  if (txt.includes("WALK") || txt.includes("YÜRÜYÜŞ")) return "Yürüyüş";
  if (txt.includes("STRENGTH") || txt.includes("FITNESS") || txt.includes("KUVVET")) return "Kuvvet / Fitness";
  if (txt.includes("SWIM") || txt.includes("YÜZME")) return "Yüzme";
  if (txt.includes("CARDIO") || txt.includes("KARDİYO")) return "Kardiyo";
  if (txt.includes("OTHER") || txt.includes("ALL")) return "Diğer Aktiviteler";

  const typeId = Number(c?.activityTypeId);
  const typeMap: Record<number, string> = {
    1: "Koşu",
    2: "Bisiklet",
    3: "Doğa Yürüyüşü",
    4: "Diğer Aktiviteler",
    5: "Bisiklet",
    9: "Yürüyüş",
    10: "Kardiyo",
    13: "Kuvvet / Fitness",
    26: "Yüzme",
    29: "Kuvvet / Fitness",
  };
  if (Number.isFinite(typeId) && typeMap[typeId]) return typeMap[typeId];

  const grp = Number(c?.group);
  const groupMap: Record<number, string> = {
    1: "Koşu",
    2: "Bisiklet",
    3: "Yüzme",
    4: "Yürüyüş & Diğer",
    5: "Kuvvet & Fitness",
  };
  if (Number.isFinite(grp) && groupMap[grp]) return groupMap[grp];
  return "Diğer Aktiviteler";
}

async function reverseGeocodeTr(lat: number, lon: number, fallbackName?: string | null): Promise<string> {
  try {
    const phRes = await fetch(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`,
      {
        headers: { "User-Agent": "GarminCoachApp/1.0 (https://github.com/testworkteams-png/GarminCoach)" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (phRes.ok) {
      const ph = await phRes.json();
      const p = ph?.features?.[0]?.properties || {};
      const sub = p.district || p.locality || "";
      const dist = p.city || p.county || p.state || "";
      if (sub && dist && sub !== dist) return `${sub}, ${dist}`;
      if (dist || sub) return String(dist || sub);
    }
  } catch (_) {}

  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=tr`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const g = await res.json();
      const admins: any[] = g?.localityInfo?.administrative || [];
      const district = admins.find((x: any) => x?.adminLevel === 6)?.name || "";
      const city = admins.find((x: any) => x?.adminLevel === 4)?.name || g?.city || g?.principalSubdivision || "";
      const locality = g?.locality || "";
      if (locality && district && locality !== district) return `${locality}, ${district}`;
      if (district && city && district !== city) return `${district}, ${city}`;
      if (district || locality || city) return String(district || locality || city);
    }
  } catch (_) {}

  try {
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=tr`,
      {
        headers: { "User-Agent": "GarminCoachApp/1.0 (https://github.com/testworkteams-png/GarminCoach)" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (nomRes.ok) {
      const nom = await nomRes.json();
      const addr = nom?.address || {};
      const sub = addr.neighbourhood || addr.suburb || addr.quarter || "";
      const dist = addr.town || addr.city_district || addr.county || addr.city || addr.province || "";
      if (sub && dist && sub !== dist) return `${sub}, ${dist}`;
      if (dist || sub) return String(dist || sub);
    }
  } catch (_) {}

  if (fallbackName && String(fallbackName).trim()) return String(fallbackName).trim();
  return `GPS (${lat.toFixed(3)}, ${lon.toFixed(3)})`;
}

async function aktifKonumuBelirle(
  supabase: any,
  userId: string,
  settings: any,
  opts?: { liveLat?: number; liveLon?: number; liveCity?: string; liveAccuracy?: number; clearLiveGps?: boolean }
) {
  const manualCity = (settings?.manual_city_override || "").trim();
  const defLat = settings?.default_lat ?? DEFAULT_LAT;
  const defLon = settings?.default_lon ?? DEFAULT_LON;
  const defCity = settings?.default_city ?? DEFAULT_CITY;

  if (opts?.clearLiveGps && settings?.weather_cache?.live_gps) {
    const nextCache = { ...(settings?.weather_cache || {}) };
    delete nextCache.live_gps;
    settings.weather_cache = nextCache;
    await supabase
      .from("athlete_settings")
      .update({ weather_cache: nextCache, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  // Priority 1: Manual city override
  if (manualCity.length > 0) {
    try {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(manualCity)}&count=1&language=tr&format=json`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (geoRes.ok) {
        const geoJson = await geoRes.json();
        if (geoJson?.results?.length > 0) {
          const r = geoJson.results[0];
          const resolvedCity = r.admin2 || r.name || manualCity;
          const loc = {
            active_city: resolvedCity,
            active_lat: Number(r.latitude),
            active_lon: Number(r.longitude),
            location_source: "MANUAL",
          };
          await supabase.from("athlete_settings").update({ ...loc, updated_at: new Date().toISOString() }).eq("user_id", userId);
          return loc;
        }
      }
    } catch (_) {}
  }

  // Priority 2: Live Device / Browser GPS
  const hasNewLive = Number.isFinite(opts?.liveLat) && Number.isFinite(opts?.liveLon);
  const savedLive = !opts?.clearLiveGps ? settings?.weather_cache?.live_gps : null;
  const liveLat = hasNewLive ? Number(opts!.liveLat) : Number(savedLive?.lat);
  const liveLon = hasNewLive ? Number(opts!.liveLon) : Number(savedLive?.lon);
  if (Number.isFinite(liveLat) && Number.isFinite(liveLon)) {
    const resolvedCity = (opts?.liveCity && opts.liveCity.trim())
      ? opts.liveCity.trim()
      : (hasNewLive || !savedLive?.city ? await reverseGeocodeTr(liveLat, liveLon) : String(savedLive.city));
    const liveEntry = {
      lat: Number(liveLat.toFixed(6)),
      lon: Number(liveLon.toFixed(6)),
      city: resolvedCity,
      accuracy: opts?.liveAccuracy ?? savedLive?.accuracy ?? null,
      updated_at: hasNewLive ? new Date().toISOString() : (savedLive?.updated_at || new Date().toISOString()),
    };
    const nextCache = { ...(settings?.weather_cache || {}), live_gps: liveEntry };
    settings.weather_cache = nextCache;
    const loc = {
      active_city: resolvedCity,
      active_lat: liveEntry.lat,
      active_lon: liveEntry.lon,
      location_source: "LIVE_GPS",
    };
    await supabase
      .from("athlete_settings")
      .update({ ...loc, weather_cache: nextCache, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    return loc;
  }

  // Priority 3: Latest Real Outdoor Garmin GPS Activity
  const { data: recentActivities } = await supabase
    .from("activities")
    .select("start_lat, start_lon, location_name, start_time_local, activity_type")
    .eq("user_id", userId)
    .neq("activity_type", "strength_training")
    .not("start_lat", "is", null)
    .not("start_lon", "is", null)
    .order("start_time_local", { ascending: false })
    .limit(1);

  if (recentActivities && recentActivities.length > 0) {
    const act = recentActivities[0];
    const resolvedName = await reverseGeocodeTr(Number(act.start_lat), Number(act.start_lon), act.location_name);
    const loc = {
      active_city: resolvedName,
      active_lat: Number(act.start_lat),
      active_lon: Number(act.start_lon),
      location_source: "GARMIN_GPS",
    };
    await supabase.from("athlete_settings").update({ ...loc, updated_at: new Date().toISOString() }).eq("user_id", userId);
    return loc;
  }

  // Priority 4: Fallback default
  const defaultLoc = {
    active_city: defCity,
    active_lat: defLat,
    active_lon: defLon,
    location_source: "DEFAULT",
  };
  await supabase.from("athlete_settings").update({ ...defaultLoc, updated_at: new Date().toISOString() }).eq("user_id", userId);
  return defaultLoc;
}

function kiyafetOnerisiUret(tempC: number, windKmh: number, precipProb: number): string {
  const parts: string[] = [];
  if (tempC < 6) parts.push("Termal içlik + polar üst + rüzgarlık + bere/eldiven");
  else if (tempC < 12) parts.push("Uzun kollu nefes alan içlik + rüzgarlık ceket");
  else if (tempC < 18) parts.push("İnce uzun kollu teknik üst veya tişört + hafif yelek");
  else parts.push("Hafif nefes alan kısa kollu tişört/şort");
  if (windKmh >= 20) parts.push("Rüzgar kesici dış katman şart");
  if (precipProb >= 40) parts.push("Su itici yağmurluk ve şapka ekle");
  return parts.join(" · ");
}

function wmoCodeToTr(code: number): string {
  if (code === 0) return "Açık";
  if (code <= 3) return "Parçalı bulutlu";
  if (code <= 48) return "Sisli / Puslu";
  if (code <= 57) return "Çisenti";
  if (code <= 67) return "Yağmurlu";
  if (code <= 77) return "Karlı";
  if (code <= 82) return "Sağanak yağış";
  return "Fırtınalı";
}

async function havaMotoruVeAksamKadran(
  supabase: any,
  userId: string,
  settings: any,
  loc: { active_city: string; active_lat: number; active_lon: number },
  todayStr: string
) {
  const metByHour: Record<number, { temp_c: number; wind_kmh: number; precip_prob: number }> = {};
  let primarySource = "MET Norway";

  try {
    const metRes = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${loc.active_lat.toFixed(4)}&lon=${loc.active_lon.toFixed(4)}`,
      {
        headers: { "User-Agent": "GarminCoachApp/1.0 (https://github.com/testworkteams-png/GarminCoach)" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (metRes.ok) {
      const metJson = await metRes.json();
      const series = metJson?.properties?.timeseries || [];
      for (const entry of series) {
        const dt = new Date(entry.time);
        const trParts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Istanbul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          hour12: false,
        }).formatToParts(dt);
        const pm: Record<string, string> = {};
        for (const p of trParts) pm[p.type] = p.value;
        const dStr = `${pm.year}-${pm.month}-${pm.day}`;
        const h = Number(pm.hour === "24" ? 0 : pm.hour);
        if (dStr === todayStr && entry?.data?.instant?.details) {
          const d = entry.data.instant.details;
          const next1h = entry.data?.next_1_hours?.details?.precipitation_amount ?? 0;
          metByHour[h] = {
            temp_c: Number((d.air_temperature ?? 13).toFixed(1)),
            wind_kmh: Number(((d.wind_speed ?? 3) * 3.6).toFixed(1)),
            precip_prob: next1h > 0.2 ? 75 : next1h > 0 ? 35 : 10,
          };
        }
      }
    }
  } catch (_) {
    primarySource = "Open-Meteo";
  }

  const omByHour: Record<number, { temp_c: number; feels_like_c: number; wind_kmh: number; precip_prob: number }> = {};
  let sunsetStr = "17:45";
  let forecast7d: any[] = [];

  try {
    const omRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.active_lat}&longitude=${loc.active_lon}&hourly=temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunset,weather_code&timezone=Europe%2FIstanbul&forecast_days=7`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (omRes.ok) {
      const om = await omRes.json();
      const times: string[] = om?.hourly?.time || [];
      times.forEach((t, idx) => {
        if (t.startsWith(todayStr)) {
          const hr = Number(t.slice(11, 13));
          if (hr >= 0 && hr <= 23) {
            omByHour[hr] = {
              temp_c: Number((om.hourly.temperature_2m[idx] ?? 13).toFixed(1)),
              feels_like_c: Number((om.hourly.apparent_temperature[idx] ?? 12).toFixed(1)),
              wind_kmh: Number((om.hourly.wind_speed_10m[idx] ?? 10).toFixed(1)),
              precip_prob: Math.round(om.hourly.precipitation_probability[idx] ?? 10),
            };
          }
        }
      });

      if (om?.daily?.sunset?.[0]) sunsetStr = om.daily.sunset[0].slice(11, 16);

      const dTimes: string[] = om?.daily?.time || [];
      const trDays = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
      forecast7d = dTimes.map((dtStr: string, i: number) => {
        const dayIdx = new Date(`${dtStr}T12:00:00Z`).getUTCDay();
        return {
          date: dtStr,
          day: trDays[dayIdx],
          temp_min: Math.round(om.daily.temperature_2m_min[i] ?? 8),
          temp_max: Math.round(om.daily.temperature_2m_max[i] ?? 15),
          precip_prob: Math.round(om.daily.precipitation_probability_max[i] ?? 15),
          wind_kmh: Math.round(om.daily.wind_speed_10m_max[i] ?? 12),
          weather_code: Number(om.daily.weather_code[i] ?? 1),
          summary: wmoCodeToTr(om.daily.weather_code[i] ?? 1),
        };
      });
    }
  } catch (_) {}

  const aqByHour: Record<number, { aqi: number; pm25: number }> = {};
  try {
    const aqRes = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.active_lat}&longitude=${loc.active_lon}&hourly=european_aqi,pm2_5&timezone=Europe%2FIstanbul&forecast_days=2`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (aqRes.ok) {
      const aq = await aqRes.json();
      const aqTimes: string[] = aq?.hourly?.time || [];
      aqTimes.forEach((t, idx) => {
        if (t.startsWith(todayStr)) {
          const hr = Number(t.slice(11, 13));
          if (hr >= 0 && hr <= 23) {
            aqByHour[hr] = {
              aqi: Math.round(aq.hourly.european_aqi[idx] ?? 25),
              pm25: Number((aq.hourly.pm2_5[idx] ?? 8.0).toFixed(1)),
            };
          }
        }
      });
    }
  } catch (_) {}

  const hasLiveMet = Object.keys(metByHour).length > 0;
  const hasLiveOm = Object.keys(omByHour).length > 0;
  const cache = settings?.weather_cache;
  const cacheFresh = cache?.cached_at && (Date.now() - new Date(cache.cached_at).getTime()) < 6 * 3600 * 1000;

  if (!hasLiveMet && !hasLiveOm && cacheFresh && cache?.evening_weather) {
    return {
      eveningWeather: { ...cache.evening_weather, source: "6 Saatlik Önbellek" },
      forecast7d: cache.forecast7d || [],
    };
  }

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const hourlySlots = hours.map((h) => {
    const m = metByHour[h];
    const o = omByHour[h];
    const aq = aqByHour[h] || { aqi: 28, pm25: 8.5 };
    const temp = m?.temp_c ?? o?.temp_c ?? 13.0;
    const feels = o?.feels_like_c ?? Number((temp - 0.8).toFixed(1));
    const wind = m?.wind_kmh ?? o?.wind_kmh ?? 11.0;
    const precip = o?.precip_prob ?? m?.precip_prob ?? 10;
    const dial = dialForAqi(aq.aqi);
    return {
      hour: `${String(h).padStart(2, "0")}:00`,
      temp_c: temp,
      feels_like_c: feels,
      wind_kmh: wind,
      precip_prob: precip,
      aqi: aq.aqi,
      pm25: aq.pm25,
      dial_level: dial.dial_level,
    };
  });

  const istNow = getIstanbulNow();
  const currentSlot = hourlySlots[istNow.hour] || hourlySlots[0];
  const finalTemp = currentSlot.temp_c;
  const finalFeels = currentSlot.feels_like_c;
  const finalWind = currentSlot.wind_kmh;
  const finalPrecip = currentSlot.precip_prob;
  const finalAqi = currentSlot.aqi;
  const finalPm25 = currentSlot.pm25;
  const mainDial = dialForAqi(finalAqi);

  const eveningWeather = {
    city: loc.active_city,
    lat: loc.active_lat,
    lon: loc.active_lon,
    source: hasLiveMet ? "MET Norway + Open-Meteo AQI" : primarySource,
    window: "00:00-23:00",
    temp_c: finalTemp,
    feels_like_c: finalFeels,
    wind_kmh: finalWind,
    precip_prob: finalPrecip,
    sunset: sunsetStr,
    aqi_max: finalAqi,
    pm25_max: finalPm25,
    dial_level: mainDial.dial_level,
    dial_index: mainDial.dial_index,
    hourly_slots: hourlySlots,
    clothing_advice: kiyafetOnerisiUret(finalTemp, finalWind, finalPrecip),
    updated_at: new Date().toISOString(),
  };

  const { data: freshWSet } = await supabase
    .from("athlete_settings")
    .select("weather_cache")
    .eq("user_id", userId)
    .maybeSingle();

  const updatedCache = {
    ...(freshWSet?.weather_cache || settings?.weather_cache || {}),
    cached_at: new Date().toISOString(),
    evening_weather: eveningWeather,
    forecast7d,
  };
  if (settings && typeof settings === "object") settings.weather_cache = updatedCache;

  await supabase
    .from("athlete_settings")
    .update({
      weather_cache: updatedCache,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return { eveningWeather, forecast7d };
}

function detectRedFlags(bio: any, settings: any) {
  const flags: any[] = [];
  if (!bio) return flags;

  const rhrWarn = settings?.rhr_warn_threshold ?? 51;
  const rhrExt = settings?.rhr_extreme_threshold ?? 55;
  if (bio.rhr != null && bio.rhr >= rhrExt) {
    flags.push({ metric: "RHR", value: bio.rhr, threshold: rhrExt, severity: "CRITICAL", message: `Dinlenik nabız ${bio.rhr} atım/dk (yüksek eşik ≥${rhrExt})` });
  } else if (bio.rhr != null && bio.rhr >= rhrWarn) {
    flags.push({ metric: "RHR", value: bio.rhr, threshold: rhrWarn, severity: "WARN", message: `Dinlenik nabız ${bio.rhr} atım/dk (uyarı eşiği ≥${rhrWarn})` });
  }

  const hrvWarn = settings?.hrv_warn_threshold ?? 48;
  const hrvExt = settings?.hrv_extreme_threshold ?? 40;
  if (bio.hrv_nightly_avg != null && bio.hrv_nightly_avg <= hrvExt) {
    flags.push({ metric: "HRV", value: bio.hrv_nightly_avg, threshold: hrvExt, severity: "CRITICAL", message: `Gece toparlanması ${bio.hrv_nightly_avg} puan (düşük eşik ≤${hrvExt})` });
  } else if (bio.hrv_nightly_avg != null && bio.hrv_nightly_avg <= hrvWarn) {
    flags.push({ metric: "HRV", value: bio.hrv_nightly_avg, threshold: hrvWarn, severity: "WARN", message: `Gece toparlanması ${bio.hrv_nightly_avg} puan (uyarı eşiği ≤${hrvWarn})` });
  }

  const respWarn = Number(settings?.resp_warn_threshold ?? 18.0);
  if (bio.sleep_respiration_avg != null && Number(bio.sleep_respiration_avg) >= respWarn) {
    flags.push({ metric: "RESP", value: Number(bio.sleep_respiration_avg), threshold: respWarn, severity: "WARN", message: `Gece solunumu ${bio.sleep_respiration_avg} nefes/dk (eşik ≥${respWarn})` });
  }

  const stressWarn = settings?.sleep_stress_threshold ?? 23;
  if (bio.sleep_stress_avg != null && Number(bio.sleep_stress_avg) >= stressWarn) {
    flags.push({ metric: "SLEEP_STRESS", value: Number(bio.sleep_stress_avg), threshold: stressWarn, severity: "WARN", message: `Uyku stresi ${bio.sleep_stress_avg} (eşik ≥${stressWarn})` });
  }

  const tempWarn = Number(settings?.skin_temp_deviation_threshold ?? 0.4);
  if (bio.skin_temp_deviation != null && Number(bio.skin_temp_deviation) >= tempWarn) {
    flags.push({ metric: "SKIN_TEMP", value: Number(bio.skin_temp_deviation), threshold: tempWarn, severity: "WARN", message: `Deri sıcaklığı +${bio.skin_temp_deviation}°C (eşik ≥+${tempWarn}°C)` });
  }

  const spo2Warn = settings?.spo2_warn_threshold ?? 91;
  const spo2Ext = settings?.spo2_extreme_threshold ?? 87;
  const spo2AvgVal = bio.spo2_avg != null ? Number(bio.spo2_avg) : null;
  const spo2Val = spo2AvgVal ?? (bio.spo2_min != null ? Number(bio.spo2_min) : null);
  if (spo2Val != null && spo2Val <= spo2Ext) {
    flags.push({ metric: "SPO2", value: spo2Val, threshold: spo2Ext, severity: "CRITICAL", message: `Gece Oksijen %${spo2Val} (kritik ≤%${spo2Ext})` });
  } else if (spo2Val != null && spo2Val <= spo2Warn) {
    flags.push({ metric: "SPO2", value: spo2Val, threshold: spo2Warn, severity: "WARN", message: `Gece Oksijen %${spo2Val} (uyarı ≤%${spo2Warn})` });
  }

  return flags;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveLegacyAppAuth(settings: any) {
  const appAuth = settings?.weather_cache?.app_auth;
  const isCustom = Boolean(appAuth?.is_custom && appAuth?.username && appAuth?.password_hash);
  const expectedUser = isCustom ? String(appAuth.username) : "ali";
  const expectedHash = isCustom ? String(appAuth.password_hash) : await sha256Hex("gc_salt_2026:garmin2026");
  return { appAuth, isCustom, expectedUser, expectedHash };
}

async function geminiApiCagir(
  promptText: string,
  temperature = 0.25,
  debugOut?: string[],
  customGeminiKey?: string | null
): Promise<any | null> {
  const apiKey = (customGeminiKey && String(customGeminiKey).trim()) || Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    debugOut?.push("NO_API_KEY");
    return null;
  }

  const candidateModels = [
    "models/gemini-2.5-flash-lite",
    "models/gemini-2.5-flash",
    "models/gemini-2.0-flash",
  ];

  for (const modelName of candidateModels) {
    try {
      const generationConfig: Record<string, unknown> = {
        temperature,
        maxOutputTokens: 700,
        responseMimeType: "application/json",
      };
      if (modelName.includes("gemini-2.5")) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(25000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig,
          }),
        }
      );

      if (!res.ok) {
        const errBody = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
        debugOut?.push(`${modelName}:HTTP_${res.status}:${errBody}`);
        continue;
      }
      const data = await res.json();
      const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
      const texts = parts.map((p: any) => String(p?.text || "")).filter(Boolean);
      const joined = texts.join("\n").trim();
      const rawText =
        texts.find((t: string) => t.trim().startsWith("{") || t.trim().startsWith("[")) ||
        texts[texts.length - 1] ||
        joined;
      if (!rawText) {
        debugOut?.push(`${modelName}:EMPTY_TEXT`);
        continue;
      }

      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch (_) {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (!m) {
          debugOut?.push(`${modelName}:PARSE_FAIL:${cleaned.slice(0, 80)}`);
          continue;
        }
        parsed = JSON.parse(m[0]);
      }
      if (Array.isArray(parsed)) parsed = parsed[0];
      if (parsed && typeof parsed === "object") {
        parsed.model_used = modelName;
        return parsed;
      }
      debugOut?.push(`${modelName}:NOT_OBJ`);
    } catch (e) {
      debugOut?.push(`${modelName}:ERR:${String(e).slice(0, 80)}`);
      continue;
    }
  }
  console.error("geminiApiCagir exhausted:", debugOut?.join(" | "));
  return null;
}

// --- FCM HTTP v1 Push Notification Helper ---
function b64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getFcmAccessToken(serviceAccountJson: string): Promise<{ token: string; projectId: string } | null> {
  try {
    const sa = JSON.parse(serviceAccountJson);
    if (!sa?.client_email || !sa?.private_key || !sa?.project_id) return null;

    const pem = String(sa.private_key)
      .replace(/-----BEGIN PRIVATE KEY-----/g, "")
      .replace(/-----END PRIVATE KEY-----/g, "")
      .replace(/\s+/g, "");
    const binStr = atob(pem);
    const der = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) der[i] = binStr.charCodeAt(i);

    const key = await crypto.subtle.importKey(
      "pkcs8",
      der.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const header = b64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64UrlEncode(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: nowSec,
        exp: nowSec + 3600,
      })
    );
    const signingInput = `${header}.${claims}`;
    const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
    const jwt = `${signingInput}.${b64UrlEncode(new Uint8Array(sigBuf))}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) return null;
    const tokenJson = await tokenRes.json();
    if (!tokenJson?.access_token) return null;
    return { token: tokenJson.access_token, projectId: sa.project_id };
  } catch (e) {
    console.error("FCM token err:", e);
    return null;
  }
}

async function sendUserNotification(
  supabase: any,
  userId: string,
  notif: {
    type: "MORNING_REPORT" | "WORKOUT_REPORT" | "WEEKLY_CEO" | "MONTHLY_CEO" | "HEALTH_ALERT";
    title: string;
    body: string;
    payload?: Record<string, any>;
    activity_id?: number | null;
    report_date?: string | null;
  }
) {
  let pushStatus: "IN_APP_ONLY" | "SENT" | "FAILED" = "IN_APP_ONLY";
  let pushSentAt: string | null = null;

  const { data: tokens } = await supabase
    .from("user_push_tokens")
    .select("id, fcm_token, platform")
    .eq("user_id", userId)
    .eq("enabled", true);

  const fcmSa = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (fcmSa && Array.isArray(tokens) && tokens.length > 0) {
    const auth = await getFcmAccessToken(fcmSa);
    if (auth) {
      let anySent = false;
      const flatData: Record<string, string> = {
        type: notif.type,
        ...(notif.activity_id != null ? { activity_id: String(notif.activity_id) } : {}),
        ...(notif.report_date ? { report_date: String(notif.report_date) } : {}),
        ...(notif.payload?.tab ? { tab: String(notif.payload.tab) } : {}),
      };
      for (const tk of tokens) {
        try {
          const r = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${auth.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token: tk.fcm_token,
                notification: { title: notif.title, body: notif.body },
                data: flatData,
                android: { priority: "high" },
              },
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) {
            anySent = true;
          } else {
            const errTxt = await r.text();
            if (errTxt.includes("UNREGISTERED") || errTxt.includes("INVALID_ARGUMENT")) {
              await supabase.from("user_push_tokens").update({ enabled: false }).eq("id", tk.id);
            }
          }
        } catch (_) {}
      }
      pushStatus = anySent ? "SENT" : "FAILED";
      if (anySent) pushSentAt = new Date().toISOString();
    } else {
      pushStatus = "FAILED";
    }
  }

  const { data: inserted } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      type: notif.type,
      title: notif.title,
      body: notif.body,
      payload: notif.payload || {},
      activity_id: notif.activity_id ?? null,
      report_date: notif.report_date ?? null,
      push_status: pushStatus,
      push_sent_at: pushSentAt,
    })
    .select("*")
    .single();

  return inserted;
}

// --- Multi-Tenant Owner Bootstrap & Auth Helpers ---
async function ensureOwnerUserId(supabase: any): Promise<string> {
  const { data: existingSettings } = await supabase
    .from("athlete_settings")
    .select("id, user_id, weather_cache, display_name")
    .order("id", { ascending: true })
    .limit(5);

  const alreadyLinked = (existingSettings || []).find((s: any) => s.user_id);
  let ownerId: string | null = alreadyLinked?.user_id || null;

  if (!ownerId) {
    const { data: userList } = await supabase.auth.admin.listUsers({ page: 1, perPage: 50 });
    const found = (userList?.users || []).find((u: any) => String(u.email || "").toLowerCase() === OWNER_EMAIL);
    if (found) {
      ownerId = found.id;
    } else {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: OWNER_EMAIL,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { display_name: "Ali", role: "owner" },
      });
      if (createErr || !created?.user) {
        throw new Error(createErr?.message || "Owner auth user creation failed");
      }
      ownerId = created.user.id;
    }
  }

  // Backfill any unowned rows from legacy single-user setup
  const legacySettings = (existingSettings || []).find((s: any) => !s.user_id);
  if (legacySettings) {
    const ownerName = legacySettings?.weather_cache?.app_auth?.username || "Ali";
    await supabase
      .from("athlete_settings")
      .update({ user_id: ownerId, display_name: legacySettings.display_name || ownerName })
      .is("user_id", null);
  }
  await supabase.from("daily_biometrics").update({ user_id: ownerId }).is("user_id", null);
  await supabase.from("activities").update({ user_id: ownerId }).is("user_id", null);
  await supabase.from("weekly_strategies").update({ user_id: ownerId }).is("user_id", null);
  await supabase.from("sync_logs").update({ user_id: ownerId }).is("user_id", null);

  await supabase.from("user_integrations").upsert(
    {
      user_id: ownerId,
      garmin_api_base_url: Deno.env.get("GARMIN_API_BASE_URL") || DEFAULT_GARMIN_BASE,
      use_owner_default: true,
      connection_status: Deno.env.get("GARMIN_API_KEY") ? "CONNECTED" : "NOT_CONFIGURED",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id", ignoreDuplicates: true }
  );

  return ownerId;
}

async function getAuthenticatedUser(req: Request, supabase: any) {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const jwt = match[1].trim();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!jwt || jwt === anonKey || jwt.startsWith("sb_publishable_") || jwt.split(".").length !== 3) {
    return null;
  }
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user;
}

function getAuthAnonClient(serviceRoleKey: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey;
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureUserSettingsAndIntegration(supabase: any, user: any) {
  const { data: settings } = await supabase
    .from("athlete_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  let activeSettings = settings;
  if (!activeSettings) {
    const displayName = user.user_metadata?.display_name || String(user.email || "Sporcu").split("@")[0];
    const { data: inserted } = await supabase
      .from("athlete_settings")
      .insert({
        user_id: user.id,
        display_name: displayName,
      })
      .select("*")
      .single();
    activeSettings = inserted;
  }

  let { data: integration } = await supabase
    .from("user_integrations")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!integration) {
    const isOwner = String(user.email || "").toLowerCase() === OWNER_EMAIL;
    const { data: insInt } = await supabase
      .from("user_integrations")
      .upsert(
        {
          user_id: user.id,
          use_owner_default: isOwner,
          garmin_api_base_url: DEFAULT_GARMIN_BASE,
          connection_status: isOwner && Deno.env.get("GARMIN_API_KEY") ? "CONNECTED" : "NOT_CONFIGURED",
        },
        { onConflict: "user_id" }
      )
      .select("*")
      .single();
    integration = insInt;
  }

  return { settings: activeSettings, integration };
}

function buildDeepAthleteContext(recentBios: any[], recentActs: any[], _settings?: any) {
  const bios = Array.isArray(recentBios) ? recentBios : [];
  const acts = Array.isArray(recentActs) ? recentActs : [];
  const latest = bios[0] || {};

  const sleepDays = bios.slice(0, 7).filter((d: any) => Number(d.sleep_seconds || 0) > 0);
  const avgSleepH = sleepDays.length
    ? Number((sleepDays.reduce((s: number, d: any) => s + Number(d.sleep_seconds) / 3600, 0) / sleepDays.length).toFixed(2))
    : null;
  const sleepDebtH = sleepDays.length
    ? Number(Math.max(0, sleepDays.reduce((s: number, d: any) => s + (7.5 - Number(d.sleep_seconds) / 3600), 0)).toFixed(1))
    : 0;

  const nowMs = Date.now();
  const muscles6 = ["Göğüs", "Ön Kol", "Omuz", "Sırt", "Core", "Bacak"];
  const lastMs: Record<string, number> = {};
  for (const a of acts) {
    const tMs = new Date(a.start_time_local).getTime();
    if (!Number.isFinite(tMs)) continue;
    const hm = a.muscle_heatmap || {};
    const isStr = a.activity_type === "strength_training";
    for (const m of muscles6) {
      const val = Number(hm[m] || 0);
      if ((isStr && val >= 60) || (!isStr && m === "Bacak" && val >= 75)) {
        if (!lastMs[m] || tMs > lastMs[m]) lastMs[m] = tMs;
      }
    }
  }
  const muscleRecovery: Record<string, { recovery_pct: number; hours_ago: number | null }> = {};
  for (const m of muscles6) {
    if (!lastMs[m]) {
      muscleRecovery[m] = { recovery_pct: 100, hours_ago: null };
    } else {
      const hrs = Math.max(0, (nowMs - lastMs[m]) / 3600000);
      muscleRecovery[m] = {
        recovery_pct: Math.min(100, Math.round((hrs / 48) * 100)),
        hours_ago: Math.round(hrs),
      };
    }
  }

  const rotations = [
    { id: "chest_arms", title: "Kochler - Göğüs & Ön Kol", muscles: ["Göğüs", "Ön Kol"] },
    { id: "shoulders_back", title: "Kochler - Omuz & Sırt", muscles: ["Omuz", "Sırt"] },
    { id: "core_legs", title: "Ab Roller & Squat", muscles: ["Core", "Bacak"] },
  ];
  let bestRot = rotations[0];
  let bestRec = -1;
  for (const r of rotations) {
    const avg = Math.round(r.muscles.reduce((s, m) => s + (muscleRecovery[m]?.recovery_pct ?? 100), 0) / r.muscles.length);
    if (avg > bestRec) {
      bestRec = avg;
      bestRot = r;
    }
  }

  const prs: Record<string, { muscle: string; sets_x_reps: string; weight_kg: number; volume_kg: number }> = {};
  for (const a of acts) {
    const setsArr = Array.isArray(a.exercise_sets) ? a.exercise_sets : [];
    for (const s of setsArr) {
      const name = String(s.exercise || "").trim();
      if (!name || name.toUpperCase() === "CARDIO") continue;
      const sc = Math.max(1, Number(s.sets || 1));
      const rawR = Number(s.reps || 15);
      const perSet = sc > 1 && rawR >= sc * 4 ? Math.round(rawR / sc) : rawR;
      const wt = Number(s.weight_kg || 0);
      const vol = Number(s.volume_kg || 0);
      if (!prs[name] || vol > prs[name].volume_kg) {
        prs[name] = { muscle: s.muscle || "Core", sets_x_reps: `${sc} set x ${perSet} tekrar`, weight_kg: wt, volume_kg: vol };
      }
    }
  }

  const topPrEntries = Object.entries(prs)
    .sort((a, b) => b[1].volume_kg - a[1].volume_kg)
    .slice(0, 6);
  const compactPrs: Record<string, { muscle: string; sets_x_reps: string; weight_kg: number; volume_kg: number }> = {};
  for (const [k, v] of topPrEntries) compactPrs[k] = v;

  const te = latest?.raw_payload?.telemetry_extra || {};
  return {
    sleep_7d_avg_h: avgSleepH,
    sleep_7d_debt_h: sleepDebtH,
    muscle_recovery_48h: muscleRecovery,
    recommended_rotation: { ...bestRot, recovery_pct: bestRec },
    exercise_prs: compactPrs,
    intraday: {
      bb_current: te.bb_current ?? latest?.body_battery_min ?? null,
      hrv_5min_high: te.hrv_5min_high ?? null,
      stress_qualifier: te.stress_breakdown?.qualifier ?? null,
      max_stress: te.stress_breakdown?.max_stress ?? null,
      active_kcal: te.metabolism?.active_kcal ?? latest?.active_kilocalories ?? null,
      total_kcal: te.metabolism?.total_kcal ?? null,
    },
  };
}

function yerelGunlukYorumOlustur(bio: any, weather: any, flags: any[], ist: IstanbulTime, settings: any) {
  const score = bio?.readiness_score ?? 75;
  const age = new Date().getUTCFullYear() - (settings?.birth_year ?? 1988);
  const isStrengthDay = ["Pazartesi", "Salı", "Cuma"].includes(ist.dayOfWeekTr);
  const hasAlert = flags.length > 0;

  let headline = `${ist.dayOfWeekTr} Hazırlık ${score}/100`;
  if (hasAlert) {
    headline = `Dikkat Gerektiriyor (${flags.length} Uyarı) — Toparlanma Öncelikli Gün`;
  } else if (score >= 80) {
    headline = `${ist.dayOfWeekTr} Optimum Hazırlık (${score}/100) — Güçlü Antrenmana Hazır`;
  }

  const baseRhr = settings?.base_rhr ?? 46;
  const baseHrvMin = settings?.base_hrv_min ?? 59;
  const baseHrvMax = settings?.base_hrv_max ?? 74;
  const morningNote = `Yaş ${age} profiline göre: Gece toparlanması ${bio?.hrv_nightly_avg ?? "--"} puan (normal ${baseHrvMin}–${baseHrvMax}), Dinlenik Nabız ${bio?.rhr ?? "--"} atım/dk (normal ${baseRhr}), Uyku Puanı ${bio?.sleep_score ?? "--"}, En Yüksek Enerji ${bio?.body_battery_max ?? "--"}/100.`;

  let strengthRec = "Bugün aktif dinlenme / hafif esneme günü.";
  if (hasAlert || score < 55) {
    strengthRec = "Vücut uyarısı veya düşük enerji nedeniyle ağır setleri bugün ertele; 15 dk hafif esneme yeterli.";
  } else if (isStrengthDay) {
    strengthRec = `${ist.dayOfWeekTr} kuvvet günü: Evde 6–10 kg dambıl ile kontrollü 4x15 set (60 sn dinlenme).`;
  }

  const aqiNote = weather?.dial_level === "KIRMIZI"
    ? "Akşam hava kalitesi düşük — açık hava yerine evde hafif yürüyüş veya esneme seç."
    : `${weather?.city ?? DEFAULT_CITY} 17:00–21:00 penceresi ${weather?.temp_c ?? 13}°C, hava kalitesi ${weather?.aqi_max ?? 25} (${weather?.dial_level ?? "YEŞİL"}). 5–6 km tempolu yürüyüş uygun.`;

  return {
    headline,
    morning_coach_note: morningNote,
    strength_prescription: strengthRec,
    evening_walk_plan: `${aqiNote} Öneri: ${weather?.clothing_advice ?? "Hafif katmanlı giyim."}`,
    source: "LOCAL_DETERMINISTIC",
  };
}

function yerelHaftalikProgramOlustur(forecast7d: any[], avgReadiness: number) {
  const days = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  return days.map((day, idx) => {
    const fc = forecast7d[idx] || {};
    const rainy = (fc.precip_prob ?? 0) >= 50;
    const isStrength = ["Pazartesi", "Salı", "Cuma"].includes(day);

    if (isStrength) {
      return {
        day,
        focus: rainy ? "Kuvvet + Ev İçi Esneme" : "Kuvvet + 5 km Yürüyüş",
        plan: `Dambıl Kuvvet 4x15${rainy ? " · Yağış nedeniyle açık hava yerine evde 15 dk karın/esneme" : " + 5 km rahat tempo açık hava yürüyüşü"}`,
        intensity: avgReadiness >= 75 ? "Orta-Yüksek" : "Orta",
      };
    }
    if (day === "Çarşamba") {
      return {
        day,
        focus: "Aktif Toparlanma",
        plan: rainy ? "Evde 25 dk omuz/sırt esneme" : "5 km düşük nabızlı toparlanma yürüyüşü",
        intensity: "Düşük",
      };
    }
    if (day === "Cumartesi") {
      return {
        day,
        focus: "Uzun Kardiyo",
        plan: rainy ? "Ev içi kardiyo / 30 dk hareket" : "6 km açık hava yürüyüş/hafif koşu",
        intensity: "Orta-Yüksek",
      };
    }
    return {
      day,
      focus: day === "Pazar" ? "Hafif Yürüyüş & Haftalık Değerlendirme" : "Aerobik Yürüyüş",
      plan: rainy ? "Ev içi hareketlilik + haftalık durum değerlendirmesi" : "5.5 km tempolu akşam yürüyüşü",
      intensity: "Orta",
    };
  });
}

function mapGarminMuscle(cat: string, sub: string, name: string): string {
  const exText = `${cat} ${sub}`.toUpperCase();
  if (exText.includes("CURL") || exText.includes("BICEP") || exText.includes("TRICEP") || exText.includes("ARM") || exText.includes("ÖN KOL")) return "Ön Kol";
  if (exText.includes("SQUAT") || exText.includes("LUNGE") || exText.includes("LEG") || exText.includes("CALF") || exText.includes("BACAK")) return "Bacak";
  if (exText.includes("WHEEL") || exText.includes("AB") || exText.includes("CORE") || exText.includes("PLANK") || exText.includes("CRUNCH") || exText.includes("SIT_UP")) return "Core";
  if (exText.includes("LAT") || exText.includes("ROW") || exText.includes("PULL") || exText.includes("BACK") || exText.includes("SIRT")) return "Sırt";
  if (exText.includes("SHOULDER") || exText.includes("OVERHEAD") || exText.includes("DELT") || exText.includes("LATERAL") || exText.includes("OMUZ")) return "Omuz";
  if (exText.includes("FLYE") || exText.includes("CHEST") || exText.includes("BENCH") || exText.includes("PUSH_UP") || exText.includes("GÖĞÜS")) return "Göğüs";

  const fb = name.toUpperCase();
  if (fb.includes("CURL") || fb.includes("ÖN KOL") || fb.includes("KOL")) return "Ön Kol";
  if (fb.includes("SQUAT") || fb.includes("BACAK")) return "Bacak";
  if (fb.includes("AB") || fb.includes("ROLLER") || fb.includes("CORE") || fb.includes("KARIN")) return "Core";
  if (fb.includes("LAT") || fb.includes("ROW") || fb.includes("SIRT")) return "Sırt";
  if (fb.includes("OMUZ") || fb.includes("PRESS")) return "Omuz";
  if (fb.includes("GÖĞÜS") || fb.includes("FLYE")) return "Göğüs";
  return "Core";
}

function buildMuscleHeatmapFromActivity(
  actName: string,
  actType: string,
  sets: any[] | null,
  distMeters = 0,
  elevGain = 0
) {
  if (actType !== "strength_training") {
    const km = Number(distMeters || 0) / 1000;
    const elev = Number(elevGain || 0);
    return {
      Bacak: Math.min(98, Math.round(68 + km * 3.2 + elev * 0.08)),
      Core: Math.min(86, Math.round(38 + km * 1.8 + elev * 0.12)),
      Sırt: Math.min(78, Math.round(28 + elev * 0.15)),
    };
  }
  const hm: Record<string, number> = {};
  if (Array.isArray(sets) && sets.length > 0) {
    for (const s of sets) {
      if (s.exercise === "CARDIO") continue;
      hm[s.muscle] = Math.min(98, (hm[s.muscle] || 74) + (Number(s.sets) || 1) * 5);
    }
  }
  const up = actName.toUpperCase();
  if (!hm["Göğüs"] && up.includes("GÖĞÜS")) hm["Göğüs"] = 90;
  if (!hm["Ön Kol"] && (up.includes("ÖN KOL") || up.includes("KOL"))) hm["Ön Kol"] = 86;
  if (!hm["Omuz"] && up.includes("OMUZ")) hm["Omuz"] = 88;
  if (!hm["Sırt"] && up.includes("SIRT")) hm["Sırt"] = 88;
  if (!hm["Bacak"] && up.includes("SQUAT")) hm["Bacak"] = 88;
  if (!hm["Core"] && (up.includes("CORE") || up.includes("KARIN") || up.includes("AB"))) hm["Core"] = 86;
  if (Object.keys(hm).length === 0) {
    return { Göğüs: 85, Omuz: 82, Sırt: 80, "Ön Kol": 78, Core: 70 };
  }
  return hm;
}

function resolveGarminCredentials(integration: any) {
  const customKey = (integration?.garmin_api_key || "").trim();
  const useOwnerDefault = Boolean(integration?.use_owner_default);
  const garminKey = customKey || (useOwnerDefault ? (Deno.env.get("GARMIN_API_KEY") || "") : "");
  const base = ((integration?.garmin_api_base_url || "").trim() || (useOwnerDefault ? Deno.env.get("GARMIN_API_BASE_URL") : "") || DEFAULT_GARMIN_BASE).replace(/\/$/, "");
  const geminiKey = (integration?.gemini_api_key || "").trim() || null;
  return { garminKey, base, geminiKey };
}

const garminBearerCache = new Map<string, { token: string; exp: number }>();

async function exchangeGarminBearerToken(base: string, garminKey: string) {
  let bearerToken = garminKey;
  if (garminKey.startsWith("GCDC_")) {
    const cacheKey = `${base}::${garminKey}`;
    const cached = garminBearerCache.get(cacheKey);
    if (cached && Date.now() < cached.exp) {
      return cached.token;
    }
    const tokenRes = await fetch(`${base}/personalapitoken-service/personal-api/personal-api-key/token`, {
      method: "POST",
      headers: {
        Authorization: `ApiKey ${garminKey}`,
        Accept: "text/plain",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenRes.ok) {
      const errTxt = await tokenRes.text();
      throw new Error(`Garmin Token HTTP ${tokenRes.status}: ${errTxt.slice(0, 160)}`);
    }
    bearerToken = (await tokenRes.text()).trim();
    garminBearerCache.set(cacheKey, { token: bearerToken, exp: Date.now() + 45 * 60 * 1000 });
  }
  return bearerToken;
}

async function syncFromGarminForUser(
  supabase: any,
  userId: string,
  todayStr: string,
  settings: any,
  integration: any,
  opts?: { onlyActivities?: boolean }
) {
  const { garminKey, base } = resolveGarminCredentials(integration);
  if (!garminKey) {
    return {
      synced: false,
      base_url: base,
      reason: "Kişisel Garmin API anahtarı henüz tanımlanmadı. Ayarlar → Garmin API Bağlantım bölümünden bağlayabilirsiniz.",
    };
  }

  let bearerToken = "";
  try {
    bearerToken = await exchangeGarminBearerToken(base, garminKey);
  } catch (e) {
    await supabase
      .from("user_integrations")
      .update({ connection_status: "ERROR", last_error: String(e), updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    return { synced: false, base_url: base, reason: String(e) };
  }

  const headers = { Authorization: `Bearer ${bearerToken}`, Accept: "application/json" };
  const safeGet = async (path: string) => {
    try {
      const r = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(10000) });
      if (r.status === 401 && garminKey.startsWith("GCDC_")) {
        garminBearerCache.delete(`${base}::${garminKey}`);
      }
      return r.ok ? await r.json() : null;
    } catch (_) {
      return null;
    }
  };
  const safeGetSt = async (path: string) => {
    try {
      const r = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(10000) });
      if (r.status === 401 && garminKey.startsWith("GCDC_")) {
        garminBearerCache.delete(`${base}::${garminKey}`);
      }
      return { status: r.status, data: r.ok ? await r.json() : null };
    } catch (_) {
      return { status: 0, data: null };
    }
  };

  try {
    const onlyActs = Boolean(opts?.onlyActivities);
    let sleepArr: any = null,
      hrv: any = null,
      summary: any = null,
      acts: any = null,
      vo2: any = null,
      vo2Latest: any = null,
      vo2Range: any = null,
      enduranceRes: any = null,
      fitnessAge: any = null,
      dailyHr: any = null,
      bbReport: any = null,
      dailyStress: any = null;
    let devicesRes: { status: number; data: any } = { status: 0, data: null };
    let lastUsedRes: { status: number; data: any } = { status: 0, data: null };
    let deviceInfoRes: { status: number; data: any } = { status: 0, data: null };
    let sensorsRes: { status: number; data: any } = { status: 0, data: null };

    if (onlyActs) {
      acts = await safeGet(`/activitylist-service/activities/search/activities?limit=6`);
    } else {
      const vo2RangeBase = new Date(`${todayStr}T00:00:00Z`);
      vo2RangeBase.setUTCDate(vo2RangeBase.getUTCDate() - 30);
      const vo2StartStr = vo2RangeBase.toISOString().slice(0, 10);

      [sleepArr, hrv, summary, acts, vo2, vo2Latest, vo2Range, enduranceRes, fitnessAge, dailyHr, bbReport, dailyStress, devicesRes, lastUsedRes, deviceInfoRes, sensorsRes] = await Promise.all([
        safeGet(`/sleep-service/sleep/dailySleepSummariesByDate?startDate=${todayStr}&endDate=${todayStr}`),
        safeGet(`/hrv-service/hrv/${todayStr}`),
        safeGet(`/usersummary-service/usersummary/daily?calendarDate=${todayStr}`),
        safeGet(`/activitylist-service/activities/search/activities?limit=6`),
        safeGet(`/metrics-service/metrics/maxmet/daily/${todayStr}/${todayStr}`),
        safeGet(`/metrics-service/metrics/maxmet/latest/${todayStr}`),
        safeGet(`/metrics-service/metrics/maxmet/daily/${vo2StartStr}/${todayStr}`),
        safeGet(`/metrics-service/metrics/endurancescore?calendarDate=${todayStr}`),
        safeGet(`/fitnessage-service/fitnessage/v2/${todayStr}`),
        safeGet(`/wellness-service/wellness/dailyHeartRate?date=${todayStr}`),
        safeGet(`/wellness-service/wellness/bodyBattery/reports/daily?startDate=${todayStr}&endDate=${todayStr}`),
        safeGet(`/wellness-service/wellness/dailyStress/${todayStr}`),
        safeGetSt(`/device-service/deviceregistration/devices`),
        safeGetSt(`/device-service/deviceservice/last-used`),
        safeGetSt(`/device-service/deviceservice/device-info/all`),
        safeGetSt(`/device-service/sensors`),
      ]);
      if (!dailyStress || !Array.isArray(dailyStress.stressValuesArray) || dailyStress.stressValuesArray.length === 0) {
        const stressFallback = await safeGet(`/wellness-service/wellness/dailyStress?date=${todayStr}`);
        if (stressFallback) dailyStress = stressFallback;
      }
    }
    const devices = devicesRes.data;
    const lastUsed = lastUsedRes.data;
    const deviceInfoAll = deviceInfoRes.data;
    const sensors = sensorsRes.data;

    const formatDeviceName = (raw: string) => {
      const clean = raw.trim();
      if (!clean) return "";
      return /^garmin\b/i.test(clean) ? clean : `Garmin ${clean}`;
    };
    const parseBatteryFields = (obj: any) => {
      if (!obj || typeof obj !== "object") return { level: null as number | null, status: null as string | null };
      const rawLvl = obj.batteryLevel ?? obj.batteryPercentage ?? obj.battery_level ?? obj.currentBatteryLevel ?? null;
      const lvlNum = rawLvl != null && Number.isFinite(Number(rawLvl)) ? Math.min(100, Math.max(0, Math.round(Number(rawLvl)))) : null;
      const rawSt = obj.batteryStatus ?? obj.battery_status ?? null;
      const stStr = rawSt != null && String(rawSt).trim() ? String(rawSt).trim().toUpperCase() : null;
      return { level: lvlNum, status: stStr };
    };

    const devPool: any[] = [
      ...(Array.isArray(devices) ? devices : []),
      ...(Array.isArray(deviceInfoAll) ? deviceInfoAll : []),
      ...(lastUsed && typeof lastUsed === "object" && !Array.isArray(lastUsed) ? [lastUsed] : []),
    ];
    const getDevRawName = (d: any) =>
      String(d?.productDisplayName || d?.deviceTypeName || d?.displayName || d?.lastUsedDeviceName || d?.deviceName || "").trim();

    let detectedDevice: Record<string, any> | null = null;
    if (devPool.length > 0) {
      const watchCandidate =
        devPool.find((d: any) => d?.primary && getDevRawName(d)) ||
        devPool.find((d: any) =>
          /watch|forerunner|fenix|fēnix|epix|venu|instinct|vivo|tactix|marq|enduro|descent|swim|approach/i.test(
            getDevRawName(d)
          )
        ) ||
        devPool.find((d: any) => Boolean(getDevRawName(d))) ||
        devPool[0];

      const rawName = getDevRawName(watchCandidate);
      const bat = parseBatteryFields(watchCandidate);
      if (rawName || bat.level != null || bat.status) {
        detectedDevice = {
          ...(rawName ? { name: formatDeviceName(rawName) } : {}),
          device_id: watchCandidate?.deviceId ?? watchCandidate?.unitId ?? null,
          software_version: watchCandidate?.softwareVersion ?? null,
          part_number: watchCandidate?.partNumber ?? null,
          ...(bat.level != null ? { battery_level: bat.level } : {}),
          ...(bat.status ? { battery_status: bat.status } : {}),
          source: Array.isArray(devices) && devices.length ? "garmin_device_api" : lastUsed ? "garmin_last_used_api" : "garmin_device_info_api",
          detected_at: new Date().toISOString(),
        };
      }
    }

    if (detectedDevice && (detectedDevice.battery_level == null || !detectedDevice.battery_status)) {
      const targetId = detectedDevice.device_id != null ? String(detectedDevice.device_id) : null;
      const extraSources = [...devPool, ...(Array.isArray(sensors) ? sensors : [])];
      for (const item of extraSources) {
        const b = parseBatteryFields(item);
        if (b.level == null && !b.status) continue;
        const itemId = item?.deviceId ?? item?.unitId ?? item?.parentDeviceId;
        const matchesWatch =
          (targetId && itemId != null && String(itemId) === targetId) ||
          Boolean(item?.primary) ||
          /watch|forerunner|fenix|fēnix|epix|venu|instinct|vivo|tactix|marq|enduro|descent|swim|approach/i.test(
            getDevRawName(item) || String(item?.sensorType || "")
          );
        if (matchesWatch) {
          if (detectedDevice.battery_level == null && b.level != null) detectedDevice.battery_level = b.level;
          if (!detectedDevice.battery_status && b.status) detectedDevice.battery_status = b.status;
        }
      }
    }

    if ((!detectedDevice || !detectedDevice.name) && Array.isArray(acts) && acts[0]?.deviceName) {
      const rawActDev = String(acts[0].deviceName).trim();
      if (rawActDev) {
        detectedDevice = {
          ...(detectedDevice || {}),
          name: formatDeviceName(rawActDev),
          source: detectedDevice?.source || "garmin_activity_meta",
          detected_at: new Date().toISOString(),
        };
      }
    }

    const deviceDebug: Record<string, any> = {
      statuses: {
        devices: devicesRes.status,
        last_used: lastUsedRes.status,
        device_info_all: deviceInfoRes.status,
        sensors: sensorsRes.status,
      },
      has_devices_arr: Array.isArray(devices),
      devices_count: Array.isArray(devices) ? devices.length : 0,
      has_last_used: Boolean(lastUsed && typeof lastUsed === "object"),
      last_used_keys: lastUsed && typeof lastUsed === "object" ? Object.keys(lastUsed).slice(0, 12) : [],
      has_device_info_all: Array.isArray(deviceInfoAll),
      device_info_count: Array.isArray(deviceInfoAll) ? deviceInfoAll.length : 0,
      has_sensors: Array.isArray(sensors),
      sensors_count: Array.isArray(sensors) ? sensors.length : 0,
      first_act_device_keys: Array.isArray(acts) && acts[0]
        ? Object.keys(acts[0]).filter((k) => /dev|watch|unit|meta|bat/i.test(k))
        : [],
      summary_device_keys: summary && typeof summary === "object"
        ? Object.keys(summary).filter((k) => /dev|watch|unit|bat|source/i.test(k))
        : [],
      act_meta_checked: false,
      act_meta_keys: [] as string[],
      act_top_keys: [] as string[],
    };

    const sleepDto = Array.isArray(sleepArr) ? sleepArr[0] : sleepArr?.dailySleepDTO || sleepArr;
    const bbEvents = (summary?.bodyBatteryActivityEventList || []).map((e: any) => {
      const startDt = e.eventStartTimeGmt ? new Date(`${e.eventStartTimeGmt.replace(" ", "T")}Z`) : null;
      const startTr = startDt
        ? new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(startDt)
        : "--:--";
      return {
        type: e.eventType,
        impact: e.bodyBatteryImpact,
        start_tr: startTr,
        duration_min: Math.round((e.durationInMilliseconds || 0) / 60000),
        label: e.activityName || e.shortFeedback || e.eventType,
      };
    });

    const hrvReadings = (hrv?.hrvReadings || []).map((r: any) => ({
      time: String(r.readingTimeLocal || r.readingTimeGMT || "").slice(11, 16),
      val: r.hrvValue,
    }));

    const bbSeriesRaw = bbReport?.[0]?.bodyBatteryValuesArray || [];
    let bbSeries = downsamplePairs(bbSeriesRaw, 36, "bb");
    if (bbSeries.length < 10 && Array.isArray(dailyStress?.bodyBatteryValuesArray)) {
      const bbFromStress = dailyStress.bodyBatteryValuesArray
        .map((p: any) => (Array.isArray(p) ? [p[0], typeof p[2] === "number" ? p[2] : p[1]] : null))
        .filter((p: any) => p && p[0] != null && p[1] != null && Number(p[1]) >= 0 && Number(p[1]) <= 100);
      if (bbFromStress.length > bbSeries.length) {
        bbSeries = downsamplePairs(bbFromStress, 36, "bb");
      }
    }
    const stressRaw = (dailyStress?.stressValuesArray || []).filter(
      (p: any) => Array.isArray(p) && p[0] != null && p[1] != null && Number(p[1]) >= 0 && Number(p[1]) <= 100
    );
    const stressSeries = downsamplePairs(stressRaw, 48, "stress");
    const intradayHr = downsamplePairs(dailyHr?.heartRateValues || [], 48, "hr");

    const endRaw = Array.isArray(enduranceRes) ? [...enduranceRes].reverse().find(Boolean) : enduranceRes;
    const endObj = endRaw?.enduranceScoreDTO || endRaw || null;
    const endContribsRaw = Array.isArray(endObj?.contributors) ? endObj.contributors : [];
    const enduranceDetail = endObj
      ? {
          classification: endObj.classification ?? null,
          feedback_phrase: endObj.feedbackPhrase ?? null,
          limits: {
            intermediate: endObj.classificationLowerLimitIntermediate ?? null,
            trained: endObj.classificationLowerLimitTrained ?? null,
            well_trained: endObj.classificationLowerLimitWellTrained ?? null,
            expert: endObj.classificationLowerLimitExpert ?? null,
            superior: endObj.classificationLowerLimitSuperior ?? null,
            elite: endObj.classificationLowerLimitElite ?? null,
          },
          contributors: endContribsRaw
            .map((c: any) => {
              const rawPct = c?.contribution ?? c?.percentage ?? c?.pct ?? c?.value ?? null;
              const numPct = rawPct != null && Number.isFinite(Number(rawPct)) ? Number(rawPct) : 0;
              return {
                activity_type_id: c?.activityTypeId ?? null,
                group: c?.group ?? null,
                label: resolveEnduranceContributorLabel(c),
                pct: Number(numPct.toFixed(1)),
              };
            })
            .filter((c: any) => c.pct > 0)
            .sort((a: any, b: any) => b.pct - a.pct),
        }
      : null;

    const faCompsRaw = fitnessAge?.components || {};
    const faComponents: Record<string, any> = {};
    for (const [k, v] of Object.entries(faCompsRaw)) {
      if (v && typeof v === "object") {
        const comp = v as any;
        faComponents[k] = {
          value: comp.value ?? null,
          target: comp.targetValue ?? null,
          potential_age: comp.potentialAge ?? null,
          stale: Boolean(comp.stale),
        };
      }
    }

    const telemetryExtra = {
      bb_current: summary?.bodyBatteryMostRecentValue ?? (bbSeries.length ? bbSeries[bbSeries.length - 1].bb : null),
      bb_during_sleep: summary?.bodyBatteryDuringSleep ?? null,
      bb_at_wake: summary?.bodyBatteryAtWakeTime ?? null,
      bb_feedback: summary?.bodyBatteryDynamicFeedbackEvent?.feedbackShortType ?? bbReport?.[0]?.bodyBatteryDynamicFeedbackEvent?.feedbackShortType ?? null,
      bb_events: bbEvents,
      bb_series: bbSeries,
      stress_series: stressSeries,
      hrv_5min_high: hrv?.hrvSummary?.lastNight5MinHigh ?? null,
      hrv_baseline: hrv?.hrvSummary?.baseline ?? null,
      hrv_readings: hrvReadings,
      stress_breakdown: {
        max_stress: summary?.maxStressLevel ?? dailyStress?.maxStressLevel ?? null,
        rest_pct: summary?.restStressPercentage ?? null,
        low_pct: summary?.lowStressPercentage ?? null,
        med_pct: summary?.mediumStressPercentage ?? null,
        high_pct: summary?.highStressPercentage ?? null,
        activity_pct: summary?.activityStressPercentage ?? null,
        qualifier: summary?.stressQualifier ?? null,
      },
      rhr_7d_avg: summary?.lastSevenDaysAvgRestingHeartRate ?? dailyHr?.lastSevenDaysAvgRestingHeartRate ?? null,
      intraday_hr: intradayHr,
      floors: {
        ascended: summary?.floorsAscended != null ? Number(summary.floorsAscended.toFixed(1)) : null,
        descended: summary?.floorsDescended != null ? Number(summary.floorsDescended.toFixed(1)) : null,
        goal: summary?.userFloorsAscendedGoal ?? 10,
        meters_up: summary?.floorsAscendedInMeters != null ? Number(summary.floorsAscendedInMeters.toFixed(1)) : null,
        altitude_m: summary?.averageMonitoringEnvironmentAltitude ?? null,
      },
      endurance_detail: enduranceDetail,
      fitness_age_detail: {
        chronological_age: fitnessAge?.chronologicalAge ?? null,
        current_age: fitnessAge?.fitnessAge != null ? Number(fitnessAge.fitnessAge.toFixed(1)) : null,
        achievable_age: fitnessAge?.achievableFitnessAge != null ? Number(fitnessAge.achievableFitnessAge.toFixed(1)) : null,
        vigorous_days: fitnessAge?.components?.vigorousDaysAvg?.value ?? null,
        vigorous_target: fitnessAge?.components?.vigorousDaysAvg?.targetValue ?? 3,
        vigorous_minutes: fitnessAge?.components?.vigorousMinutesAvg?.value ?? null,
        vigorous_minutes_target: fitnessAge?.components?.vigorousMinutesAvg?.targetValue ?? 75,
        rhr_value: fitnessAge?.components?.rhr?.value ?? null,
        rhr_target: fitnessAge?.components?.rhr?.targetValue ?? null,
        bmi_value: fitnessAge?.components?.bmi?.value ?? null,
        bmi_target: fitnessAge?.components?.bmi?.targetValue ?? null,
        body_fat_value: fitnessAge?.components?.bodyFat?.value ?? null,
        body_fat_target: fitnessAge?.components?.bodyFat?.targetValue ?? null,
        components: faComponents,
      },
      metabolism: {
        total_kcal: summary?.totalKilocalories != null ? Math.round(summary.totalKilocalories) : null,
        bmr_kcal: summary?.bmrKilocalories != null ? Math.round(summary.bmrKilocalories) : null,
        active_kcal: summary?.activeKilocalories != null ? Math.round(summary.activeKilocalories) : null,
        highly_active_min: Math.round((summary?.highlyActiveSeconds || 0) / 60),
        active_min: Math.round((summary?.activeSeconds || 0) / 60),
        sedentary_min: Math.round((summary?.sedentarySeconds || 0) / 60),
      },
      sleep_insights: {
        feedback: sleepDto?.sleepScoreFeedback ?? null,
        insight: sleepDto?.sleepScoreInsight ?? null,
      },
      waking_respiration: {
        avg: summary?.avgWakingRespirationValue ?? null,
        max: summary?.highestRespirationValue ?? null,
        min: summary?.lowestRespirationValue ?? null,
        latest: summary?.latestRespirationValue ?? null,
      },
    };

    const patch: Record<string, any> = {
      user_id: userId,
      log_date: todayStr,
      raw_payload: { telemetry_extra: telemetryExtra },
    };

    if (summary) {
      if (summary.bodyBatteryHighestValue != null) patch.body_battery_max = summary.bodyBatteryHighestValue;
      if (summary.bodyBatteryLowestValue != null) patch.body_battery_min = summary.bodyBatteryLowestValue;
      if (summary.bodyBatteryChargedValue != null) patch.body_battery_charged = summary.bodyBatteryChargedValue;
      if (summary.bodyBatteryDrainedValue != null) patch.body_battery_drained = summary.bodyBatteryDrainedValue;
      if (summary.restingHeartRate != null) patch.rhr = summary.restingHeartRate;
      if (summary.minHeartRate != null) patch.min_hr = summary.minHeartRate;
      if (summary.maxHeartRate != null) patch.max_hr = summary.maxHeartRate;
      if (summary.totalSteps != null) patch.steps = summary.totalSteps;
      if (summary.activeKilocalories != null) patch.active_kilocalories = Math.round(summary.activeKilocalories);
      if (summary.averageStressLevel != null) patch.stress_avg = summary.averageStressLevel;
      if (summary.moderateIntensityMinutes != null) patch.moderate_intensity_minutes = summary.moderateIntensityMinutes;
      if (summary.vigorousIntensityMinutes != null) patch.vigorous_intensity_minutes = summary.vigorousIntensityMinutes;
      if (summary.averageSpo2 != null) patch.spo2_avg = summary.averageSpo2;
      if (summary.lowestSpo2 != null) patch.spo2_min = summary.lowestSpo2;
    }

    if (sleepDto) {
      if (sleepDto.sleepScores?.overall?.value != null) patch.sleep_score = sleepDto.sleepScores.overall.value;
      if (sleepDto.sleepTimeSeconds != null) patch.sleep_seconds = sleepDto.sleepTimeSeconds;
      if (sleepDto.deepSleepSeconds != null) patch.deep_sleep_seconds = sleepDto.deepSleepSeconds;
      if (sleepDto.lightSleepSeconds != null) patch.light_sleep_seconds = sleepDto.lightSleepSeconds;
      if (sleepDto.remSleepSeconds != null) patch.rem_sleep_seconds = sleepDto.remSleepSeconds;
      if (sleepDto.awakeSleepSeconds != null) patch.awake_seconds = sleepDto.awakeSleepSeconds;
      if (sleepDto.averageRespirationValue != null) patch.sleep_respiration_avg = sleepDto.averageRespirationValue;
      if (sleepDto.avgSleepStress != null) patch.sleep_stress_avg = sleepDto.avgSleepStress;
      if (sleepDto.averageSpO2Value != null && patch.spo2_avg == null) patch.spo2_avg = sleepDto.averageSpO2Value;
      if (sleepDto.lowestSpO2Value != null && patch.spo2_min == null) patch.spo2_min = sleepDto.lowestSpO2Value;
      if (sleepDto.avgSkinTempDeviationC != null) patch.skin_temp_deviation = sleepDto.avgSkinTempDeviationC;
    }

    if (hrv?.hrvSummary) {
      if (hrv.hrvSummary.lastNightAvg != null) patch.hrv_nightly_avg = hrv.hrvSummary.lastNightAvg;
      if (hrv.hrvSummary.weeklyAvg != null) patch.hrv_weekly_avg = hrv.hrvSummary.weeklyAvg;
      if (hrv.hrvSummary.status != null) patch.hrv_status = hrv.hrvSummary.status;
    }
    const pickVo2FromEntry = (entry: any) =>
      entry?.generic?.vo2MaxPreciseValue ??
      entry?.generic?.vo2MaxValue ??
      entry?.cycling?.vo2MaxPreciseValue ??
      entry?.cycling?.vo2MaxValue ??
      null;
    const latestFromRange = Array.isArray(vo2Range)
      ? [...vo2Range].reverse().map(pickVo2FromEntry).find((v) => v != null) ?? null
      : null;
    const latestFromEndpoint = Array.isArray(vo2Latest)
      ? [...vo2Latest].reverse().map(pickVo2FromEntry).find((v) => v != null) ?? null
      : pickVo2FromEntry(vo2Latest);
    const vo2TodayVal = Array.isArray(vo2)
      ? pickVo2FromEntry(vo2[0])
      : pickVo2FromEntry(vo2);
    const resolvedVo2 = vo2TodayVal ?? latestFromEndpoint ?? latestFromRange;
    if (resolvedVo2 != null && Number.isFinite(Number(resolvedVo2)) && Number(resolvedVo2) > 0) {
      patch.vo2_max = Number(resolvedVo2);
    }

    const resolvedEndurance =
      enduranceRes?.overallScore ??
      enduranceRes?.enduranceScore ??
      enduranceRes?.value ??
      enduranceRes?.enduranceScoreDTO?.overallScore ??
      (Array.isArray(enduranceRes)
        ? [...enduranceRes]
            .reverse()
            .map((e: any) => e?.overallScore ?? e?.enduranceScore ?? e?.value ?? e?.enduranceScoreDTO?.overallScore ?? null)
            .find((v) => v != null) ?? null
        : null);
    if (resolvedEndurance != null && Number.isFinite(Number(resolvedEndurance)) && Number(resolvedEndurance) > 0) {
      patch.endurance_score = Math.round(Number(resolvedEndurance));
    }
    if (fitnessAge?.fitnessAge != null) patch.fitness_age = Math.round(fitnessAge.fitnessAge);

    if (Array.isArray(acts) && acts.length > 0) {
      const actIds = acts.slice(0, 6).map((a: any) => a.activityId).filter(Boolean);
      const { data: existingActs } = actIds.length
        ? await supabase
            .from("activities")
            .select("activity_id, post_workout_notified_at, ai_post_workout_analysis, session_comparison")
            .eq("user_id", userId)
            .in("activity_id", actIds)
        : { data: [] };
      const existingMap = new Map<number, any>();
      for (const ea of existingActs || []) existingMap.set(Number(ea.activity_id), ea);

      for (const a of acts.slice(0, 6)) {
        const actId = a.activityId;
        if (!actId) continue;
        const prevRow = existingMap.get(Number(actId));
        if (prevRow && (onlyActs || detectedDevice?.name)) {
          continue;
        }
        const actType = a.activityType?.typeKey || "other";
        const actName = a.activityName || "Garmin Aktivite";

        const [actSummaryApi, detailsApi] = await Promise.all([
          safeGet(`/activity-service/activity/${actId}`),
          safeGet(`/activity-service/activity/${actId}/details?maxChartSize=36&maxPolylineSize=55`),
        ]);

        if (!deviceDebug.act_meta_checked && actSummaryApi) {
          deviceDebug.act_meta_checked = true;
          const dm = actSummaryApi?.metadataDTO?.deviceMetaDataDTO;
          const actSensors = Array.isArray(actSummaryApi?.metadataDTO?.sensors) ? actSummaryApi.metadataDTO.sensors : [];
          deviceDebug.act_meta_keys = dm && typeof dm === "object" ? Object.keys(dm) : [];
          deviceDebug.act_top_keys = Object.keys(actSummaryApi?.metadataDTO || {}).filter((k) => /dev|sen|bat|unit/i.test(k));
          const actMetaDevName = String(
            dm?.deviceName || dm?.deviceTypeName || dm?.productDisplayName || actSummaryApi?.deviceName || ""
          ).trim();
          const actBat = parseBatteryFields(dm || actSummaryApi);
          const sensorBat = actSensors.map((s: any) => parseBatteryFields(s)).find((b: any) => b.level != null || b.status) || { level: null, status: null };
          const bestLevel = actBat.level ?? sensorBat.level;
          const bestStatus = actBat.status ?? sensorBat.status;
          if ((!detectedDevice || !detectedDevice.name || detectedDevice.battery_level == null) && (actMetaDevName || bestLevel != null || bestStatus)) {
            detectedDevice = {
              ...(detectedDevice || {}),
              ...(actMetaDevName && !detectedDevice?.name ? { name: formatDeviceName(actMetaDevName) } : {}),
              ...(dm?.deviceId && !detectedDevice?.device_id ? { device_id: dm.deviceId } : {}),
              ...(bestLevel != null && detectedDevice?.battery_level == null ? { battery_level: bestLevel } : {}),
              ...(bestStatus && !detectedDevice?.battery_status ? { battery_status: bestStatus } : {}),
              source: detectedDevice?.source || "garmin_activity_detail_meta",
              detected_at: new Date().toISOString(),
            };
          }
        }

        const zVals = [
          Number(a.hrTimeInZone_1 || 0),
          Number(a.hrTimeInZone_2 || 0),
          Number(a.hrTimeInZone_3 || 0),
          Number(a.hrTimeInZone_4 || 0),
          Number(a.hrTimeInZone_5 || 0),
        ];
        const zSum = zVals.reduce((x, y) => x + y, 0);
        const hrZones = zSum > 0
          ? zVals.map((sec, i) => ({
              zone: `Z${i + 1}`,
              label: ["Toparlanma", "Aerobik Baz", "Tempo", "Eşik", "VO2Max"][i],
              seconds: Math.round(sec),
              pct: Math.round((sec / zSum) * 100),
            }))
          : null;

        const rawSets = a.summarizedExerciseSets || null;
        const filteredSets = Array.isArray(rawSets)
          ? rawSets.filter((s: any) => rawSets.length <= 1 || !((s.category === "CARDIO" || s.subCategory === "CARDIO") && !s.maxWeight))
          : null;
        const parsedSets = Array.isArray(filteredSets) && filteredSets.length > 0
          ? filteredSets.map((s: any) => {
              const setsCount = Math.max(1, Number(s.sets || 1));
              const rawReps = Number(s.reps || 15);
              const repsPerSet = setsCount > 1 && rawReps >= setsCount * 4 ? Math.round(rawReps / setsCount) : rawReps;
              const weightKg = s.maxWeight ? Number((s.maxWeight / 1000).toFixed(1)) : 0;
              const volKg = s.volume ? Math.round(s.volume / 1000) : Math.round(setsCount * repsPerSet * weightKg);
              return {
                exercise: (s.subCategory || s.category || actName).replace(/_/g, " "),
                muscle: mapGarminMuscle(s.category || "", s.subCategory || "", actName),
                sets: setsCount,
                reps: repsPerSet,
                total_reps: rawReps,
                weight_kg: weightKg,
                volume_kg: volKg,
              };
            })
          : null;

        const poly = detailsApi?.geoPolylineDTO?.polyline;
        const route = Array.isArray(poly)
          ? poly.filter((p: any) => p.lat != null && p.lon != null).map((p: any) => [Number(p.lat.toFixed(5)), Number(p.lon.toFixed(5))])
          : null;

        let hrSeries: number[] = [];
        let elevSeries: number[] = [];
        let cadenceSeries: number[] = [];
        let tsLabels: string[] = [];
        const metrics = detailsApi?.activityDetailMetrics;
        const descriptors = detailsApi?.metricDescriptors || [];
        const hrIdx = descriptors.find((d: any) => d.key === "directHeartRate")?.metricsIndex;
        const elevIdx = descriptors.find((d: any) => d.key === "directElevation")?.metricsIndex;
        const cadIdx = descriptors.find((d: any) => d.key === "directDoubleCadence" || d.key === "directRunCadence" || d.key === "directFractionalCadence")?.metricsIndex;
        if (Array.isArray(metrics)) {
          if (hrIdx != null) hrSeries = metrics.map((m: any) => m.metrics?.[hrIdx]).map((v: any) => (typeof v === "number" ? Math.round(v) : null));
          if (elevIdx != null) elevSeries = metrics.map((m: any) => m.metrics?.[elevIdx]).map((v: any) => (typeof v === "number" ? Number(v.toFixed(1)) : null));
          if (cadIdx != null) cadenceSeries = metrics.map((m: any) => m.metrics?.[cadIdx]).map((v: any) => (typeof v === "number" ? Math.round(v) : null));
          const len = Math.max(hrSeries.length, elevSeries.length);
          tsLabels = Array.from({ length: len }, (_, i) => `${Math.round((i / Math.max(1, len - 1)) * Math.round((a.duration || 0) / 60))} dk`);
        }

        const muscleHeatmap = buildMuscleHeatmapFromActivity(actName, actType, parsedSets, a.distance || 0, a.elevationGain || 0);
        const sDto = actSummaryApi?.summaryDTO || {};
        const rawWater = sDto.waterEstimated ?? a.waterEstimated;
        const durSec = Math.round(a.duration || 0);
        const calVal = Math.round(a.calories || 0);
        const waterMl = rawWater ? Math.round(rawWater) : Math.max(120, Math.round((durSec / 60) * 6.5 + calVal * 0.45));
        const bbImpact = sDto.differenceBodyBattery ?? a.differenceBodyBattery ?? null;

        await supabase.from("activities").upsert(
          {
            user_id: userId,
            activity_id: actId,
            activity_name: actName,
            activity_type: actType,
            start_time_local: String(a.startTimeLocal || new Date().toISOString()).replace(" ", "T") + "+03:00",
            duration_seconds: durSec,
            distance_meters: Number((a.distance || 0).toFixed(2)),
            calories: calVal,
            avg_hr: a.averageHR ? Math.round(a.averageHR) : null,
            max_hr: a.maxHR ? Math.round(a.maxHR) : null,
            avg_speed: a.averageSpeed ? Number(a.averageSpeed.toFixed(3)) : 0,
            avg_cadence: a.averageRunningCadenceInStepsPerMinute ? Math.round(a.averageRunningCadenceInStepsPerMinute) : 0,
            elevation_gain: Number((a.elevationGain || 0).toFixed(2)),
            aerobic_te: a.aerobicTrainingEffect ? Number(a.aerobicTrainingEffect.toFixed(1)) : null,
            anaerobic_te: a.anaerobicTrainingEffect ? Number(a.anaerobicTrainingEffect.toFixed(1)) : null,
            training_load: a.activityTrainingLoad ? Number(a.activityTrainingLoad.toFixed(1)) : null,
            start_lat: a.startLatitude ?? null,
            start_lon: a.startLongitude ?? null,
            location_name: a.startLatitude != null ? (settings?.active_city || null) : null,
            hr_zones: hrZones,
            exercise_sets: parsedSets,
            muscle_heatmap: muscleHeatmap,
            time_series: { labels: tsLabels, hr: hrSeries, elevation_m: elevSeries, cadence: cadenceSeries, route },
            session_comparison: prevRow?.session_comparison || {
              water_ml: waterMl,
              water_estimated_by_garmin: Boolean(rawWater),
              bb_impact: bbImpact,
              verdict: `${actName} · Tahmini ter kaybı ${waterMl} ml (Telafi hedefi: ${Math.round(waterMl * 1.5)} ml)${bbImpact != null ? ` · Enerji Etkisi ${bbImpact}` : ""}`,
            },
            ai_post_workout_analysis: prevRow?.ai_post_workout_analysis || {
              summary: `${actName} (${Math.round(durSec / 60)} dk, ort. ${a.averageHR ? Math.round(a.averageHR) : "--"} atım/dk).`,
              highlight: `Dayanıklılık etkisi ${a.aerobicTrainingEffect?.toFixed(1) ?? "-"} · Güç etkisi ${a.anaerobicTrainingEffect?.toFixed(1) ?? "-"} · Yük ${a.activityTrainingLoad?.toFixed(1) ?? "-"}.`,
              next_step: `Ter kaybı (${waterMl} ml) için %150 telafi hedefi: ${Math.round(waterMl * 1.5)} ml su iç.`,
            },
          },
          { onConflict: "user_id,activity_id" }
        );
      }
    }

    if (!onlyActs && detectedDevice) {
      const { data: latestSet } = await supabase
        .from("athlete_settings")
        .select("weather_cache")
        .eq("user_id", userId)
        .maybeSingle();
      const existingCache = latestSet?.weather_cache || settings?.weather_cache || {};
      const existingDev = existingCache?.garmin_device || {};
      const mergedDevice =
        !detectedDevice.name && existingDev?.source === "user_settings" && existingDev?.name
          ? { ...detectedDevice, name: existingDev.name, source: existingDev.source }
          : { ...existingDev, ...detectedDevice };
      const mergedCache = {
        ...existingCache,
        garmin_device: mergedDevice,
      };
      if (settings && typeof settings === "object") settings.weather_cache = mergedCache;
      await supabase
        .from("athlete_settings")
        .update({ weather_cache: mergedCache, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }

    await supabase
      .from("user_integrations")
      .update({ connection_status: "CONNECTED", last_error: null, last_tested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    return {
      synced: true,
      base_url: base,
      patch,
      telemetry_extra: telemetryExtra,
      detected_device: detectedDevice,
      device_debug: deviceDebug,
      activities_synced: Array.isArray(acts) ? Math.min(acts.length, 6) : 0,
    };
  } catch (err) {
    return { synced: false, base_url: base, reason: String(err) };
  }
}

function formatAthleteFirstName(displayName?: string | null): string | null {
  const clean = String(displayName || "").trim();
  if (!clean || clean.toLowerCase() === "sporcu") return null;
  const first = clean.split(/\s+/)[0];
  if (!first) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

async function analyzeAndNotifyWorkout(
  supabase: any,
  userId: string,
  latest: any,
  prevActs: any[],
  geminiKey: string | null,
  sendPush: boolean,
  displayName?: string | null
) {
  const prevSame = prevActs.find((a: any) => a.activity_id !== latest.activity_id && a.activity_type === latest.activity_type);
  const durMin = Math.max(1, Math.round((latest.duration_seconds || 0) / 60));
  const distKm = latest.distance_meters ? Number((Number(latest.distance_meters) / 1000).toFixed(2)) : 0;
  const waterMl = Number(latest.session_comparison?.water_ml || Math.max(150, Math.round(durMin * 6.5 + Number(latest.calories || 0) * 0.45)));
  const rehydMl = Math.round(waterMl * 1.5);
  const cups = Math.max(1, Math.round(rehydMl / 200));

  let comparison: Record<string, any> = {
    ...(latest.session_comparison || {}),
    water_ml: waterMl,
    rehyd_ml: rehydMl,
    cups,
  };
  if (prevSame) {
    const hrDelta = (latest.avg_hr || 0) - (prevSame.avg_hr || 0);
    comparison = {
      ...comparison,
      prev_activity_name: prevSame.activity_name,
      prev_avg_hr: prevSame.avg_hr,
      hr_delta: hrDelta,
      verdict:
        hrDelta <= 0
          ? `Önceki benzer seansa göre ortalama nabız ${Math.abs(hrDelta)} atım/dk daha düşük — kondisyon gelişimi olumlu.`
          : `Önceki benzer seansa göre ortalama nabız +${hrDelta} atım/dk daha yüksek — sıcaklık veya yorgunluk etkisi olabilir.`,
    };
  }

  const zonesTxt = Array.isArray(latest.hr_zones)
    ? latest.hr_zones.map((z: any) => `${z.zone}: %${z.pct}`).join(", ")
    : "bilinmiyor";
  const firstName = formatAthleteFirstName(displayName);

  const prompt = `${firstName ? `Sporcu Adı: ${firstName}. Antrenmanı ${firstName}'in ilk bakışta anlayacağı` : "Antrenmanı sporcunun ilk bakışta anlayacağı"} sade, samimi, sıcak bir Türkçe ile analiz et (jargon kullanma${firstName ? `, uygun yerde ${firstName} diye hitap edebilirsin` : ""}).
Aktivite: ${latest.activity_name} (${latest.activity_type}), süre ${durMin} dk, mesafe ${distKm} km, kalori ${latest.calories ?? "--"} kcal, ort nabız ${latest.avg_hr ?? "--"} atım/dk, maks nabız ${latest.max_hr ?? "--"} atım/dk, nabız bölgeleri (${zonesTxt}), dayanıklılık etkisi ${latest.aerobic_te ?? "-"}, güç etkisi ${latest.anaerobic_te ?? "-"}, yük ${latest.training_load ?? "-"}, tahmini su ihtiyacı ${rehydMl} ml (~${cups} bardak).
Önceki kıyas: ${comparison.verdict || "Yok"}
JSON döndür: {"summary":"1-2 cümle net özet","highlight":"En güçlü kazanım / dikkat çeken detay","recovery_plan":"Toparlanma ve su/uyku planı","next_step":"Bir sonraki gün için net öneri"}`;

  const aiWorkout = (await geminiApiCagir(prompt, 0.25, undefined, geminiKey)) || {
    summary: `${firstName ? `${firstName}, ` : ""}${latest.activity_name} tamamlandı (${durMin} dk${distKm > 0 ? `, ${distKm} km` : ""}, ort. ${latest.avg_hr ?? "--"} atım/dk).`,
    highlight: comparison.verdict || `Dayanıklılık etkisi ${latest.aerobic_te ?? "-"} · Güç etkisi ${latest.anaerobic_te ?? "-"} ile verimli bir seans.`,
    recovery_plan: `Kaybedilen sıvıyı yerine koymak için yaklaşık ${cups} bardak (${rehydMl} ml) su iç ve akşam uykunu koru.`,
    next_step: "Yarın vücudun toparlanma puanına göre hafif yürüyüş veya normal antrenman seçebilirsin.",
  };

  const nowIso = new Date().toISOString();
  await supabase
    .from("activities")
    .update({
      session_comparison: comparison,
      ai_post_workout_analysis: aiWorkout,
      post_workout_notified_at: nowIso,
    })
    .eq("user_id", userId)
    .eq("activity_id", latest.activity_id);

  let notification = null;
  if (sendPush) {
    notification = await sendUserNotification(supabase, userId, {
      type: "WORKOUT_REPORT",
      title: `🏃 ${firstName ? `${firstName}, Antrenman Raporun` : "Antrenman Raporun"}: ${latest.activity_name}`,
      body: `${aiWorkout.summary} ~${cups} bardak (${rehydMl} ml) su iç. ${aiWorkout.next_step}`,
      activity_id: Number(latest.activity_id),
      report_date: String(latest.start_time_local || nowIso).slice(0, 10),
      payload: { tab: "workouts", activity_id: Number(latest.activity_id) },
    });
  }

  return { comparison, ai_post_workout_analysis: aiWorkout, notification };
}

async function runDailyAnalysisForUser(
  supabase: any,
  userId: string,
  settings: any,
  integration: any,
  ist: IstanbulTime,
  opts: { isSilent: boolean; force: boolean; isCron: boolean }
) {
  if (!opts.force && (ist.hour < 7 || (ist.hour === 7 && ist.minute < 30))) {
    await supabase.from("sync_logs").insert({
      user_id: userId,
      job_type: opts.isSilent ? "SILENT_UPDATE" : "DAILY_ANALYSIS",
      status: "SKIPPED_NIGHT_WINDOW",
      details: { ist },
    });
    return { skipped: true, reason: "Gece 00:00-07:30 uyku penceresi koruması" };
  }

  const loc = await aktifKonumuBelirle(supabase, userId, settings);
  const { eveningWeather } = await havaMotoruVeAksamKadran(supabase, userId, settings, loc, ist.dateStr);
  const garminSync = await syncFromGarminForUser(supabase, userId, ist.dateStr, settings, integration);
  const { geminiKey } = resolveGarminCredentials(integration);

  const { data: todayRow } = await supabase
    .from("daily_biometrics")
    .select("*")
    .eq("user_id", userId)
    .eq("log_date", ist.dateStr)
    .maybeSingle();

  const patchData = garminSync.synced && garminSync.patch ? garminSync.patch : null;
  const hasRealTodayData = Boolean(todayRow || (patchData && (patchData.sleep_score != null || patchData.rhr != null || patchData.body_battery_max != null)));

  const bio = {
    user_id: userId,
    log_date: ist.dateStr,
    ...(todayRow || {}),
    ...(patchData || {}),
  };

  if (bio.vo2_max == null || bio.endurance_score == null) {
    const { data: recentBioMeta } = await supabase
      .from("daily_biometrics")
      .select("vo2_max, endurance_score")
      .eq("user_id", userId)
      .order("log_date", { ascending: false })
      .limit(15);
    if (Array.isArray(recentBioMeta)) {
      if (bio.vo2_max == null) {
        const prevVo2 = recentBioMeta.find((r: any) => r?.vo2_max != null)?.vo2_max;
        if (prevVo2 != null) bio.vo2_max = prevVo2;
      }
      if (bio.endurance_score == null) {
        const prevEndurance = recentBioMeta.find((r: any) => r?.endurance_score != null)?.endurance_score;
        if (prevEndurance != null) bio.endurance_score = prevEndurance;
      }
    }
  }

  // Preserve baseline preview only if user has zero biometrics at all yet
  const readiness = calculateReadinessScore(bio.body_battery_max ?? null, bio.sleep_score ?? null, bio.hrv_nightly_avg ?? null, bio.rhr ?? null, settings);
  const readinessStatus = getReadinessStatus(readiness);
  const redFlags = detectRedFlags(bio, settings);

  const hrvMissing = bio.hrv_nightly_avg == null;
  const alreadyReportedToday =
    settings?.last_daily_report_date === ist.dateStr ||
    Boolean(todayRow?.ai_daily_brief?.headline);
  let shouldGenerateFullBrief = false;

  if (hasRealTodayData) {
    if (!opts.isSilent && (!hrvMissing || ist.hour >= 13 || opts.force)) shouldGenerateFullBrief = true;
    else if (opts.isSilent && !alreadyReportedToday && (!hrvMissing || ist.hour >= 13)) shouldGenerateFullBrief = true;
  }

  const firstName = formatAthleteFirstName(settings?.display_name);

  let aiDailyBrief = bio.ai_daily_brief;
  if (shouldGenerateFullBrief) {
    const [{ data: ctxBios }, { data: ctxActs }] = await Promise.all([
      supabase.from("daily_biometrics").select("*").eq("user_id", userId).order("log_date", { ascending: false }).limit(7),
      supabase.from("activities").select("activity_name,activity_type,duration_seconds,distance_meters,avg_hr,start_time_local,muscle_heatmap,exercise_sets").eq("user_id", userId).order("start_time_local", { ascending: false }).limit(12),
    ]);
    const mergedBios = ctxBios?.length ? [{ ...bio }, ...ctxBios.filter((b: any) => b.log_date !== ist.dateStr)] : [{ ...bio }];
    const deepContext = buildDeepAthleteContext(mergedBios, ctxActs || [], settings);

    const prompt = `Sen ${firstName ? `${firstName} (${settings?.birth_year ?? 1990} doğumlu) adlı sporcunun` : `${settings?.birth_year ?? 1990} doğumlu kullanıcının`} kişisel sağlık ve antrenman koçusun. Sade, teknik terimsiz, samimi Türkçe yaz${firstName ? ` (uygun yerde ${firstName} diye sıcak bir şekilde hitap et)` : ""}.
Bugün (${ist.dateStr}): Hazırlık ${readiness}/100, Maks Enerji ${bio.body_battery_max ?? "--"}/100, Uyku ${bio.sleep_score ?? "--"}/100, Gece Toparlanması ${bio.hrv_nightly_avg ?? "--"} puan, Dinlenik Nabız ${bio.rhr ?? "--"} atım/dk.
Derin Bağlam: ${JSON.stringify(deepContext)}.
Akşam hava penceresi (${eveningWeather.city}): ${eveningWeather.temp_c}°C, Hava Kalitesi ${eveningWeather.aqi_max} (${eveningWeather.dial_level}), gün batımı ${eveningWeather.sunset}, kıyafet: ${eveningWeather.clothing_advice}.
Uyarılar: ${JSON.stringify(redFlags)}.
JSON döndür (başka metin ekleme): {"headline": "...", "morning_coach_note": "...", "strength_prescription": "...", "evening_walk_plan": "..."}`;

    const aiResult = await geminiApiCagir(prompt, 0.25, undefined, geminiKey);
    aiDailyBrief = aiResult?.headline
      ? { ...aiResult, source: aiResult.model_used || "models/gemini-3.6-flash" }
      : yerelGunlukYorumOlustur({ ...bio, readiness_score: readiness }, eveningWeather, redFlags, ist, settings);

    await supabase
      .from("athlete_settings")
      .update({ last_daily_report_date: ist.dateStr, pending_hrv_report_date: null, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  } else if (hasRealTodayData && hrvMissing && ist.hour < 13) {
    await supabase
      .from("athlete_settings")
      .update({ pending_hrv_report_date: ist.dateStr, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  let redAlertTriggered = false;
  const outsideSleepHours = (ist.hour > 8 || (ist.hour === 8 && ist.minute >= 30)) && ist.hour < 23;
  if (redFlags.length > 0 && outsideSleepHours && settings?.last_red_alert_date !== ist.dateStr) {
    redAlertTriggered = true;
    await supabase.from("athlete_settings").update({ last_red_alert_date: ist.dateStr }).eq("user_id", userId);
    await sendUserNotification(supabase, userId, {
      type: "HEALTH_ALERT",
      title: `⚠️ ${firstName ? `${firstName}, ` : ""}Sağlık & Toparlanma Uyarısı (${redFlags.length})`,
      body: `${redFlags.map((f: any) => f.message).join(" · ")}. Bugün hafif tempoda kalman önerilir.`,
      report_date: ist.dateStr,
      payload: { tab: "dashboard" },
    });
  }

  if (hasRealTodayData) {
    await supabase.from("daily_biometrics").upsert(
      {
        ...bio,
        user_id: userId,
        log_date: ist.dateStr,
        readiness_score: readiness,
        readiness_status: readinessStatus,
        evening_weather: eveningWeather,
        red_flags: redFlags,
        ai_daily_brief: aiDailyBrief,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,log_date" }
    );
  }

  // Send Morning Report notification once sleep/morning data arrives today
  let morningNotified = false;
  const hasSleepOrMorningData = Boolean(bio.sleep_score != null || bio.sleep_seconds != null || bio.rhr != null);
  if (shouldGenerateFullBrief && hasSleepOrMorningData) {
    const { data: existingMorning } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "MORNING_REPORT")
      .eq("report_date", ist.dateStr)
      .limit(1);

    if (!existingMorning || existingMorning.length === 0) {
      const slpH = bio.sleep_seconds ? `${(Number(bio.sleep_seconds) / 3600).toFixed(1)} sa uyku` : `Uyku ${bio.sleep_score ?? "--"}/100`;
      await sendUserNotification(supabase, userId, {
        type: "MORNING_REPORT",
        title: `☀️ ${firstName ? `${firstName}, Sabah Raporun` : "Sabah Raporun"} Hazır · Hazırlık ${readiness}/100`,
        body: `${aiDailyBrief?.headline || "Günlük durum özeti hazır."} (${slpH}, Dinlenik nabız ${bio.rhr ?? "--"} atım/dk, Enerji ${bio.body_battery_max ?? "--"}/100).`,
        report_date: ist.dateStr,
        payload: { tab: "dashboard" },
      });
      morningNotified = true;
    }
  }

  await supabase.from("sync_logs").insert({
    user_id: userId,
    job_type: opts.isSilent ? "SILENT_UPDATE" : "DAILY_ANALYSIS",
    status: "OK",
    details: {
      readiness,
      readinessStatus,
      redFlagsCount: redFlags.length,
      morningNotified,
      garminSynced: garminSync.synced,
      city: loc.active_city,
    },
  });

  return {
    log_date: ist.dateStr,
    readiness_score: readiness,
    readiness_status: readinessStatus,
    evening_weather: eveningWeather,
    red_flags: redFlags,
    red_alert_triggered: redAlertTriggered,
    morning_notified: morningNotified,
    ai_daily_brief: aiDailyBrief,
    garmin_sync: {
      synced: garminSync.synced,
      base_url: garminSync.base_url,
      activities_synced: garminSync.activities_synced ?? 0,
      detected_device: garminSync.detected_device || null,
      device_debug: garminSync.device_debug || null,
      reason: garminSync.reason || null,
    },
  };
}

async function generateWeeklyStrategyForUser(
  supabase: any,
  userId: string,
  settings: any,
  integration: any,
  ist: IstanbulTime,
  sendNotification: boolean
) {
  const loc = await aktifKonumuBelirle(supabase, userId, settings);
  const { forecast7d } = await havaMotoruVeAksamKadran(supabase, userId, settings, loc, ist.dateStr);
  const { geminiKey } = resolveGarminCredentials(integration);

  const { data: recent14 } = await supabase
    .from("daily_biometrics")
    .select("*")
    .eq("user_id", userId)
    .order("log_date", { ascending: false })
    .limit(14);

  const thisWeek = (recent14 || []).slice(0, 7);
  const prevWeek = (recent14 || []).slice(7, 14);
  const avg = (arr: any[], key: string) => {
    const vals = arr.map((x) => Number(x[key])).filter((n) => !Number.isNaN(n) && n > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };

  const hrvCur = avg(thisWeek, "hrv_nightly_avg");
  const hrvPrev = avg(prevWeek, "hrv_nightly_avg") || hrvCur;
  const rhrCur = avg(thisWeek, "rhr");
  const rhrPrev = avg(prevWeek, "rhr") || rhrCur;
  const sleepCur = avg(thisWeek, "sleep_score");
  const sleepPrev = avg(prevWeek, "sleep_score") || sleepCur;
  const readyCur = avg(thisWeek, "readiness_score");
  const readyPrev = avg(prevWeek, "readiness_score") || readyCur;

  const fourteenDaysAgoMs = Date.now() - 14 * 86400 * 1000;
  const sevenDaysAgoMs = Date.now() - 7 * 86400 * 1000;
  const { data: recent14Acts } = await supabase
    .from("activities")
    .select("*")
    .eq("user_id", userId)
    .gte("start_time_local", new Date(fourteenDaysAgoMs).toISOString());

  const all14Acts = recent14Acts || [];
  const acts = all14Acts.filter((a: any) => new Date(a.start_time_local).getTime() >= sevenDaysAgoMs);
  const prevActs = all14Acts.filter((a: any) => new Date(a.start_time_local).getTime() < sevenDaysAgoMs);
  const cardioActs = acts.filter((a: any) => a.activity_type !== "strength_training");
  const strengthActs = acts.filter((a: any) => a.activity_type === "strength_training");
  const prevCardioActs = prevActs.filter((a: any) => a.activity_type !== "strength_training");
  const prevStrengthActs = prevActs.filter((a: any) => a.activity_type === "strength_training");
  const totalKm = Number((cardioActs.reduce((s: number, a: any) => s + Number(a.distance_meters || 0), 0) / 1000).toFixed(1));
  const prevKm = Number((prevCardioActs.reduce((s: number, a: any) => s + Number(a.distance_meters || 0), 0) / 1000).toFixed(1));

  const zoneSec: Record<string, number> = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  for (const a of acts) {
    const hz = Array.isArray(a.hr_zones) ? a.hr_zones : [];
    for (const z of hz) {
      if (z?.zone && z.zone in zoneSec) zoneSec[z.zone] += Number(z.seconds || 0);
    }
  }
  const totalZoneSec = Object.values(zoneSec).reduce((s, v) => s + v, 0);
  const realZoneDist = totalZoneSec > 0
    ? ["Z1", "Z2", "Z3", "Z4", "Z5"].map((zone) => ({
        zone,
        minutes: Math.round(zoneSec[zone] / 60),
        pct: Math.round((zoneSec[zone] / totalZoneSec) * 100),
      }))
    : [
        { zone: "Z1", pct: 25, minutes: 0 },
        { zone: "Z2", pct: 50, minutes: 0 },
        { zone: "Z3", pct: 18, minutes: 0 },
        { zone: "Z4", pct: 7, minutes: 0 },
        { zone: "Z5", pct: 0, minutes: 0 },
      ];

  const realStrengthVolume = Math.round(
    strengthActs.reduce((sum: number, a: any) => {
      const setsArr = Array.isArray(a.exercise_sets) ? a.exercise_sets : [];
      const actVol = setsArr.reduce((sv: number, ex: any) => sv + Number(ex.volume_kg || 0), 0);
      return sum + (actVol > 0 ? actVol : 1200);
    }, 0)
  );

  const wowDeltas = {
    hrv_avg_ms: hrvCur,
    hrv_delta_ms: hrvCur - hrvPrev,
    rhr_avg_bpm: rhrCur,
    rhr_delta_bpm: rhrCur - rhrPrev,
    sleep_avg_score: sleepCur,
    sleep_delta_score: sleepCur - sleepPrev,
    readiness_avg: readyCur,
    readiness_delta: readyCur - readyPrev,
    distance_km: totalKm,
    distance_delta_km: prevActs.length ? Number((totalKm - prevKm).toFixed(1)) : 0,
    strength_sessions: strengthActs.length,
    strength_delta: prevActs.length ? strengthActs.length - prevStrengthActs.length : 0,
  };

  const firstName = formatAthleteFirstName(settings?.display_name);
  const prompt = `Haftalık sporcu yönetici strateji kokpiti üret (${firstName ? `${firstName} için ` : ""}sade, samimi Türkçe, teknik terimsiz${firstName ? `; uygun yerde ${firstName} diye hitap et` : ""}). Konum: ${loc.active_city}. Haftalık ortalamalar: Toparlanma ${hrvCur} puan, Dinlenik Nabız ${rhrCur} atım/dk, Hazırlık ${readyCur}/100, Mesafe ${totalKm} km, Kuvvet seansı ${strengthActs.length} (${realStrengthVolume} kg).
7 günlük hava tahmini: ${JSON.stringify(forecast7d)}.
JSON döndür: {"ai_executive_summary": "...", "weekly_schedule": [{"day":"Pazartesi","focus":"...","plan":"...","intensity":"..."}]}`;

  const aiResp = await geminiApiCagir(prompt, 0.25, undefined, geminiKey);
  const weeklySchedule =
    Array.isArray(aiResp?.weekly_schedule) && aiResp.weekly_schedule.length === 7
      ? aiResp.weekly_schedule
      : yerelHaftalikProgramOlustur(forecast7d, readyCur);

  const execSummary =
    aiResp?.ai_executive_summary ||
    `Haftalık Yönetici Özeti: Ortalama toparlanma ${hrvCur} puan (${wowDeltas.hrv_delta_ms >= 0 ? "+" : ""}${wowDeltas.hrv_delta_ms}), Dinlenik Nabız ${rhrCur} atım/dk, Hazırlık ${readyCur}/100. ${loc.active_city} için 7 günlük hava penceresine göre haftalık kuvvet ve yürüyüş dengesi planlandı.`;

  const baseRhr = settings?.base_rhr ?? 46;
  const baseHrv = settings?.base_hrv_min ?? 59;
  const strategyPayload = {
    user_id: userId,
    week_start_date: ist.weekStartDate,
    wow_deltas: wowDeltas,
    zone_distribution: realZoneDist,
    cardio_vs_strength: {
      cardio_sessions: cardioActs.length,
      cardio_minutes: Math.round(cardioActs.reduce((s: number, a: any) => s + (a.duration_seconds || 0) / 60, 0)),
      strength_sessions: strengthActs.length,
      strength_minutes: Math.round(strengthActs.reduce((s: number, a: any) => s + (a.duration_seconds || 0) / 60, 0)),
      strength_volume_kg: realStrengthVolume,
      goal_scorecard: [
        { goal: "Haftalık 3x Kuvvet Antrenmanı", target: "3 seans", actual: `${strengthActs.length} seans`, status: strengthActs.length >= 3 ? "PASS" : "WARN" },
        { goal: "Haftalık 25+ km Yürüyüş/Koşu", target: "25.0 km", actual: `${totalKm} km`, status: totalKm >= 25 ? "PASS" : "WARN" },
        { goal: `Gece Toparlanması >= ${baseHrv} puan`, target: `${baseHrv} puan`, actual: `${hrvCur} puan`, status: hrvCur >= baseHrv ? "PASS" : "WARN" },
        { goal: `Dinlenik Nabız <= ${baseRhr + 2} atım/dk`, target: `${baseRhr + 2} atım/dk`, actual: `${rhrCur} atım/dk`, status: rhrCur > 0 && rhrCur <= baseRhr + 2 ? "PASS" : "WARN" },
      ],
    },
    mvp_and_flags: {
      mvp: `7 günlük toparlanma ortalaması ${hrvCur} puan ve dinlenik nabız ${rhrCur} atım/dk seviyesinde.`,
      attention_flag: readyCur < 70 ? "Haftalık hazırlık ortalaması 70 altında; uyku süresine odaklan." : "Önemli fizyolojik sapma yok; aktif dinlenme gününü koru.",
    },
    weather_forecast_7d: forecast7d,
    weekly_schedule: weeklySchedule,
    ai_executive_summary: execSummary,
  };

  await supabase.from("weekly_strategies").upsert(strategyPayload, { onConflict: "user_id,week_start_date" });
  await supabase.from("sync_logs").insert({
    user_id: userId,
    job_type: "WEEKLY_STRATEGY",
    status: "OK",
    details: { week_start_date: ist.weekStartDate, readyCur },
  });

  if (sendNotification) {
    await sendUserNotification(supabase, userId, {
      type: "WEEKLY_CEO",
      title: `📊 ${firstName ? `${firstName}, Haftalık Yönetici Raporun` : "Haftalık Yönetici Raporun"} Hazır (${ist.weekStartDate})`,
      body: execSummary.slice(0, 220),
      report_date: ist.dateStr,
      payload: { tab: "weekly", mode: "weekly" },
    });
  }

  return strategyPayload;
}

async function generateMonthlyCeoReportForUser(
  supabase: any,
  userId: string,
  settings: any,
  integration: any,
  ist: IstanbulTime,
  sendNotification: boolean
) {
  const { geminiKey } = resolveGarminCredentials(integration);
  const cutoff60 = shiftDateStr(ist.dateStr, -59);
  const cutoff30 = shiftDateStr(ist.dateStr, -29);

  const [{ data: bios60 }, { data: acts60 }] = await Promise.all([
    supabase
      .from("daily_biometrics")
      .select("*")
      .eq("user_id", userId)
      .gte("log_date", cutoff60)
      .order("log_date", { ascending: true }),
    supabase
      .from("activities")
      .select("*")
      .eq("user_id", userId)
      .gte("start_time_local", `${cutoff60}T00:00:00Z`)
      .order("start_time_local", { ascending: true }),
  ]);

  const allBios = bios60 || [];
  const allActs = acts60 || [];
  const curBios = allBios.filter((b: any) => b.log_date >= cutoff30);
  const prevBios = allBios.filter((b: any) => b.log_date < cutoff30);
  const curActs = allActs.filter((a: any) => String(a.start_time_local || "").slice(0, 10) >= cutoff30);
  const prevActs = allActs.filter((a: any) => String(a.start_time_local || "").slice(0, 10) < cutoff30);

  const avgNum = (arr: any[], key: string, dec = 0) => {
    const vals = arr.map((x) => Number(x[key])).filter((n) => Number.isFinite(n) && n > 0);
    if (!vals.length) return null;
    const v = vals.reduce((a, b) => a + b, 0) / vals.length;
    return dec > 0 ? Number(v.toFixed(dec)) : Math.round(v);
  };

  const trendDir = (cur: number | null, prev: number | null, th: number, lowerIsBetter = false) => {
    if (cur == null || prev == null) return { delta: 0, status: "STABLE" as const };
    const diff = Number((cur - prev).toFixed(1));
    const effective = lowerIsBetter ? -diff : diff;
    if (effective >= th) return { delta: diff, status: "IMPROVING" as const };
    if (effective <= -th) return { delta: diff, status: "DECLINING" as const };
    return { delta: diff, status: "STABLE" as const };
  };

  const rCur = avgNum(curBios, "readiness_score");
  const rPrev = avgNum(prevBios, "readiness_score");
  const slpCur = avgNum(curBios, "sleep_score");
  const slpPrev = avgNum(prevBios, "sleep_score");
  const hrvCur = avgNum(curBios, "hrv_nightly_avg");
  const hrvPrev = avgNum(prevBios, "hrv_nightly_avg");
  const rhrCur = avgNum(curBios, "rhr");
  const rhrPrev = avgNum(prevBios, "rhr");
  const vo2Cur = avgNum(curBios, "vo2_max", 1);
  const vo2Prev = avgNum(prevBios, "vo2_max", 1);
  const stepsCur = avgNum(curBios, "steps");
  const stepsPrev = avgNum(prevBios, "steps");

  const curKm = Number((curActs.reduce((s: number, a: any) => s + Number(a.distance_meters || 0), 0) / 1000).toFixed(1));
  const prevKm = Number((prevActs.reduce((s: number, a: any) => s + Number(a.distance_meters || 0), 0) / 1000).toFixed(1));
  const activeDaysSet = new Set(curActs.map((a: any) => String(a.start_time_local || "").slice(0, 10)));

  const kpis = {
    days_recorded: curBios.length,
    prev_days_recorded: prevBios.length,
    readiness_avg: rCur,
    sleep_avg: slpCur,
    hrv_avg: hrvCur,
    rhr_avg: rhrCur,
    vo2_max_avg: vo2Cur,
    steps_avg: stepsCur,
    workouts_count: curActs.length,
    prev_workouts_count: prevActs.length,
    active_days: activeDaysSet.size,
    total_km: curKm,
    prev_total_km: prevKm,
  };

  const momDeltas = {
    readiness: { current: rCur, previous: rPrev, ...trendDir(rCur, rPrev, 2) },
    sleep: { current: slpCur, previous: slpPrev, ...trendDir(slpCur, slpPrev, 2) },
    hrv: { current: hrvCur, previous: hrvPrev, ...trendDir(hrvCur, hrvPrev, 2) },
    rhr: { current: rhrCur, previous: rhrPrev, ...trendDir(rhrCur, rhrPrev, 1, true) },
    vo2_max: { current: vo2Cur, previous: vo2Prev, ...trendDir(vo2Cur, vo2Prev, 0.5) },
    steps: { current: stepsCur, previous: stepsPrev, ...trendDir(stepsCur, stepsPrev, 500) },
  };

  // Build 30-day Consistency Calendar
  const bioByDate = new Map<string, any>();
  for (const b of curBios) bioByDate.set(b.log_date, b);
  const actsByDate = new Map<string, any[]>();
  for (const a of curActs) {
    const d = String(a.start_time_local || "").slice(0, 10);
    if (!actsByDate.has(d)) actsByDate.set(d, []);
    actsByDate.get(d)!.push(a);
  }

  const consistencyCalendar: any[] = [];
  for (let i = 29; i >= 0; i--) {
    const dStr = shiftDateStr(ist.dateStr, -i);
    const b = bioByDate.get(dStr);
    const dayActs = actsByDate.get(dStr) || [];
    const rs = b?.readiness_score ?? null;
    let level: "peak" | "good" | "moderate" | "low" | "empty" = "empty";
    if (b || dayActs.length > 0) {
      if ((rs != null && rs >= 80) || dayActs.length >= 2) level = "peak";
      else if ((rs != null && rs >= 65) || dayActs.length === 1) level = "good";
      else if (rs != null && rs >= 50) level = "moderate";
      else level = "low";
    }
    consistencyCalendar.push({
      date: dStr,
      day_num: Number(dStr.slice(8, 10)),
      readiness_score: rs,
      sleep_score: b?.sleep_score ?? null,
      steps: b?.steps ?? null,
      workouts_count: dayActs.length,
      workout_names: dayActs.map((x: any) => x.activity_name),
      level,
    });
  }

  const improvingCount = Object.values(momDeltas).filter((x: any) => x.status === "IMPROVING").length;
  const decliningCount = Object.values(momDeltas).filter((x: any) => x.status === "DECLINING").length;
  const fallbackTrajectory = improvingCount > decliningCount ? "Yükselişte" : decliningCount > improvingCount ? "Dikkat Gerektiriyor" : "Dengede";

  const firstName = formatAthleteFirstName(settings?.display_name);
  const prompt = `Sen ${firstName ? `${firstName} adlı sporcunun` : "bu sporcunun"} kişisel Performans CEO danışmanısın. Bir CEO şirketinin aylık bilançosunu nasıl incelerse son 30 günü önceki 30 günle kıyaslayıp sade, samimi, jargonsuz Türkçe yönetici brifingi ver${firstName ? ` (uygun yerlerde ${firstName} diye hitap edebilirsin)` : ""}.
Son 30 gün KPI'ları: ${JSON.stringify(kpis)}
Aydan Aya (MoM) değişimler: ${JSON.stringify(momDeltas)}
JSON döndür (başka metin ekleme):
{
  "trajectory": "Yükselişte | Dengede | Dikkat Gerektiriyor",
  "verdict_headline": "Tek cümlede 'Neredeyiz? Nereye gidiyoruz?' özeti",
  "where_we_are": "Şu anki fiziksel durum ve istikrar özetin (2 cümle)",
  "where_we_are_going": "Bu gidişat devam ederse gelecek ay nereye varılacağı (1-2 cümle)",
  "biggest_win": "Ayın en büyük başarısı / gelişimi",
  "biggest_risk": "Önümüzdeki en büyük risk veya dikkat edilmesi gereken alan",
  "ceo_actions": ["Önümüzdeki dönem için 1. somut aksiyon", "2. somut aksiyon", "3. somut aksiyon"]
}`;

  const aiCeo = await geminiApiCagir(prompt, 0.25, undefined, geminiKey);
  const ceoBrief = aiCeo?.verdict_headline
    ? { ...aiCeo, source: aiCeo.model_used || "models/gemini-3.6-flash" }
    : {
        trajectory: fallbackTrajectory,
        verdict_headline: `Son 30 günde ${curActs.length} antrenman (${curKm} km) ve ortalama ${rCur ?? "--"}/100 hazırlık ile ${fallbackTrajectory.toLowerCase()} bir seyir izliyorsun.`,
        where_we_are: `Kayıtlı ${curBios.length} günde ortalama uyku puanın ${slpCur ?? "--"}/100, dinlenik nabzın ${rhrCur ?? "--"} atım/dk ve gece toparlanman ${hrvCur ?? "--"} puan seviyesinde.`,
        where_we_are_going: prevBios.length > 0
          ? `Önceki döneme göre ${improvingCount} metrikte yükseliş, ${decliningCount} metrikte düşüş görülüyor; uyku düzeni korunduğunda gelecek ay kondisyon artışı sürecektir.`
          : `İlk aylık baz dönemin başarıyla oluştu; sonraki 30 günde önceki dönemle net gelişim kıyaslaması daha da keskinleşecek.`,
        biggest_win: `${activeDaysSet.size} farklı aktif günde toplam ${curActs.length} antrenman ve ${curKm} km mesafe tamamladın.`,
        biggest_risk: decliningCount > 0 || (slpCur != null && slpCur < 75)
          ? "Uyku süresi veya gece stresi toparlanma hızını sınırlayabilir."
          : "Mevcut ritmi bozmadan haftalık dinlenme günlerini korumaya devam et.",
        ceo_actions: [
          "Haftada en az 3 kuvvet + 2–3 açık hava yürüyüşü/koşusu istikrarını koru.",
          "Akşam 22:30 öncesi ekranı bırakarak ortalama uyku puanını 80+ bandına çek.",
          "Yorgunluk sinyali olan günlerde ağır yük yerine düşük nabızlı yürüyüş seç.",
        ],
        source: "LOCAL_DETERMINISTIC",
      };

  const reportPayload = {
    user_id: userId,
    month_key: ist.monthKey,
    kpis,
    mom_deltas: momDeltas,
    ceo_brief: ceoBrief,
    consistency_calendar: consistencyCalendar,
    created_at: new Date().toISOString(),
  };

  await supabase.from("monthly_reports").upsert(reportPayload, { onConflict: "user_id,month_key" });
  await supabase.from("sync_logs").insert({
    user_id: userId,
    job_type: "MONTHLY_CEO",
    status: "OK",
    details: { month_key: ist.monthKey, trajectory: ceoBrief.trajectory, workouts: curActs.length },
  });

  if (sendNotification) {
    await sendUserNotification(supabase, userId, {
      type: "MONTHLY_CEO",
      title: `📈 ${firstName ? `${firstName}, Aylık CEO Raporun` : "Aylık CEO Raporun"} Hazır (${ist.monthKey}) · ${ceoBrief.trajectory}`,
      body: ceoBrief.verdict_headline,
      report_date: ist.dateStr,
      payload: { tab: "weekly", mode: "monthly" },
    });
  }

  return reportPayload;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: any = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch (_) {}
    } else {
      const url = new URL(req.url);
      body.action = url.searchParams.get("action") || "health";
    }

    const action = String(body.action || "gunlukGarminAnalizi");
    const force = Boolean(body.force);
    const ist = getIstanbulNow();
    const authUser = await getAuthenticatedUser(req, supabase);

    if (action === "health" || action === "bootstrapOwnerAuth") {
      const ownerId = await ensureOwnerUserId(supabase);
      return jsonResp({
        ok: true,
        multi_tenant: true,
        timezone: "Europe/Istanbul",
        local_now: ist,
        owner_id: ownerId,
        has_owner_garmin_key: Boolean(Deno.env.get("GARMIN_API_KEY")),
        has_gemini_key: Boolean(Deno.env.get("GEMINI_API_KEY")),
        has_fcm_push: Boolean(Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")),
      });
    }

    if (action === "authStatus") {
      const ownerId = await ensureOwnerUserId(supabase);
      const { data: ownerSettings } = await supabase
        .from("athlete_settings")
        .select("*")
        .eq("user_id", ownerId)
        .maybeSingle();
      const { isCustom, expectedUser } = await resolveLegacyAppAuth(ownerSettings);
      return jsonResp({
        ok: true,
        multi_user: true,
        is_custom: isCustom,
        owner_username: expectedUser,
      });
    }

    if (action === "registerUser") {
      if (!PUBLIC_REGISTRATION_ENABLED) {
        return jsonResp(
          { ok: false, error: "Yeni hesap kayıtları geliştirme aşamasında geçici olarak kapalıdır." },
          403,
        );
      }
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const displayName = String(body.display_name || "").trim() || email.split("@")[0];
      const birthYear = body.birth_year ? Number(body.birth_year) : 1990;
      const defaultCity = String(body.default_city || "İstanbul").trim() || "İstanbul";

      if (!email.includes("@") || email.length < 5) {
        return jsonResp({ ok: false, error: "Geçerli bir e-posta adresi girin." }, 400);
      }
      if (password.length < 6) {
        return jsonResp({ ok: false, error: "Şifre en az 6 karakter olmalıdır." }, 400);
      }

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (createErr || !created?.user) {
        const msg = createErr?.message?.toLowerCase().includes("already")
          ? "Bu e-posta adresi zaten kayıtlı. Giriş Yap sekmesini kullanın."
          : createErr?.message || "Hesap oluşturulamadı.";
        return jsonResp({ ok: false, error: msg }, 400);
      }

      const newUserId = created.user.id;
      await supabase.from("athlete_settings").insert({
        user_id: newUserId,
        display_name: displayName,
        birth_year: Number.isFinite(birthYear) ? birthYear : 1990,
        default_city: defaultCity,
        active_city: defaultCity,
        location_source: "DEFAULT",
      });
      await supabase.from("user_integrations").insert({
        user_id: newUserId,
        use_owner_default: false,
        garmin_api_base_url: DEFAULT_GARMIN_BASE,
        connection_status: "NOT_CONFIGURED",
      });

      const authClient = getAuthAnonClient(serviceRoleKey);
      const { data: signData, error: signErr } = await authClient.auth.signInWithPassword({ email, password });
      if (signErr || !signData?.session) {
        return jsonResp({ ok: false, error: signErr?.message || "Oturum başlatılamadı." }, 500);
      }

      return jsonResp({
        ok: true,
        authenticated: true,
        session: signData.session,
        user: { id: newUserId, email, display_name: displayName },
      });
    }

    if (action === "loginUser" || action === "verifyAppLogin") {
      const ownerId = await ensureOwnerUserId(supabase);
      const identifier = String(body.identifier || body.email || body.username || "").trim();
      const password = String(body.password || "");
      if (!identifier || !password) {
        return jsonResp({ ok: false, error: "Kullanıcı adı/e-posta ve şifre gereklidir." }, 400);
      }

      const { data: ownerSettings } = await supabase
        .from("athlete_settings")
        .select("*")
        .eq("user_id", ownerId)
        .maybeSingle();
      const { expectedUser, expectedHash } = await resolveLegacyAppAuth(ownerSettings);

      let loginEmail = identifier.toLowerCase();
      if (!loginEmail.includes("@")) {
        if (loginEmail === expectedUser.toLowerCase() || loginEmail === "ali") {
          loginEmail = OWNER_EMAIL;
        } else {
          return jsonResp({ ok: false, error: "E-posta adresinizle giriş yapın (örn. ad@domain.com)." }, 401);
        }
      }

      const authClient = getAuthAnonClient(serviceRoleKey);
      let signRes = await authClient.auth.signInWithPassword({ email: loginEmail, password });

      // Migrate legacy app_auth password seamlessly into Supabase Auth on first owner login
      if ((signRes.error || !signRes.data?.session) && loginEmail === OWNER_EMAIL) {
        const legacyMatch = (await sha256Hex("gc_salt_2026:" + password)) === expectedHash;
        if (legacyMatch) {
          await supabase.auth.admin.updateUserById(ownerId, { password });
          signRes = await authClient.auth.signInWithPassword({ email: loginEmail, password });
        }
      }

      if (signRes.error || !signRes.data?.session) {
        return jsonResp({ ok: false, authenticated: false, error: "E-posta/kullanıcı adı veya şifre hatalı." }, 401);
      }

      const signedUser = signRes.data.user;
      const { settings } = await ensureUserSettingsAndIntegration(supabase, signedUser);
      return jsonResp({
        ok: true,
        authenticated: true,
        session: signRes.data.session,
        user: {
          id: signedUser.id,
          email: signedUser.email,
          display_name: settings?.display_name || signedUser.user_metadata?.display_name || "Sporcu",
        },
      });
    }

    // Determine target users: authenticated user OR cron batch
    const cronBatchActions = new Set([
      "gunlukGarminAnalizi",
      "dokumaniSessizGuncelle",
      "yeniAntrenmanKontrol",
      "haftalikStratejiBulteni",
      "aylikCeoRaporu",
    ]);

    if (!authUser) {
      if (!cronBatchActions.has(action)) {
        return jsonResp({ ok: false, error: "Bu işlem için giriş yapmanız gerekiyor." }, 401);
      }

      // Cron fan-out over all users
      await ensureOwnerUserId(supabase);
      const { data: allSettings } = await supabase.from("athlete_settings").select("*").not("user_id", "is", null);
      const { data: allInts } = await supabase.from("user_integrations").select("*");
      const intMap = new Map<string, any>();
      for (const item of allInts || []) intMap.set(item.user_id, item);

      const results: any[] = [];
      for (const s of allSettings || []) {
        const uid = s.user_id;
        const integ = intMap.get(uid) || null;
        try {
          if (action === "gunlukGarminAnalizi" || action === "dokumaniSessizGuncelle") {
            const r = await runDailyAnalysisForUser(supabase, uid, s, integ, ist, {
              isSilent: action === "dokumaniSessizGuncelle",
              force,
              isCron: true,
            });
            results.push({ user_id: uid, ...r });
          } else if (action === "yeniAntrenmanKontrol") {
            const { garminKey } = resolveGarminCredentials(integ);
            let syncedCount = 0;
            if (garminKey) {
              const gs = await syncFromGarminForUser(supabase, uid, ist.dateStr, s, integ, { onlyActivities: true });
              syncedCount = gs.activities_synced || 0;
            }
            const cutoff36h = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
            const { data: unnotified } = await supabase
              .from("activities")
              .select("*")
              .eq("user_id", uid)
              .is("post_workout_notified_at", null)
              .gte("start_time_local", cutoff36h)
              .order("start_time_local", { ascending: false })
              .limit(3);

            const { data: prevActs } = await supabase
              .from("activities")
              .select("*")
              .eq("user_id", uid)
              .order("start_time_local", { ascending: false })
              .limit(10);

            const { geminiKey } = resolveGarminCredentials(integ);
            let notifiedCount = 0;
            for (const act of unnotified || []) {
              await analyzeAndNotifyWorkout(supabase, uid, act, prevActs || [], geminiKey, true, s?.display_name);
              notifiedCount++;
            }
            results.push({ user_id: uid, syncedCount, notifiedCount });
          } else if (action === "haftalikStratejiBulteni") {
            await generateWeeklyStrategyForUser(supabase, uid, s, integ, ist, true);
            results.push({ user_id: uid, ok: true });
          } else if (action === "aylikCeoRaporu") {
            await generateMonthlyCeoReportForUser(supabase, uid, s, integ, ist, true);
            results.push({ user_id: uid, ok: true });
          }
        } catch (err) {
          results.push({ user_id: uid, error: String(err) });
        }
      }

      return jsonResp({ ok: true, cron_batch: true, action, processed: results.length, results });
    }

    // Authenticated single-user scope below
    const userId = authUser.id;
    const { settings, integration } = await ensureUserSettingsAndIntegration(supabase, authUser);
    const { geminiKey } = resolveGarminCredentials(integration);

    if (action === "getIntegrationStatus") {
      return jsonResp({
        ok: true,
        garmin_api_base_url: integration?.garmin_api_base_url || DEFAULT_GARMIN_BASE,
        has_garmin_key: Boolean(integration?.garmin_api_key || (integration?.use_owner_default && Deno.env.get("GARMIN_API_KEY"))),
        has_personal_garmin_key: Boolean(integration?.garmin_api_key),
        garmin_key_hint: maskKeyHint(integration?.garmin_api_key) || (integration?.use_owner_default && Deno.env.get("GARMIN_API_KEY") ? "Sistem Sahibi Kasası Aktif" : null),
        has_gemini_key: Boolean(integration?.gemini_api_key || Deno.env.get("GEMINI_API_KEY")),
        has_personal_gemini_key: Boolean(integration?.gemini_api_key),
        gemini_key_hint: maskKeyHint(integration?.gemini_api_key),
        use_owner_default: Boolean(integration?.use_owner_default),
        connection_status: integration?.connection_status || "NOT_CONFIGURED",
        last_error: integration?.last_error || null,
        last_tested_at: integration?.last_tested_at || null,
      });
    }

    if (action === "saveGarminIntegration" || action === "testGarminConnection") {
      const baseInput = String(body.garmin_api_base_url ?? integration?.garmin_api_base_url ?? DEFAULT_GARMIN_BASE).trim().replace(/\/$/, "") || DEFAULT_GARMIN_BASE;
      const newGarminKey = body.garmin_api_key != null ? String(body.garmin_api_key).trim() : undefined;
      const newGeminiKey = body.gemini_api_key != null ? String(body.gemini_api_key).trim() : undefined;

      const upsertPayload: Record<string, any> = {
        user_id: userId,
        garmin_api_base_url: baseInput,
        updated_at: new Date().toISOString(),
      };
      if (newGarminKey !== undefined && newGarminKey.length > 0) upsertPayload.garmin_api_key = newGarminKey;
      if (newGeminiKey !== undefined) upsertPayload.gemini_api_key = newGeminiKey.length > 0 ? newGeminiKey : null;

      await supabase.from("user_integrations").upsert(upsertPayload, { onConflict: "user_id" });
      const { data: freshInt } = await supabase.from("user_integrations").select("*").eq("user_id", userId).single();
      const creds = resolveGarminCredentials(freshInt);

      if (!creds.garminKey) {
        await supabase
          .from("user_integrations")
          .update({ connection_status: "NOT_CONFIGURED", last_error: "Garmin API Anahtarı girilmedi." })
          .eq("user_id", userId);
        return jsonResp({ ok: false, error: "Lütfen geçerli bir Garmin API Anahtarı girin." }, 400);
      }

      try {
        const bearer = await exchangeGarminBearerToken(creds.base, creds.garminKey);
        const testRes = await fetch(`${creds.base}/usersummary-service/usersummary/daily?calendarDate=${ist.dateStr}`, {
          headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        if (!testRes.ok) {
          const errTxt = (await testRes.text()).slice(0, 150);
          throw new Error(`Garmin API HTTP ${testRes.status}: ${errTxt}`);
        }

        await supabase
          .from("user_integrations")
          .update({
            connection_status: "CONNECTED",
            last_error: null,
            last_tested_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

        let syncResult = null;
        if (body.sync_now !== false) {
          syncResult = await runDailyAnalysisForUser(supabase, userId, settings, freshInt, ist, {
            isSilent: false,
            force: true,
            isCron: false,
          });
        }

        return jsonResp({
          ok: true,
          connection_status: "CONNECTED",
          garmin_api_base_url: creds.base,
          garmin_key_hint: maskKeyHint(creds.garminKey),
          sync_result: syncResult,
        });
      } catch (err) {
        const msg = String(err);
        await supabase
          .from("user_integrations")
          .update({
            connection_status: "ERROR",
            last_error: msg,
            last_tested_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
        return jsonResp({ ok: false, connection_status: "ERROR", error: msg }, 400);
      }
    }

    if (action === "updateAppCredentials") {
      const displayName = String(body.display_name || body.new_username || settings?.display_name || "").trim();
      const newPassword = String(body.new_password || "");
      const currentPassword = String(body.current_password || "");

      if (newPassword && newPassword.length < 6) {
        return jsonResp({ ok: false, error: "Yeni şifre en az 6 karakter olmalıdır." }, 400);
      }
      if (newPassword) {
        const authClient = getAuthAnonClient(serviceRoleKey);
        const checkSign = await authClient.auth.signInWithPassword({ email: authUser.email!, password: currentPassword });
        let verified = Boolean(checkSign.data?.session);
        if (!verified && String(authUser.email || "").toLowerCase() === OWNER_EMAIL) {
          const { expectedHash } = await resolveLegacyAppAuth(settings);
          verified = (await sha256Hex("gc_salt_2026:" + currentPassword)) === expectedHash;
        }
        if (!verified) {
          return jsonResp({ ok: false, error: "Mevcut şifreniz doğrulanamadı." }, 401);
        }
        const { error: updAuthErr } = await supabase.auth.admin.updateUserById(userId, {
          password: newPassword,
          user_metadata: { ...(authUser.user_metadata || {}), ...(displayName ? { display_name: displayName } : {}) },
        });
        if (updAuthErr) return jsonResp({ ok: false, error: updAuthErr.message }, 500);
      }
      if (displayName) {
        await supabase
          .from("athlete_settings")
          .update({ display_name: displayName, updated_at: new Date().toISOString() })
          .eq("user_id", userId);
      }

      let freshSession = null;
      if (newPassword) {
        const authClient = getAuthAnonClient(serviceRoleKey);
        const reSign = await authClient.auth.signInWithPassword({ email: authUser.email!, password: newPassword });
        freshSession = reSign.data?.session || null;
      }

      await supabase.from("sync_logs").insert({
        user_id: userId,
        job_type: "AUTH_CREDENTIALS_UPDATE",
        status: "OK",
        details: { display_name: displayName, updated_at: new Date().toISOString() },
      });

      return jsonResp({ ok: true, display_name: displayName, session: freshSession });
    }

    if (action === "registerPushToken") {
      const fcmToken = String(body.fcm_token || "").trim();
      const platform = ["android", "ios", "web"].includes(String(body.platform)) ? String(body.platform) : "android";
      const deviceName = String(body.device_name || "").trim() || null;
      if (!fcmToken) return jsonResp({ ok: false, error: "FCM token boş olamaz." }, 400);

      await supabase.from("user_push_tokens").upsert(
        {
          user_id: userId,
          platform,
          fcm_token: fcmToken,
          device_name: deviceName,
          enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,fcm_token" }
      );
      return jsonResp({ ok: true });
    }

    if (action === "markNotificationsRead") {
      const nowIso = new Date().toISOString();
      if (body.notification_id) {
        await supabase
          .from("notifications")
          .update({ read_at: nowIso })
          .eq("user_id", userId)
          .eq("id", body.notification_id);
      } else {
        await supabase
          .from("notifications")
          .update({ read_at: nowIso })
          .eq("user_id", userId)
          .is("read_at", null);
      }
      return jsonResp({ ok: true });
    }

    if (action === "updateLiveLocation") {
      await supabase
        .from("athlete_settings")
        .update({ manual_city_override: null, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      const { data: freshSettings } = await supabase.from("athlete_settings").select("*").eq("user_id", userId).single();
      const loc = await aktifKonumuBelirle(supabase, userId, freshSettings || settings, {
        liveLat: body.live_lat != null ? Number(body.live_lat) : undefined,
        liveLon: body.live_lon != null ? Number(body.live_lon) : undefined,
        liveCity: typeof body.live_city === "string" ? body.live_city.trim() : undefined,
        liveAccuracy: body.live_accuracy != null ? Number(body.live_accuracy) : undefined,
        clearLiveGps: Boolean(body.use_garmin_gps || body.clear_live_gps),
      });
      const { eveningWeather } = await havaMotoruVeAksamKadran(supabase, userId, freshSettings || settings, loc, ist.dateStr);
      await supabase
        .from("daily_biometrics")
        .update({ evening_weather: eveningWeather, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("log_date", ist.dateStr);
      await supabase.from("sync_logs").insert({ user_id: userId, job_type: "LIVE_LOCATION_UPDATE", status: "OK", details: { loc } });
      return jsonResp({ ok: true, loc, eveningWeather });
    }

    if (action === "update_settings") {
      const allowedFields = [
        "display_name",
        "manual_city_override",
        "default_city",
        "birth_year",
        "base_rhr",
        "rhr_warn_threshold",
        "rhr_extreme_threshold",
        "base_hrv_min",
        "base_hrv_max",
        "hrv_warn_threshold",
        "hrv_extreme_threshold",
        "resp_warn_threshold",
        "sleep_stress_threshold",
        "skin_temp_deviation_threshold",
        "spo2_warn_threshold",
        "spo2_extreme_threshold",
      ];
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      for (const k of allowedFields) {
        if (k in body) patch[k] = body[k] === "" ? null : body[k];
      }
      await supabase.from("athlete_settings").update(patch).eq("user_id", userId);
      const { data: updatedSettings } = await supabase.from("athlete_settings").select("*").eq("user_id", userId).single();
      const loc = await aktifKonumuBelirle(supabase, userId, updatedSettings, {
        liveLat: body.live_lat != null ? Number(body.live_lat) : undefined,
        liveLon: body.live_lon != null ? Number(body.live_lon) : undefined,
        liveCity: typeof body.live_city === "string" ? body.live_city.trim() : undefined,
        liveAccuracy: body.live_accuracy != null ? Number(body.live_accuracy) : undefined,
        clearLiveGps: Boolean(body.use_garmin_gps || body.clear_live_gps),
      });
      const { eveningWeather } = await havaMotoruVeAksamKadran(supabase, userId, updatedSettings, loc, ist.dateStr);
      await supabase
        .from("daily_biometrics")
        .update({ evening_weather: eveningWeather, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("log_date", ist.dateStr);
      await supabase.from("sync_logs").insert({ user_id: userId, job_type: "SETTINGS_UPDATE", status: "OK", details: { loc, eveningWeather } });
      return jsonResp({ ok: true, loc, eveningWeather });
    }

    if (action === "havaVeKonumGuncelle") {
      const loc = await aktifKonumuBelirle(supabase, userId, settings, {
        liveLat: body.live_lat != null ? Number(body.live_lat) : undefined,
        liveLon: body.live_lon != null ? Number(body.live_lon) : undefined,
        liveCity: typeof body.live_city === "string" ? body.live_city.trim() : undefined,
        liveAccuracy: body.live_accuracy != null ? Number(body.live_accuracy) : undefined,
        clearLiveGps: Boolean(body.use_garmin_gps || body.clear_live_gps),
      });
      const { eveningWeather, forecast7d } = await havaMotoruVeAksamKadran(supabase, userId, settings, loc, ist.dateStr);
      await supabase
        .from("daily_biometrics")
        .update({ evening_weather: eveningWeather, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("log_date", ist.dateStr);
      await supabase.from("sync_logs").insert({
        user_id: userId,
        job_type: "WEATHER_REFRESH",
        status: "OK",
        details: { city: loc.active_city, dial: eveningWeather.dial_level, aqi: eveningWeather.aqi_max },
      });
      return jsonResp({ ok: true, loc, eveningWeather, forecast7d });
    }

    if (action === "askCoach") {
      const question = String(body.question || "").trim();
      if (!question) return jsonResp({ ok: false, error: "Soru boş olamaz." }, 400);

      const [{ data: recentBios }, { data: recentActs }] = await Promise.all([
        supabase.from("daily_biometrics").select("*").eq("user_id", userId).order("log_date", { ascending: false }).limit(14),
        supabase.from("activities").select("activity_name,activity_type,duration_seconds,distance_meters,avg_hr,training_load,start_time_local,muscle_heatmap,exercise_sets").eq("user_id", userId).order("start_time_local", { ascending: false }).limit(15),
      ]);

      const todayBio = recentBios?.[0] || {};
      const validHrv = (recentBios || []).slice(0, 7).filter((b: any) => Number(b.hrv_nightly_avg) > 0);
      const avgHrv = validHrv.length ? Math.round(validHrv.reduce((s: number, b: any) => s + Number(b.hrv_nightly_avg), 0) / validHrv.length) : (settings?.base_hrv_min ?? 60);
      const validRhr = (recentBios || []).slice(0, 7).filter((b: any) => Number(b.rhr) > 0);
      const avgRhr = validRhr.length ? Math.round(validRhr.reduce((s: number, b: any) => s + Number(b.rhr), 0) / validRhr.length) : (settings?.base_rhr ?? 46);

      const deepContext = buildDeepAthleteContext(recentBios || [], recentActs || [], settings);
      const prevHistory = Array.isArray(settings?.weather_cache?.coach_history) ? settings.weather_cache.coach_history.slice(-3) : [];
      const recentActSummaries = (recentActs || []).slice(0, 6).map((a: any) => ({
        name: a.activity_name,
        type: a.activity_type,
        min: Math.round((a.duration_seconds || 0) / 60),
        km: a.distance_meters ? Number((a.distance_meters / 1000).toFixed(2)) : 0,
        avg_hr: a.avg_hr,
        load: a.training_load,
        start: a.start_time_local,
      }));
      const rawEw = todayBio.evening_weather || {};
      const compactWeather = rawEw.city || rawEw.temp_c != null
        ? {
            city: rawEw.city,
            temp_c: rawEw.temp_c,
            aqi_max: rawEw.aqi_max,
            dial_level: rawEw.dial_level,
            sunset: rawEw.sunset,
            clothing_advice: rawEw.clothing_advice,
          }
        : {};

      const firstName = formatAthleteFirstName(settings?.display_name);
      const prompt = `Sen ${firstName ? `${firstName} (${settings?.birth_year ?? 1990} doğumlu) adlı sporcunun` : `sporcunun (${settings?.birth_year ?? 1990} doğumlu)`} baş performans koçusun. Sade, teknik terimsiz, samimi Türkçe yanıt ver${firstName ? ` (uygun yerde ${firstName} diye sıcak bir şekilde hitap et)` : ""}.
Bugün (${todayBio.log_date || ist.dateStr}): Hazırlık ${todayBio.readiness_score ?? "--"}/100, Toparlanma ${todayBio.hrv_nightly_avg ?? "--"} puan, Dinlenik Nabız ${todayBio.rhr ?? "--"} atım/dk, Uyku ${todayBio.sleep_score ?? "--"}/100, En Yüksek Enerji ${todayBio.body_battery_max ?? "--"}/100.
7 Günlük Ort: Toparlanma ${avgHrv} puan, Nabız ${avgRhr} atım/dk, Uyku Ort ${deepContext.sleep_7d_avg_h ?? "--"} sa, Uyku Borcu ${deepContext.sleep_7d_debt_h} sa.
Derin Analiz: ${JSON.stringify(deepContext)}
Akşam Hava/AQI (${ist.dateStr}): ${JSON.stringify(compactWeather)}
Son Antrenmanlar: ${JSON.stringify(recentActSummaries)}
Sohbet Hafızası: ${JSON.stringify(prevHistory)}
Soru: "${question}"
JSON döndür (başka metin ekleme): {"answer":"Kullanıcının gerçek rakamlarına dayalı 2-4 cümle sade Türkçe koç yanıtı","action_items":["...","..."],"suggested_rotation":"chest_arms | shoulders_back | core_legs veya null"}`;

      const geminiErrors: string[] = [];
      const aiAnswer = await geminiApiCagir(prompt, 0.25, geminiErrors, geminiKey);
      const qLow = question.toLowerCase();
      let fallbackAnswer = `Bugünkü Hazırlık Skorun ${todayBio.readiness_score ?? "--"}/100 (7G Ort. Toparlanma ${avgHrv} puan, Uyku Borcu ${deepContext.sleep_7d_debt_h} sa). Kas toparlanmasına göre sıradaki blok ${deepContext.recommended_rotation.title} (%${deepContext.recommended_rotation.recovery_pct} hazır). `;
      const items: string[] = [];
      if (qLow.includes("yürüyüş") || qLow.includes("hava") || qLow.includes("akşam")) {
        const ew = todayBio.evening_weather || {};
        fallbackAnswer += `${ew.city || settings?.active_city || DEFAULT_CITY} akşam 17:00–21:00 penceresi ${ew.temp_c ?? 13}°C, hava kalitesi ${ew.aqi_max ?? 25} (${ew.dial_level || "SARI"}).`;
        items.push("Rahat tempo yürüyüş (Zone 2)");
        items.push(`Gün batımı: ${ew.sunset || "17:40"}`);
      } else {
        fallbackAnswer += `Değerlerin dengeli (${avgHrv} puan toparlanma / ${avgRhr} atım/dk nabız).`;
        items.push(`${deepContext.recommended_rotation.title} (%${deepContext.recommended_rotation.recovery_pct} hazır)`);
        items.push(deepContext.sleep_7d_debt_h >= 2 ? "Bu gece uyku borcunu kapatmak için erken uyu" : "Antrenman sonrası su alımını koru");
      }

      const validRot = ["chest_arms", "shoulders_back", "core_legs"].includes(aiAnswer?.suggested_rotation) ? aiAnswer.suggested_rotation : null;
      const ansText = aiAnswer?.answer || aiAnswer?.yanit || aiAnswer?.response;
      const reply = ansText
        ? {
            answer: ansText,
            action_items: Array.isArray(aiAnswer.action_items) ? aiAnswer.action_items : items,
            suggested_rotation: validRot,
            model_used: aiAnswer.model_used || "models/gemini-3.6-flash",
            source: aiAnswer.model_used || "models/gemini-3.6-flash",
          }
        : {
            answer: fallbackAnswer,
            action_items: items,
            suggested_rotation: deepContext.recommended_rotation.id,
            model_used: "LOCAL_DETERMINISTIC",
            source: "LOCAL_DETERMINISTIC",
            debug_gemini: geminiErrors,
          };

      const nextHistory = [...prevHistory, { q: question, a: reply.answer, at: new Date().toISOString() }].slice(-6);
      await supabase
        .from("athlete_settings")
        .update({ weather_cache: { ...(settings?.weather_cache || {}), coach_history: nextHistory }, updated_at: new Date().toISOString() })
        .eq("user_id", userId);

      return jsonResp({ ok: true, reply });
    }

    if (action === "upsertBiometric") {
      const logDate = body.log_date || ist.dateStr;
      const bbMax = body.body_battery_max != null ? Number(body.body_battery_max) : 88;
      const sleepScore = body.sleep_score != null ? Number(body.sleep_score) : 82;
      const hrvAvg = body.hrv_nightly_avg != null ? Number(body.hrv_nightly_avg) : 64;
      const rhr = body.rhr != null ? Number(body.rhr) : 46;
      const readiness = calculateReadinessScore(bbMax, sleepScore, hrvAvg, rhr, settings);
      const readinessStatus = getReadinessStatus(readiness);

      const bioRow: Record<string, any> = {
        user_id: userId,
        log_date: logDate,
        body_battery_max: bbMax,
        sleep_score: sleepScore,
        hrv_nightly_avg: hrvAvg,
        rhr,
        sleep_respiration_avg: body.sleep_respiration_avg != null ? Number(body.sleep_respiration_avg) : 15.6,
        sleep_stress_avg: body.sleep_stress_avg != null ? Number(body.sleep_stress_avg) : 17.5,
        skin_temp_deviation: body.skin_temp_deviation != null ? Number(body.skin_temp_deviation) : 0.08,
        spo2_avg: body.spo2_avg != null ? Number(body.spo2_avg) : 96.4,
        steps: body.steps != null ? Number(body.steps) : 9500,
        readiness_score: readiness,
        readiness_status: readinessStatus,
        updated_at: new Date().toISOString(),
      };
      bioRow.red_flags = detectRedFlags(bioRow, settings);

      await supabase.from("daily_biometrics").upsert(bioRow, { onConflict: "user_id,log_date" });
      await supabase.from("sync_logs").insert({ user_id: userId, job_type: "MANUAL_BIOMETRIC", status: "OK", details: { logDate, readiness } });
      return jsonResp({ ok: true, bio: bioRow });
    }

    if (action === "logWorkout") {
      const mode = body.activity_type === "walking" || body.activity_type === "running" ? body.activity_type : "strength_training";
      const weightKg = Number(body.weight_kg ?? 6);
      const sets = Number(body.sets ?? 4);
      const reps = Number(body.reps ?? 15);
      const durationMin = Number(body.duration_min ?? (mode === "strength_training" ? 42 : 55));
      const distanceKm = Number(body.distance_km ?? (mode === "strength_training" ? 0 : 5.5));
      const avgHr = Number(body.avg_hr ?? (mode === "strength_training" ? 109 : 116));
      const maxHr = Number(body.max_hr ?? (mode === "strength_training" ? 135 : 132));
      const activityId = Date.now();

      const exerciseSets =
        mode === "strength_training"
          ? (Array.isArray(body.custom_sets) && body.custom_sets.length > 0
              ? body.custom_sets
              : [
                  { exercise: "Dumbbell Floor Chest Press", muscle: "Göğüs", sets, reps, weight_kg: weightKg, volume_kg: sets * reps * weightKg * 2 },
                  { exercise: "Dumbbell Overhead Shoulder Press", muscle: "Omuz", sets, reps, weight_kg: weightKg, volume_kg: sets * reps * weightKg * 2 },
                  { exercise: "Bent-Over Dumbbell Row", muscle: "Sırt", sets, reps, weight_kg: weightKg, volume_kg: sets * reps * weightKg * 2 },
                  { exercise: "Dumbbell Hammer Curl", muscle: "Ön Kol", sets, reps, weight_kg: weightKg, volume_kg: sets * reps * weightKg * 2 },
                  { exercise: "Weighted Core & Plank", muscle: "Core", sets, reps, weight_kg: weightKg, volume_kg: sets * reps * weightKg },
                ])
          : null;

      const muscleHeatmap = buildMuscleHeatmapFromActivity(body.activity_name || "Dambıl Kuvvet", mode, exerciseSets, distanceKm * 1000, mode === "strength_training" ? 0 : 48);
      const calEst = Math.round(durationMin * (mode === "strength_training" ? 6.4 : 7.2));
      const waterMl = Math.max(150, Math.round(durationMin * 6.5 + calEst * 0.45));
      const hrZones =
        mode === "strength_training"
          ? [
              { zone: "Z1", label: "Toparlanma", seconds: Math.round(durationMin * 60 * 0.42), pct: 42 },
              { zone: "Z2", label: "Aerobik Baz", seconds: Math.round(durationMin * 60 * 0.44), pct: 44 },
              { zone: "Z3", label: "Tempo", seconds: Math.round(durationMin * 60 * 0.14), pct: 14 },
              { zone: "Z4", label: "Eşik", seconds: 0, pct: 0 },
              { zone: "Z5", label: "VO2Max", seconds: 0, pct: 0 },
            ]
          : [
              { zone: "Z1", label: "Toparlanma", seconds: Math.round(durationMin * 60 * 0.22), pct: 22 },
              { zone: "Z2", label: "Aerobik Baz", seconds: Math.round(durationMin * 60 * 0.65), pct: 65 },
              { zone: "Z3", label: "Tempo", seconds: Math.round(durationMin * 60 * 0.13), pct: 13 },
              { zone: "Z4", label: "Eşik", seconds: 0, pct: 0 },
              { zone: "Z5", label: "VO2Max", seconds: 0, pct: 0 },
            ];
      const totalVol = exerciseSets ? exerciseSets.reduce((s: number, x: any) => s + Number(x.volume_kg || 0), 0) : 0;
      const actName =
        body.activity_name ||
        (mode === "strength_training"
          ? `Evde ${weightKg} kg Dambıl Kuvvet (${sets}x${reps})`
          : `${settings?.active_city || DEFAULT_CITY} ${mode === "running" ? "Koşu" : "Yürüyüş"} (${distanceKm} km)`);

      const newAct = {
        user_id: userId,
        activity_id: activityId,
        activity_name: actName,
        activity_type: mode,
        start_time_local: new Date().toISOString(),
        duration_seconds: durationMin * 60,
        distance_meters: Number((distanceKm * 1000).toFixed(2)),
        calories: calEst,
        avg_hr: avgHr,
        max_hr: maxHr,
        avg_speed: mode === "strength_training" ? 0 : Number(((distanceKm * 1000) / (durationMin * 60)).toFixed(3)),
        avg_cadence: mode === "strength_training" ? 0 : mode === "running" ? 152 : 118,
        elevation_gain: mode === "strength_training" ? 0 : 48,
        aerobic_te: mode === "strength_training" ? 2.1 : 2.9,
        anaerobic_te: mode === "strength_training" ? 1.4 : 0.3,
        training_load: mode === "strength_training" ? 48 : 56,
        start_lat: settings?.active_lat ?? DEFAULT_LAT,
        start_lon: settings?.active_lon ?? DEFAULT_LON,
        location_name: settings?.active_city ?? DEFAULT_CITY,
        hr_zones: hrZones,
        exercise_sets: exerciseSets,
        muscle_heatmap: muscleHeatmap,
        time_series: {
          labels: ["00:00", "10:00", "20:00", "30:00", `${durationMin}:00`],
          hr: [88, avgHr - 6, avgHr, maxHr - 4, avgHr - 2],
          cadence: mode === "strength_training" ? [] : [112, 118, 120, 119, 116],
          route: mode === "strength_training" ? null : [
            [settings?.active_lat ?? DEFAULT_LAT, settings?.active_lon ?? DEFAULT_LON],
            [(settings?.active_lat ?? DEFAULT_LAT) + 0.0025, (settings?.active_lon ?? DEFAULT_LON) + 0.003],
            [(settings?.active_lat ?? DEFAULT_LAT) + 0.0042, (settings?.active_lon ?? DEFAULT_LON) + 0.001],
            [settings?.active_lat ?? DEFAULT_LAT, settings?.active_lon ?? DEFAULT_LON],
          ],
        },
        session_comparison: {
          water_ml: waterMl,
          verdict: mode === "strength_training"
            ? `Toplam ${totalVol} kg dambıl hacmi kaydedildi (${weightKg} kg · ${sets}x${reps}) · Ter kaybı ${waterMl} ml.`
            : `${distanceKm} km mesafe ort. ${avgHr} atım/dk ile tamamlandı · Ter kaybı ${waterMl} ml.`,
        },
        ai_post_workout_analysis: {
          summary: `${actName} kaydedildi (${durationMin} dk, ort. ${avgHr} atım/dk).`,
          highlight: mode === "strength_training" ? `5 ana kas grubunda (${totalVol} kg hacim) dengeli yüklenme.` : "Aerobik baz gelişimi ve nabız kararlılığı hedefte.",
          next_step: "Seans sonrası yeterli su + protein ve gece uyku düzenini koru.",
        },
        post_workout_notified_at: new Date().toISOString(),
      };

      await supabase.from("activities").insert(newAct);
      await supabase.from("sync_logs").insert({ user_id: userId, job_type: "LOG_WORKOUT", status: "OK", details: { activity_id: activityId, activity_name: actName } });
      return jsonResp({ ok: true, activity: newAct });
    }

    if (action === "gunlukGarminAnalizi" || action === "dokumaniSessizGuncelle") {
      const res = await runDailyAnalysisForUser(supabase, userId, settings, integration, ist, {
        isSilent: action === "dokumaniSessizGuncelle" || Boolean(body.silent),
        force,
        isCron: false,
      });
      return jsonResp({ ok: true, ...res });
    }

    if (action === "haftalikStratejiBulteni") {
      const strategy = await generateWeeklyStrategyForUser(supabase, userId, settings, integration, ist, Boolean(body.notify));
      return jsonResp({ ok: true, strategy });
    }

    if (action === "aylikCeoRaporu") {
      const report = await generateMonthlyCeoReportForUser(supabase, userId, settings, integration, ist, body.notify !== false);
      return jsonResp({ ok: true, report });
    }

    if (action === "yeniAntrenmanKontrol" || action === "sonAntrenmaniManuelAnalizEt") {
      const { garminKey } = resolveGarminCredentials(integration);
      if (garminKey) {
        await syncFromGarminForUser(supabase, userId, ist.dateStr, settings, integration, { onlyActivities: true });
      }

      const { data: latestActs } = await supabase
        .from("activities")
        .select("*")
        .eq("user_id", userId)
        .order("start_time_local", { ascending: false })
        .limit(8);

      if (!latestActs || latestActs.length === 0) {
        return jsonResp({ ok: true, message: "Analiz edilecek aktivite bulunamadı." });
      }

      const targetAct = body.activity_id
        ? latestActs.find((a: any) => Number(a.activity_id) === Number(body.activity_id)) || latestActs[0]
        : latestActs[0];

      const shouldNotify = action === "yeniAntrenmanKontrol"
        ? (!targetAct.post_workout_notified_at || Boolean(body.notify))
        : Boolean(body.notify !== false);

      const res = await analyzeAndNotifyWorkout(supabase, userId, targetAct, latestActs, geminiKey, shouldNotify, settings?.display_name);

      await supabase.from("sync_logs").insert({
        user_id: userId,
        job_type: "WORKOUT_CHECK",
        status: "OK",
        details: { activity_id: targetAct.activity_id, activity_name: targetAct.activity_name, notified: Boolean(res.notification) },
      });

      return jsonResp({
        ok: true,
        activity_id: targetAct.activity_id,
        comparison: res.comparison,
        ai_post_workout_analysis: res.ai_post_workout_analysis,
        notification: res.notification,
      });
    }

    return jsonResp({ ok: false, error: `Bilinmeyen action: ${action}` }, 400);
  } catch (err) {
    return jsonResp({ ok: false, error: String(err) }, 500);
  }
});
