import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SYSTEM_PROMPT =
  "Ham sayıları tekrar etme; uyku, HRV, aktivite ve antrenman yükü arasındaki ilişkileri yorumla. Tıbbi teşhis koyma. Maksimum 2-3 cümlelik net, motive edici ve somut bir özet ile tek bir aksiyon önerisi içeren geçerli JSON döndür.";

const VALID_CATEGORIES = new Set(["uyku", "antrenman", "toparlanma", "genel"]);

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getIstanbulNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const hour = Number(map.hour === "24" ? 0 : map.hour);
  const minute = Number(map.minute);
  return { dateStr, hour, minute, minuteOfDay: hour * 60 + minute };
}

function shiftDateStr(dateStr: string, deltaDays: number): string {
  const dt = new Date(`${dateStr}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function formatFirstName(displayName?: string | null): string | null {
  const clean = String(displayName || "").trim();
  if (!clean || clean.toLowerCase() === "sporcu") return null;
  const first = clean.split(/\s+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : null;
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

async function callGeminiWithSystemPrompt(promptText: string, customKey?: string | null): Promise<any | null> {
  const apiKey = (customKey && String(customKey).trim()) || Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;

  const candidateModels = [
    "models/gemini-3.6-flash",
    "models/gemini-3.5-flash",
    "models/gemini-3.5-flash-lite",
  ];

  for (const modelName of candidateModels) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(22000),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: {
              temperature: 0.35,
              responseMimeType: "application/json",
            },
          }),
        }
      );
      if (!res.ok) continue;

      const data = await res.json();
      const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
      const texts = parts.map((p: any) => String(p?.text || "")).filter(Boolean);
      const rawText =
        texts.find((t: string) => t.trim().startsWith("{")) ||
        texts[texts.length - 1] ||
        "";
      if (!rawText) continue;

      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      let parsed: any = null;
      try {
        parsed = JSON.parse(cleaned);
      } catch (_) {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }
      if (Array.isArray(parsed)) parsed = parsed[0];
      if (parsed && typeof parsed === "object" && parsed.title && parsed.summary && parsed.action_tip) {
        return parsed;
      }
    } catch (_) {
      continue;
    }
  }
  return null;
}

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
    return tokenJson?.access_token ? { token: tokenJson.access_token, projectId: sa.project_id } : null;
  } catch (_) {
    return null;
  }
}

async function sendFcmAndInAppNotification(
  supabase: any,
  userId: string,
  settings: any,
  insight: any,
  dateStr: string
) {
  if (!settings?.daily_notification_enabled || !settings?.ai_insights_enabled) {
    return { sent: false, reason: "DISABLED_BY_USER" };
  }

  const { data: existingNotifs } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("report_date", dateStr)
    .contains("payload", { source: "ai_insights_engine" })
    .limit(1);

  if (existingNotifs && existingNotifs.length > 0) {
    return { sent: false, reason: "ALREADY_SENT_TODAY" };
  }

  const firstName = formatFirstName(settings?.display_name);
  const title = `✨ ${firstName ? `${firstName}, ` : ""}${insight.title}`;
  const body = `${insight.summary} Öneri: ${insight.action_tip}`.slice(0, 240);

  let pushStatus: "IN_APP_ONLY" | "SENT" | "FAILED" = "IN_APP_ONLY";
  let pushSentAt: string | null = null;

  const { data: pushRows } = await supabase
    .from("user_push_tokens")
    .select("id, fcm_token")
    .eq("user_id", userId)
    .eq("enabled", true);

  const tokenSet = new Set<string>();
  if (settings?.fcm_token) tokenSet.add(String(settings.fcm_token));
  for (const pr of pushRows || []) {
    if (pr?.fcm_token) tokenSet.add(String(pr.fcm_token));
  }

  const fcmSa = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (fcmSa && tokenSet.size > 0) {
    const auth = await getFcmAccessToken(fcmSa);
    if (auth) {
      let anySent = false;
      for (const tk of tokenSet) {
        try {
          const r = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                token: tk,
                notification: { title, body },
                data: {
                  type: "AI_INSIGHT",
                  tab: "dashboard",
                  focus_card: "ai-daily-insight-card",
                  insight_id: String(insight.id),
                },
                android: { priority: "high" },
              },
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) anySent = true;
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
      type: "MORNING_REPORT",
      title,
      body,
      report_date: dateStr,
      push_status: pushStatus,
      push_sent_at: pushSentAt,
      payload: {
        tab: "dashboard",
        focus_card: "ai-daily-insight-card",
        insight_id: insight.id,
        source: "ai_insights_engine",
      },
    })
    .select("*")
    .single();

  return { sent: true, notification: inserted };
}

function avgNums(arr: any[], key: string): number | null {
  const nums = arr.map((x) => Number(x?.[key])).filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1));
}

function buildDeterministicInsight(
  firstName: string | null,
  todayBio: any,
  trendSummary: any,
  latestAct: any
) {
  const namePrefix = firstName ? `${firstName}, ` : "";
  const hasNewActToday = Boolean(latestAct && String(latestAct.start_time_local || "").startsWith(todayBio?.log_date || "___"));

  const hrvDiff =
    todayBio?.hrv_nightly_avg != null && trendSummary.hrv_14d != null
      ? Number(todayBio.hrv_nightly_avg) - trendSummary.hrv_14d
      : 0;
  const rhrDiff =
    todayBio?.rhr != null && trendSummary.rhr_14d != null
      ? Number(todayBio.rhr) - trendSummary.rhr_14d
      : 0;
  const sleepLow = todayBio?.sleep_score != null && Number(todayBio.sleep_score) < 68;

  if (hasNewActToday && latestAct) {
    return {
      category: "antrenman",
      title: "Antrenman Yükü & Toparlanma Dengesi",
      summary: `${namePrefix}tamamladığın son ${latestAct.activity_name} seansının ardından otonom toparlanma kapasitenle mevcut yükün arasındaki denge önem kazandı. Son iki haftalık ritmin vücudunun bu tempoya uyum sağladığını gösteriyor.`,
      action_tip: "Seans sonrası sıvı alımını artırıp bu akşam uykuya normalden 20 dakika erken geçerek kas onarımını destekle.",
    };
  }

  if (sleepLow || hrvDiff <= -4 || rhrDiff >= 3) {
    return {
      category: "uyku",
      title: "Dinlenme & Toparlanma Önceliği",
      summary: `${namePrefix}son gece toparlanma işaretlerin iki haftalık normal ritmine göre vücudunun ek dinlenmeye ihtiyaç duyduğunu gösteriyor. Mevcut birikmiş antrenman yükünü bugün koruyucu alanda tutmak yarınki enerjini hızla toplayacaktır.`,
      action_tip: "Bugün ağır yükleme yerine 25-30 dakikalık düşük tempolu açık hava yürüyüşü ve erken ekran kapanışı tercih et.",
    };
  }

  if (hrvDiff >= 3 && rhrDiff <= 0) {
    return {
      category: "toparlanma",
      title: "Yükselen Toparlanma İvmesi",
      summary: `${namePrefix}uyku kaliten ve sinir sistemi dengen son iki haftalık ortalamanın üzerinde seyrederek antrenman yükünü verimli sindirdiğini gösteriyor. Vücudun bugün kaliteli bir kuvvet veya tempo çalışmasına açık görünüyor.`,
      action_tip: "Bu yüksek hazırlık penceresini değerlendirip planlı kuvvet ya da orta tempolu kardiyo seansını gün içinde tamamla.",
    };
  }

  return {
    category: "genel",
    title: "Dengeli Ritim & İstikrarlı İlerleme",
    summary: `${namePrefix}uyku düzenin, dinlenme nabzın ve günlük hareket hacmin son iki haftalık baz çizginle uyumlu bir denge içinde ilerliyor. İstikrarlı küçük adımlar uzun vadeli kondisyon temelini güçlendirmeye devam ediyor.`,
    action_tip: "Günlük adım ritmini koruyup akşam saatlerinde hafif esneme ile yarınki güne taze hazırlan.",
  };
}

async function generateOrFetchInsightForUser(
  supabase: any,
  userId: string,
  settings: any,
  customGeminiKey: string | null,
  dateStr: string,
  force = false
) {
  if (!settings?.ai_insights_enabled) {
    return { disabled: true, cached: false, insight: null };
  }

  const cutoff14 = shiftDateStr(dateStr, -13);
  const [{ data: bios14 }, { data: acts14 }, { data: pastInsights }] = await Promise.all([
    supabase
      .from("daily_biometrics")
      .select("log_date, readiness_score, body_battery_max, sleep_score, sleep_seconds, deep_sleep_seconds, rem_sleep_seconds, sleep_stress_avg, hrv_nightly_avg, rhr, steps, stress_avg, active_kilocalories")
      .eq("user_id", userId)
      .gte("log_date", cutoff14)
      .order("log_date", { ascending: false }),
    supabase
      .from("activities")
      .select("activity_id, activity_name, activity_type, start_time_local, duration_seconds, distance_meters, avg_hr, training_load, aerobic_te, anaerobic_te")
      .eq("user_id", userId)
      .order("start_time_local", { ascending: false })
      .limit(12),
    supabase
      .from("ai_insights")
      .select("id, date, category, title, summary, action_tip, feedback, last_activity_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const recentActs = acts14 || [];
  const latestActivityId = recentActs[0]?.activity_id != null ? Number(recentActs[0].activity_id) : null;
  const existingToday = (pastInsights || []).find((x: any) => x.date === dateStr) || null;

  // Deduplication: same day + no new workout added -> reuse existing insight
  if (
    !force &&
    existingToday &&
    (existingToday.last_activity_id ?? null) === latestActivityId
  ) {
    return { disabled: false, cached: true, insight: existingToday };
  }

  const recentBios = bios14 || [];
  const todayBio = recentBios.find((b: any) => b.log_date === dateStr) || recentBios[0] || null;
  const firstName = formatFirstName(settings?.display_name);

  if (!todayBio && recentActs.length === 0) {
    return { disabled: false, cached: false, insight: null, needs_garmin_data: true };
  }

  const last7Acts = recentActs.filter((a: any) => String(a.start_time_local || "").slice(0, 10) >= shiftDateStr(dateStr, -6));
  const prev7Acts = recentActs.filter((a: any) => {
    const d = String(a.start_time_local || "").slice(0, 10);
    return d < shiftDateStr(dateStr, -6) && d >= cutoff14;
  });

  const load7 = Number(last7Acts.reduce((s: number, a: any) => s + Number(a.training_load || 0), 0).toFixed(1));
  const loadPrev7 = Number(prev7Acts.reduce((s: number, a: any) => s + Number(a.training_load || 0), 0).toFixed(1));

  const trendSummary = {
    days_recorded_14d: recentBios.length,
    readiness_14d: avgNums(recentBios, "readiness_score"),
    sleep_14d: avgNums(recentBios, "sleep_score"),
    hrv_14d: avgNums(recentBios, "hrv_nightly_avg"),
    rhr_14d: avgNums(recentBios, "rhr"),
    steps_14d: avgNums(recentBios, "steps"),
    workouts_7d_count: last7Acts.length,
    training_load_7d: load7,
    training_load_prev_7d: loadPrev7,
  };

  const likedTopics = (pastInsights || [])
    .filter((i: any) => i.feedback === 1)
    .map((i: any) => `[${i.category}] ${i.title}`);
  const dislikedTopics = (pastInsights || [])
    .filter((i: any) => i.feedback === -1)
    .map((i: any) => `[${i.category}] ${i.title}`);

  const todaySnapshot = todayBio
    ? {
        date: todayBio.log_date,
        is_today: todayBio.log_date === dateStr,
        readiness_score: todayBio.readiness_score,
        body_battery_max: todayBio.body_battery_max,
        sleep_score: todayBio.sleep_score,
        sleep_hours: todayBio.sleep_seconds ? Number((Number(todayBio.sleep_seconds) / 3600).toFixed(1)) : null,
        sleep_stress: todayBio.sleep_stress_avg,
        hrv: todayBio.hrv_nightly_avg,
        rhr: todayBio.rhr,
        steps: todayBio.steps,
      }
    : null;

  const latestActSummary = recentActs[0]
    ? {
        name: recentActs[0].activity_name,
        type: recentActs[0].activity_type,
        date: String(recentActs[0].start_time_local || "").slice(0, 10),
        duration_min: Math.round(Number(recentActs[0].duration_seconds || 0) / 60),
        training_load: recentActs[0].training_load,
        aerobic_te: recentActs[0].aerobic_te,
        anaerobic_te: recentActs[0].anaerobic_te,
      }
    : null;

  const userPrompt = `Bugünün tarihi: ${dateStr}
${firstName ? `Sporcunun adı: ${firstName} (doğal bir yerde adı ile hitap edebilirsin).` : ""}
Güncel Biyometrik Durum: ${JSON.stringify(todaySnapshot)}
Son 14 Günlük Ortalamalar ve Yük Trendi: ${JSON.stringify(trendSummary)}
En Son Aktivite: ${JSON.stringify(latestActSummary)}
Kullanıcının Geçmiş İçgörü Tercihleri (Beğenilenler): ${JSON.stringify(likedTopics)}
Kullanıcının Beğenmediği İçgörüler (bu tarz yaklaşım/tekrardan kaçın): ${JSON.stringify(dislikedTopics)}

Tam olarak şu geçerli JSON şemasını döndür:
{
  "category": "uyku | antrenman | toparlanma | genel",
  "title": "En fazla 5-6 kelimelik kısa dikkat çekici başlık",
  "summary": "Sayıları listeleyip tekrar etmeden uyku, HRV, aktivite ve antrenman yükü ilişkilerini yorumlayan en fazla 2-3 cümlelik net, motive edici özet",
  "action_tip": "Bugün uygulanabilecek tek cümlelik somut aksiyon önerisi"
}`;

  const aiOut = await callGeminiWithSystemPrompt(userPrompt, customGeminiKey);
  const fallback = buildDeterministicInsight(firstName, todayBio, trendSummary, recentActs[0]);

  const rawCat = String(aiOut?.category || fallback.category).toLowerCase().trim();
  const category = VALID_CATEGORIES.has(rawCat) ? rawCat : "genel";
  const title = String(aiOut?.title || fallback.title).trim().slice(0, 110);
  const summary = String(aiOut?.summary || fallback.summary).trim();
  const action_tip = String(aiOut?.action_tip || fallback.action_tip).trim();

  const { data: inserted, error: insErr } = await supabase
    .from("ai_insights")
    .insert({
      user_id: userId,
      date: dateStr,
      category,
      title,
      summary,
      action_tip,
      last_activity_id: latestActivityId,
    })
    .select("*")
    .single();

  if (insErr) throw new Error(insErr.message);

  return { disabled: false, cached: false, insight: inserted };
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

    const action = String(body.action || "getLatestInsight");
    const ist = getIstanbulNow();

    if (action === "health") {
      return jsonResp({
        ok: true,
        service: "ai-insights-engine",
        timezone: "Europe/Istanbul",
        local_now: ist,
        has_gemini_key: Boolean(Deno.env.get("GEMINI_API_KEY")),
        has_fcm_push: Boolean(Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")),
      });
    }

    const authUser = await getAuthenticatedUser(req, supabase);

    if (action === "cronDispatch") {
      if (authUser) {
        return jsonResp({ ok: false, error: "cronDispatch yalnızca sistem zamanlayıcısı içindir." }, 403);
      }

      const { data: allSettings } = await supabase
        .from("athlete_settings")
        .select("*")
        .not("user_id", "is", null)
        .eq("ai_insights_enabled", true);

      const { data: allInts } = await supabase.from("user_integrations").select("user_id, gemini_api_key");
      const keyMap = new Map<string, string | null>();
      for (const item of allInts || []) keyMap.set(item.user_id, item.gemini_api_key || null);

      const results: any[] = [];
      for (const s of allSettings || []) {
        const uid = s.user_id;
        try {
          const gen = await generateOrFetchInsightForUser(
            supabase,
            uid,
            s,
            keyMap.get(uid) || null,
            ist.dateStr,
            false
          );

          let notifResult: any = { sent: false, reason: "NO_INSIGHT" };
          if (gen.insight && s.daily_notification_enabled) {
            const m = String(s.notification_time || "09:00").match(/^(\d{2}):(\d{2})$/);
            const targetH = m ? Number(m[1]) : 9;
            const targetM = m ? Number(m[2]) : 0;
            const targetMin = targetH * 60 + targetM;
            const diffMin = ist.minuteOfDay - targetMin;
            if (diffMin >= 0 && diffMin < 15) {
              notifResult = await sendFcmAndInAppNotification(supabase, uid, s, gen.insight, ist.dateStr);
            } else {
              notifResult = { sent: false, reason: "OUTSIDE_USER_NOTIFICATION_WINDOW" };
            }
          } else if (!s.daily_notification_enabled) {
            notifResult = { sent: false, reason: "DAILY_NOTIFICATION_DISABLED" };
          }

          results.push({ user_id: uid, insight_id: gen.insight?.id || null, cached: gen.cached, notif: notifResult });
        } catch (err) {
          results.push({ user_id: uid, error: String(err) });
        }
      }

      return jsonResp({ ok: true, action: "cronDispatch", processed: results.length, results });
    }

    if (!authUser) {
      return jsonResp({ ok: false, error: "Bu işlem için oturum açmanız gerekiyor." }, 401);
    }

    const userId = authUser.id;
    const [{ data: settings }, { data: integ }] = await Promise.all([
      supabase.from("athlete_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("user_integrations").select("gemini_api_key").eq("user_id", userId).maybeSingle(),
    ]);

    let activeSettings = settings;
    if (!activeSettings) {
      const { data: inserted } = await supabase
        .from("athlete_settings")
        .insert({
          user_id: userId,
          display_name: authUser.user_metadata?.display_name || String(authUser.email || "Sporcu").split("@")[0],
        })
        .select("*")
        .single();
      activeSettings = inserted;
    }

    if (action === "getLatestInsight") {
      const { data: list } = await supabase
        .from("ai_insights")
        .select("*")
        .eq("user_id", userId)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5);

      return jsonResp({
        ok: true,
        today: ist.dateStr,
        preferences: {
          ai_insights_enabled: activeSettings?.ai_insights_enabled !== false,
          daily_notification_enabled: activeSettings?.daily_notification_enabled !== false,
          notification_time: activeSettings?.notification_time || "09:00",
        },
        insight: (list || []).find((x: any) => x.date === ist.dateStr) || list?.[0] || null,
        history: list || [],
      });
    }

    if (action === "generateInsight") {
      const res = await generateOrFetchInsightForUser(
        supabase,
        userId,
        activeSettings,
        integ?.gemini_api_key || null,
        ist.dateStr,
        Boolean(body.force)
      );
      return jsonResp({
        ok: true,
        today: ist.dateStr,
        preferences: {
          ai_insights_enabled: activeSettings?.ai_insights_enabled !== false,
          daily_notification_enabled: activeSettings?.daily_notification_enabled !== false,
          notification_time: activeSettings?.notification_time || "09:00",
        },
        ...res,
      });
    }

    if (action === "submitFeedback") {
      const insightId = String(body.insight_id || "").trim();
      const fb = Number(body.feedback);
      if (!insightId) return jsonResp({ ok: false, error: "insight_id gereklidir." }, 400);
      if (fb !== 1 && fb !== -1) {
        return jsonResp({ ok: false, error: "feedback yalnızca 1 veya -1 olabilir." }, 400);
      }

      const { data: existing, error: fetchErr } = await supabase
        .from("ai_insights")
        .select("*")
        .eq("id", insightId)
        .eq("user_id", userId)
        .single();

      if (fetchErr || !existing) {
        return jsonResp({ ok: false, error: fetchErr?.message || "Öneri bulunamadı." }, 404);
      }

      if (existing.feedback !== null) {
        return jsonResp({ ok: true, already_voted: true, insight: existing });
      }

      const { data: updated, error: updErr } = await supabase
        .from("ai_insights")
        .update({ feedback: fb })
        .eq("id", insightId)
        .eq("user_id", userId)
        .select("*")
        .single();

      if (updErr) return jsonResp({ ok: false, error: updErr.message }, 400);
      return jsonResp({ ok: true, insight: updated });
    }

    if (action === "updatePreferences") {
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (typeof body.ai_insights_enabled === "boolean") {
        patch.ai_insights_enabled = body.ai_insights_enabled;
      }
      if (typeof body.daily_notification_enabled === "boolean") {
        patch.daily_notification_enabled = body.daily_notification_enabled;
      }
      if (body.notification_time != null) {
        const timeStr = String(body.notification_time).trim();
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)) {
          return jsonResp({ ok: false, error: "Geçersiz bildirim saati formatı (HH:MM)." }, 400);
        }
        patch.notification_time = timeStr;
      }
      if (body.fcm_token !== undefined) {
        patch.fcm_token = body.fcm_token ? String(body.fcm_token).trim() : null;
      }

      const { data: updatedSet, error: setErr } = await supabase
        .from("athlete_settings")
        .update(patch)
        .eq("user_id", userId)
        .select("*")
        .single();

      if (setErr) return jsonResp({ ok: false, error: setErr.message }, 400);

      if (typeof body.daily_notification_enabled === "boolean") {
        await supabase
          .from("user_push_tokens")
          .update({ enabled: body.daily_notification_enabled, updated_at: new Date().toISOString() })
          .eq("user_id", userId);
      }

      if (body.fcm_token) {
        await supabase.from("user_push_tokens").upsert(
          {
            user_id: userId,
            platform: "android",
            fcm_token: String(body.fcm_token).trim(),
            enabled: updatedSet.daily_notification_enabled !== false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,fcm_token" }
        );
      }

      return jsonResp({
        ok: true,
        preferences: {
          ai_insights_enabled: updatedSet.ai_insights_enabled !== false,
          daily_notification_enabled: updatedSet.daily_notification_enabled !== false,
          notification_time: updatedSet.notification_time || "09:00",
          has_fcm_token: Boolean(updatedSet.fcm_token),
        },
      });
    }

    return jsonResp({ ok: false, error: `Bilinmeyen action: ${action}` }, 400);
  } catch (err) {
    return jsonResp({ ok: false, error: String(err) }, 500);
  }
});
