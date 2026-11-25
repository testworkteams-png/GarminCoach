import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT = `Sen bir kan tahlili / laboratuvar raporu ayrıştırıcısısın (E-Nabız, hastane veya laboratuvar PDF'i ya da fotoğrafı, Türkçe veya İngilizce).
Raporda sayısal sonucu olan HER testi çıkar. Her test için:
- name: Test adı (Türkçe raporda yazıldığı gibi, örn. "Hemoglobin", "Ferritin", "25-OH Vitamin D")
- value: Sayısal sonuç (yalnızca sayı; "<0.5" gibi ise 0.5 yaz). Sayısal olmayan sonuçları (pozitif/negatif vb.) ATLA.
- unit: Birim (örn. "g/dL", "ng/mL") yoksa null
- ref_low: Referans aralığı alt sınırı, yoksa null
- ref_high: Referans aralığı üst sınırı, yoksa null
Ayrıca:
- report_date: Numune/rapor tarihi YYYY-MM-DD, görünmüyorsa null
- lab_name: Laboratuvar/kurum adı, yoksa null
Asla uydurma veya tahmin etme; okunamayanı atla. Yalnızca şu şemaya uyan geçerli JSON döndür:
{"report_date": string|null, "lab_name": string|null, "results": [{"name": string, "value": number, "unit": string|null, "ref_low": number|null, "ref_high": number|null}]}`;

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getAuthenticatedUser(req: Request, supabase: any) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const jwt = m[1].trim();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!jwt || jwt === anonKey || jwt.startsWith("sb_publishable_") || jwt.split(".").length !== 3) return null;
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function sanitize(raw: any) {
  let reportDate: string | null = null;
  if (typeof raw?.report_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.report_date.trim())) {
    reportDate = raw.report_date.trim();
  }
  const results = (Array.isArray(raw?.results) ? raw.results : [])
    .map((r: any) => ({
      name: String(r?.name || "").trim().slice(0, 120),
      value: num(r?.value),
      unit: r?.unit ? String(r.unit).trim().slice(0, 30) : null,
      ref_low: num(r?.ref_low),
      ref_high: num(r?.ref_high),
    }))
    .filter((r: any) => r.name && r.value !== null)
    .slice(0, 150);
  return {
    report_date: reportDate,
    lab_name: raw?.lab_name ? String(raw.lab_name).trim().slice(0, 120) : null,
    results,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ ok: false, error: "Yalnızca POST desteklenir." }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const authUser = await getAuthenticatedUser(req, supabase);
    if (!authUser) return jsonResp({ ok: false, error: "Oturum doğrulaması gereklidir." }, 401);

    const body = await req.json().catch(() => ({}));
    let data = String(body.file_base64 || "").trim();
    let mime = String(body.mime_type || "application/pdf").trim();
    const m = data.match(/^data:([^;]+);base64,(.+)$/);
    if (m) {
      mime = m[1];
      data = m[2];
    }
    if (!data || data.length < 100) return jsonResp({ ok: false, error: "Geçerli dosya verisi bulunamadı." }, 400);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"].includes(mime)) {
      return jsonResp({ ok: false, error: "Yalnızca PDF veya görsel desteklenir." }, 415);
    }
    if (data.length > 14_000_000) return jsonResp({ ok: false, error: "Dosya çok büyük (maks ~10 MB)." }, 413);

    const { data: userInt } = await supabase
      .from("user_integrations")
      .select("gemini_api_key")
      .eq("user_id", authUser.id)
      .maybeSingle();
    const apiKey = (userInt?.gemini_api_key && String(userInt.gemini_api_key).trim()) || Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return jsonResp({ ok: false, error: "GEMINI_API_KEY tanımlı değil." }, 500);

    const models = ["models/gemini-3.6-flash", "models/gemini-3.5-flash", "models/gemini-2.5-flash", "models/gemini-2.0-flash"];
    const debug: string[] = [];
    for (const modelName of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(50000),
            body: JSON.stringify({
              contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data } }] }],
              generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
            }),
          },
        );
        if (!res.ok) {
          debug.push(`${modelName}:HTTP_${res.status}:${(await res.text()).slice(0, 120)}`);
          continue;
        }
        const j = await res.json();
        const parts: any[] = j?.candidates?.[0]?.content?.parts || [];
        const raw = parts.map((p: any) => String(p?.text || "")).filter(Boolean).join("\n").trim();
        if (!raw) {
          debug.push(`${modelName}:EMPTY`);
          continue;
        }
        const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        let parsed: any = null;
        try {
          parsed = JSON.parse(cleaned);
        } catch (_) {
          const mm = cleaned.match(/\{[\s\S]*\}/);
          if (mm) parsed = JSON.parse(mm[0]);
        }
        if (parsed && typeof parsed === "object") {
          const out = sanitize(parsed);
          if (out.results.length) {
            data = ""; // dosya hiçbir yere kaydedilmez
            return jsonResp({ ok: true, data: out, model_used: modelName });
          }
          debug.push(`${modelName}:NO_RESULTS`);
        }
      } catch (e) {
        debug.push(`${modelName}:ERR:${String(e).slice(0, 80)}`);
      }
    }
    return jsonResp(
      { ok: false, error: "Rapordaki değerler okunamadı. Daha net bir dosya deneyin veya değerleri elle girin.", debug },
      422,
    );
  } catch (err) {
    return jsonResp({ ok: false, error: String(err) }, 500);
  }
});
