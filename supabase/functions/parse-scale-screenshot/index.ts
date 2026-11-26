import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTRACTION_PROMPT = `Sen Huawei Health (Honor Scale 2 / akıllı tartı) ekran görüntüsünden yalnızca sayısal vücut kompozisyonu metriklerini çıkaran katı bir veri ayrıştırıcısın.
Ekrandaki Türkçe veya İngilizce etiketlerden aşağıdaki alanları oku:
- weight_kg: Kilo / Ağırlık / Weight (kg)
- bmi: VKİ / Beden Kitle İndeksi / BMI
- body_fat_pct: Vücut Yağ Oranı / Yağ Yüzdesi / Body fat (%)
- muscle_mass_kg: Kas Kütlesi / İskelet Kası / Muscle mass (kg). Eğer sadece yüzde verilmişse kilo verilmemişse null bırak.
- bone_mass_kg: Kemik Mineral Kütlesi / Kemik Kütlesi / Bone mass (kg)
- body_water_pct: Su Oranı / Vücut Suyu / Body water (%)
- visceral_fat: İç Organ Yağlanması / Visceral fat seviyesi (sayı)
- metabolic_age: Vücut Yaşı / Metabolik Yaş / Body age (tam sayı)
- bmr_kcal: Bazal Metabolizma / BMR (kcal, tam sayı)
- protein_pct: Protein (%)
- measured_at: Ekranda açık tarih/saat görünüyorsa ISO 8601 formatında (+03:00 Türkiye saatiyle, örn "2026-11-25T08:15:00+03:00"), görünmüyorsa null.

Okunamayan veya ekranda olmayan her alan için null döndür. Asla uydurma veya tahmin etme.
Yalnızca şu JSON şemasına birebir uyan geçerli JSON nesnesi döndür:
{
  "measured_at": string | null,
  "weight_kg": number | null,
  "bmi": number | null,
  "body_fat_pct": number | null,
  "muscle_mass_kg": number | null,
  "bone_mass_kg": number | null,
  "body_water_pct": number | null,
  "visceral_fat": number | null,
  "metabolic_age": integer | null,
  "bmr_kcal": integer | null,
  "protein_pct": number | null
}`;

const CANDIDATE_MODELS = [
  "models/gemini-3.6-flash",
  "models/gemini-3.5-flash",
  "models/gemini-2.5-flash",
  "models/gemini-2.0-flash",
];

const BODY_ANALYSIS_PROMPT = `Sen kanıta dayalı spor fizyolojisi ve vücut kompozisyonu koçusun. Kullanıcının boy, kilo ve akıllı tartı (Honor Scale 2) verilerini analiz et.
Kurallar:
- Türkçe, samimi ama net ve tıbbi abartıdan uzak konuş.
- Boy (mevcutsa), kilo, VKİ, yağ oranı, iskelet kas kütlesi, yağsız kütle, viseral yağ, su, protein, kemik minerali, BMR ve önceki ölçüme göre değişimi birlikte değerlendir.
- Eğer boy hesaplanmışsa "yaklaşık X cm boy" diye kısaca değinebilirsin; eksik alanları asla uydurma.
- Sadece aşağıdaki şemaya birebir uyan geçerli JSON nesnesi döndür:
{
  "title": "⚖️ Vücut Analizi · 76,9 kg (VKİ 24,0)",
  "summary": "2-3 cümlelik net genel değerlendirme (bildirim önizlemesinde de görünecek).",
  "highlights": ["3-4 kısa madde (güçlü yönler ve dikkat edilmesi gerekenler)"],
  "actions": ["2-3 somut, uygulanabilir beslenme/hidrasyon/antrenman önerisi"]
}`;

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function toBoundedFloat(val: unknown, min: number, max: number, decimals = 2): number | null {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(String(val).replace(",", "."));
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return Number(num.toFixed(decimals));
}

function toBoundedInt(val: unknown, min: number, max: number): number | null {
  if (val === null || val === undefined || val === "") return null;
  const num = Math.round(Number(String(val).replace(",", ".")));
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
}

function sanitizeParsedMetrics(raw: any) {
  let measuredAt: string | null = null;
  if (typeof raw?.measured_at === "string" && raw.measured_at.trim()) {
    const dt = new Date(raw.measured_at.trim());
    if (!Number.isNaN(dt.getTime())) measuredAt = dt.toISOString();
  }

  return {
    measured_at: measuredAt,
    weight_kg: toBoundedFloat(raw?.weight_kg, 20, 300, 2),
    bmi: toBoundedFloat(raw?.bmi, 8, 80, 1),
    body_fat_pct: toBoundedFloat(raw?.body_fat_pct, 2, 75, 1),
    muscle_mass_kg: toBoundedFloat(raw?.muscle_mass_kg, 5, 150, 2),
    bone_mass_kg: toBoundedFloat(raw?.bone_mass_kg, 0.5, 15, 2),
    body_water_pct: toBoundedFloat(raw?.body_water_pct, 15, 85, 1),
    visceral_fat: toBoundedFloat(raw?.visceral_fat, 1, 50, 1),
    metabolic_age: toBoundedInt(raw?.metabolic_age, 10, 110),
    bmr_kcal: toBoundedInt(raw?.bmr_kcal, 500, 6000),
    protein_pct: toBoundedFloat(raw?.protein_pct, 4, 45, 1),
  };
}

async function resolveGeminiApiKey(supabase: any, userId: string): Promise<string | null> {
  const { data: userInt } = await supabase
    .from("user_integrations")
    .select("gemini_api_key")
    .eq("user_id", userId)
    .maybeSingle();

  return (
    (userInt?.gemini_api_key && String(userInt.gemini_api_key).trim()) ||
    Deno.env.get("GEMINI_API_KEY") ||
    null
  );
}

async function callGeminiJson(apiKey: string, parts: unknown[], temperature = 0.1) {
  const debugErrors: string[] = [];
  for (const modelName of CANDIDATE_MODELS) {
    try {
      const gemRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(28000),
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (!gemRes.ok) {
        const errText = (await gemRes.text()).slice(0, 120);
        debugErrors.push(`${modelName}:HTTP_${gemRes.status}:${errText}`);
        continue;
      }

      const gemJson = await gemRes.json();
      const respParts: any[] = gemJson?.candidates?.[0]?.content?.parts || [];
      const rawText = respParts
        .filter((p: any) => !p?.thought && p?.text)
        .map((p: any) => String(p.text))
        .join("\n")
        .trim();
      if (!rawText) {
        debugErrors.push(`${modelName}:EMPTY`);
        continue;
      }

      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      let parsed: any = null;
      try {
        parsed = JSON.parse(cleaned);
      } catch (_) {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }
      if (Array.isArray(parsed)) parsed = parsed[0];
      if (parsed && typeof parsed === "object") {
        return { ok: true as const, parsed, modelName, debugErrors };
      }
      debugErrors.push(`${modelName}:BAD_JSON`);
    } catch (e) {
      debugErrors.push(`${modelName}:ERR:${String(e).slice(0, 80)}`);
    }
  }
  return { ok: false as const, parsed: null, modelName: null, debugErrors };
}

function enrichRecordForAi(rec: any) {
  if (!rec) return null;
  const w = rec.weight_kg != null ? Number(rec.weight_kg) : null;
  const leanMassKg =
    w != null && rec.body_fat_pct != null
      ? Number((w * (1 - Number(rec.body_fat_pct) / 100)).toFixed(1))
      : null;
  return {
    measured_at: rec.measured_at,
    weight_kg: w,
    bmi: rec.bmi != null ? Number(rec.bmi) : null,
    body_fat_pct: rec.body_fat_pct != null ? Number(rec.body_fat_pct) : null,
    muscle_mass_kg: rec.muscle_mass_kg != null ? Number(rec.muscle_mass_kg) : null,
    lean_mass_kg: leanMassKg,
    visceral_fat: rec.visceral_fat != null ? Number(rec.visceral_fat) : null,
    bmr_kcal: rec.bmr_kcal != null ? Number(rec.bmr_kcal) : null,
    body_water_pct: rec.body_water_pct != null ? Number(rec.body_water_pct) : null,
    water_kg: w != null && rec.body_water_pct != null ? Number(((w * Number(rec.body_water_pct)) / 100).toFixed(2)) : null,
    bone_mass_kg: rec.bone_mass_kg != null ? Number(rec.bone_mass_kg) : null,
    protein_pct: rec.protein_pct != null ? Number(rec.protein_pct) : null,
    protein_kg: w != null && rec.protein_pct != null ? Number(((w * Number(rec.protein_pct)) / 100).toFixed(2)) : null,
    fat_kg: w != null && rec.body_fat_pct != null ? Number(((w * Number(rec.body_fat_pct)) / 100).toFixed(2)) : null,
    metabolic_age: rec.metabolic_age != null ? Number(rec.metabolic_age) : null,
  };
}

async function handleAnalyzeBodyComposition(supabase: any, authUser: any, body: any) {
  const [recRes, athRes] = await Promise.all([
    supabase
      .from("body_composition")
      .select("*")
      .eq("user_id", authUser.id)
      .order("measured_at", { ascending: false })
      .limit(5),
    supabase.from("athlete_settings").select("birth_year").eq("user_id", authUser.id).maybeSingle(),
  ]);

  if (recRes.error) {
    return jsonResp({ ok: false, error: recRes.error.message }, 500);
  }
  const records = Array.isArray(recRes.data) ? recRes.data : [];
  if (records.length === 0) {
    return jsonResp({ ok: false, error: "Yorumlamak için önce en az bir vücut ölçümü kaydedin." }, 400);
  }

  const latest = records[0];
  const prev = records[1] || null;
  let inferredHeightCm: number | null = null;
  const reqHeight = Number(body?.height_cm);
  if (Number.isFinite(reqHeight) && reqHeight >= 130 && reqHeight <= 230) {
    inferredHeightCm = Math.round(reqHeight);
  } else {
    for (const r of records) {
      const w = Number(r?.weight_kg);
      const bmi = Number(r?.bmi);
      if (Number.isFinite(w) && Number.isFinite(bmi) && w > 20 && bmi > 10) {
        const cm = Math.round(Math.sqrt(w / bmi) * 100);
        if (cm >= 130 && cm <= 230) {
          inferredHeightCm = cm;
          break;
        }
      }
    }
  }

  const birthYear = athRes?.data?.birth_year ? Number(athRes.data.birth_year) : null;
  const age = birthYear && birthYear > 1920 ? new Date().getFullYear() - birthYear : null;
  const context = {
    profile: { height_cm: inferredHeightCm, age },
    latest: enrichRecordForAi(latest),
    previous: enrichRecordForAi(prev),
    trend_count: records.length,
  };

  const apiKey = await resolveGeminiApiKey(supabase, authUser.id);
  if (!apiKey) {
    return jsonResp({ ok: false, error: "GEMINI_API_KEY tanımlı değil." }, 500);
  }

  const gem = await callGeminiJson(
    apiKey,
    [{ text: `${BODY_ANALYSIS_PROMPT}\n\nVERİ:\n${JSON.stringify(context)}` }],
    0.35
  );
  if (!gem.ok || !gem.parsed) {
    return jsonResp(
      { ok: false, error: "YZ yorumu oluşturulamadı. Lütfen tekrar deneyin.", debug: gem.debugErrors },
      502
    );
  }

  const p = gem.parsed;
  const defaultTitle = `⚖️ Vücut Analizi · ${latest.weight_kg != null ? String(latest.weight_kg).replace(".", ",") + " kg" : ""}${latest.bmi != null ? ` (VKİ ${String(latest.bmi).replace(".", ",")})` : ""}`.trim();
  const title = String(p.title || defaultTitle).trim().slice(0, 120) || defaultTitle;
  const summary = String(p.summary || "").trim().slice(0, 700);
  const highlights = Array.isArray(p.highlights)
    ? p.highlights.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 5)
    : [];
  const actions = Array.isArray(p.actions)
    ? p.actions.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 4)
    : [];

  if (!summary) {
    return jsonResp({ ok: false, error: "YZ yorumu boş döndü, lütfen tekrar deneyin." }, 422);
  }

  const reportDate = new Date(latest.measured_at || Date.now()).toISOString().slice(0, 10);
  const payloadObj = {
    tab: "body",
    kind: "body_ai_commentary",
    record_id: latest.id,
    measured_at: latest.measured_at,
    height_cm: inferredHeightCm,
    weight_kg: latest.weight_kg,
    bmi: latest.bmi,
    summary,
    highlights,
    actions,
  };

  const { data: insertedNotif, error: notifErr } = await supabase
    .from("notifications")
    .insert({
      user_id: authUser.id,
      type: "HEALTH_ALERT",
      title,
      body: summary,
      payload: payloadObj,
      report_date: reportDate,
      push_status: "IN_APP_ONLY",
    })
    .select("id, created_at")
    .single();

  if (notifErr) {
    return jsonResp({ ok: false, error: `Bildirim kaydı hatası: ${notifErr.message}` }, 500);
  }

  return jsonResp({
    ok: true,
    notification_id: insertedNotif?.id || null,
    analysis: {
      title,
      summary,
      highlights,
      actions,
      height_cm: inferredHeightCm,
      measured_at: latest.measured_at,
      weight_kg: latest.weight_kg,
      bmi: latest.bmi,
    },
    model_used: gem.modelName,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ ok: false, error: "Yalnızca POST desteklenir." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authUser = await getAuthenticatedUser(req, supabase);
    if (!authUser) {
      return jsonResp({ ok: false, error: "Oturum doğrulaması gereklidir." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    if (body?.action === "analyzeBodyComposition") {
      return await handleAnalyzeBodyComposition(supabase, authUser, body);
    }

    let base64Data = String(body.image_base64 || "").trim();
    let mimeType = String(body.mime_type || "image/jpeg").trim();

    const dataUrlMatch = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1];
      base64Data = dataUrlMatch[2];
    }

    if (!base64Data || base64Data.length < 100) {
      return jsonResp({ ok: false, error: "Geçerli bir ekran görüntüsü verisi bulunamadı." }, 400);
    }
    if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(mimeType)) {
      mimeType = "image/jpeg";
    }
    if (base64Data.length > 7_000_000) {
      return jsonResp({ ok: false, error: "Görsel boyutu çok büyük (maks ~5 MB)." }, 413);
    }

    const apiKey = await resolveGeminiApiKey(supabase, authUser.id);
    if (!apiKey) {
      return jsonResp({ ok: false, error: "GEMINI_API_KEY tanımlı değil." }, 500);
    }

    const gem = await callGeminiJson(
      apiKey,
      [{ text: EXTRACTION_PROMPT }, { inline_data: { mime_type: mimeType, data: base64Data } }],
      0.1
    );
    base64Data = "";

    if (gem.ok && gem.parsed) {
      const metrics = sanitizeParsedMetrics(gem.parsed);
      return jsonResp({ ok: true, data: metrics, model_used: gem.modelName });
    }

    return jsonResp(
      {
        ok: false,
        error: "Ekran görüntüsündeki değerler okunamadı. Lütfen değerleri manuel girin veya daha net bir görüntü seçin.",
        debug: gem.debugErrors,
      },
      422
    );
  } catch (err) {
    return jsonResp({ ok: false, error: String(err) }, 500);
  }
});
