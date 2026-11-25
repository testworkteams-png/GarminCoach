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

    const { data: userInt } = await supabase
      .from("user_integrations")
      .select("gemini_api_key")
      .eq("user_id", authUser.id)
      .maybeSingle();

    const apiKey = (userInt?.gemini_api_key && String(userInt.gemini_api_key).trim()) || Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return jsonResp({ ok: false, error: "GEMINI_API_KEY tanımlı değil." }, 500);
    }

    const candidateModels = [
      "models/gemini-3.6-flash",
      "models/gemini-3.5-flash",
      "models/gemini-2.5-flash",
      "models/gemini-2.0-flash",
    ];

    const debugErrors: string[] = [];
    for (const modelName of candidateModels) {
      try {
        const gemRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(28000),
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: EXTRACTION_PROMPT },
                    { inline_data: { mime_type: mimeType, data: base64Data } },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.1,
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
        const parts: any[] = gemJson?.candidates?.[0]?.content?.parts || [];
        const rawText = parts.map((p: any) => String(p?.text || "")).filter(Boolean).join("\n").trim();
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
          const metrics = sanitizeParsedMetrics(parsed);
          // Görseli hiçbir yere kaydetmeden yalnızca sayısal çıktıyı döndür
          base64Data = "";
          return jsonResp({ ok: true, data: metrics, model_used: modelName });
        }
      } catch (e) {
        debugErrors.push(`${modelName}:ERR:${String(e).slice(0, 80)}`);
      }
    }

    base64Data = "";
    return jsonResp(
      {
        ok: false,
        error: "Ekran görüntüsündeki değerler okunamadı. Lütfen değerleri manuel girin veya daha net bir görüntü seçin.",
        debug: debugErrors,
      },
      422
    );
  } catch (err) {
    return jsonResp({ ok: false, error: String(err) }, 500);
  }
});
