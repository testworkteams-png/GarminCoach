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
    reports: [],
    series: [],
    selectedReportId: "all",
    slideIdx: 0,
    tableQuery: "",
    tableFilter: "all",
    overviewAi: null,
    aiLoading: false,
    aiError: null,
    aiAttemptedKeys: new Set(),
    activeCat: "all",
    selectedTest: null,
    draft: null,
    chart: null,
    parsing: false,
    pendingSharedFile: null,
    pendingSharedLabel: null,
    parseAbort: null,
    progTimer: null,
    progVal: 0,
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

  function fmtShortDate(d) {
    if (!d) return "--";
    const [, m, day] = String(d).slice(0, 10).split("-");
    return `${day}.${m}`;
  }

  function shortLab(name) {
    if (!name) return "";
    return String(name)
      .replace(/İSTANBUL\s+ÜSKÜDAR\s+0*20\s+NOLU\s+AİLE\s+HEKİMLİĞİ\s+BİRİMİ/i, "Üsküdar ASM")
      .replace(/AİLE\s+HEKİMLİĞİ\s+BİRİMİ/i, "ASM")
      .replace(/ÖZEL\s+ERDEM\s+HASTANESİ/i, "Erdem Hst.");
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
          report_id: rp.id,
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

  // ---------- Carousel Engine (#hl-carousel-track) ----------
  function syncHlCarouselHeight() {
    const track = document.getElementById("hl-carousel-track");
    if (!track) return;
    const slides = track.querySelectorAll(".lab-carousel-slide");
    if (!slides.length) return;
    const idx = Math.max(0, Math.min(slides.length - 1, Number(st.slideIdx) || 0));
    const card = slides[idx]?.querySelector(".card") || slides[idx];
    if (!card) return;
    const h = Math.round(card.offsetHeight);
    if (h > 40) track.style.height = `${h + 2}px`;
  }

  function updateHlCarouselUi(idx) {
    const track = document.getElementById("hl-carousel-track");
    if (!track) return;
    const slides = track.querySelectorAll(".lab-carousel-slide");
    const total = slides.length;
    if (!total) return;

    const clamped = Math.max(0, Math.min(total - 1, Number(idx) || 0));
    st.slideIdx = clamped;

    const counter = document.getElementById("hl-carousel-counter");
    if (counter) counter.textContent = `${clamped + 1} / ${total}`;

    const nav = document.getElementById("hl-carousel-nav");
    if (nav) {
      nav.querySelectorAll(".lab-carousel-tab").forEach((btn, i) => btn.classList.toggle("active", i === clamped));
      const activeTab = nav.querySelector(`.lab-carousel-tab[data-slide="${clamped}"]`);
      if (activeTab) {
        const targetLeft = Math.max(0, activeTab.offsetLeft - (nav.clientWidth - activeTab.offsetWidth) / 2);
        nav.scrollTo({ left: targetLeft, behavior: "smooth" });
      }
    }

    document.querySelectorAll("#hl-carousel-dots .lab-carousel-dot").forEach((dot, i) => dot.classList.toggle("active", i === clamped));
    syncHlCarouselHeight();
  }

  function goToHlSlide(idx) {
    const track = document.getElementById("hl-carousel-track");
    if (!track) return;
    const slides = track.querySelectorAll(".lab-carousel-slide");
    if (!slides.length) return;
    const clamped = Math.max(0, Math.min(slides.length - 1, Number(idx) || 0));
    const left = Math.max(0, slides[clamped].offsetLeft - slides[0].offsetLeft);
    track.scrollTo({ left, behavior: "smooth" });
    updateHlCarouselUi(clamped);
    if (clamped === 1 && st.chart) {
      try { st.chart.resize(); } catch (_) {}
    }
  }

  function moveHlCarousel(delta) {
    const track = document.getElementById("hl-carousel-track");
    if (!track) return;
    const total = track.querySelectorAll(".lab-carousel-slide").length;
    if (!total) return;
    goToHlSlide(((st.slideIdx || 0) + Number(delta || 0) + total) % total);
  }

  function initHlCarousel() {
    const track = document.getElementById("hl-carousel-track");
    if (!track || track.dataset.bound === "1") return;
    track.dataset.bound = "1";

    let rafId = 0;
    track.addEventListener("scroll", () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const slides = track.querySelectorAll(".lab-carousel-slide");
        if (!slides.length) return;
        const base = slides[0].offsetLeft;
        const cur = track.scrollLeft;
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < slides.length; i++) {
          const d = Math.abs(slides[i].offsetLeft - base - cur);
          if (d < bestDist) { bestDist = d; best = i; }
        }
        if (best !== st.slideIdx) updateHlCarouselUi(best);
      });
    }, { passive: true });

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => syncHlCarouselHeight());
      track.querySelectorAll(".lab-carousel-slide > .card").forEach((c) => ro.observe(c));
    }
    window.addEventListener("resize", syncHlCarouselHeight);
    updateHlCarouselUi(0);
  }

  // ---------- Render: Report Switcher ----------
  function renderReportSwitcher() {
    const sw = document.getElementById("lab-report-switcher");
    const count = document.getElementById("lab-count");
    const sec = document.getElementById("hl-carousel-section");
    if (count) count.textContent = `${st.reports.length} rapor`;

    if (st.selectedReportId !== "all" && !st.reports.some((r) => r.id === st.selectedReportId)) {
      st.selectedReportId = "all";
    }

    if (sec) sec.classList.toggle("hidden", !st.reports.length);
    if (!sw) return;

    if (!st.auth?.authenticated) {
      sw.innerHTML = `<div class="auth-hint-box" style="width:100%;">Giriş yaptıktan sonra tahlillerini ekleyebilirsin.</div>`;
      return;
    }
    if (!st.reports.length) {
      sw.innerHTML = `<div class="auth-hint-box" style="width:100%;">Henüz tahlil eklenmedi. E-Nabız veya hastane PDF'i yükleyerek başla.</div>`;
      return;
    }

    const allPill = `<button type="button" class="lab-rep-pill ${st.selectedReportId === "all" ? "active" : ""}" onclick="selectLabReport('all')">✨ Tümü · ${st.reports.length} rapor</button>`;
    const repPills = st.reports
      .map((rp) => {
        const abn = rp.results.filter((r) => ["low", "high"].includes(flagOf(r))).length;
        const act = st.selectedReportId === rp.id ? "active" : "";
        const warnCls = abn ? "has-warn" : "";
        const labTxt = shortLab(rp.lab_name);
        return `<button type="button" class="lab-rep-pill ${warnCls} ${act}" onclick="selectLabReport('${esc(rp.id)}')">${fmtShortDate(rp.report_date)}${labTxt ? " · " + esc(labTxt) : ""} · ${abn ? "⚠️" + abn : "✓"}</button>`;
      })
      .join("");
    sw.innerHTML = allPill + repPills;
  }

  // ---------- Render: AI Comment & Slide 0 Summary ----------
  function renderAiBox() {
    const scopeEl = document.getElementById("lab-ai-scope");
    const textEl = document.getElementById("lab-ai-text");
    const btnEl = document.getElementById("btn-lab-ai-refresh");
    if (!textEl) return;

    const isAll = st.selectedReportId === "all";
    const rp = isAll ? null : st.reports.find((r) => r.id === st.selectedReportId);
    if (scopeEl) scopeEl.textContent = isAll ? "Birleşik" : `${fmtDate(rp?.report_date)}`;
    if (btnEl) btnEl.disabled = st.aiLoading;

    if (!st.reports.length) {
      textEl.textContent = "Yorum için önce en az bir tahlil ekle.";
      return;
    }
    if (st.aiLoading) {
      textEl.textContent = "⏳ Yapay zeka tahlilleri yorumluyor (yaklaşık 2–3 sn)...";
      return;
    }

    const cachedText = isAll ? st.overviewAi?.summary : rp?.ai_summary;
    if (cachedText) {
      textEl.textContent = cachedText;
      return;
    }
    if (st.aiError) {
      textEl.textContent = `⚠️ ${st.aiError} (Sağ üstten ↻ ile tekrar deneyebilirsin)`;
      return;
    }
    textEl.textContent = "Yorum hazırlanıyor...";
  }

  async function ensureAiSummary(force) {
    if (!st.auth?.authenticated || !st.reports.length || st.aiLoading) return;
    const scopeKey = st.selectedReportId || "all";
    const isAll = scopeKey === "all";
    const rp = isAll ? null : st.reports.find((r) => r.id === scopeKey);
    const hasCached = isAll ? Boolean(st.overviewAi?.summary) : Boolean(rp?.ai_summary);
    if (!force && (hasCached || st.aiAttemptedKeys.has(scopeKey))) return;

    st.aiAttemptedKeys.add(scopeKey);
    st.aiLoading = true;
    st.aiError = null;
    renderAiBox();
    syncHlCarouselHeight();

    try {
      const token = await getToken();
      if (!token) throw new Error("Oturum bulunamadı.");
      const res = await fetch(PARSE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "analyzeSummary", report_id: isAll ? null : scopeKey, force: Boolean(force) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "AI yorumu alınamadı.");
      if (isAll) {
        st.overviewAi = { summary: json.summary, fingerprint: json.fingerprint || "" };
      } else if (rp) {
        rp.ai_summary = json.summary;
      }
      if (force) toast("✨ Tahlil AI yorumu güncellendi.");
    } catch (err) {
      st.aiError = err?.message || "AI yorumu alınamadı";
    } finally {
      st.aiLoading = false;
      renderAiBox();
      requestAnimationFrame(syncHlCarouselHeight);
    }
  }

  function renderSummary() {
    const el = document.getElementById("lab-summary");
    const badge = document.getElementById("lab-badge");
    if (!el) return;
    if (!st.auth?.authenticated || !st.reports.length) {
      if (badge) { badge.className = "badge badge-info"; badge.textContent = st.auth?.authenticated ? "Boş" : "--"; }
      el.innerHTML = "";
      return;
    }

    const isAll = st.selectedReportId === "all";
    const rp = isAll ? null : st.reports.find((r) => r.id === st.selectedReportId);

    let abnormalCards = [];
    let metaText = "";

    if (isAll) {
      const multiCount = st.series.filter((s) => s.points.length >= 2).length;
      abnormalCards = st.series
        .filter((s) => s.isAbnormal)
        .map((s) => ({
          name: s.name,
          pt: s.latest,
          prev: s.prev,
          delta: s.delta,
        }));
      metaText = `<strong>${st.series.length}</strong> standart test · <strong>${multiCount}</strong> çoklu tarih trendi`;
    } else if (rp) {
      abnormalCards = rp.results
        .filter((r) => ["low", "high"].includes(flagOf(r)))
        .map((r) => {
          const sr = st.series.find((x) => x.name === r.test_name);
          const older = (sr?.points || []).filter((p) => p.date < rp.report_date);
          const prev = older.length ? older[older.length - 1] : null;
          const delta = prev ? Number(r.value) - Number(prev.value) : null;
          return {
            name: r.test_name,
            pt: { ...r, value: Number(r.value), flag: flagOf(r), date: rp.report_date },
            prev,
            delta,
          };
        });
      metaText = `<strong>${fmtDate(rp.report_date)}</strong> · ${esc(shortLab(rp.lab_name) || "Rapor")} · ${rp.results.length} değer`;
    }

    if (badge) {
      badge.className = `badge mono ${abnormalCards.length ? "badge-warn" : "badge-ok"}`;
      badge.textContent = abnormalCards.length ? `${abnormalCards.length} sınır dışı` : "Tümü normal";
    }

    const headHtml = `<div class="lab-latest-head">${metaText}</div>`;
    if (!abnormalCards.length) {
      el.innerHTML = headHtml + `<div class="auth-hint-box">✓ ${isAll ? "Tüm testlerin en güncel ölçümleri referans aralığında." : `${fmtDate(rp.report_date)} tarihli rapordaki tüm değerler (${rp.results.length} test) referans aralığında.`}</div>`;
      return;
    }

    const cardsHtml = abnormalCards
      .map((item) => {
        const pt = item.pt;
        const active = st.selectedTest === item.name ? "active" : "";
        const arrow = pt.flag === "high" ? "▲ Yüksek" : "▼ Düşük";
        const deltaTxt = item.prev ? `Önceki: ${item.prev.value} · ${fmtDelta(item.delta, "")}` : `Ref: ${refText(pt)}`;
        return `
        <button type="button" class="lab-focus-card ${pt.flag} ${active}" onclick="selectLabBiomarker('${esc(item.name)}', true)">
          <div class="lab-focus-top">
            <span class="lab-focus-name">${esc(item.name)}</span>
            <span class="lab-focus-flag">${arrow}</span>
          </div>
          <div class="lab-focus-val mono">${pt.value} <small>${esc(pt.unit || "")}</small></div>
          <div class="lab-focus-sub">${esc(deltaTxt)} · ${fmtDate(pt.date)}</div>
        </button>`;
      })
      .join("");

    el.innerHTML = headHtml + `<div class="lab-focus-grid">${cardsHtml}</div>`;
  }

  // ---------- Render: Slide 1 Trend & Charts ----------
  function filteredSeries() {
    if (st.activeCat === "abnormal") return st.series.filter((s) => s.isAbnormal);
    if (st.activeCat === "multi") return st.series.filter((s) => s.points.length >= 2);
    if (st.activeCat === "organ") return st.series.filter((s) => s.category === "organ" || s.category === "tiroid");
    if (st.activeCat === "all") return st.series;
    return st.series.filter((s) => s.category === st.activeCat);
  }

  function renderTrend() {
    const strip = document.getElementById("lab-cat-strip");
    const pills = document.getElementById("lab-param-pills");
    const sel = document.getElementById("lab-test-select");
    if (!sel) return;

    if (!st.series.length) {
      if (st.chart) { st.chart.destroy(); st.chart = null; }
      return;
    }

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
      pills.innerHTML = list
        .slice(0, 12)
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

  // ---------- Render: Slide 2 Full Table ----------
  function renderFullTable() {
    const wrap = document.getElementById("lab-full-table-wrap");
    const delBtn = document.getElementById("btn-delete-selected-report");
    if (!wrap) return;

    const isAll = st.selectedReportId === "all";
    const rp = isAll ? null : st.reports.find((r) => r.id === st.selectedReportId);
    if (delBtn) delBtn.classList.toggle("hidden", isAll || !rp);

    if (!st.reports.length) {
      wrap.innerHTML = "";
      return;
    }

    const q = st.tableQuery.trim().toLocaleLowerCase("tr-TR");
    let rows = isAll
      ? st.series.map((s) => ({
          name: s.name,
          value: s.latest.value,
          unit: s.latest.unit,
          ref_low: s.latest.ref_low,
          ref_high: s.latest.ref_high,
          flag: s.latest.flag,
          date: s.latest.date,
        }))
      : (rp?.results || []).map((r) => ({
          name: r.test_name,
          value: r.value,
          unit: r.unit,
          ref_low: r.ref_low,
          ref_high: r.ref_high,
          flag: flagOf(r),
          date: rp.report_date,
        }));

    if (st.tableFilter === "abnormal") {
      rows = rows.filter((r) => r.flag === "high" || r.flag === "low");
    }
    if (q) {
      rows = rows.filter((r) => r.name.toLocaleLowerCase("tr-TR").includes(q));
    }

    const rank = (f) => (f === "high" || f === "low" ? 0 : f === "ok" ? 1 : 2);
    rows.sort((a, b) => rank(a.flag) - rank(b.flag) || a.name.localeCompare(b.name, "tr"));

    if (!rows.length) {
      wrap.innerHTML = `<p class="card-sub">Eşleşen test bulunamadı.</p>`;
      return;
    }

    const bodyHtml = rows
      .map((r) => {
        const fl = r.flag;
        const stTxt = fl === "high" ? "▲ Yüksek" : fl === "low" ? "▼ Düşük" : fl === "ok" ? "✓" : "";
        const dateTd = isAll ? `<td class="mono">${fmtShortDate(r.date)}</td>` : "";
        return `<tr class="lab-${fl}" onclick="selectLabBiomarker('${esc(r.name)}', true)" style="cursor:pointer;"><td>${esc(r.name)}</td><td class="mono"><b>${r.value}</b> ${esc(r.unit || "")}</td><td class="mono">${esc(refText(r))}</td>${dateTd}<td>${stTxt}</td></tr>`;
      })
      .join("");

    const dateTh = isAll ? "<th>Tarih</th>" : "";
    wrap.innerHTML = `<table class="lab-table"><thead><tr><th>Test</th><th>Sonuç</th><th>Referans</th>${dateTh}<th></th></tr></thead><tbody>${bodyHtml}</tbody></table>`;
  }

  function renderAll() {
    renderReportSwitcher();
    renderAiBox();
    renderSummary();
    renderTrend();
    renderFullTable();
    requestAnimationFrame(syncHlCarouselHeight);
  }

  // ---------- Data ----------
  async function refresh() {
    if (!st.sb || !st.auth?.userId) return;
    const uid = st.auth.userId;
    const [rep, res, ov] = await Promise.all([
      st.sb.from("lab_reports").select("*").eq("user_id", uid).order("report_date", { ascending: false }).limit(60),
      st.sb.from("lab_results").select("*").eq("user_id", uid).limit(3000),
      st.sb.from("lab_ai_overview").select("fingerprint, summary").eq("user_id", uid).maybeSingle(),
    ]);
    if (rep.error) return toast("Tahlil listesi alınamadı: " + rep.error.message);

    st.overviewAi = ov?.data || null;
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
    buildBiomarkerSeries();
    renderAll();
    ensureAiSummary(false);
  }

  async function removeReport(id) {
    if (!id || !window.confirm("Bu tahlil raporu ve tüm değerleri silinsin mi?")) return;
    const { error } = await st.sb.from("lab_reports").delete().eq("id", id).eq("user_id", st.auth.userId);
    if (error) return toast("Silinemedi: " + error.message);
    st.reports = st.reports.filter((r) => r.id !== id);
    if (st.selectedReportId === id) st.selectedReportId = "all";
    st.aiAttemptedKeys.delete("all");
    buildBiomarkerSeries();
    renderAll();
    if (st.reports.length) ensureAiSummary(true);
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
      st.selectedReportId = rep.id;
      st.aiAttemptedKeys.delete("all");
      st.aiAttemptedKeys.delete(rep.id);
      closeModal();
      toast(`🩸 ${rows.length} değer kaydedildi`);
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

  function fmtSize(bytes) {
    const b = Number(bytes || 0);
    if (!b) return "";
    return b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
  }

  function stopProgressTimer() {
    if (st.progTimer) {
      clearInterval(st.progTimer);
      st.progTimer = null;
    }
  }

  function setParseProgress(pct, activeStep) {
    st.progVal = Math.max(0, Math.min(100, Number(pct) || 0));
    const fill = document.getElementById("lab-parse-bar-fill");
    const pctEl = document.getElementById("lab-parse-pct");
    const bar = document.getElementById("lab-parse-progressbar");
    if (fill) fill.style.width = `${st.progVal.toFixed(1)}%`;
    if (pctEl) pctEl.textContent = `${Math.round(st.progVal)}%`;
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(st.progVal)));

    document.querySelectorAll("#lab-parse-steps .lab-step-item").forEach((el) => {
      const s = Number(el.getAttribute("data-step") || 0);
      el.classList.toggle("done", activeStep > 4 || s < activeStep);
      el.classList.toggle("active", activeStep <= 4 && s === activeStep);
    });
  }

  function openParseOverlay(fileName, fileSize, subNote) {
    stopProgressTimer();
    const overlay = document.getElementById("lab-parse-overlay");
    const icon = document.getElementById("lab-parse-icon");
    const title = document.getElementById("lab-parse-title");
    const meta = document.getElementById("lab-parse-filemeta");
    const fill = document.getElementById("lab-parse-bar-fill");
    const errBox = document.getElementById("lab-parse-error");
    const cancelBtn = document.getElementById("btn-lab-parse-cancel");
    const errBtns = document.getElementById("lab-parse-err-btns");

    if (icon) { icon.textContent = "📄"; icon.className = "lab-parse-icon"; }
    if (title) title.textContent = "Tahlil Raporu Okunuyor";
    const sizeStr = fmtSize(fileSize);
    if (meta) meta.textContent = subNote || `${fileName || "Belge"}${sizeStr ? " · " + sizeStr : ""}`;
    if (fill) fill.classList.remove("is-error");
    if (errBox) { errBox.textContent = ""; errBox.classList.add("hidden"); }
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    if (errBtns) errBtns.classList.add("hidden");
    setParseProgress(8, 1);
    overlay?.classList.add("open");
  }

  function startSmoothAiProgress() {
    stopProgressTimer();
    st.progTimer = setInterval(() => {
      const remaining = 91 - st.progVal;
      if (remaining <= 0.4) return;
      const next = st.progVal + Math.max(0.4, remaining * 0.075);
      const step = next >= 62 ? 3 : 2;
      setParseProgress(next, step);
    }, 280);
  }

  function showParseOverlayError(msg) {
    stopProgressTimer();
    const icon = document.getElementById("lab-parse-icon");
    const title = document.getElementById("lab-parse-title");
    const fill = document.getElementById("lab-parse-bar-fill");
    const errBox = document.getElementById("lab-parse-error");
    const cancelBtn = document.getElementById("btn-lab-parse-cancel");
    const errBtns = document.getElementById("lab-parse-err-btns");

    if (icon) { icon.textContent = "⚠️"; icon.className = "lab-parse-icon is-error"; }
    if (title) title.textContent = "Rapor Okunamadı";
    if (fill) fill.classList.add("is-error");
    if (errBox) { errBox.textContent = msg || "Dosya okunurken hata oluştu."; errBox.classList.remove("hidden"); }
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (errBtns) errBtns.classList.remove("hidden");
  }

  function closeLabParseOverlay() {
    stopProgressTimer();
    document.getElementById("lab-parse-overlay")?.classList.remove("open");
  }

  function cancelLabParsing() {
    if (st.parseAbort) {
      try { st.parseAbort.abort(); } catch (_) {}
      st.parseAbort = null;
    }
    st.pendingSharedFile = null;
    st.pendingSharedLabel = null;
    st.parsing = false;
    closeLabParseOverlay();
    toast("Tahlil okuma iptal edildi.");
  }

  async function handleFile(file, sourceLabel) {
    if (!file) return;
    const label = sourceLabel || file.name || "Tahlil Belgesi";
    if (!st.auth?.authenticated) {
      st.pendingSharedFile = file;
      st.pendingSharedLabel = label;
      openParseOverlay(label, file.size, `${label} · Oturum doğrulanıyor...`);
      setParseProgress(12, 1);
      return;
    }
    if (st.parsing) return;
    st.parsing = true;
    openParseOverlay(label, file.size);
    setParseProgress(16, 1);

    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    st.parseAbort = ac;

    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (isPdf && file.size > 9 * 1024 * 1024) throw new Error("PDF çok büyük (maks 9 MB).");
      const base64 = isPdf ? await fileToBase64(file) : await resizeImage(file);
      if (ac?.signal?.aborted) return;

      const token = await getToken();
      if (!token) throw new Error("Oturum bulunamadı. Lütfen yeniden giriş yapın.");

      setParseProgress(24, 2);
      startSmoothAiProgress();

      const res = await fetch(PARSE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ file_base64: base64, mime_type: isPdf ? "application/pdf" : "image/jpeg" }),
        signal: ac?.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (ac?.signal?.aborted) return;
      if (!res.ok || !json.ok || !json.data) throw new Error(json.error || "Rapor okunamadı.");

      stopProgressTimer();
      setParseProgress(100, 5);
      const icon = document.getElementById("lab-parse-icon");
      const title = document.getElementById("lab-parse-title");
      const count = (json.data.results || []).length;
      if (icon) { icon.textContent = "✓"; icon.className = "lab-parse-icon is-done"; }
      if (title) title.textContent = `${count} Değer Okundu!`;

      await new Promise((r) => setTimeout(r, 420));
      closeLabParseOverlay();
      openModal({ report_date: json.data.report_date, lab_name: json.data.lab_name || "", source: "ai", rows: json.data.results });
      toast(`✓ ${count} değer standart formatta okundu — kontrol edip Kaydet'e bas.`);
    } catch (err) {
      if (err?.name === "AbortError" || ac?.signal?.aborted) return;
      showParseOverlayError(err?.message || "Rapor okunamadı.");
    } finally {
      stopProgressTimer();
      if (st.parseAbort === ac) st.parseAbort = null;
      st.parsing = false;
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
      const bridge = window.GarminNativeShare;
      if (!bridge || typeof bridge.consumeSharedPdf !== "function") return false;
      const b64 = bridge.consumeSharedPdf();
      if (!b64 || String(b64).length < 100) return false;
      document.querySelector('[data-tab="health"]')?.click();
      const bin = atob(String(b64));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], "shared-report.pdf", { type: "application/pdf" });
      await handleFile(file, "Paylaşılan Tahlil PDF");
      return true;
    } catch (_) {
      return false;
    }
  }

  async function consumeWebSharedPdfIfAny() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("shared_lab") !== "1") return false;
      params.delete("shared_lab");
      const cleanUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, "", cleanUrl);
      if (!("caches" in window)) return false;
      const cache = await caches.open("garmincoach-share-temp-v1");
      const resp = await cache.match("./__shared-lab-pdf");
      if (!resp) return false;
      await cache.delete("./__shared-lab-pdf");
      const blob = await resp.blob();
      if (!blob || blob.size < 100) return false;
      document.querySelector('[data-tab="health"]')?.click();
      const file = new File([blob], "shared-report.pdf", { type: blob.type || "application/pdf" });
      await handleFile(file, "Paylaşılan Tahlil PDF");
      return true;
    } catch (_) {
      return false;
    }
  }

  function bindShareResumeListeners() {
    if (window.__GC_LAB_SHARE_BOUND) return;
    window.__GC_LAB_SHARE_BOUND = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkNativeSharedPdf();
    });
    window.addEventListener("focus", () => checkNativeSharedPdf());
    try {
      window.Capacitor?.Plugins?.App?.addListener?.("appStateChange", (state) => {
        if (state?.isActive) checkNativeSharedPdf();
      });
    } catch (_) {}
  }

  bindShareResumeListeners();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      checkNativeSharedPdf();
      consumeWebSharedPdfIfAny();
    });
  } else {
    checkNativeSharedPdf();
    consumeWebSharedPdfIfAny();
  }

  async function initForUser(auth, sb) {
    st.auth = auth || null;
    st.sb = sb || null;
    bindInput();
    initHlCarousel();
    const selEl = document.getElementById("lab-test-select");
    if (selEl && selEl.dataset.bound !== "1") {
      selEl.dataset.bound = "1";
      selEl.addEventListener("change", (e) => {
        st.selectedTest = e.target.value;
        renderSummary();
        renderTrend();
        requestAnimationFrame(syncHlCarouselHeight);
      });
    }
    buildBiomarkerSeries();
    renderAll();
    if (!auth?.authenticated || !auth?.userId || !sb) return;

    if (st.pendingSharedFile) {
      const f = st.pendingSharedFile;
      const lbl = st.pendingSharedLabel;
      st.pendingSharedFile = null;
      st.pendingSharedLabel = null;
      handleFile(f, lbl);
    } else {
      checkNativeSharedPdf();
      consumeWebSharedPdfIfAny();
    }
    await refresh();
  }

  function reset() {
    st.auth = null;
    st.reports = [];
    st.series = [];
    st.selectedReportId = "all";
    st.selectedTest = null;
    st.activeCat = "all";
    st.tableQuery = "";
    st.tableFilter = "all";
    st.overviewAi = null;
    st.aiLoading = false;
    st.aiError = null;
    st.aiAttemptedKeys.clear();
    closeModal();
    if (st.chart) { st.chart.destroy(); st.chart = null; }
    renderAll();
  }

  window.selectLabReport = function (id) {
    st.selectedReportId = id || "all";
    st.aiError = null;
    renderAll();
    ensureAiSummary(false);
  };

  window.refreshLabAiSummary = function (force) {
    const scopeKey = st.selectedReportId || "all";
    st.aiAttemptedKeys.delete(scopeKey);
    st.aiError = null;
    ensureAiSummary(Boolean(force));
  };

  window.setLabCategory = function (cat) {
    st.activeCat = cat || "all";
    const list = filteredSeries();
    if (list.length && !list.some((s) => s.name === st.selectedTest)) {
      st.selectedTest = list[0].name;
    }
    renderSummary();
    renderTrend();
    requestAnimationFrame(syncHlCarouselHeight);
  };

  window.selectLabBiomarker = function (name, jumpToChart) {
    if (!name) return;
    st.selectedTest = name;
    renderSummary();
    renderTrend();
    if (jumpToChart) goToHlSlide(1);
    requestAnimationFrame(syncHlCarouselHeight);
  };

  window.filterLabTable = function (q) {
    st.tableQuery = String(q || "");
    const inp = document.getElementById("lab-table-search");
    if (inp && inp.value !== st.tableQuery) inp.value = st.tableQuery;
    document.getElementById("btn-lab-search-clear")?.classList.toggle("hidden", !st.tableQuery.trim());
    renderFullTable();
    requestAnimationFrame(syncHlCarouselHeight);
  };

  window.setLabTableFilter = function (f) {
    st.tableFilter = f || "all";
    document.querySelectorAll("#lab-table-filters .lab-mini-filter").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-f") === st.tableFilter);
    });
    renderFullTable();
    requestAnimationFrame(syncHlCarouselHeight);
  };

  window.deleteSelectedLabReport = function () {
    if (st.selectedReportId && st.selectedReportId !== "all") {
      removeReport(st.selectedReportId);
    }
  };

  window.closeLabParseOverlay = closeLabParseOverlay;
  window.cancelLabParsing = cancelLabParsing;
  window.goToHlSlide = goToHlSlide;
  window.moveHlCarousel = moveHlCarousel;
  window.triggerLabUpload = triggerUpload;
  window.openLabModal = () => openModal();
  window.closeLabModal = closeModal;
  window.addLabDraftRow = addRow;
  window.removeLabDraftRow = removeRow;
  window.submitLabModal = saveDraft;
  window.deleteLabReport = removeReport;
  window.GarminLabs = {
    initForUser,
    reset,
    refresh,
    checkNativeSharedPdf,
    onTabShown: () => requestAnimationFrame(syncHlCarouselHeight),
  };
})();
