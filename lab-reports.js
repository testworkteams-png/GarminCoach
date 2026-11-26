(function () {
  "use strict";

  const SUPABASE_URL = "https://htooqswstuuzslvrgxsx.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5_1RDXV8unnW9ttkHEA_HQ_n8fJrt4I";
  const PARSE_URL = `${SUPABASE_URL}/functions/v1/parse-lab-report`;

  const CAT_TABS = [
    { key: "all", label: "Tümü" },
    { key: "abnormal", label: "⚠️ Sınır Dışı" },
    { key: "multi", label: "📈 Trend (2+)" },
    { key: "vitamin", label: "💊 Vitamin & Demir" },
    { key: "lipid", label: "🫀 Kolesterol & Şeker" },
    { key: "organ", label: "🧪 Organ & Tiroid" },
    { key: "hemogram", label: "🩸 Kan Sayımı" },
  ];

  const PRIORITY_BONUS = {
    "Vitamin D (25-OH)": 35,
    "Vitamin B12": 32,
    "Folat (B9)": 32,
    Ferritin: 30,
    Demir: 28,
    "LDL Kolesterol": 30,
    "HDL Kolesterol": 28,
    "Total Kolesterol": 26,
    Trigliserid: 26,
    "Glukoz (Açlık)": 28,
    HbA1c: 30,
    TSH: 26,
    "Serbest T4": 24,
    ALT: 22,
    AST: 22,
    CRP: 24,
    Kreatinin: 20,
    eGFR: 20,
    "Hemoglobin (HGB)": 24,
    "Lökosit (WBC)": 20,
    "Trombosit (PLT)": 20,
    Magnezyum: 24,
  };

  const LOW_PRIORITY_HEMO = new Set([
    "Bazofil %", "Bazofil #", "Eozinofil %", "Eozinofil #",
    "Monosit %", "Monosit #", "Lenfosit %", "Lenfosit #",
    "Nötrofil %", "Nötrofil #", "P-LCR", "PCT", "PDW (%)", "PDW (fL)",
  ]);

  const EXACT_CANON = {
    "25-oh vitamin d3": { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" },
    "25-oh vitamin d": { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" },
    "25-oh d3": { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" },
    "vitamin d (25-oh)": { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" },
    "vitamin d3": { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" },
    "vitamin b12": { name: "Vitamin B12", cat: "vitamin", unit: "pg/mL" },
    "b12 vitamini": { name: "Vitamin B12", cat: "vitamin", unit: "pg/mL" },
    folat: { name: "Folat (B9)", cat: "vitamin", unit: "ng/mL" },
    "folat (b9)": { name: "Folat (B9)", cat: "vitamin", unit: "ng/mL" },
    "folik asit (folat)": { name: "Folat (B9)", cat: "vitamin", unit: "ng/mL" },
    "folik asit": { name: "Folat (B9)", cat: "vitamin", unit: "ng/mL" },
    ferritin: { name: "Ferritin", cat: "vitamin", unit: "ng/mL" },
    demir: { name: "Demir", cat: "vitamin", unit: "µg/dL" },
    "demir (serum)": { name: "Demir", cat: "vitamin", unit: "µg/dL" },
    "demir baglama kapasitesi": { name: "Demir Bağlama (TDBK)", cat: "vitamin", unit: "µg/dL" },
    "demir baglama kapasitesi (tdbk)": { name: "Demir Bağlama (TDBK)", cat: "vitamin", unit: "µg/dL" },
    "demir baglama (tdbk)": { name: "Demir Bağlama (TDBK)", cat: "vitamin", unit: "µg/dL" },
    tdbk: { name: "Demir Bağlama (TDBK)", cat: "vitamin", unit: "µg/dL" },
    magnezyum: { name: "Magnezyum", cat: "vitamin", unit: "mg/dL" },
    "magnezyum(mg)": { name: "Magnezyum", cat: "vitamin", unit: "mg/dL" },
    kalsiyum: { name: "Kalsiyum", cat: "vitamin", unit: "mg/dL" },
    "kalsiyum (ca)": { name: "Kalsiyum", cat: "vitamin", unit: "mg/dL" },
    fosfor: { name: "Fosfor", cat: "vitamin", unit: "mg/dL" },
    "fosfor (p)": { name: "Fosfor", cat: "vitamin", unit: "mg/dL" },
    "ldl kolesterol": { name: "LDL Kolesterol", cat: "lipid", unit: "mg/dL" },
    "ldl kolesterol (indirekt, hesaplamali)": { name: "LDL Kolesterol", cat: "lipid", unit: "mg/dL" },
    ldl: { name: "LDL Kolesterol", cat: "lipid", unit: "mg/dL" },
    "hdl kolesterol": { name: "HDL Kolesterol", cat: "lipid", unit: "mg/dL" },
    hdl: { name: "HDL Kolesterol", cat: "lipid", unit: "mg/dL" },
    "kolesterol total": { name: "Total Kolesterol", cat: "lipid", unit: "mg/dL" },
    "total kolesterol": { name: "Total Kolesterol", cat: "lipid", unit: "mg/dL" },
    kolesterol: { name: "Total Kolesterol", cat: "lipid", unit: "mg/dL" },
    trigliserid: { name: "Trigliserid", cat: "lipid", unit: "mg/dL" },
    "glukoz(aclik)": { name: "Glukoz (Açlık)", cat: "lipid", unit: "mg/dL" },
    "glukoz (aclik)": { name: "Glukoz (Açlık)", cat: "lipid", unit: "mg/dL" },
    "glukoz (aclik kan sekeri)": { name: "Glukoz (Açlık)", cat: "lipid", unit: "mg/dL" },
    "aclik kan sekeri": { name: "Glukoz (Açlık)", cat: "lipid", unit: "mg/dL" },
    glukoz: { name: "Glukoz (Açlık)", cat: "lipid", unit: "mg/dL" },
    hba1c: { name: "HbA1c", cat: "lipid", unit: "%" },
    "glike hemoglobin (hb a1c)": { name: "HbA1c", cat: "lipid", unit: "%" },
    alt: { name: "ALT", cat: "organ", unit: "U/L" },
    "alt (sgpt)": { name: "ALT", cat: "organ", unit: "U/L" },
    sgpt: { name: "ALT", cat: "organ", unit: "U/L" },
    "alanin aminotransferaz (alt)": { name: "ALT", cat: "organ", unit: "U/L" },
    ast: { name: "AST", cat: "organ", unit: "U/L" },
    "ast (sgot)": { name: "AST", cat: "organ", unit: "U/L" },
    sgot: { name: "AST", cat: "organ", unit: "U/L" },
    "aspartat transaminaz (ast)": { name: "AST", cat: "organ", unit: "U/L" },
    ggt: { name: "GGT", cat: "organ", unit: "U/L" },
    "gamma glutamil transferaz (ggt)": { name: "GGT", cat: "organ", unit: "U/L" },
    alp: { name: "ALP", cat: "organ", unit: "U/L" },
    "alkalen fosfataz (alp)": { name: "ALP", cat: "organ", unit: "U/L" },
    ldh: { name: "LDH", cat: "organ", unit: "U/L" },
    "laktat dehidrogenaz (ldh)": { name: "LDH", cat: "organ", unit: "U/L" },
    ck: { name: "Kreatin Kinaz (CK)", cat: "organ", unit: "U/L" },
    "kreatin kinaz (ck)": { name: "Kreatin Kinaz (CK)", cat: "organ", unit: "U/L" },
    amilaz: { name: "Amilaz", cat: "organ", unit: "U/L" },
    "bilirubin (total)": { name: "Bilirubin (Total)", cat: "organ", unit: "mg/dL" },
    "total bilirubin": { name: "Bilirubin (Total)", cat: "organ", unit: "mg/dL" },
    "bilirubin (direkt)": { name: "Bilirubin (Direkt)", cat: "organ", unit: "mg/dL" },
    "direkt bilirubin": { name: "Bilirubin (Direkt)", cat: "organ", unit: "mg/dL" },
    albumin: { name: "Albümin", cat: "organ" },
    kreatinin: { name: "Kreatinin", cat: "organ", unit: "mg/dL" },
    egfr: { name: "eGFR", cat: "organ", unit: "mL/dk" },
    "egfr hesaplamasi": { name: "eGFR", cat: "organ", unit: "mL/dk" },
    ure: { name: "Üre", cat: "organ", unit: "mg/dL" },
    "ure (serum/plazma)": { name: "Üre", cat: "organ", unit: "mg/dL" },
    "urik asit": { name: "Ürik Asit", cat: "organ", unit: "mg/dL" },
    crp: { name: "CRP", cat: "organ", unit: "mg/L" },
    "c reaktif protein (crp)": { name: "CRP", cat: "organ", unit: "mg/L" },
    "crp,nefelometrik": { name: "CRP", cat: "organ", unit: "mg/L" },
    "crp, nefelometrik": { name: "CRP", cat: "organ", unit: "mg/L" },
    sodyum: { name: "Sodyum", cat: "organ", unit: "mmol/L" },
    "sodyum (na)": { name: "Sodyum", cat: "organ", unit: "mmol/L" },
    "sodyum (na,serum)": { name: "Sodyum", cat: "organ", unit: "mmol/L" },
    potasyum: { name: "Potasyum", cat: "organ", unit: "mmol/L" },
    "potasyum (k)": { name: "Potasyum", cat: "organ", unit: "mmol/L" },
    "potasyum ( k , serum )": { name: "Potasyum", cat: "organ", unit: "mmol/L" },
    klor: { name: "Klor", cat: "organ", unit: "mmol/L" },
    "klor (cl)": { name: "Klor", cat: "organ", unit: "mmol/L" },
    tsh: { name: "TSH", cat: "tiroid", unit: "mIU/L" },
    "serbest t4": { name: "Serbest T4", cat: "tiroid", unit: "ng/dL" },
    ft4: { name: "Serbest T4", cat: "tiroid", unit: "ng/dL" },
    "serbest t3": { name: "Serbest T3", cat: "tiroid", unit: "pg/mL" },
    ft3: { name: "Serbest T3", cat: "tiroid", unit: "pg/mL" },
    hgb: { name: "Hemoglobin (HGB)", cat: "hemogram", unit: "g/dL" },
    hemoglobin: { name: "Hemoglobin (HGB)", cat: "hemogram", unit: "g/dL" },
    "hemoglobin (hgb)": { name: "Hemoglobin (HGB)", cat: "hemogram", unit: "g/dL" },
    hct: { name: "Hematokrit (HCT)", cat: "hemogram", unit: "%" },
    hematokrit: { name: "Hematokrit (HCT)", cat: "hemogram", unit: "%" },
    "hematokrit (hct)": { name: "Hematokrit (HCT)", cat: "hemogram", unit: "%" },
    wbc: { name: "Lökosit (WBC)", cat: "hemogram", unit: "10^3/µL" },
    "lokosit (wbc)": { name: "Lökosit (WBC)", cat: "hemogram", unit: "10^3/µL" },
    rbc: { name: "Eritrosit (RBC)", cat: "hemogram", unit: "10^6/µL" },
    "eritrosit (rbc)": { name: "Eritrosit (RBC)", cat: "hemogram", unit: "10^6/µL" },
    plt: { name: "Trombosit (PLT)", cat: "hemogram", unit: "10^3/µL" },
    "trombosit (plt)": { name: "Trombosit (PLT)", cat: "hemogram", unit: "10^3/µL" },
    mcv: { name: "MCV", cat: "hemogram", unit: "fL" },
    mch: { name: "MCH", cat: "hemogram", unit: "pg" },
    mchc: { name: "MCHC", cat: "hemogram", unit: "g/dL" },
    rdw: { name: "RDW", cat: "hemogram", unit: "%" },
    "rdw-cv": { name: "RDW", cat: "hemogram", unit: "%" },
    "rdw-sd": { name: "RDW-SD", cat: "hemogram", unit: "fL" },
    mpv: { name: "MPV", cat: "hemogram", unit: "fL" },
    pct: { name: "PCT", cat: "hemogram", unit: "%" },
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

  const st = {
    auth: null,
    sb: null,
    reports: [], // { ...report, results: [] }
    series: [], // unified biomarker series sorted by priority
    activeCat: "all",
    selectedTest: null,
    draft: null,
    chart: null,
    parsing: false,
  };

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    if (typeof window.showToast === "function") window.showToast(msg);
  }

  function fmtDate(d) {
    if (!d) return "--";
    const [y, m, day] = String(d).slice(0, 10).split("-");
    return `${day}.${m}.${y}`;
  }

  function shortLab(name) {
    if (!name) return "";
    return String(name)
      .replace(/İSTANBUL\s+ÜSKÜDAR\s+0*20\s+NOLU\s+AİLE\s+HEKİMLİĞİ\s+BİRİMİ/i, "Üsküdar 20 Nolu ASM")
      .replace(/AİLE\s+HEKİMLİĞİ\s+BİRİMİ/i, "ASM")
      .replace(/ÖZEL\s+ERDEM\s+HASTANESİ/i, "Özel Erdem Hst.");
  }

  function normKey(s) {
    return String(s || "")
      .toLocaleLowerCase("tr-TR")
      .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
      .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
      .replace(/^tam kan sayimi\s*\(hemogram\)\s*/i, "")
      .replace(/^hemogram\s*[-:]?\s*/i, "")
      .replace(/\s+/g, " ")
      .replace(/[.\s]+$/g, "")
      .trim();
  }

  function canonicalizeLabTest(name, unit, rawName) {
    const cleanInput = String(name || rawName || "").trim();
    const raw = String(rawName || cleanInput).trim();
    const u = unit ? String(unit).trim() : null;
    const k = normKey(cleanInput);
    const rk = normKey(raw);

    if (k === "pdw" || k.startsWith("pdw ") || rk === "pdw") {
      const isPct = (u || "").includes("%") || k.includes("%");
      return { test_name: isPct ? "PDW (%)" : "PDW (fL)", raw_name: raw || cleanInput, category: "hemogram", unit: isPct ? "%" : "fL" };
    }

    let match = EXACT_CANON[k] || EXACT_CANON[rk];
    if (!match) {
      if (/vitamin\s*d|25[-\s]*oh/.test(k)) match = { name: "Vitamin D (25-OH)", cat: "vitamin", unit: "ng/mL" };
      else if (/ldl/.test(k)) match = { name: "LDL Kolesterol", cat: "lipid", unit: "mg/dL" };
      else if (/hdl/.test(k)) match = { name: "HDL Kolesterol", cat: "lipid", unit: "mg/dL" };
      else if (/alanin|\balt\b|\bsgpt\b/.test(k)) match = { name: "ALT", cat: "organ", unit: "U/L" };
      else if (/aspartat|\bast\b|\bsgot\b/.test(k)) match = { name: "AST", cat: "organ", unit: "U/L" };
      else if (/egfr/.test(k)) match = { name: "eGFR", cat: "organ", unit: "mL/dk" };
      else if (/hbsag|anti\s*hb|anti\s*hc|anti\s*hi|vdrl/.test(k)) match = { name: cleanInput, cat: "other" };
    }

    const finalName = match?.name || cleanInput;
    let finalUnit = match?.unit || u;
    if (finalUnit === "ng/L" && finalName === "Vitamin B12") finalUnit = "pg/mL";
    if ((finalUnit === "µg/L" || finalUnit === "ug/L") && finalName === "Folat (B9)") finalUnit = "ng/mL";
    if (finalUnit === "mEq/L" && (finalName === "Sodyum" || finalName === "Potasyum" || finalName === "Klor")) finalUnit = "mmol/L";

    return {
      test_name: finalName,
      raw_name: raw || finalName,
      category: match?.cat || "other",
      unit: finalUnit,
    };
  }

  function flagOf(r) {
    const v = Number(r.value);
    if (r.ref_low !== null && r.ref_low !== undefined && v < Number(r.ref_low)) return "low";
    if (r.ref_high !== null && r.ref_high !== undefined && v > Number(r.ref_high)) return "high";
    if ((r.ref_low === null || r.ref_low === undefined) && (r.ref_high === null || r.ref_high === undefined)) return "none";
    return "ok";
  }

  function refText(r) {
    const lo = r.ref_low, hi = r.ref_high;
    if (lo != null && hi != null) return `${lo} – ${hi}`;
    if (lo != null) return `≥ ${lo}`;
    if (hi != null) return `≤ ${hi}`;
    return "—";
  }

  function fmtDelta(delta, unit) {
    if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 1e-6) return "";
    const arrow = delta > 0 ? "↑" : "↓";
    const abs = Math.round(Math.abs(delta) * 100) / 100;
    return `${arrow}${abs}${unit ? " " + unit : ""}`;
  }

  function buildBiomarkerSeries() {
    const map = new Map();
    const ascReports = [...st.reports].sort((a, b) => a.report_date.localeCompare(b.report_date));
    ascReports.forEach((rp) => {
      rp.results.forEach((r) => {
        const key = r.test_name;
        if (!map.has(key)) {
          map.set(key, { name: key, category: r.category || "other", points: [] });
        }
        map.get(key).points.push({
          date: rp.report_date,
          lab_name: rp.lab_name || "",
          value: Number(r.value),
          unit: r.unit || "",
          ref_low: r.ref_low != null ? Number(r.ref_low) : null,
          ref_high: r.ref_high != null ? Number(r.ref_high) : null,
          flag: flagOf(r),
          raw_name: r.raw_name || r.test_name,
        });
      });
    });

    const list = [...map.values()].map((s) => {
      const latest = s.points[s.points.length - 1];
      const prev = s.points.length > 1 ? s.points[s.points.length - 2] : null;
      const delta = prev ? Number(latest.value) - Number(prev.value) : null;
      const isAbnormal = latest.flag === "high" || latest.flag === "low";
      let score = PRIORITY_BONUS[s.name] || 10;
      if (LOW_PRIORITY_HEMO.has(s.name)) score = 1;
      if (isAbnormal) score += 100;
      if (s.points.length >= 2) score += 45;
      if (s.category === "other") score -= 15;
      return { ...s, latest, prev, delta, isAbnormal, score };
    });

    list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "tr"));
    st.series = list;
  }

  async function getToken() {
    let token = st.auth?.accessToken || null;
    try {
      const { data } = await st.sb.auth.getSession();
      if (data?.session?.access_token) token = data.session.access_token;
    } catch (_) {}
    return token;
  }

  // ---------- Render ----------
  function renderSummary() {
    const el = document.getElementById("lab-summary");
    const badge = document.getElementById("lab-badge");
    if (!el) return;
    if (!st.auth?.authenticated) {
      el.innerHTML = `<div class="auth-hint-box">Giriş yaptıktan sonra tahlillerini ekleyebilirsin.</div>`;
      if (badge) { badge.className = "badge badge-info"; badge.textContent = "--"; }
      return;
    }
    if (!st.reports.length) {
      el.innerHTML = `<div class="auth-hint-box">Henüz tahlil eklenmedi. E-Nabız veya hastane PDF'i yükleyerek başla.</div>`;
      if (badge) { badge.className = "badge badge-info"; badge.textContent = "Boş"; }
      return;
    }

    const abnormalList = st.series.filter((s) => s.isAbnormal);
    const multiCount = st.series.filter((s) => s.points.length >= 2).length;
    if (badge) {
      badge.className = `badge mono ${abnormalList.length ? "badge-warn" : "badge-ok"}`;
      badge.textContent = abnormalList.length ? `${abnormalList.length} sınır dışı` : "Tümü normal";
    }

    const latestRep = st.reports[0];
    const metaHtml = `<div class="lab-latest-head"><strong>${st.series.length}</strong> farklı test birleştirildi · <strong>${multiCount}</strong> trend hazır · Son rapor: <strong>${fmtDate(latestRep.report_date)}</strong> (${esc(shortLab(latestRep.lab_name) || "Rapor")})</div>`;

    if (!abnormalList.length) {
      el.innerHTML = metaHtml + `<div class="auth-hint-box">✓ Tüm testlerin en güncel ölçümleri referans aralığında.</div>`;
      return;
    }

    const cards = abnormalList
      .map((s) => {
        const pt = s.latest;
        const active = st.selectedTest === s.name ? "active" : "";
        const arrow = pt.flag === "high" ? "▲ Yüksek" : "▼ Düşük";
        const deltaTxt = s.prev ? `Önceki: ${s.prev.value} · ${fmtDelta(s.delta, "")}` : `Ref: ${refText(pt)}`;
        return `
        <button type="button" class="lab-focus-card ${pt.flag} ${active}" onclick="selectLabBiomarker('${esc(s.name)}')">
          <div class="lab-focus-top">
            <span class="lab-focus-name">${esc(s.name)}</span>
            <span class="lab-focus-flag">${arrow}</span>
          </div>
          <div class="lab-focus-val mono">${pt.value} <small>${esc(pt.unit)}</small></div>
          <div class="lab-focus-sub">${esc(deltaTxt)} · ${fmtDate(pt.date)}</div>
        </button>`;
      })
      .join("");

    el.innerHTML = metaHtml + `<div class="lab-focus-grid">${cards}</div>`;
  }

  function filteredSeries() {
    if (st.activeCat === "abnormal") return st.series.filter((s) => s.isAbnormal);
    if (st.activeCat === "multi") return st.series.filter((s) => s.points.length >= 2);
    if (st.activeCat === "organ") return st.series.filter((s) => s.category === "organ" || s.category === "tiroid");
    if (st.activeCat === "all") return st.series;
    return st.series.filter((s) => s.category === st.activeCat);
  }

  function renderTrend() {
    const wrap = document.getElementById("lab-trend-wrap");
    const strip = document.getElementById("lab-cat-strip");
    const pills = document.getElementById("lab-param-pills");
    const sel = document.getElementById("lab-test-select");
    if (!wrap || !sel) return;

    if (!st.series.length) {
      wrap.style.display = "none";
      if (st.chart) { st.chart.destroy(); st.chart = null; }
      return;
    }
    wrap.style.display = "";

    if (strip) {
      strip.innerHTML = CAT_TABS
        .map((c) => `<button type="button" class="lab-cat-chip ${st.activeCat === c.key ? "active" : ""}" onclick="setLabCategory('${c.key}')">${c.label}</button>`)
        .join("");
    }

    let list = filteredSeries();
    if (!list.length) list = st.series;
    if (!st.selectedTest || !list.some((s) => s.name === st.selectedTest)) {
      st.selectedTest = list[0].name;
    }

    if (pills) {
      const topPills = list.slice(0, 12);
      pills.innerHTML = topPills
        .map((s) => {
          const act = s.name === st.selectedTest ? "active" : "";
          const fl = s.isAbnormal ? ` ${s.latest.flag}` : "";
          const cnt = s.points.length >= 2 ? ` <em>(${s.points.length})</em>` : "";
          return `<button type="button" class="lab-param-pill ${act}${fl}" onclick="selectLabBiomarker('${esc(s.name)}')">${esc(s.name)}${cnt}</button>`;
        })
        .join("");
    }

    sel.innerHTML = list
      .map((s) => `<option value="${esc(s.name)}">${esc(s.name)} (${s.latest.value} ${esc(s.latest.unit)}${s.points.length > 1 ? " · " + s.points.length + " ölçüm" : ""})</option>`)
      .join("");
    sel.value = st.selectedTest;

    drawSelectedBiomarker();
  }

  function renderSingleGauge(s) {
    const gauge = document.getElementById("lab-single-gauge");
    if (!gauge) return;
    const pt = s.latest;
    const lo = pt.ref_low, hi = pt.ref_high;
    if (lo == null && hi == null) {
      gauge.innerHTML = `<div class="lab-gauge-card">
        <div class="lab-gauge-row"><strong>${esc(s.name)}</strong><span class="mono">${pt.value} ${esc(pt.unit)}</span></div>
        <div class="card-sub">${fmtDate(pt.date)} · ${esc(shortLab(pt.lab_name))} · Referans aralığı belirtilmemiş</div>
      </div>`;
      gauge.classList.remove("hidden");
      return;
    }

    const spanLo = lo != null ? lo : 0;
    const spanHi = hi != null ? hi : Math.max(pt.value * 1.4, spanLo + 10);
    const span = Math.max(spanHi - spanLo, 1e-6);
    const pad = span * 0.25;
    const minPlot = spanLo - pad;
    const maxPlot = spanHi + pad;
    const pctOf = (v) => Math.min(97, Math.max(3, ((v - minPlot) / (maxPlot - minPlot)) * 100));

    const okLeft = lo != null ? pctOf(lo) : 3;
    const okRight = hi != null ? pctOf(hi) : 97;
    const pinPct = pctOf(pt.value);
    const statusCls = pt.flag === "high" ? "high" : pt.flag === "low" ? "low" : "ok";
    const statusTxt = pt.flag === "high" ? "Üst sınırın üzerinde" : pt.flag === "low" ? "Alt sınırın altında" : "Referans aralığında";

    gauge.innerHTML = `
      <div class="lab-gauge-card">
        <div class="lab-gauge-row">
          <div>
            <strong>${esc(s.name)}</strong>
            <span class="lab-gauge-status ${statusCls}">${statusTxt}</span>
          </div>
          <div class="mono" style="font-size:16px; font-weight:800;">${pt.value} <small style="font-weight:500;">${esc(pt.unit)}</small></div>
        </div>
        <div class="lab-gauge-track">
          <div class="lab-gauge-safe" style="left:${okLeft.toFixed(1)}%; width:${Math.max(4, okRight - okLeft).toFixed(1)}%;"></div>
          <div class="lab-gauge-pin ${statusCls}" style="left:${pinPct.toFixed(1)}%;"></div>
        </div>
        <div class="lab-gauge-bounds mono">
          <span>${lo != null ? "Alt: " + lo : ""}</span>
          <span>Ref: ${esc(refText(pt))} ${esc(pt.unit)}</span>
          <span>${hi != null ? "Üst: " + hi : ""}</span>
        </div>
        <div class="card-sub" style="margin-top:6px;">Tek ölçüm: ${fmtDate(pt.date)} · ${esc(shortLab(pt.lab_name))}</div>
      </div>`;
    gauge.classList.remove("hidden");
  }

  function drawSelectedBiomarker() {
    const s = st.series.find((x) => x.name === st.selectedTest);
    const chartBox = document.getElementById("lab-chart-box");
    const gauge = document.getElementById("lab-single-gauge");
    const info = document.getElementById("lab-trend-info");
    const canvas = document.getElementById("lab-trend-chart");
    if (!s) return;

    if (s.points.length < 2) {
      if (st.chart) { st.chart.destroy(); st.chart = null; }
      if (chartBox) chartBox.classList.add("hidden");
      renderSingleGauge(s);
      if (info) info.textContent = `1 ölçüm · Ref: ${refText(s.latest)}`;
      return;
    }

    if (gauge) gauge.classList.add("hidden");
    if (chartBox) chartBox.classList.remove("hidden");
    if (!canvas || !window.Chart) return;

    const pts = s.points;
    const last = s.latest;
    const isSunny = document.documentElement.dataset.theme === "weather_sunny";
    const tickColor = isSunny ? "#334155" : "#9fb0c8";
    const gridColor = isSunny ? "rgba(15, 23, 42, 0.08)" : "rgba(148, 163, 184, 0.12)";

    if (st.chart) st.chart.destroy();
    const datasets = [
      {
        label: `${s.name}${last.unit ? " (" + last.unit + ")" : ""}`,
        data: pts.map((p) => p.value),
        borderColor: "#10b981",
        backgroundColor: "rgba(16, 185, 129, 0.16)",
        pointBackgroundColor: pts.map((p) => (p.flag === "high" ? "#ef4444" : p.flag === "low" ? "#f59e0b" : "#10b981")),
        tension: 0.25,
        pointRadius: 5,
        fill: true,
      },
    ];
    if (last.ref_high != null) {
      datasets.push({ label: "Üst sınır", data: pts.map(() => last.ref_high), borderColor: "rgba(239, 68, 68, 0.65)", borderDash: [5, 4], pointRadius: 0, fill: false });
    }
    if (last.ref_low != null) {
      datasets.push({ label: "Alt sınır", data: pts.map(() => last.ref_low), borderColor: "rgba(245, 158, 11, 0.65)", borderDash: [5, 4], pointRadius: 0, fill: false });
    }

    st.chart = new window.Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: pts.map((p) => fmtDate(p.date)), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: tickColor, boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: tickColor }, grid: { color: gridColor } },
          y: { ticks: { color: tickColor }, grid: { color: gridColor } },
        },
      },
    });

    if (info) {
      const deltaStr = s.delta ? ` · ${fmtDelta(s.delta, last.unit)}` : "";
      info.textContent = `${pts.length} ölçüm · Son: ${last.value} ${last.unit} (önceki: ${s.prev.value}${deltaStr})`;
    }
  }

  function renderList() {
    const el = document.getElementById("lab-report-list");
    const count = document.getElementById("lab-count");
    if (!el) return;
    if (count) count.textContent = `${st.reports.length} rapor`;
    if (!st.reports.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = st.reports
      .map((rp) => {
        const abnCount = rp.results.filter((r) => ["low", "high"].includes(flagOf(r))).length;
        const rows = rp.results
          .map((r) => {
            const f = flagOf(r);
            return `<tr class="lab-${f}"><td>${esc(r.test_name)}</td><td class="mono"><b>${r.value}</b> ${esc(r.unit || "")}</td><td class="mono">${esc(refText(r))}</td><td>${f === "high" ? "▲ Yüksek" : f === "low" ? "▼ Düşük" : f === "ok" ? "✓" : ""}</td></tr>`;
          })
          .join("");
        const abnBadge = abnCount ? `<span class="badge badge-warn mono">${abnCount} sınır dışı</span>` : "";
        return `
        <details class="lab-report">
          <summary>
            <span class="lab-report-title"><strong>${fmtDate(rp.report_date)}</strong>${rp.lab_name ? " · " + esc(shortLab(rp.lab_name)) : ""}</span>
            <span class="lab-report-badges">${abnBadge}<span class="badge badge-info mono">${rp.results.length} değer</span></span>
          </summary>
          <div class="lab-table-wrap"><table class="lab-table"><thead><tr><th>Test</th><th>Sonuç</th><th>Referans</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
          <div style="text-align:right; margin-top:8px;"><button type="button" class="btn btn-sm" onclick="deleteLabReport('${rp.id}')">🗑 Raporu Sil</button></div>
        </details>`;
      })
      .join("");
  }

  function renderAll() {
    buildBiomarkerSeries();
    renderSummary();
    renderTrend();
    renderList();
  }

  // ---------- Data ----------
  async function refresh() {
    if (!st.sb || !st.auth?.userId) return;
    const uid = st.auth.userId;
    const [rep, res] = await Promise.all([
      st.sb.from("lab_reports").select("*").eq("user_id", uid).order("report_date", { ascending: false }).limit(60),
      st.sb.from("lab_results").select("*").eq("user_id", uid).limit(3000),
    ]);
    if (rep.error) return toast("Tahlil listesi alınamadı: " + rep.error.message);
    const byReport = {};
    (res.data || []).forEach((rawRow) => {
      const c = canonicalizeLabTest(rawRow.test_name, rawRow.unit, rawRow.raw_name);
      const r = { ...rawRow, test_name: c.test_name, unit: c.unit, category: rawRow.category || c.category, raw_name: rawRow.raw_name || c.raw_name };
      (byReport[r.report_id] = byReport[r.report_id] || []).push(r);
    });
    st.reports = (rep.data || []).map((rp) => ({
      ...rp,
      results: (byReport[rp.id] || []).sort((a, b) => a.test_name.localeCompare(b.test_name, "tr")),
    }));
    renderAll();
  }

  async function removeReport(id) {
    if (!window.confirm("Bu tahlil raporu ve tüm değerleri silinsin mi?")) return;
    const { error } = await st.sb.from("lab_reports").delete().eq("id", id).eq("user_id", st.auth.userId);
    if (error) return toast("Silinemedi: " + error.message);
    st.reports = st.reports.filter((r) => r.id !== id);
    renderAll();
  }

  // ---------- Draft modal ----------
  function rowHtml(r, i) {
    return `<tr data-i="${i}">
      <td><input type="text" class="lab-in-name" value="${esc(r.name)}" /><input type="hidden" class="lab-in-raw" value="${esc(r.raw_name || r.name)}" /></td>
      <td><input type="number" step="any" class="lab-in-value" value="${r.value ?? ""}" /></td>
      <td><input type="text" class="lab-in-unit" value="${esc(r.unit || "")}" /></td>
      <td><input type="number" step="any" class="lab-in-lo" value="${r.ref_low ?? ""}" /></td>
      <td><input type="number" step="any" class="lab-in-hi" value="${r.ref_high ?? ""}" /></td>
      <td><button type="button" class="btn btn-sm" onclick="removeLabDraftRow(${i})">✕</button></td>
    </tr>`;
  }

  function collectRows() {
    const rows = [];
    document.querySelectorAll("#lab-draft-body tr").forEach((tr) => {
      const g = (c) => tr.querySelector(c)?.value.trim();
      const n = (c) => {
        const v = g(c);
        return v === "" || v === undefined ? null : Number(String(v).replace(",", "."));
      };
      const name = g(".lab-in-name");
      const raw = g(".lab-in-raw") || name;
      const c = canonicalizeLabTest(name, g(".lab-in-unit") || null, raw);
      rows.push({
        name: c.test_name,
        raw_name: c.raw_name,
        category: c.category,
        value: n(".lab-in-value"),
        unit: c.unit,
        ref_low: n(".lab-in-lo"),
        ref_high: n(".lab-in-hi"),
      });
    });
    return rows;
  }

  function renderDraft() {
    const body = document.getElementById("lab-draft-body");
    if (!body || !st.draft) return;
    body.innerHTML = st.draft.rows.map(rowHtml).join("");
    const d = document.getElementById("lab-draft-date");
    const l = document.getElementById("lab-draft-lab");
    if (d) d.value = st.draft.report_date || new Date().toISOString().slice(0, 10);
    if (l) l.value = st.draft.lab_name || "";
    const badge = document.getElementById("lab-modal-source");
    if (badge) {
      badge.textContent = st.draft.source === "ai" ? "🤖 AI · Standart Format" : "✏️ Manuel";
      badge.className = `badge ${st.draft.source === "ai" ? "badge-info" : "badge-ok"}`;
    }
  }

  function openModal(draft) {
    if (!st.auth?.authenticated) return toast("Önce giriş yapmalısın.");
    window.closeQuickAddSheet?.();
    const base = draft || { report_date: null, lab_name: "", source: "manual", rows: [{ name: "", raw_name: "", value: null, unit: "", ref_low: null, ref_high: null }] };
    base.rows = (base.rows || []).map((r) => {
      if (!r.name) return r;
      const c = canonicalizeLabTest(r.name, r.unit, r.raw_name);
      return { ...r, name: c.test_name, raw_name: c.raw_name, category: r.category || c.category, unit: c.unit };
    });
    st.draft = base;
    renderDraft();
    document.getElementById("lab-modal")?.classList.add("open");
  }

  function closeModal() {
    document.getElementById("lab-modal")?.classList.remove("open");
    st.draft = null;
  }

  function addRow() {
    if (!st.draft) return;
    st.draft.rows = collectRows();
    st.draft.report_date = document.getElementById("lab-draft-date")?.value || null;
    st.draft.lab_name = document.getElementById("lab-draft-lab")?.value || "";
    st.draft.rows.push({ name: "", raw_name: "", value: null, unit: "", ref_low: null, ref_high: null });
    renderDraft();
  }

  function removeRow(i) {
    if (!st.draft) return;
    st.draft.rows = collectRows();
    st.draft.report_date = document.getElementById("lab-draft-date")?.value || null;
    st.draft.lab_name = document.getElementById("lab-draft-lab")?.value || "";
    st.draft.rows.splice(i, 1);
    renderDraft();
  }

  async function saveDraft(ev) {
    ev?.preventDefault();
    if (!st.draft || !st.sb || !st.auth?.userId) return;
    const date = document.getElementById("lab-draft-date")?.value;
    if (!date) return toast("Rapor tarihi zorunlu.");
    const rows = collectRows().filter((r) => r.name && r.value !== null && Number.isFinite(r.value));
    if (!rows.length) return toast("En az bir geçerli değer gerekli.");
    const btn = document.getElementById("lab-save-btn");
    if (btn) btn.disabled = true;
    try {
      const { data: rep, error } = await st.sb
        .from("lab_reports")
        .insert({ user_id: st.auth.userId, report_date: date, lab_name: document.getElementById("lab-draft-lab")?.value.trim() || null, source: st.draft.source })
        .select()
        .single();
      if (error) throw error;
      const { error: e2 } = await st.sb.from("lab_results").insert(
        rows.map((r) => ({
          user_id: st.auth.userId,
          report_id: rep.id,
          test_name: r.name,
          raw_name: r.raw_name || r.name,
          category: r.category || "other",
          value: r.value,
          unit: r.unit,
          ref_low: r.ref_low,
          ref_high: r.ref_high,
        })),
      );
      if (e2) {
        await st.sb.from("lab_reports").delete().eq("id", rep.id);
        throw e2;
      }
      closeModal();
      toast(`🩸 ${rows.length} değer standart formatta kaydedildi`);
      await refresh();
    } catch (err) {
      toast("Kaydedilemedi: " + (err.message || err));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---------- Upload + AI ----------
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Dosya okunamadı."));
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.readAsDataURL(file);
    });
  }

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Görsel okunamadı."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Görsel yüklenemedi."));
        img.onload = () => {
          const max = 2000;
          let w = img.width, h = img.height;
          if (w > max || h > max) {
            const r = Math.min(max / w, max / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL("image/jpeg", 0.88).split(",")[1] || "");
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(file) {
    if (!file || st.parsing) return;
    if (!st.auth?.authenticated) return toast("Önce giriş yapmalısın.");
    st.parsing = true;
    const status = document.getElementById("lab-upload-status");
    if (status) {
      status.textContent = "⏳ Rapor okunup standart formata dönüştürülüyor (dosya saklanmaz)...";
      status.classList.remove("hidden");
    }
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (isPdf && file.size > 9 * 1024 * 1024) throw new Error("PDF çok büyük (maks 9 MB).");
      const base64 = isPdf ? await fileToBase64(file) : await resizeImage(file);
      const token = await getToken();
      if (!token) throw new Error("Oturum bulunamadı. Lütfen yeniden giriş yapın.");
      const res = await fetch(PARSE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ file_base64: base64, mime_type: isPdf ? "application/pdf" : "image/jpeg" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok || !json.data) throw new Error(json.error || "Rapor okunamadı.");
      openModal({ report_date: json.data.report_date, lab_name: json.data.lab_name || "", source: "ai", rows: json.data.results });
      toast("✓ Değerler standart formatta okundu — kontrol edip Kaydet'e bas.");
    } catch (err) {
      toast(`Okuma hatası: ${err.message} · Değerleri elle ekleyebilirsin.`);
    } finally {
      st.parsing = false;
      if (status) status.classList.add("hidden");
    }
  }

  function bindInput() {
    const input = document.getElementById("lab-file-input");
    if (!input || input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("change", (ev) => {
      const f = ev.target?.files?.[0];
      input.value = "";
      if (f) handleFile(f);
    });
  }

  function triggerUpload() {
    window.closeQuickAddSheet?.();
    if (!st.auth?.authenticated) return toast("Önce giriş yapmalısın.");
    bindInput();
    document.getElementById("lab-file-input")?.click();
  }

  async function checkNativeSharedPdf() {
    try {
      if (!st.auth?.authenticated || !st.sb) return false;
      const bridge = window.GarminNativeShare;
      if (!bridge || typeof bridge.consumeSharedPdf !== "function") return false;
      const b64 = bridge.consumeSharedPdf();
      if (!b64 || String(b64).length < 100) return false;
      document.querySelector('[data-tab="health"]')?.click();
      const bin = atob(String(b64));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await handleFile(new File([bytes], "shared-report.pdf", { type: "application/pdf" }));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function initForUser(auth, sb) {
    st.auth = auth || null;
    st.sb = sb || null;
    bindInput();
    const selEl = document.getElementById("lab-test-select");
    if (selEl && selEl.dataset.bound !== "1") {
      selEl.dataset.bound = "1";
      selEl.addEventListener("change", (e) => {
        st.selectedTest = e.target.value;
        renderSummary();
        renderTrend();
      });
    }
    renderAll();
    if (!auth?.authenticated || !auth?.userId || !sb) return;
    await refresh();
    await checkNativeSharedPdf();
  }

  function reset() {
    st.auth = null;
    st.reports = [];
    st.series = [];
    st.selectedTest = null;
    st.activeCat = "all";
    closeModal();
    if (st.chart) { st.chart.destroy(); st.chart = null; }
    renderAll();
  }

  window.setLabCategory = function (cat) {
    st.activeCat = cat || "all";
    const list = filteredSeries();
    if (list.length && !list.some((s) => s.name === st.selectedTest)) {
      st.selectedTest = list[0].name;
    }
    renderSummary();
    renderTrend();
  };

  window.selectLabBiomarker = function (name) {
    if (!name) return;
    st.selectedTest = name;
    renderSummary();
    renderTrend();
    document.getElementById("lab-trend-wrap")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  window.triggerLabUpload = triggerUpload;
  window.openLabModal = () => openModal();
  window.closeLabModal = closeModal;
  window.addLabDraftRow = addRow;
  window.removeLabDraftRow = removeRow;
  window.submitLabModal = saveDraft;
  window.deleteLabReport = removeReport;
  window.GarminLabs = { initForUser, reset, refresh, checkNativeSharedPdf };
})();
