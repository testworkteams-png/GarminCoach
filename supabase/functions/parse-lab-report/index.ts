import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT = `Sen bir kan tahlili / laboratuvar raporu ayrıştırıcısısın (E-Nabız, hastane veya laboratuvar PDF'i ya da fotoğrafı, Türkçe veya İngilizce).
Raporda sayısal sonucu olan HER testi çıkar. Farklı hastanelerin uzun veya değişik adlarını standart tek isimlere çevir ve orijinal adını "raw_name" alanına koy:
Standart isim örnekleri: "Hemoglobin (HGB)", "Hematokrit (HCT)", "Lökosit (WBC)", "Eritrosit (RBC)", "Trombosit (PLT)", "MCV", "MCH", "MCHC", "RDW", "RDW-SD", "MPV", "PCT", "P-LCR", "Nötrofil %", "Nötrofil #", "Lenfosit %", "Lenfosit #", "Monosit %", "Monosit #", "Eozinofil %", "Eozinofil #", "Bazofil %", "Bazofil #", "Vitamin D (25-OH)", "Vitamin B12", "Folat (B9)", "Ferritin", "Demir", "Demir Bağlama (TDBK)", "Magnezyum", "Kalsiyum", "Fosfor", "LDL Kolesterol", "HDL Kolesterol", "Total Kolesterol", "Trigliserid", "Glukoz (Açlık)", "HbA1c", "ALT", "AST", "GGT", "ALP", "LDH", "Kreatin Kinaz (CK)", "Amilaz", "Bilirubin (Total)", "Bilirubin (Direkt)", "Albümin", "Kreatinin", "eGFR", "Üre", "Ürik Asit", "CRP", "Sodyum", "Potasyum", "Klor", "TSH", "Serbest T4", "Serbest T3".
Her test için:
- name: Standart kısa ad (yukarıdaki sözlüğe uyumlu)
- raw_name: Raporda yazan orijinal tam test adı
- value: Sayısal sonuç (yalnızca sayı; "<0.5" gibi ise 0.5 yaz). Sayısal olmayan sonuçları (pozitif/negatif vb.) ATLA.
- unit: Birim (örn. "g/dL", "ng/mL", "pg/mL") yoksa null
- ref_low: Referans aralığı alt sınırı, yoksa null
- ref_high: Referans aralığı üst sınırı, yoksa null
Ayrıca:
- report_date: Numune/rapor tarihi YYYY-MM-DD, görünmüyorsa null
- lab_name: Laboratuvar/kurum adı, yoksa null
Asla uydurma veya tahmin etme; okunamayanı atla. Yalnızca şu şemaya uyan geçerli JSON döndür:
{"report_date": string|null, "lab_name": string|null, "results": [{"name": string, "raw_name": string|null, "value": number, "unit": string|null, "ref_low": number|null, "ref_high": number|null}]}`;

const MODELS = [
  "models/gemini-3.6-flash",
  "models/gemini-3.5-flash",
  "models/gemini-3.5-flash-lite",
  "models/gemini-2.5-flash",
];

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

type CanonDef = { name: string; cat: string; unit?: string };

function normKey(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/^tam kan sayimi\s*\(hemogram\)\s*/i, "")
    .replace(/^hemogram\s*[-:]?\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "")
    .trim();
}

const EXACT_MAP: Record<string, CanonDef> = {
  "25-oh vitamin d3": { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" },
  "25-oh vitamin d": { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" },
  "25-oh d3": { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" },
  "vitamin d (25-oh)": { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" },
  "vitamin d3": { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" },
  "vitamin b12": { name: "Vitamin B12", cat: "vitamin", unit: "pg/mL" },
  "b12 vitamini": { name: "Vitamin B12", cat: "vitamin", unit: "pg/mL" },
  "folat": { name: "Folat (B9)", cat: "vitamin", unit: "ng/mL" },
  "folat (b9)": { name: "Folat (B9)", cat: "vitamin", unit: "ng/mL" },
  "folik asit (folat)": { name: "Folat (B9)", cat: "vitamin", unit: "ng/mL" },
  "folik asit": { name: "Folat (B9)", cat: "vitamin", unit: "ng/mL" },
  "ferritin": { name: "Ferritin", cat: "vitamin", unit: "ng/mL" },
  "demir": { name: "Demir", cat: "vitamin", unit: "µg/dL" },
  "demir (serum)": { name: "Demir", cat: "vitamin", unit: "µg/dL" },
  "demir baglama kapasitesi": { name: "Demir Bağlama (TDBK)", cat: "vitamin", unit: "µg/dL" },
  "demir baglama kapasitesi (tdbk)": { name: "Demir Bağlama (TDBK)", cat: "vitamin", unit: "µg/dL" },
  "demir baglama (tdbk)": { name: "Demir Bağlama (TDBK)", cat: "vitamin", unit: "µg/dL" },
  "tdbk": { name: "Demir Bağlama (TDBK)", cat: "vitamin", unit: "µg/dL" },
  "magnezyum": { name: "Magnezyum", cat: "vitamin", unit: "mg/dL" },
  "magnezyum(mg)": { name: "Magnezyum", cat: "vitamin", unit: "mg/dL" },
  "kalsiyum": { name: "Kalsiyum", cat: "vitamin", unit: "mg/dL" },
  "kalsiyum (ca)": { name: "Kalsiyum", cat: "vitamin", unit: "mg/dL" },
  "fosfor": { name: "Fosfor", cat: "vitamin", unit: "mg/dL" },
  "fosfor (p)": { name: "Fosfor", cat: "vitamin", unit: "mg/dL" },
  "ldl kolesterol": { name: "LDL Kolesterol", cat: "lipid", unit: "mg/dL" },
  "ldl kolesterol (indirekt, hesaplamali)": { name: "LDL Kolesterol", cat: "lipid", unit: "mg/dL" },
  "ldl": { name: "LDL Kolesterol", cat: "lipid", unit: "mg/dL" },
  "hdl kolesterol": { name: "HDL Kolesterol", cat: "lipid", unit: "mg/dL" },
  "hdl": { name: "HDL Kolesterol", cat: "lipid", unit: "mg/dL" },
  "kolesterol total": { name: "Total Kolesterol", cat: "lipid", unit: "mg/dL" },
  "total kolesterol": { name: "Total Kolesterol", cat: "lipid", unit: "mg/dL" },
  "kolesterol": { name: "Total Kolesterol", cat: "lipid", unit: "mg/dL" },
  "trigliserid": { name: "Trigliserid", cat: "lipid", unit: "mg/dL" },
  "glukoz(aclik)": { name: "Glukoz (Açlık)", cat: "lipid", unit: "mg/dL" },
  "glukoz (aclik)": { name: "Glukoz (Açlık)", cat: "lipid", unit: "mg/dL" },
  "glukoz (aclik kan sekeri)": { name: "Glukoz (Açlık)", cat: "lipid", unit: "mg/dL" },
  "aclik kan sekeri": { name: "Glukoz (Açlık)", cat: "lipid", unit: "mg/dL" },
  "glukoz": { name: "Glukoz (Açlık)", cat: "lipid", unit: "mg/dL" },
  "hba1c": { name: "HbA1c", cat: "lipid", unit: "%" },
  "glike hemoglobin (hb a1c)": { name: "HbA1c", cat: "lipid", unit: "%" },
  "alt": { name: "ALT", cat: "organ", unit: "U/L" },
  "alt (sgpt)": { name: "ALT", cat: "organ", unit: "U/L" },
  "sgpt": { name: "ALT", cat: "organ", unit: "U/L" },
  "alanin aminotransferaz (alt)": { name: "ALT", cat: "organ", unit: "U/L" },
  "ast": { name: "AST", cat: "organ", unit: "U/L" },
  "ast (sgot)": { name: "AST", cat: "organ", unit: "U/L" },
  "sgot": { name: "AST", cat: "organ", unit: "U/L" },
  "aspartat transaminaz (ast)": { name: "AST", cat: "organ", unit: "U/L" },
  "ggt": { name: "GGT", cat: "organ", unit: "U/L" },
  "gamma glutamil transferaz (ggt)": { name: "GGT", cat: "organ", unit: "U/L" },
  "alp": { name: "ALP", cat: "organ", unit: "U/L" },
  "alkalen fosfataz (alp)": { name: "ALP", cat: "organ", unit: "U/L" },
  "ldh": { name: "LDH", cat: "organ", unit: "U/L" },
  "laktat dehidrogenaz (ldh)": { name: "LDH", cat: "organ", unit: "U/L" },
  "ck": { name: "Kreatin Kinaz (CK)", cat: "organ", unit: "U/L" },
  "kreatin kinaz (ck)": { name: "Kreatin Kinaz (CK)", cat: "organ", unit: "U/L" },
  "amilaz": { name: "Amilaz", cat: "organ", unit: "U/L" },
  "bilirubin (total)": { name: "Bilirubin (Total)", cat: "organ", unit: "mg/dL" },
  "total bilirubin": { name: "Bilirubin (Total)", cat: "organ", unit: "mg/dL" },
  "bilirubin (direkt)": { name: "Bilirubin (Direkt)", cat: "organ", unit: "mg/dL" },
  "direkt bilirubin": { name: "Bilirubin (Direkt)", cat: "organ", unit: "mg/dL" },
  "albumin": { name: "Albümin", cat: "organ" },
  "kreatinin": { name: "Kreatinin", cat: "organ", unit: "mg/dL" },
  "egfr": { name: "eGFR", cat: "organ", unit: "mL/dk" },
  "egfr hesaplamasi": { name: "eGFR", cat: "organ", unit: "mL/dk" },
  "ure": { name: "Üre", cat: "organ", unit: "mg/dL" },
  "ure (serum/plazma)": { name: "Üre", cat: "organ", unit: "mg/dL" },
  "urik asit": { name: "Ürik Asit", cat: "organ", unit: "mg/dL" },
  "crp": { name: "CRP", cat: "organ", unit: "mg/L" },
  "c reaktif protein (crp)": { name: "CRP", cat: "organ", unit: "mg/L" },
  "crp,nefelometrik": { name: "CRP", cat: "organ", unit: "mg/L" },
  "crp, nefelometrik": { name: "CRP", cat: "organ", unit: "mg/L" },
  "sodyum": { name: "Sodyum", cat: "organ", unit: "mmol/L" },
  "sodyum (na)": { name: "Sodyum", cat: "organ", unit: "mmol/L" },
  "sodyum (na,serum)": { name: "Sodyum", cat: "organ", unit: "mmol/L" },
  "potasyum": { name: "Potasyum", cat: "organ", unit: "mmol/L" },
  "potasyum (k)": { name: "Potasyum", cat: "organ", unit: "mmol/L" },
  "potasyum ( k , serum )": { name: "Potasyum", cat: "organ", unit: "mmol/L" },
  "klor": { name: "Klor", cat: "organ", unit: "mmol/L" },
  "klor (cl)": { name: "Klor", cat: "organ", unit: "mmol/L" },
  "tsh": { name: "TSH", cat: "tiroid", unit: "mIU/L" },
  "serbest t4": { name: "Serbest T4", cat: "tiroid", unit: "ng/dL" },
  "ft4": { name: "Serbest T4", cat: "tiroid", unit: "ng/dL" },
  "serbest t3": { name: "Serbest T3", cat: "tiroid", unit: "pg/mL" },
  "ft3": { name: "Serbest T3", cat: "tiroid", unit: "pg/mL" },
  "hgb": { name: "Hemoglobin (HGB)", cat: "hemogram", unit: "g/dL" },
  "hemoglobin": { name: "Hemoglobin (HGB)", cat: "hemogram", unit: "g/dL" },
  "hemoglobin (hgb)": { name: "Hemoglobin (HGB)", cat: "hemogram", unit: "g/dL" },
  "hct": { name: "Hematokrit (HCT)", cat: "hemogram", unit: "%" },
  "hematokrit": { name: "Hematokrit (HCT)", cat: "hemogram", unit: "%" },
  "hematokrit (hct)": { name: "Hematokrit (HCT)", cat: "hemogram", unit: "%" },
  "wbc": { name: "Lökosit (WBC)", cat: "hemogram", unit: "10^3/µL" },
  "lokosit (wbc)": { name: "Lökosit (WBC)", cat: "hemogram", unit: "10^3/µL" },
  "rbc": { name: "Eritrosit (RBC)", cat: "hemogram", unit: "10^6/µL" },
  "eritrosit (rbc)": { name: "Eritrosit (RBC)", cat: "hemogram", unit: "10^6/µL" },
  "plt": { name: "Trombosit (PLT)", cat: "hemogram", unit: "10^3/µL" },
  "trombosit (plt)": { name: "Trombosit (PLT)", cat: "hemogram", unit: "10^3/µL" },
  "mcv": { name: "MCV", cat: "hemogram", unit: "fL" },
  "mch": { name: "MCH", cat: "hemogram", unit: "pg" },
  "mchc": { name: "MCHC", cat: "hemogram", unit: "g/dL" },
  "rdw": { name: "RDW", cat: "hemogram", unit: "%" },
  "rdw-cv": { name: "RDW", cat: "hemogram", unit: "%" },
  "rdw-sd": { name: "RDW-SD", cat: "hemogram", unit: "fL" },
  "mpv": { name: "MPV", cat: "hemogram", unit: "fL" },
  "pct": { name: "PCT", cat: "hemogram", unit: "%" },
  "p-lcr": { name: "P-LCR", cat: "hemogram", unit: "%" },
  "% neu": { name: "Nötrofil %", cat: "hemogram", unit: "%" },
  "neu%": { name: "Nötrofil %", cat: "hemogram", unit: "%" },
  "notrofil %": { name: "Nötrofil %", cat: "hemogram", unit: "%" },
  "neu#": { name: "Nötrofil #", cat: "hemogram", unit: "10^3/µL" },
  "notrofil #": { name: "Nötrofil #", cat: "hemogram", unit: "10^3/µL" },
  "% lym": { name: "Lenfosit %", cat: "hemogram", unit: "%" },
  "lym%": { name: "Lenfosit %", cat: "hemogram", unit: "%" },
  "lenfosit %": { name: "Lenfosit %", cat: "hemogram", unit: "%" },
  "lym#": { name: "Lenfosit #", cat: "hemogram", unit: "10^3/µL" },
  "lenfosit #": { name: "Lenfosit #", cat: "hemogram", unit: "10^3/µL" },
  "% mon": { name: "Monosit %", cat: "hemogram", unit: "%" },
  "mono%": { name: "Monosit %", cat: "hemogram", unit: "%" },
  "monosit %": { name: "Monosit %", cat: "hemogram", unit: "%" },
  "mon#": { name: "Monosit #", cat: "hemogram", unit: "10^3/µL" },
  "mono#": { name: "Monosit #", cat: "hemogram", unit: "10^3/µL" },
  "monosit #": { name: "Monosit #", cat: "hemogram", unit: "10^3/µL" },
  "% eo": { name: "Eozinofil %", cat: "hemogram", unit: "%" },
  "eos%": { name: "Eozinofil %", cat: "hemogram", unit: "%" },
  "eozinofil %": { name: "Eozinofil %", cat: "hemogram", unit: "%" },
  "eo#": { name: "Eozinofil #", cat: "hemogram", unit: "10^3/µL" },
  "eos#": { name: "Eozinofil #", cat: "hemogram", unit: "10^3/µL" },
  "eozinofil #": { name: "Eozinofil #", cat: "hemogram", unit: "10^3/µL" },
  "% bas": { name: "Bazofil %", cat: "hemogram", unit: "%" },
  "baso%": { name: "Bazofil %", cat: "hemogram", unit: "%" },
  "bazofil %": { name: "Bazofil %", cat: "hemogram", unit: "%" },
  "bas#": { name: "Bazofil #", cat: "hemogram", unit: "10^3/µL" },
  "baso#": { name: "Bazofil #", cat: "hemogram", unit: "10^3/µL" },
  "bazofil #": { name: "Bazofil #", cat: "hemogram", unit: "10^3/µL" },
};

function canonicalizeLabRow(r: any) {
  const rawName = String(r?.raw_name || r?.name || "").trim().slice(0, 120);
  const inputName = String(r?.name || r?.raw_name || "").trim().slice(0, 120);
  const unitRaw = r?.unit ? String(r.unit).trim().slice(0, 30) : null;
  const k = normKey(inputName);
  const rk = normKey(rawName);

  if (k === "pdw" || k.startsWith("pdw ") || rk === "pdw") {
    const isPct = (unitRaw || "").includes("%") || k.includes("%");
    return {
      name: isPct ? "PDW (%)" : "PDW (fL)",
      raw_name: rawName || inputName,
      category: "hemogram",
      value: num(r?.value),
      unit: isPct ? "%" : "fL",
      ref_low: num(r?.ref_low),
      ref_high: num(r?.ref_high),
    };
  }

  let match = EXACT_MAP[k] || EXACT_MAP[rk];
  if (!match) {
    if (/vitamin\s*d|25[-\s]*oh/.test(k)) match = { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" };
    else if (/ldl/.test(k)) match = { name: "LDL Kolesterol", cat: "lipid", unit: "mg/dL" };
    else if (/hdl/.test(k)) match = { name: "HDL Kolesterol", cat: "lipid", unit: "mg/dL" };
    else if (/alanin|\balt\b|\bsgpt\b/.test(k)) match = { name: "ALT", cat: "organ", unit: "U/L" };
    else if (/aspartat|\bast\b|\bsgot\b/.test(k)) match = { name: "AST", cat: "organ", unit: "U/L" };
    else if (/egfr/.test(k)) match = { name: "eGFR", cat: "organ", unit: "mL/dk" };
    else if (/hbsag|anti\s*hb|anti\s*hc|anti\s*hi|vdrl/.test(k)) match = { name: inputName, cat: "other" };
  }

  const finalName = match?.name || inputName;
  let finalUnit = match?.unit || unitRaw;
  if (finalUnit === "ng/L" && finalName === "Vitamin B12") finalUnit = "pg/mL";
  if ((finalUnit === "µg/L" || finalUnit === "ug/L") && finalName === "Folat (B9)") finalUnit = "ng/mL";
  if (finalUnit === "mEq/L" && (finalName === "Sodyum" || finalName === "Potasyum" || finalName === "Klor")) finalUnit = "mmol/L";

  return {
    name: finalName,
    raw_name: rawName || finalName,
    category: match?.cat || "other",
    value: num(r?.value),
    unit: finalUnit,
    ref_low: num(r?.ref_low),
    ref_high: num(r?.ref_high),
  };
}

function sanitize(raw: any) {
  let reportDate: string | null = null;
  if (typeof raw?.report_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.report_date.trim())) {
    reportDate = raw.report_date.trim();
  }
  const byName = new Map<string, ReturnType<typeof canonicalizeLabRow>>();
  for (const item of Array.isArray(raw?.results) ? raw.results : []) {
    const row = canonicalizeLabRow(item);
    if (!row.name || row.value === null) continue;
    const prev = byName.get(row.name);
    if (!prev || (prev.ref_low === null && row.ref_low !== null)) {
      byName.set(row.name, row);
    }
  }
  return {
    report_date: reportDate,
    lab_name: raw?.lab_name ? String(raw.lab_name).trim().slice(0, 120) : null,
    results: [...byName.values()].slice(0, 150),
  };
}

function flagOf(r: any) {
  const v = Number(r.value);
  if (r.ref_low !== null && r.ref_low !== undefined && v < Number(r.ref_low)) return "YETKISIZ_LOW";
  if (r.ref_high !== null && r.ref_high !== undefined && v > Number(r.ref_high)) return "HIGH";
  return "OK";
}

async function handleAnalyzeSummary(supabase: any, authUser: any, body: any, apiKey: string) {
  const reportId = body.report_id ? String(body.report_id).trim() : null;
  const force = Boolean(body.force);

  const [repRes, resRes, medRes] = await Promise.all([
    supabase.from("lab_reports").select("id, report_date, lab_name, ai_summary").eq("user_id", authUser.id).order("report_date", { ascending: false }).limit(30),
    supabase.from("lab_results").select("report_id, test_name, value, unit, ref_low, ref_high, category").eq("user_id", authUser.id).limit(3000),
    supabase.from("medications").select("name, dose, kind").eq("user_id", authUser.id).eq("active", true),
  ]);

  const reports = repRes.data || [];
  if (!reports.length) return jsonResp({ ok: true, summary: null, cached: false });

  const results = resRes.data || [];
  const activeMeds = medRes.data || [];
  const fingerprint = `${reports.map((r: any) => r.id).sort().join(",")}::${activeMeds.map((m: any) => m.name).sort().join(",")}`;

  if (reportId) {
    const targetRep = reports.find((r: any) => r.id === reportId);
    if (!targetRep) return jsonResp({ ok: false, error: "Rapor bulunamadı." }, 404);
    if (!force && targetRep.ai_summary) {
      return jsonResp({ ok: true, summary: targetRep.ai_summary, cached: true });
    }
  } else if (!force) {
    const { data: ov } = await supabase
      .from("lab_ai_overview")
      .select("fingerprint, summary")
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (ov?.summary && ov.fingerprint === fingerprint) {
      return jsonResp({ ok: true, summary: ov.summary, cached: true });
    }
  }

  const byReport = new Map<string, any[]>();
  for (const r of results) {
    const arr = byReport.get(r.report_id) || [];
    arr.push(r);
    byReport.set(r.report_id, arr);
  }

  const ascReports = [...reports].sort((a: any, b: any) => String(a.report_date).localeCompare(String(b.report_date)));
  const series = new Map<string, any[]>();
  for (const rp of ascReports) {
    for (const r of byReport.get(rp.id) || []) {
      const arr = series.get(r.test_name) || [];
      arr.push({ date: rp.report_date, ...r });
      series.set(r.test_name, arr);
    }
  }

  const trendLines: string[] = [];
  const latestRows: string[] = [];
  for (const [name, pts] of series.entries()) {
    const last = pts[pts.length - 1];
    const prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const fl = Number(last.value) > Number(last.ref_high ?? Infinity)
      ? "YÜKSEK"
      : Number(last.value) < Number(last.ref_low ?? -Infinity)
        ? "DÜŞÜK"
        : "normal";
    if (fl !== "normal" || prev) {
      const refStr = last.ref_low != null || last.ref_high != null ? `ref ${last.ref_low ?? "-"}–${last.ref_high ?? "-"}` : "";
      const prevStr = prev ? ` (önceki ${prev.date}: ${prev.value})` : "";
      const line = `- ${name}: ${last.value} ${last.unit || ""} [${fl}] ${refStr}${prevStr}`;
      if (fl !== "normal" || Math.abs(Number(last.value) - Number(prev?.value ?? last.value)) > 0.01) {
        trendLines.push(line);
      } else {
        latestRows.push(line);
      }
    }
  }

  let focusPrompt = "";
  if (reportId) {
    const target = reports.find((r: any) => r.id === reportId);
    const tRows = byReport.get(reportId) || [];
    const lines = tRows.map((r: any) => {
      const fl = r.ref_high != null && Number(r.value) > Number(r.ref_high)
        ? "YÜKSEK"
        : r.ref_low != null && Number(r.value) < Number(r.ref_low)
          ? "DÜŞÜK"
          : "normal";
      const pts = (series.get(r.test_name) || []).filter((p: any) => p.date < target.report_date);
      const prev = pts.length ? pts[pts.length - 1] : null;
      return `- ${r.test_name}: ${r.value} ${r.unit || ""} [${fl}] (ref ${r.ref_low ?? "-"}–${r.ref_high ?? "-"})${prev ? ` [önceki ${prev.date}: ${prev.value}]` : ""}`;
    });
    focusPrompt = `Seçili Rapor: ${target.report_date} · ${target.lab_name || "Laboratuvar"} (${tRows.length} değer).
Rapordaki değerler (sınır dışılar ve önceki karşılaştırmalar dahil):
${lines.slice(0, 65).join("\n")}

Görev: Bu tek raporu 3-4 kısa, sade Türkçe cümleyle yorumla. Madde işareti kullanma, akıcı tek paragraf yaz. Varsa yüksek/düşük değerleri ve önceki tarihe göre iyileşme/değişimleri (örn. LDL düşüşü) vurgula; tümü normalse netçe belirt. Aktif takviyelerle (${activeMeds.map((m: any) => m.name).join(", ") || "yok"}) uyumluysa kısaca değin, sonunda hekim kontrolünü hatırlat.
Yalnızca şu JSON şemasını döndür: {"summary": "3-4 cümlelik akıcı Türkçe yorum"}`;
  } else {
    focusPrompt = `Tüm Raporlar Birleşik Özet (${reports.length} rapor: ${ascReports.map((r: any) => r.report_date).join(", ")}).
Aktif İlaç/Takviyeler: ${activeMeds.map((m: any) => `${m.name}${m.dose ? " (" + m.dose + ")" : ""}`).join(", ") || "yok"}.
Öne çıkan sınır dışı değerler ve tarihler arası değişimler:
${trendLines.slice(0, 45).join("\n")}
Ek takipler:
${latestRows.slice(0, 15).join("\n")}

Görev: Kullanıcının tüm tahlil geçmişini ve takviyelerini birlikte değerlendiren 3-4 kısa, anlaşılır Türkçe cümlelik akıcı bir özet yaz. Madde işareti kullanma, tek paragraf olsun. Güncel dikkat gerektiren değerleri (yüksek/düşük), önceki ölçümlere kıyasla iyiye/kötüye giden trendleri ve takviye uyumunu özetle; son cümlede klinik değerlendirme için doktora danışılmasını belirt.
Yalnızca şu JSON şemasını döndür: {"summary": "3-4 cümlelik akıcı Türkçe yorum"}`;
  }

  for (const modelName of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(35000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: focusPrompt }] }],
            generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
          }),
        },
      );
      if (!res.ok) continue;
      const j = await res.json();
      const parts: any[] = (j?.candidates?.[0]?.content?.parts || []).filter((p: any) => !p?.thought);
      const texts = parts.map((p: any) => String(p?.text || "")).filter(Boolean);
      const raw = texts.find((t: string) => t.trim().startsWith("{")) || texts[texts.length - 1] || "";
      if (!raw) continue;

      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      let parsed: any = null;
      try {
        parsed = JSON.parse(cleaned);
      } catch (_) {
        const mm = cleaned.match(/\{[\s\S]*\}/);
        if (mm) parsed = JSON.parse(mm[0]);
      }
      if (Array.isArray(parsed)) parsed = parsed[0];
      const text = String(parsed?.summary || "").replace(/\s+/g, " ").trim();
      if (text.length < 25) continue;

      if (reportId) {
        await supabase.from("lab_reports").update({ ai_summary: text }).eq("id", reportId).eq("user_id", authUser.id);
      } else {
        await supabase.from("lab_ai_overview").upsert(
          { user_id: authUser.id, fingerprint, summary: text, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
      }
      return jsonResp({ ok: true, summary: text, cached: false, fingerprint, model_used: modelName });
    } catch (_) {}
  }

  return jsonResp({ ok: false, error: "AI özeti şu an oluşturulamadı." }, 502);
}

const MED_LABEL_PROMPT = `Sen bir eczane ilaç etiketi / reçete / kutu görseli ayrıştırıcısısın (Türkçe veya İngilizce).
Fotoğrafta 1 veya birden fazla eczane etiketi/ilaç bulunabilir — GÖRÜNEN HER İLAÇ / KUTU / ETİKETİ ayrı bir öğe olarak çıkar.
Her öğe için:
- name: İlaç veya takviye adı + mg/gr (örn. "Arveles 25 mg", "Wilkinson Pomad %12,5")
- dose: Kullanım dozu/miktarı (örn. "1 tablet", "ince tabaka", "1 kapsül", "1 ölçek")
- kind: "medication" (reçeteli/eczane ilacı, ağrı kesici, pomad, antibiyotik vb.), "vitamin", veya "supplement"
- purpose: Kısa kullanım amacı (örn. "Ağrı Kesici", "Kaşıntı - Deri Tedavisi"), görünmüyorsa null
- times: Önerilen saatler dizisi (HH:MM). Sabah="09:00", Öğle="13:00", Akşam="21:00", Gece="23:00". Günde 1="09:00", Günde 2 / Sabah-Akşam=["09:00","21:00"], Günde 3=["08:00","14:00","21:00"], Günde 4=["08:00","12:00","18:00","22:00"]. Belirtilmemişse ["09:00"].
- notes: Kısa kullanım talimatı (aç/tok karnına, bol su ile, yıkanmama uyarısı vb.), yoksa null (maks 140 karakter)
- duration_days: Etikette "3 gün boyunca", "7 gün kullanınız" gibi süre yazıyorsa pozitif tam sayı, yoksa null
- as_needed: "sadece ağrı hissettiğiniz günlerde", "gerektiğinde", "lüzum halinde" gibi sadece şikayet oldukça kullanım varsa true, düzenli günde X kez ise false
- start_date: null (istemci bugünü seçer; geçmiş eski etiket tarihlerini kopyalama)

Yalnızca şu JSON şemasını döndür:
{"items": [{"name": string, "dose": string|null, "kind": "medication"|"vitamin"|"supplement", "purpose": string|null, "times": string[], "notes": string|null, "duration_days": number|null, "as_needed": boolean, "start_date": string|null}]}`;

function sanitizeMedTimes(arr: any): string[] {
  const valid = (Array.isArray(arr) ? arr : [])
    .map((s) => String(s || "").trim())
    .map((s) => {
      const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
      if (!m) return null;
      const h = Number(m[1]), mi = Number(m[2] || 0);
      if (h > 23 || mi > 59) return null;
      return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
    })
    .filter((x): x is string => Boolean(x));
  return valid.length ? [...new Set(valid)].sort().slice(0, 6) : ["09:00"];
}

function sanitizeMedItems(raw: any) {
  const list = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  return list
    .map((x: any) => {
      const durRaw = num(x?.duration_days);
      const dur = durRaw !== null && durRaw >= 1 && durRaw <= 365 ? Math.round(durRaw) : null;
      const kind = ["medication", "vitamin", "supplement"].includes(x?.kind) ? x.kind : "medication";
      return {
        name: String(x?.name || "").trim().slice(0, 80),
        dose: x?.dose ? String(x.dose).trim().slice(0, 60) : null,
        kind,
        purpose: x?.purpose ? String(x.purpose).trim().slice(0, 80) : null,
        times: sanitizeMedTimes(x?.times),
        notes: x?.notes ? String(x.notes).trim().slice(0, 140) : null,
        duration_days: dur,
        as_needed: Boolean(x?.as_needed),
        start_date: null,
      };
    })
    .filter((x: any) => Boolean(x.name))
    .slice(0, 12);
}

async function handleParseMedicationLabel(body: any, apiKey: string) {
  let data = String(body.file_base64 || "").trim();
  let mime = String(body.mime_type || "image/jpeg").trim();
  const m = data.match(/^data:([^;]+);base64,(.+)$/);
  if (m) {
    mime = m[1];
    data = m[2];
  }
  if (!data || data.length < 100) return jsonResp({ ok: false, error: "Geçerli fotoğraf verisi bulunamadı." }, 400);
  if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(mime)) {
    return jsonResp({ ok: false, error: "Yalnızca görsel (JPG/PNG/WEBP/HEIC) desteklenir." }, 415);
  }
  if (data.length > 14_000_000) return jsonResp({ ok: false, error: "Görsel çok büyük (maks ~10 MB)." }, 413);

  const debug: string[] = [];
  for (const modelName of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(40000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: MED_LABEL_PROMPT }, { inline_data: { mime_type: mime, data } }] }],
            generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
          }),
        },
      );
      if (!res.ok) {
        debug.push(`${modelName}:HTTP_${res.status}`);
        continue;
      }
      const j = await res.json();
      const parts: any[] = (j?.candidates?.[0]?.content?.parts || []).filter((p: any) => !p?.thought);
      const texts = parts.map((p: any) => String(p?.text || "")).filter(Boolean);
      const raw = texts.find((t: string) => t.trim().startsWith("{")) || texts[texts.length - 1] || "";
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
      const items = sanitizeMedItems(parsed);
      if (items.length) {
        data = "";
        return jsonResp({ ok: true, items, model_used: modelName });
      }
      debug.push(`${modelName}:NO_ITEMS`);
    } catch (e) {
      debug.push(`${modelName}:ERR:${String(e).slice(0, 60)}`);
    }
  }
  data = "";
  return jsonResp({ ok: false, error: "Etiketteki ilaç bilgileri okunamadı. Daha net bir fotoğraf dene veya elle ekle.", debug }, 422);
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
    const { data: userInt } = await supabase
      .from("user_integrations")
      .select("gemini_api_key")
      .eq("user_id", authUser.id)
      .maybeSingle();
    const apiKey = (userInt?.gemini_api_key && String(userInt.gemini_api_key).trim()) || Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return jsonResp({ ok: false, error: "GEMINI_API_KEY tanımlı değil." }, 500);

    if (body.action === "analyzeSummary") {
      return await handleAnalyzeSummary(supabase, authUser, body, apiKey);
    }
    if (body.action === "parseMedicationLabel") {
      return await handleParseMedicationLabel(body, apiKey);
    }

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

    const debug: string[] = [];
    for (const modelName of MODELS) {
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
        const parts: any[] = (j?.candidates?.[0]?.content?.parts || []).filter((p: any) => !p?.thought);
        const texts = parts.map((p: any) => String(p?.text || "")).filter(Boolean);
        const raw = texts.find((t: string) => t.trim().startsWith("{")) || texts[texts.length - 1] || "";
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
            data = "";
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
