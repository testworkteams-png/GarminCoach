(function () {
  "use strict";

  const SUPABASE_URL = "https://htooqswstuuzslvrgxsx.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5_1RDXV8unnW9ttkHEA_HQ_n8fJrt4I";
  const PARSE_SCALE_URL = `${SUPABASE_URL}/functions/v1/parse-scale-screenshot`;
  const WEIGH_IN_NOTIF_ID = 202602;
  const SHARE_CACHE_NAME = "garmincoach-share-temp-v1";
  const SHARE_IMAGE_KEY = "./__shared-scale-image";

  const moduleState = {
    auth: null,
    sbClient: null,
    records: [],
    settings: {
      garmin_auto_sync_scale: true,
      weigh_in_reminder_enabled: true,
      weigh_in_interval_days: 3,
      weigh_in_reminder_time: "08:00",
    },
    donutChart: null,
    detailChart: null,
    activeDetailKey: "weight_kg",
    activeDetailRange: "all",
    selectedPointIdx: null,
    activeAiNotificationId: null,
    analyzingAi: false,
    modalSource: "manual",
    parsing: false,
    listenerAttached: false,
    escListenerAttached: false,
  };

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    if (typeof window.showToast === "function") {
      window.showToast(msg);
    }
  }

  function fmtDateShort(isoStr) {
    if (!isoStr) return "--";
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) return String(isoStr).slice(0, 10);
    return new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dt);
  }

  function fmtChartDay(isoStr) {
    if (!isoStr) return "--";
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) return String(isoStr).slice(5, 10);
    return new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "2-digit",
      month: "2-digit",
    }).format(dt);
  }

  function fmtTr(val, decimals = 1) {
    if (val === null || val === undefined || val === "") return "--";
    const num = Number(val);
    if (!Number.isFinite(num)) return "--";
    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);
  }

  function fmtDayMonthLong(isoStr) {
    if (!isoStr) return "--";
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) return String(isoStr).slice(0, 10);
    return new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "numeric",
      month: "long",
    }).format(dt);
  }

  function fmtDayMonthShort(isoStr) {
    if (!isoStr) return "--";
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) return String(isoStr).slice(5, 10);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      day: "numeric",
      month: "numeric",
    }).formatToParts(dt);
    const m = {};
    for (const p of parts) m[p.type] = p.value;
    return `${Number(m.day)}/${Number(m.month)}`;
  }

  function toLocalDatetimeInputValue(dateObjOrIso) {
    const dt = dateObjOrIso ? new Date(dateObjOrIso) : new Date();
    const safeDt = Number.isNaN(dt.getTime()) ? new Date() : dt;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(safeDt);
    const m = {};
    for (const p of parts) m[p.type] = p.value;
    const hh = m.hour === "24" ? "00" : m.hour;
    return `${m.year}-${m.month}-${m.day}T${hh}:${m.minute}`;
  }

  function parseOptionalNumber(id, isInt = false) {
    const el = document.getElementById(id);
    if (!el) return null;
    const raw = String(el.value || "").trim().replace(",", ".");
    if (!raw) return null;
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    return isInt ? Math.round(num) : num;
  }

  function setInputVal(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val !== null && val !== undefined ? String(val) : "";
  }

  async function getAccessToken() {
    let token = moduleState.auth?.accessToken || null;
    try {
      if (moduleState.sbClient?.auth?.getSession) {
        const { data } = await moduleState.sbClient.auth.getSession();
        if (data?.session?.access_token) token = data.session.access_token;
      }
    } catch (_) {}
    return token;
  }

  function fileToResizedJpegBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Görsel okunamadı."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Görsel yüklenemedi."));
        img.onload = () => {
          const maxDim = 1400;
          let w = img.width || 1000;
          let h = img.height || 1000;
          if (w > maxDim || h > maxDim) {
            const ratio = Math.min(maxDim / w, maxDim / h);
            w = Math.max(1, Math.round(w * ratio));
            h = Math.max(1, Math.round(h * ratio));
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
          const base64 = dataUrl.split(",")[1] || "";
          resolve({ base64, mimeType: "image/jpeg" });
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  function getLeanMass(r) {
    if (!r || r.weight_kg == null || r.body_fat_pct == null) return null;
    const w = Number(r.weight_kg);
    const f = Number(r.body_fat_pct);
    if (!Number.isFinite(w) || !Number.isFinite(f)) return null;
    return Number((w * (1 - f / 100)).toFixed(1));
  }

  function inferHeightM() {
    for (const r of moduleState.records) {
      const w = Number(r?.weight_kg);
      const bmi = Number(r?.bmi);
      if (Number.isFinite(w) && Number.isFinite(bmi) && w > 20 && bmi > 10) {
        const h = Math.sqrt(w / bmi);
        if (h >= 1.35 && h <= 2.2) return h;
      }
    }
    return null;
  }

  const BODY_METRICS = [
    {
      key: "weight_kg",
      label: "Kilo",
      tabLabel: "Kilo",
      unit: "kg",
      decimals: 1,
      invertGood: true,
      getValue: (r) => (r?.weight_kg != null ? Number(r.weight_kg) : null),
      getBands: () => {
        const h = inferHeightM();
        if (h) {
          const h2 = h * h;
          return {
            min: Number((15 * h2).toFixed(1)),
            max: Number((35 * h2).toFixed(1)),
            bands: [
              { to: Number((18.5 * h2).toFixed(1)), label: "Düşük", color: "#4f8df9" },
              { to: Number((25.0 * h2).toFixed(1)), label: "Sağlıklı", color: "#22c55e" },
              { to: Number((30.0 * h2).toFixed(1)), label: "Aşırı kilolu", color: "#f97316" },
              { to: Number((35.0 * h2).toFixed(1)), label: "Obez", color: "#ef4444" },
            ],
          };
        }
        return {
          min: 45,
          max: 115,
          bands: [
            { to: 58, label: "Düşük", color: "#4f8df9" },
            { to: 78, label: "Sağlıklı", color: "#22c55e" },
            { to: 92, label: "Aşırı kilolu", color: "#f97316" },
            { to: 115, label: "Obez", color: "#ef4444" },
          ],
        };
      },
    },
    {
      key: "bmi",
      label: "VKİ",
      tabLabel: "VKİ",
      unit: "",
      decimals: 1,
      invertGood: true,
      getValue: (r) => (r?.bmi != null ? Number(r.bmi) : null),
      getBands: () => ({
        min: 14,
        max: 36,
        bands: [
          { to: 18.5, label: "Düşük", color: "#4f8df9" },
          { to: 25.0, label: "Sağlıklı", color: "#22c55e" },
          { to: 30.0, label: "Aşırı kilolu", color: "#f97316" },
          { to: 36.0, label: "Obez", color: "#ef4444" },
        ],
      }),
    },
    {
      key: "body_fat_pct",
      label: "Vücut yağı",
      tabLabel: "Vücut yağ oranı",
      unit: "%",
      decimals: 1,
      invertGood: true,
      getValue: (r) => (r?.body_fat_pct != null ? Number(r.body_fat_pct) : null),
      getBands: () => ({
        min: 5,
        max: 36,
        bands: [
          { to: 10, label: "Düşük", color: "#4f8df9" },
          { to: 20, label: "Sağlıklı", color: "#22c55e" },
          { to: 25, label: "Yüksek", color: "#f97316" },
          { to: 36, label: "Obez", color: "#ef4444" },
        ],
      }),
    },
    {
      key: "muscle_mass_kg",
      label: "İskelet kas kütlesi",
      tabLabel: "İskelet kas kütlesi",
      unit: "kg",
      decimals: 1,
      invertGood: false,
      getValue: (r) => (r?.muscle_mass_kg != null ? Number(r.muscle_mass_kg) : null),
      getBands: (latest) => {
        const w = Number(latest?.weight_kg);
        if (Number.isFinite(w) && w > 30) {
          return {
            min: Number((0.25 * w).toFixed(1)),
            max: Number((0.58 * w).toFixed(1)),
            bands: [
              { to: Number((0.34 * w).toFixed(1)), label: "Düşük", color: "#4f8df9" },
              { to: Number((0.42 * w).toFixed(1)), label: "Normal", color: "#22c55e" },
              { to: Number((0.50 * w).toFixed(1)), label: "Yüksek", color: "#10b981" },
              { to: Number((0.58 * w).toFixed(1)), label: "Atletik", color: "#06b6d4" },
            ],
          };
        }
        return {
          min: 18,
          max: 46,
          bands: [
            { to: 24, label: "Düşük", color: "#4f8df9" },
            { to: 31, label: "Normal", color: "#22c55e" },
            { to: 38, label: "Yüksek", color: "#10b981" },
            { to: 46, label: "Atletik", color: "#06b6d4" },
          ],
        };
      },
    },
    {
      key: "visceral_fat",
      label: "Viseral yağ",
      tabLabel: "Viseral yağ",
      unit: "",
      decimals: 1,
      invertGood: true,
      getValue: (r) => (r?.visceral_fat != null ? Number(r.visceral_fat) : null),
      getBands: () => ({
        min: 1,
        max: 22,
        bands: [
          { to: 9.5, label: "Sağlıklı", color: "#22c55e" },
          { to: 14.5, label: "Yüksek", color: "#f97316" },
          { to: 22, label: "Çok yüksek", color: "#ef4444" },
        ],
      }),
    },
    {
      key: "bmr_kcal",
      label: "Bazal metabolizma",
      tabLabel: "BMR",
      unit: "kcal/g",
      decimals: 0,
      invertGood: false,
      getValue: (r) => (r?.bmr_kcal != null ? Number(r.bmr_kcal) : null),
      getBands: () => ({
        min: 1000,
        max: 2400,
        bands: [
          { to: 1350, label: "Düşük", color: "#4f8df9" },
          { to: 1850, label: "Normal", color: "#22c55e" },
          { to: 2400, label: "Yüksek", color: "#10b981" },
        ],
      }),
    },
    {
      key: "body_water_pct",
      label: "Vücut su oranı",
      tabLabel: "Su oranı",
      unit: "%",
      decimals: 1,
      invertGood: false,
      getValue: (r) => (r?.body_water_pct != null ? Number(r.body_water_pct) : null),
      getBands: () => ({
        min: 38,
        max: 75,
        bands: [
          { to: 50, label: "Düşük", color: "#f97316" },
          { to: 65, label: "Sağlıklı", color: "#22c55e" },
          { to: 75, label: "Yüksek", color: "#4f8df9" },
        ],
      }),
    },
    {
      key: "bone_mass_kg",
      label: "Kemik mineral",
      tabLabel: "Kemik minerali",
      unit: "kg",
      decimals: 2,
      invertGood: false,
      getValue: (r) => (r?.bone_mass_kg != null ? Number(r.bone_mass_kg) : null),
      getBands: () => ({
        min: 1.5,
        max: 4.5,
        bands: [
          { to: 2.5, label: "Düşük", color: "#f97316" },
          { to: 3.5, label: "Normal", color: "#22c55e" },
          { to: 4.5, label: "Yüksek", color: "#4f8df9" },
        ],
      }),
    },
    {
      key: "protein_pct",
      label: "Protein",
      tabLabel: "Protein",
      unit: "%",
      decimals: 1,
      invertGood: false,
      getValue: (r) => (r?.protein_pct != null ? Number(r.protein_pct) : null),
      getBands: () => ({
        min: 10,
        max: 28,
        bands: [
          { to: 16, label: "Düşük", color: "#f97316" },
          { to: 20, label: "Sağlıklı", color: "#22c55e" },
          { to: 28, label: "Yüksek", color: "#10b981" },
        ],
      }),
    },
    {
      key: "lean_mass_kg",
      label: "Yağsız kütle",
      tabLabel: "Yağsız kütle",
      unit: "kg",
      decimals: 1,
      invertGood: false,
      getValue: getLeanMass,
      getBands: (latest) => {
        const w = Number(latest?.weight_kg);
        if (Number.isFinite(w) && w > 30) {
          return {
            min: Number((0.6 * w).toFixed(1)),
            max: Number((0.95 * w).toFixed(1)),
            bands: [
              { to: Number((0.72 * w).toFixed(1)), label: "Düşük", color: "#f97316" },
              { to: Number((0.85 * w).toFixed(1)), label: "Sağlıklı", color: "#22c55e" },
              { to: Number((0.95 * w).toFixed(1)), label: "Yüksek", color: "#10b981" },
            ],
          };
        }
        return {
          min: 38,
          max: 76,
          bands: [
            { to: 48, label: "Düşük", color: "#f97316" },
            { to: 64, label: "Sağlıklı", color: "#22c55e" },
            { to: 76, label: "Yüksek", color: "#10b981" },
          ],
        };
      },
    },
    {
      key: "metabolic_age",
      label: "Metabolik yaş",
      tabLabel: "Metabolik yaş",
      unit: "yaş",
      decimals: 0,
      invertGood: true,
      optional: true,
      getValue: (r) => (r?.metabolic_age != null ? Number(r.metabolic_age) : null),
      getBands: () => ({
        min: 18,
        max: 75,
        bands: [
          { to: 32, label: "Genç", color: "#10b981" },
          { to: 45, label: "Normal", color: "#22c55e" },
          { to: 58, label: "Yüksek", color: "#f97316" },
          { to: 75, label: "Çok yüksek", color: "#ef4444" },
        ],
      }),
    },
  ];

  function getMetricValue(metric, record) {
    if (!metric || !record) return null;
    const v = metric.getValue(record);
    return v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null;
  }

  function getVisibleMetrics() {
    return BODY_METRICS.filter(
      (m) => !m.optional || moduleState.records.some((r) => getMetricValue(m, r) !== null)
    );
  }

  function getMetricByKey(key) {
    return BODY_METRICS.find((m) => m.key === key) || BODY_METRICS[0];
  }

  function evaluateBand(value, bandSpec) {
    if (value === null || value === undefined || !bandSpec?.bands?.length) return null;
    for (let i = 0; i < bandSpec.bands.length; i += 1) {
      const band = bandSpec.bands[i];
      if (value < band.to || i === bandSpec.bands.length - 1) return band;
    }
    return bandSpec.bands[bandSpec.bands.length - 1];
  }

  function formatMetricDeltaHtml(cur, old, decimals, invertGood, cls = "body-param-delta") {
    if (cur == null || old == null) return "";
    const factor = Math.pow(10, decimals);
    const diff = Math.round((Number(cur) - Number(old)) * factor) / factor;
    if (diff === 0) return "";
    const pos = diff > 0;
    const good = invertGood ? !pos : pos;
    const arrow = pos ? "↑" : "↓";
    return `<span class="${cls} ${good ? "good" : "warn"}">${arrow} ${esc(fmtTr(Math.abs(diff), decimals))}</span>`;
  }

  function renderLatestSummary() {
    const heroWeightEl = document.getElementById("body-hero-weight");
    const heroDeltaEl = document.getElementById("body-hero-delta");
    const gridEl = document.getElementById("body-latest-grid");
    const metaEl = document.getElementById("body-latest-meta");
    const badgeEl = document.getElementById("body-latest-sync-badge");
    if (!gridEl) return;

    const latest = moduleState.records[0];
    if (!latest) {
      if (heroWeightEl) heroWeightEl.textContent = "--";
      if (heroDeltaEl) heroDeltaEl.innerHTML = "";
      if (metaEl) metaEl.textContent = "İlk ölçüm bekleniyor";
      if (badgeEl) {
        badgeEl.className = "badge badge-info";
        badgeEl.textContent = "Kayıt Yok";
      }
      gridEl.innerHTML = `<p class="card-sub" style="grid-column:1/-1;">Henüz vücut ölçümü kaydı yok. <strong>📷 Tara</strong> veya <strong>✏️ Ekle</strong> ile Honor Scale 2 verisini ekleyebilirsin.</p>`;
      return;
    }

    const prev = moduleState.records[1] || null;
    if (heroWeightEl) heroWeightEl.textContent = fmtTr(latest.weight_kg, 1);
    if (heroDeltaEl) {
      const wDiffHtml = formatMetricDeltaHtml(latest.weight_kg, prev?.weight_kg, 1, true, "body-hero-delta-pill");
      heroDeltaEl.innerHTML = wDiffHtml;
    }

    if (metaEl) {
      metaEl.textContent = `${fmtDateShort(latest.measured_at)} · ${latest.source === "screenshot_ai" ? "📷 AI Tarama" : "✏️ Manuel"}`;
    }

    if (badgeEl) {
      if (latest.garmin_synced) {
        badgeEl.className = "badge badge-ok";
        badgeEl.textContent = "Garmin'de";
      } else if (latest.garmin_sync_error) {
        badgeEl.className = "badge badge-crit";
        badgeEl.textContent = "Hata";
      } else {
        badgeEl.className = "badge badge-warn";
        badgeEl.textContent = "Bekliyor";
      }
    }

    const tileMetrics = getVisibleMetrics().filter((m) => m.key !== "weight_kg");
    gridEl.innerHTML = tileMetrics
      .map((m) => {
        const curVal = getMetricValue(m, latest);
        const prevVal = prev ? getMetricValue(m, prev) : null;
        const band = curVal !== null ? evaluateBand(curVal, m.getBands(latest)) : null;
        const valText = curVal !== null ? fmtTr(curVal, m.decimals) : "--";
        const deltaHtml = formatMetricDeltaHtml(curVal, prevVal, m.decimals, m.invertGood);
        const statusLabel = band ? band.label : "Veri yok";
        const statusColor = band ? band.color : "var(--text-dim)";

        return `
        <button type="button" class="body-param-tile" onclick="openBodyMetricModal('${esc(m.key)}')">
          <div class="body-param-lbl" title="${esc(m.label)}">${esc(m.label)}</div>
          <div class="body-param-main">
            <span class="body-param-val mono">${esc(valText)}</span>
            ${m.unit ? `<span class="body-param-unit">${esc(m.unit)}</span>` : ""}
            ${deltaHtml}
          </div>
          <div class="body-param-status" style="color:${statusColor};">${esc(statusLabel)}</div>
        </button>`;
      })
      .join("");
  }

  function renderStructureDonut() {
    const canvas = document.getElementById("bodyStructureDonut");
    const layoutEl = document.getElementById("body-donut-layout");
    const legendEl = document.getElementById("body-donut-legend");
    const emptyEl = document.getElementById("body-donut-empty");
    if (!canvas || !layoutEl || !legendEl) return;

    if (moduleState.donutChart) {
      moduleState.donutChart.destroy();
      moduleState.donutChart = null;
    }

    const latest = moduleState.records[0];
    if (!latest || latest.weight_kg == null) {
      layoutEl.classList.add("hidden");
      if (emptyEl) {
        emptyEl.textContent = "Vücut yapısı dağılımı için tartı ölçümü ekleyin.";
        emptyEl.classList.remove("hidden");
      }
      legendEl.innerHTML = "";
      return;
    }

    const w = Number(latest.weight_kg);
    const items = [
      {
        label: "Su miktarı",
        val: latest.body_water_pct != null ? Number(((w * Number(latest.body_water_pct)) / 100).toFixed(2)) : null,
        color: "#4f8df9",
      },
      {
        label: "Protein",
        val: latest.protein_pct != null ? Number(((w * Number(latest.protein_pct)) / 100).toFixed(2)) : null,
        color: "#f5b841",
      },
      {
        label: "Yağ",
        val: latest.body_fat_pct != null ? Number(((w * Number(latest.body_fat_pct)) / 100).toFixed(2)) : null,
        color: "#f07178",
      },
      {
        label: "Kemik minerali",
        val: latest.bone_mass_kg != null ? Number(Number(latest.bone_mass_kg).toFixed(2)) : null,
        color: "#b8ddd6",
      },
    ];

    const chartSlices = items.filter((it) => it.val !== null && it.val > 0);
    if (chartSlices.length === 0 || typeof Chart === "undefined") {
      layoutEl.classList.add("hidden");
      if (emptyEl) {
        emptyEl.textContent = "Son ölçümde su/protein/yağ/kemik detayı bulunmuyor.";
        emptyEl.classList.remove("hidden");
      }
      legendEl.innerHTML = "";
      return;
    }

    layoutEl.classList.remove("hidden");
    if (emptyEl) emptyEl.classList.add("hidden");

    legendEl.innerHTML = items
      .map(
        (it) => `
      <div class="body-donut-row">
        <span class="body-donut-name"><i class="body-donut-dot" style="background:${it.color};"></i>${esc(it.label)}</span>
        <span class="body-donut-val mono">${it.val !== null ? `${esc(fmtTr(it.val, 2))} kg` : "--"}</span>
      </div>`
      )
      .join("");

    moduleState.donutChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: chartSlices.map((it) => it.label),
        datasets: [
          {
            data: chartSlices.map((it) => it.val),
            backgroundColor: chartSlices.map((it) => it.color),
            borderWidth: 0,
            hoverOffset: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "66%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${fmtTr(ctx.parsed, 2)} kg`,
            },
          },
        },
      },
    });
  }

  function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function describeArc(cx, cy, r, startAngle, endAngle) {
    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, endAngle);
    const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  function renderMetricGauge(metric, latestRec) {
    const wrapEl = document.getElementById("body-gauge-svg-wrap");
    const legendEl = document.getElementById("body-gauge-legend");
    if (!wrapEl || !legendEl) return;

    const bandSpec = metric.getBands(latestRec);
    const val = latestRec ? getMetricValue(metric, latestRec) : null;
    const activeBand = val !== null ? evaluateBand(val, bandSpec) : null;
    const { min, max, bands } = bandSpec;
    const span = Math.max(0.001, max - min);
    const startDeg = 145;
    const totalDeg = 250;
    const cx = 120;
    const cy = 112;
    const r = 84;

    const paths = [];
    let prevEdge = min;
    bands.forEach((b, i) => {
      const segStart = Math.max(min, Math.min(max, prevEdge));
      const segEnd = Math.max(segStart, Math.min(max, b.to));
      prevEdge = segEnd;
      const a0 = startDeg + ((segStart - min) / span) * totalDeg + (i === 0 ? 0 : 2.5);
      const a1 = startDeg + ((segEnd - min) / span) * totalDeg - (i === bands.length - 1 ? 0 : 2.5);
      if (a1 > a0) {
        const isCurrent = activeBand && activeBand.label === b.label;
        paths.push(
          `<path d="${describeArc(cx, cy, r, a0, a1)}" fill="none" stroke="${b.color}" stroke-width="11" stroke-linecap="round" opacity="${val === null || isCurrent ? "1" : "0.78"}" />`
        );
      }
    });

    let pointerSvg = "";
    if (val !== null) {
      const norm = Math.max(0, Math.min(1, (val - min) / span));
      const thetaDeg = startDeg + norm * totalDeg;
      const rad = (thetaDeg * Math.PI) / 180;
      const ux = Math.cos(rad);
      const uy = Math.sin(rad);
      const tx = -uy;
      const ty = ux;
      const tipX = cx + (r - 4) * ux;
      const tipY = cy + (r - 4) * uy;
      const base1X = cx + (r - 16) * ux + 6 * tx;
      const base1Y = cy + (r - 16) * uy + 6 * ty;
      const base2X = cx + (r - 16) * ux - 6 * tx;
      const base2Y = cy + (r - 16) * uy - 6 * ty;
      pointerSvg = `<polygon points="${tipX.toFixed(1)},${tipY.toFixed(1)} ${base1X.toFixed(1)},${base1Y.toFixed(1)} ${base2X.toFixed(1)},${base2Y.toFixed(1)}" fill="#ffffff" stroke="rgba(15,23,42,0.45)" stroke-width="1.5" stroke-linejoin="round" />`;
    }

    const displayVal = val !== null ? fmtTr(val, metric.decimals) : "--";
    const statusText = activeBand ? activeBand.label : "Ölçüm yok";
    const statusColor = activeBand ? activeBand.color : "var(--text-muted)";

    wrapEl.innerHTML = `
      <svg viewBox="0 0 240 194" class="body-gauge-svg" aria-hidden="true">
        ${paths.join("")}
        ${pointerSvg}
      </svg>
      <div class="body-gauge-center">
        <div class="body-gauge-val mono">${esc(displayVal)}</div>
        ${metric.unit ? `<div class="body-gauge-unit">${esc(metric.unit)}</div>` : ""}
        <div class="body-gauge-status" style="color:${statusColor};">${esc(statusText)}</div>
      </div>`;

    let legStart = min;
    legendEl.innerHTML = bands
      .map((b, i) => {
        const rangeTitle =
          i === 0
            ? `< ${fmtTr(b.to, metric.decimals)}`
            : i === bands.length - 1
              ? `≥ ${fmtTr(legStart, metric.decimals)}`
              : `${fmtTr(legStart, metric.decimals)} – ${fmtTr(b.to, metric.decimals)}`;
        legStart = b.to;
        return `<span class="body-gauge-leg-item" title="${esc(rangeTitle)}${metric.unit ? " " + esc(metric.unit) : ""}"><i style="background:${b.color};"></i>${esc(b.label)}</span>`;
      })
      .join("");
  }

  function renderMetricHistoryChart(metric) {
    const canvas = document.getElementById("bodyMetricHistoryChart");
    const summaryEl = document.getElementById("body-detail-chart-summary");
    const statsEl = document.getElementById("body-detail-stats");
    if (!canvas) return;

    if (moduleState.detailChart) {
      moduleState.detailChart.destroy();
      moduleState.detailChart = null;
    }

    const nowMs = Date.now();
    const rangeDays = moduleState.activeDetailRange === "30" ? 30 : moduleState.activeDetailRange === "90" ? 90 : null;
    const cutoffMs = rangeDays ? nowMs - rangeDays * 86400000 : null;

    const series = moduleState.records
      .map((rec) => ({ rec, val: getMetricValue(metric, rec) }))
      .filter((item) => {
        if (item.val === null) return false;
        if (!cutoffMs) return true;
        const ts = new Date(item.rec.measured_at).getTime();
        return Number.isFinite(ts) && ts >= cutoffMs;
      })
      .reverse();

    if (series.length === 0) {
      if (summaryEl) summaryEl.textContent = "Bu aralıkta kayıt bulunmuyor";
      if (statsEl) statsEl.innerHTML = "";
      return;
    }

    const vals = series.map((s) => s.val);
    const avg = vals.reduce((acc, v) => acc + v, 0) / vals.length;
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const netDelta = vals[vals.length - 1] - vals[0];
    const unitSuffix = metric.unit ? ` ${metric.unit}` : "";

    const updateSummary = (idx) => {
      if (!summaryEl) return;
      if (idx !== null && series[idx]) {
        const pt = series[idx];
        summaryEl.textContent = `${fmtDayMonthLong(pt.rec.measured_at)} · ${fmtTr(pt.val, metric.decimals)}${unitSuffix}`;
      } else {
        const last = series[series.length - 1];
        summaryEl.textContent = `${fmtDayMonthLong(last.rec.measured_at)}, ortalama ${fmtTr(avg, metric.decimals)}${unitSuffix}`;
      }
    };

    updateSummary(moduleState.selectedPointIdx);

    if (statsEl) {
      const factor = Math.pow(10, metric.decimals);
      const roundedNet = Math.round(netDelta * factor) / factor;
      const netGood = roundedNet === 0 ? null : metric.invertGood ? roundedNet < 0 : roundedNet > 0;
      const netArrow = roundedNet > 0 ? "↑" : roundedNet < 0 ? "↓" : "";
      const netCls = netGood === null ? "neutral" : netGood ? "good" : "warn";

      statsEl.innerHTML = `
        <span class="pill">Ort. <strong>${esc(fmtTr(avg, metric.decimals))}${esc(unitSuffix)}</strong></span>
        <span class="pill">Aralık <strong>${esc(fmtTr(minVal, metric.decimals))} – ${esc(fmtTr(maxVal, metric.decimals))}</strong></span>
        <span class="pill">Değişim <strong class="body-stat-delta ${netCls}">${netArrow} ${esc(fmtTr(Math.abs(roundedNet), metric.decimals))}${esc(unitSuffix)}</strong></span>`;
    }

    if (typeof Chart === "undefined") return;

    const isSunny = document.documentElement.getAttribute("data-theme") === "weather_sunny";
    const lineColor = isSunny ? "#06634b" : "#34d399";
    const tickColor = isSunny ? "#334155" : "#94a3b8";
    const gridColor = isSunny ? "rgba(15,23,42,0.10)" : "rgba(148,163,184,0.12)";
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, isSunny ? "rgba(6,99,75,0.28)" : "rgba(52,211,153,0.32)");
    gradient.addColorStop(1, isSunny ? "rgba(6,99,75,0.02)" : "rgba(52,211,153,0.02)");

    const pad = Math.max(metric.decimals === 0 ? 15 : 0.4, (maxVal - minVal) * 0.25);
    const activeIdx =
      moduleState.selectedPointIdx !== null && moduleState.selectedPointIdx < series.length
        ? moduleState.selectedPointIdx
        : series.length - 1;

    moduleState.detailChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: series.map((s) => fmtDayMonthShort(s.rec.measured_at)),
        datasets: [
          {
            label: metric.tabLabel,
            data: vals,
            borderColor: lineColor,
            backgroundColor: gradient,
            fill: true,
            tension: 0.25,
            borderWidth: 2.5,
            pointRadius: series.map((_, i) => (i === activeIdx ? 6 : 3.5)),
            pointHoverRadius: 7,
            pointBackgroundColor: series.map((_, i) =>
              i === activeIdx ? lineColor : isSunny ? "#f1f5f9" : "#0b1220"
            ),
            pointBorderColor: series.map((_, i) => (i === activeIdx ? "#ffffff" : lineColor)),
            pointBorderWidth: series.map((_, i) => (i === activeIdx ? 2.5 : 2)),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        onClick: (_ev, elements) => {
          if (!elements?.length) return;
          const idx = elements[0].index;
          moduleState.selectedPointIdx = idx;
          updateSummary(idx);
          const ds = moduleState.detailChart?.data?.datasets?.[0];
          if (ds && moduleState.detailChart) {
            ds.pointRadius = series.map((_, i) => (i === idx ? 6 : 3.5));
            ds.pointBackgroundColor = series.map((_, i) =>
              i === idx ? lineColor : isSunny ? "#f1f5f9" : "#0b1220"
            );
            ds.pointBorderColor = series.map((_, i) => (i === idx ? "#ffffff" : lineColor));
            ds.pointBorderWidth = series.map((_, i) => (i === idx ? 2.5 : 2));
            moduleState.detailChart.update("none");
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => (items?.[0] ? fmtDayMonthLong(series[items[0].dataIndex].rec.measured_at) : ""),
              label: (ctxItem) => `${fmtTr(ctxItem.parsed.y, metric.decimals)}${unitSuffix}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: tickColor, font: { size: 10.5 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
            grid: { display: false },
          },
          y: {
            suggestedMin: Number((minVal - pad).toFixed(metric.decimals)),
            suggestedMax: Number((maxVal + pad).toFixed(metric.decimals)),
            ticks: {
              color: tickColor,
              font: { size: 10.5 },
              callback: (v) => fmtTr(v, metric.decimals === 2 ? 2 : metric.decimals === 0 ? 0 : 1),
            },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  function renderDetailModal() {
    const tabsEl = document.getElementById("body-detail-tabs");
    const metric = getMetricByKey(moduleState.activeDetailKey);
    moduleState.activeDetailKey = metric.key;

    if (tabsEl) {
      const visible = getVisibleMetrics();
      tabsEl.innerHTML = visible
        .map(
          (m) => `
        <button type="button" class="body-detail-tab${m.key === metric.key ? " active" : ""}" data-metric="${esc(m.key)}" onclick="openBodyMetricModal('${esc(m.key)}')">${esc(m.tabLabel)}</button>`
        )
        .join("");

      const activeTab = tabsEl.querySelector(".body-detail-tab.active");
      if (activeTab && typeof activeTab.scrollIntoView === "function") {
        requestAnimationFrame(() => {
          try {
            activeTab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
          } catch (_) {}
        });
      }
    }

    document.querySelectorAll("#body-detail-ranges .body-range-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.range === moduleState.activeDetailRange);
    });

    const latestRec = moduleState.records[0] || null;
    renderMetricGauge(metric, latestRec);
    renderMetricHistoryChart(metric);
  }

  function openBodyMetricModal(metricKey = "weight_kg") {
    moduleState.activeDetailKey = metricKey || "weight_kg";
    moduleState.selectedPointIdx = null;
    const modal = document.getElementById("body-metric-modal");
    if (modal) modal.classList.add("open");
    renderDetailModal();
  }

  function closeBodyMetricModal() {
    const modal = document.getElementById("body-metric-modal");
    if (modal) modal.classList.remove("open");
    if (moduleState.detailChart) {
      moduleState.detailChart.destroy();
      moduleState.detailChart = null;
    }
  }

  function setBodyDetailRange(range) {
    moduleState.activeDetailRange = range === "30" || range === "90" ? range : "all";
    moduleState.selectedPointIdx = null;
    document.querySelectorAll("#body-detail-ranges .body-range-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.range === moduleState.activeDetailRange);
    });
    renderMetricHistoryChart(getMetricByKey(moduleState.activeDetailKey));
  }

  function renderHistoryList() {
    const listEl = document.getElementById("body-history-list");
    const countEl = document.getElementById("body-history-count");
    if (!listEl) return;

    if (countEl) countEl.textContent = `${moduleState.records.length} kayıt`;

    if (moduleState.records.length === 0) {
      listEl.innerHTML = `<p class="card-sub">Henüz geçmiş tartı ölçümü bulunmuyor.</p>`;
      return;
    }

    listEl.innerHTML = moduleState.records
      .map((r) => {
        let statusBadge = `<span class="badge badge-warn">Bekliyor</span>`;
        if (r.garmin_synced) {
          statusBadge = `<span class="badge badge-ok" title="${esc(r.garmin_synced_at ? fmtDateShort(r.garmin_synced_at) : "Senkronize edildi")}">Garmin'de</span>`;
        } else if (r.garmin_sync_error) {
          statusBadge = `<span class="badge badge-crit" title="${esc(r.garmin_sync_error)}">Hata</span>`;
        }

        const metrics = [
          r.weight_kg != null ? `<strong>${Number(r.weight_kg).toFixed(1)} kg</strong>` : null,
          r.body_fat_pct != null ? `Yağ %${Number(r.body_fat_pct).toFixed(1)}` : null,
          r.muscle_mass_kg != null ? `Kas ${Number(r.muscle_mass_kg).toFixed(1)} kg` : null,
          r.visceral_fat != null ? `İç Yağ ${Number(r.visceral_fat).toFixed(0)}` : null,
          r.bmi != null ? `VKİ ${Number(r.bmi).toFixed(1)}` : null,
        ].filter(Boolean);

        return `
        <div class="body-history-item">
          <div class="body-history-main">
            <div class="body-history-top">
              <span class="mono body-history-date">${esc(fmtDateShort(r.measured_at))}</span>
              <span class="body-source-tag">${r.source === "screenshot_ai" ? "📷 AI Görsel" : "✏️ Manuel"}</span>
            </div>
            <div class="body-history-metrics">${metrics.join(" · ") || "--"}</div>
            ${
              !r.garmin_synced && r.garmin_sync_error
                ? `<div class="body-history-err">${esc(r.garmin_sync_error)}</div>`
                : ""
            }
          </div>
          <div class="body-history-actions">
            ${statusBadge}
            <button type="button" class="btn btn-sm body-del-btn" onclick="deleteBodyComposition('${esc(r.id)}')" title="Kaydı Sil">🗑</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderScaleSettings() {
    const autoEl = document.getElementById("toggle-scale-auto-sync");
    const remEl = document.getElementById("toggle-weigh-reminder");
    const intEl = document.getElementById("inp-weigh-interval");
    const timeEl = document.getElementById("inp-weigh-time");
    const timeRow = document.getElementById("scale-reminder-options");
    const statusBox = document.getElementById("scale-sync-status-box");
    const badgeEl = document.getElementById("scale-settings-badge");

    if (autoEl) autoEl.checked = moduleState.settings.garmin_auto_sync_scale !== false;
    if (remEl) remEl.checked = moduleState.settings.weigh_in_reminder_enabled !== false;
    if (intEl) intEl.value = String(moduleState.settings.weigh_in_interval_days || 3);
    if (timeEl) timeEl.value = moduleState.settings.weigh_in_reminder_time || "08:00";
    if (timeRow) timeRow.style.opacity = moduleState.settings.weigh_in_reminder_enabled === false ? "0.45" : "1";

    const syncedRecs = moduleState.records.filter((r) => r.garmin_synced);
    const pendingRecs = moduleState.records.filter((r) => !r.garmin_synced && !r.garmin_sync_error);
    const errorRecs = moduleState.records.filter((r) => !r.garmin_synced && Boolean(r.garmin_sync_error));

    if (badgeEl) {
      if (errorRecs.length > 0) {
        badgeEl.className = "badge badge-crit";
        badgeEl.textContent = `${errorRecs.length} Hata`;
      } else if (pendingRecs.length > 0) {
        badgeEl.className = "badge badge-warn";
        badgeEl.textContent = `${pendingRecs.length} Bekliyor`;
      } else if (syncedRecs.length > 0) {
        badgeEl.className = "badge badge-ok";
        badgeEl.textContent = "Güncel";
      } else {
        badgeEl.className = "badge badge-info";
        badgeEl.textContent = "Hazır";
      }
    }

    if (statusBox) {
      const lastSync = syncedRecs
        .map((r) => r.garmin_synced_at)
        .filter(Boolean)
        .sort()
        .reverse()[0];
      const parts = [
        `<strong>Garmin'de:</strong> ${syncedRecs.length}`,
        `<strong>Bekleyen:</strong> ${pendingRecs.length}`,
        `<strong>Hatalı:</strong> ${errorRecs.length}`,
      ];
      const lastLine = lastSync ? `Son aktarım: ${fmtDateShort(lastSync)}` : "Henüz Garmin Connect aktarımı yapılmadı.";
      const errLine = errorRecs[0]?.garmin_sync_error
        ? `<div style="color:var(--red); margin-top:4px;">Son hata: ${esc(errorRecs[0].garmin_sync_error)}</div>`
        : "";
      statusBox.innerHTML = `${parts.join(" · ")}<br/><span>${esc(lastLine)}</span>${errLine}`;
    }

    const retryBtn = document.getElementById("btn-retry-scale-sync");
    if (retryBtn) {
      retryBtn.textContent =
        errorRecs.length > 0
          ? `↻ Hatalı Kayıtları Tekrar Kuyruğa Al (${errorRecs.length})`
          : "↻ Bekleyen Aktarımları Kontrol Et";
    }
  }

  function attachNotifListener() {
    if (moduleState.listenerAttached) return;
    const localNotifs = window.Capacitor?.Plugins?.LocalNotifications;
    if (!localNotifs || typeof localNotifs.addListener !== "function") return;
    moduleState.listenerAttached = true;

    try {
      localNotifs.addListener("localNotificationActionPerformed", (action) => {
        const extra = action?.notification?.extra || {};
        if (extra.tab === "body") {
          document.querySelector('[data-tab="body"]')?.click();
        }
      });
    } catch (_) {}
  }

  async function syncWeighInReminder() {
    attachNotifListener();
    const hintEl = document.getElementById("scale-reminder-hint");
    const enabled = moduleState.settings.weigh_in_reminder_enabled !== false;
    const intervalDays = Math.max(1, Number(moduleState.settings.weigh_in_interval_days || 3));
    const timeStr = moduleState.settings.weigh_in_reminder_time || "08:00";
    const [hh, mm] = timeStr.split(":").map((x) => Number(x) || 0);

    // Son ölçüm üzerinden geçen gün sayısını hesapla (son X günde ölçüm varsa o gün bildirim kurma)
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let nextDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    let skippedTodayReason = "";

    const latestAt = moduleState.records[0]?.measured_at ? new Date(moduleState.records[0].measured_at) : null;
    if (latestAt && !Number.isNaN(latestAt.getTime())) {
      const latestMidnight = new Date(latestAt.getFullYear(), latestAt.getMonth(), latestAt.getDate());
      const daysSince = Math.floor((todayMidnight.getTime() - latestMidnight.getTime()) / 86400000);
      if (daysSince < intervalDays) {
        const dueDate = new Date(latestMidnight);
        dueDate.setDate(dueDate.getDate() + intervalDays);
        nextDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate(), hh, mm, 0, 0);
        skippedTodayReason = `Son ${intervalDays} gün içinde ölçüm bulunduğu için bugün bildirim atlanacak; sonraki hatırlatıcı ${fmtChartDay(nextDate.toISOString())} ${timeStr}.`;
      }
    }

    if (nextDate.getTime() <= now.getTime()) {
      nextDate.setDate(nextDate.getDate() + 1);
    }

    const localNotifs = window.Capacitor?.Plugins?.LocalNotifications;
    if (!localNotifs) {
      if (hintEl) {
        hintEl.textContent = !enabled
          ? "🔕 Tartılma hatırlatıcısı kapalı."
          : skippedTodayReason || `🌐 Web sürümündesiniz: Android APK'da ${timeStr} (${intervalDays} günde bir) için otomatik ayarlanır.`;
      }
      return;
    }

    try {
      await localNotifs.cancel({ notifications: [{ id: WEIGH_IN_NOTIF_ID }] });

      if (!enabled) {
        if (hintEl) hintEl.textContent = "🔕 Tartılma hatırlatıcısı kapalı · Cihaz alarmı iptal edildi.";
        return;
      }

      let perm = await localNotifs.checkPermissions();
      if (perm.display !== "granted") {
        perm = await localNotifs.requestPermissions();
      }
      if (perm.display !== "granted") {
        if (hintEl) hintEl.textContent = "⚠️ Cihaz bildirim izni verilmedi.";
        return;
      }

      await localNotifs.schedule({
        notifications: [
          {
            id: WEIGH_IN_NOTIF_ID,
            title: "⚖️ Tartılma Zamanı (Honor Scale 2)",
            body: "Sabah tartını yapıp ekran görüntüsünü ＋ menüsünden ekleyebilirsin.",
            schedule: { at: nextDate, allowWhileIdle: true },
            extra: { tab: "body" },
          },
        ],
      });

      if (hintEl) {
        hintEl.textContent =
          skippedTodayReason ||
          `✅ APK Hatırlatıcısı kuruldu: ${fmtChartDay(nextDate.toISOString())} saat ${timeStr} (${intervalDays} günde bir).`;
      }
    } catch (err) {
      if (hintEl) hintEl.textContent = `Bildirim zamanlama uyarısı: ${err.message || err}`;
    }
  }

  function renderAll() {
    renderLatestSummary();
    renderStructureDonut();
    renderHistoryList();
    renderScaleSettings();
    const detailModal = document.getElementById("body-metric-modal");
    if (detailModal?.classList.contains("open")) {
      renderDetailModal();
    }
  }

  async function refresh() {
    if (!moduleState.sbClient || !moduleState.auth?.userId) return;
    const uid = moduleState.auth.userId;

    const [recRes, setRes] = await Promise.all([
      moduleState.sbClient
        .from("body_composition")
        .select("*")
        .eq("user_id", uid)
        .order("measured_at", { ascending: false })
        .limit(90),
      moduleState.sbClient.from("user_settings").select("*").eq("user_id", uid).maybeSingle(),
    ]);

    if (!recRes.error && Array.isArray(recRes.data)) {
      moduleState.records = recRes.data;
    }
    if (!setRes.error && setRes.data) {
      moduleState.settings = {
        garmin_auto_sync_scale: setRes.data.garmin_auto_sync_scale !== false,
        weigh_in_reminder_enabled: setRes.data.weigh_in_reminder_enabled !== false,
        weigh_in_interval_days: Number(setRes.data.weigh_in_interval_days || 3),
        weigh_in_reminder_time: setRes.data.weigh_in_reminder_time || "08:00",
      };
    }

    renderAll();
    syncWeighInReminder();
  }

  async function consumeSharedScaleImageIfAny() {
    try {
      const url = new URL(window.location.href);
      const hasQuery = url.searchParams.has("shared_scale");
      if (hasQuery) {
        url.searchParams.delete("shared_scale");
        window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      }

      if (!("caches" in window)) return;
      const cache = await caches.open(SHARE_CACHE_NAME);
      const match = await cache.match(SHARE_IMAGE_KEY);
      if (!match) return;

      await cache.delete(SHARE_IMAGE_KEY);
      const blob = await match.blob();
      if (!blob || blob.size < 50) return;

      const fileObj =
        typeof File !== "undefined"
          ? new File([blob], "shared-scale.jpg", { type: blob.type || "image/jpeg" })
          : blob;
      await handleScreenshotSelected(fileObj);
    } catch (_) {}
  }

  async function checkNativeSharedImage() {
    try {
      if (!moduleState.auth?.authenticated) return false;
      const bridge = window.GarminNativeShare;
      if (!bridge || typeof bridge.consumeSharedImage !== "function") return false;
      const b64 = bridge.consumeSharedImage();
      if (!b64 || String(b64).length < 100) return false;
      await processScaleBase64(String(b64), "image/jpeg");
      return true;
    } catch (_) {
      return false;
    }
  }

  function bindGlobalEscOnce() {
    if (moduleState.escListenerAttached) return;
    moduleState.escListenerAttached = true;
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        const aiModal = document.getElementById("body-ai-modal");
        if (aiModal?.classList.contains("open")) {
          dismissBodyAiModal();
          return;
        }
        const modal = document.getElementById("body-metric-modal");
        if (modal?.classList.contains("open")) closeBodyMetricModal();
      }
    });
  }

  async function initForUser(auth, sbClient) {
    moduleState.auth = auth || null;
    moduleState.sbClient = sbClient || null;
    bindFileInputOnce();
    bindGlobalEscOnce();
    if (!auth?.authenticated || !auth?.userId || !sbClient) return;
    await refresh();
    await consumeSharedScaleImageIfAny();
    await checkNativeSharedImage();
  }

  function reset() {
    moduleState.auth = null;
    moduleState.records = [];
    moduleState.activeAiNotificationId = null;
    moduleState.analyzingAi = false;
    if (moduleState.donutChart) {
      moduleState.donutChart.destroy();
      moduleState.donutChart = null;
    }
    if (moduleState.detailChart) {
      moduleState.detailChart.destroy();
      moduleState.detailChart = null;
    }
    closeQuickAddSheet();
    closeScaleModal();
    closeBodyMetricModal();
    dismissBodyAiModal();
    renderAll();
  }

  function openQuickAddSheet() {
    const sheet = document.getElementById("quick-add-sheet");
    if (sheet) sheet.classList.add("open");
  }

  function closeQuickAddSheet() {
    const sheet = document.getElementById("quick-add-sheet");
    if (sheet) sheet.classList.remove("open");
  }

  function openScaleModal(prefill, source) {
    moduleState.modalSource = source === "screenshot_ai" ? "screenshot_ai" : "manual";
    const srcBadge = document.getElementById("scale-modal-source-badge");
    if (srcBadge) {
      srcBadge.textContent = moduleState.modalSource === "screenshot_ai" ? "📷 AI Görsel Okuma" : "✏️ Manuel Giriş";
      srcBadge.className = `badge ${moduleState.modalSource === "screenshot_ai" ? "badge-info" : "badge-ok"}`;
    }

    const d = prefill || {};
    setInputVal("sc-measured-at", toLocalDatetimeInputValue(d.measured_at || null));
    setInputVal("sc-weight", d.weight_kg);
    setInputVal("sc-bmi", d.bmi);
    setInputVal("sc-fat", d.body_fat_pct);
    setInputVal("sc-muscle", d.muscle_mass_kg);
    setInputVal("sc-bone", d.bone_mass_kg);
    setInputVal("sc-water", d.body_water_pct);
    setInputVal("sc-visceral", d.visceral_fat);
    setInputVal("sc-met-age", d.metabolic_age);
    setInputVal("sc-bmr", d.bmr_kcal);
    setInputVal("sc-protein", d.protein_pct);

    const loadingEl = document.getElementById("scale-ai-loading");
    if (loadingEl) loadingEl.classList.add("hidden");

    const modal = document.getElementById("scale-review-modal");
    if (modal) modal.classList.add("open");
  }

  function closeScaleModal() {
    const modal = document.getElementById("scale-review-modal");
    if (modal) modal.classList.remove("open");
  }

  function openManualModal() {
    closeQuickAddSheet();
    openScaleModal({}, "manual");
  }

  function triggerScreenshotUpload() {
    closeQuickAddSheet();
    bindFileInputOnce();
    const input = document.getElementById("scale-screenshot-input");
    if (input) input.click();
  }

  async function processScaleBase64(base64, mimeType = "image/jpeg") {
    if (!base64) return;
    openScaleModal({}, "screenshot_ai");
    const loadingEl = document.getElementById("scale-ai-loading");
    const saveBtn = document.getElementById("btn-scale-save");
    if (loadingEl) {
      loadingEl.textContent = "⏳ Honor Scale 2 ekran görüntüsü yapay zeka ile okunuyor (görsel sunucuya kaydedilmez)...";
      loadingEl.classList.remove("hidden");
    }
    if (saveBtn) saveBtn.disabled = true;

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Oturum bulunamadı. Lütfen yeniden giriş yapın.");

      const res = await fetch(PARSE_SCALE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ image_base64: base64, mime_type: mimeType }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error || "Görsel ayrıştırılamadı.");
      }

      openScaleModal(json.data, "screenshot_ai");
      toast("✓ Değerler okundu — kontrol edip Kaydet'e basın.");
    } catch (err) {
      if (loadingEl) loadingEl.classList.add("hidden");
      toast(`Okuma hatası: ${err.message} · Değerleri elle girebilirsiniz.`);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function handleScreenshotSelected(file) {
    if (!file) return;
    openScaleModal({}, "screenshot_ai");
    const loadingEl = document.getElementById("scale-ai-loading");
    const saveBtn = document.getElementById("btn-scale-save");
    if (loadingEl) {
      loadingEl.textContent = "⏳ Görsel hazırlanıyor...";
      loadingEl.classList.remove("hidden");
    }
    if (saveBtn) saveBtn.disabled = true;

    try {
      const { base64, mimeType } = await fileToResizedJpegBase64(file);
      await processScaleBase64(base64, mimeType);
    } catch (err) {
      if (loadingEl) loadingEl.classList.add("hidden");
      if (saveBtn) saveBtn.disabled = false;
      toast(`Okuma hatası: ${err.message} · Değerleri elle girebilirsiniz.`);
    }
  }

  function bindFileInputOnce() {
    const input = document.getElementById("scale-screenshot-input");
    if (!input || input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("change", (ev) => {
      const file = ev.target?.files?.[0];
      input.value = "";
      if (file) handleScreenshotSelected(file);
    });
  }

  async function saveModal(ev) {
    ev.preventDefault();
    if (!moduleState.sbClient || !moduleState.auth?.userId) {
      toast("Önce giriş yapmanız gerekir.");
      return;
    }

    const weightKg = parseOptionalNumber("sc-weight");
    if (weightKg == null || weightKg < 20 || weightKg > 300) {
      toast("Lütfen geçerli bir kilo değeri (kg) girin.");
      return;
    }

    const measuredInput = document.getElementById("sc-measured-at")?.value;
    let measuredAtIso = new Date().toISOString();
    if (measuredInput) {
      const dt = new Date(`${measuredInput}:00+03:00`);
      if (!Number.isNaN(dt.getTime())) measuredAtIso = dt.toISOString();
    }

    const saveBtn = document.getElementById("btn-scale-save");
    if (saveBtn) saveBtn.disabled = true;

    try {
      const row = {
        user_id: moduleState.auth.userId,
        measured_at: measuredAtIso,
        weight_kg: weightKg,
        bmi: parseOptionalNumber("sc-bmi"),
        body_fat_pct: parseOptionalNumber("sc-fat"),
        muscle_mass_kg: parseOptionalNumber("sc-muscle"),
        bone_mass_kg: parseOptionalNumber("sc-bone"),
        body_water_pct: parseOptionalNumber("sc-water"),
        visceral_fat: parseOptionalNumber("sc-visceral"),
        metabolic_age: parseOptionalNumber("sc-met-age", true),
        bmr_kcal: parseOptionalNumber("sc-bmr", true),
        protein_pct: parseOptionalNumber("sc-protein"),
        source: moduleState.modalSource,
        garmin_synced: false,
        garmin_synced_at: null,
        garmin_sync_error: null,
      };

      const { error } = await moduleState.sbClient.from("body_composition").insert(row);
      if (error) throw error;

      closeScaleModal();
      await refresh();
      toast("✓ Ölçüm kaydedildi · Garmin Connect aktarımı sıraya alındı.");
      document.querySelector('[data-tab="body"]')?.click();
      requestBodyAiCommentary({ auto: true });
    } catch (err) {
      toast(`Kayıt hatası: ${err.message}`);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function deleteRecord(id) {
    if (!id || !moduleState.sbClient || !moduleState.auth?.userId) return;
    if (!window.confirm("Bu tartı ölçümünü silmek istediğine emin misin?")) return;
    try {
      const { error } = await moduleState.sbClient
        .from("body_composition")
        .delete()
        .eq("id", id)
        .eq("user_id", moduleState.auth.userId);
      if (error) throw error;
      await refresh();
      toast("Ölçüm silindi.");
    } catch (err) {
      toast(`Silme hatası: ${err.message}`);
    }
  }

  async function saveSettings() {
    if (!moduleState.sbClient || !moduleState.auth?.userId) return;

    const nextSettings = {
      user_id: moduleState.auth.userId,
      garmin_auto_sync_scale: Boolean(document.getElementById("toggle-scale-auto-sync")?.checked),
      weigh_in_reminder_enabled: Boolean(document.getElementById("toggle-weigh-reminder")?.checked),
      weigh_in_interval_days: Number(document.getElementById("inp-weigh-interval")?.value || 3),
      weigh_in_reminder_time: String(document.getElementById("inp-weigh-time")?.value || "08:00"),
      updated_at: new Date().toISOString(),
    };

    moduleState.settings = {
      garmin_auto_sync_scale: nextSettings.garmin_auto_sync_scale,
      weigh_in_reminder_enabled: nextSettings.weigh_in_reminder_enabled,
      weigh_in_interval_days: nextSettings.weigh_in_interval_days,
      weigh_in_reminder_time: nextSettings.weigh_in_reminder_time,
    };
    renderScaleSettings();

    try {
      const { error } = await moduleState.sbClient
        .from("user_settings")
        .upsert(nextSettings, { onConflict: "user_id" });
      if (error) throw error;
      await syncWeighInReminder();
      toast("✓ Tartı & bildirim ayarları kaydedildi.");
    } catch (err) {
      toast(`Ayar kayıt hatası: ${err.message}`);
    }
  }

  async function retryPendingSync() {
    if (!moduleState.sbClient || !moduleState.auth?.userId) return;
    try {
      const errIds = moduleState.records.filter((r) => !r.garmin_synced && r.garmin_sync_error).map((r) => r.id);
      if (errIds.length > 0) {
        const { error } = await moduleState.sbClient
          .from("body_composition")
          .update({ garmin_sync_error: null })
          .in("id", errIds)
          .eq("user_id", moduleState.auth.userId);
        if (error) throw error;
        await refresh();
        toast(`↻ ${errIds.length} hatalı kayıt tekrar gönderim kuyruğuna alındı (sıradaki Garmin Sync işinde aktarılacak).`);
      } else {
        await refresh();
        const pendingCount = moduleState.records.filter((r) => !r.garmin_synced).length;
        toast(
          pendingCount > 0
            ? `⏳ ${pendingCount} ölçüm aktarım bekliyor (zamanlanmış veya manuel GitHub Actions Garmin Sync işini bekliyor).`
            : "✓ Tüm tartı ölçümleri Garmin Connect ile senkronize."
        );
      }
    } catch (err) {
      toast(`Yeniden deneme hatası: ${err.message}`);
    }
  }

  function renderBodyAiModalContent(analysis, fromHistory = false) {
    const titleEl = document.getElementById("body-ai-title");
    const metaEl = document.getElementById("body-ai-meta");
    const bodyEl = document.getElementById("body-ai-body");
    const hintEl = document.getElementById("body-ai-hint");
    const ackBtn = document.getElementById("btn-body-ai-ack");
    if (!bodyEl) return;

    if (titleEl) titleEl.textContent = analysis?.title || "✨ Vücut Kompozisyonu YZ Yorumu";

    const metaParts = [];
    if (analysis?.height_cm) metaParts.push(`Tahmini Boy ~${analysis.height_cm} cm`);
    if (analysis?.weight_kg != null) metaParts.push(`${fmtTr(analysis.weight_kg, 1)} kg`);
    if (analysis?.bmi != null) metaParts.push(`VKİ ${fmtTr(analysis.bmi, 1)}`);
    if (analysis?.measured_at) metaParts.push(fmtDateShort(analysis.measured_at));
    if (metaEl) metaEl.textContent = metaParts.join(" · ") || "Boy, kilo ve son tartı verilerine göre analiz";

    const sections = [];
    if (analysis?.summary) {
      sections.push(`<p class="body-ai-summary">${esc(analysis.summary)}</p>`);
    }
    if (Array.isArray(analysis?.highlights) && analysis.highlights.length > 0) {
      sections.push(`
        <div class="body-ai-section-title">Öne Çıkanlar</div>
        <ul class="body-ai-list">
          ${analysis.highlights.map((item) => `<li>${esc(item)}</li>`).join("")}
        </ul>`);
    }
    if (Array.isArray(analysis?.actions) && analysis.actions.length > 0) {
      sections.push(`
        <div class="body-ai-section-title">Öneriler</div>
        <ul class="body-ai-list actions">
          ${analysis.actions.map((item) => `<li>${esc(item)}</li>`).join("")}
        </ul>`);
    }
    bodyEl.innerHTML = sections.join("") || `<p class="card-sub">Yorum içeriği bulunamadı.</p>`;

    if (hintEl) {
      hintEl.textContent = fromHistory
        ? "🔔 Bildirimler geçmişinden açıldı."
        : "🔔 Bu yorum Bildirimler altına da kaydedilir.";
    }
    if (ackBtn) {
      ackBtn.disabled = false;
      ackBtn.textContent = fromHistory ? "Kapat" : "✓ Okudum · Bildirimlere Al";
    }
  }

  function dismissBodyAiModal() {
    const modal = document.getElementById("body-ai-modal");
    if (modal) modal.classList.remove("open");
  }

  async function acknowledgeBodyAiModal() {
    const notifId = moduleState.activeAiNotificationId;
    moduleState.activeAiNotificationId = null;
    dismissBodyAiModal();

    if (notifId && moduleState.sbClient && moduleState.auth?.userId) {
      try {
        await moduleState.sbClient
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", notifId)
          .eq("user_id", moduleState.auth.userId);
      } catch (_) {}
      await window.refreshNotifications?.();
      toast("🔔 Vücut YZ yorumu Bildirimler altına alındı.");
    }
  }

  function openSavedBodyAiCommentary(notif) {
    if (!notif) return;
    const modal = document.getElementById("body-ai-modal");
    const ackBtn = document.getElementById("btn-body-ai-ack");
    moduleState.activeAiNotificationId = null;
    if (modal) modal.classList.add("open");
    if (ackBtn) ackBtn.disabled = false;

    const p = notif.payload || {};
    renderBodyAiModalContent(
      {
        title: notif.title,
        summary: p.summary || notif.body,
        highlights: Array.isArray(p.highlights) ? p.highlights : [],
        actions: Array.isArray(p.actions) ? p.actions : [],
        height_cm: p.height_cm ?? null,
        weight_kg: p.weight_kg ?? null,
        bmi: p.bmi ?? null,
        measured_at: p.measured_at || notif.created_at,
      },
      true
    );
  }

  async function requestBodyAiCommentary(opts = {}) {
    const isAuto = Boolean(opts?.auto);
    if (!moduleState.records.length) {
      if (!isAuto) toast("Yorumlamak için önce en az bir vücut ölçümü ekleyin.");
      return;
    }
    if (moduleState.analyzingAi) return;

    moduleState.analyzingAi = true;
    const triggerBtn = document.getElementById("btn-body-ai-commentary");
    const modal = document.getElementById("body-ai-modal");
    const titleEl = document.getElementById("body-ai-title");
    const metaEl = document.getElementById("body-ai-meta");
    const bodyEl = document.getElementById("body-ai-body");
    const hintEl = document.getElementById("body-ai-hint");
    const ackBtn = document.getElementById("btn-body-ai-ack");

    if (triggerBtn) triggerBtn.disabled = true;

    if (!isAuto) {
      moduleState.activeAiNotificationId = null;
      if (titleEl) titleEl.textContent = "✨ Vücut Kompozisyonu YZ Yorumu";
      if (metaEl) metaEl.textContent = "Boy, kilo ve son tartı verilerine göre analiz hazırlanıyor";
      if (bodyEl) {
        bodyEl.innerHTML = `<div class="body-ai-loading">⏳ Boy, kilo ve vücut kompozisyonu verilerin yapay zeka ile yorumlanıyor...</div>`;
      }
      if (hintEl) hintEl.textContent = "🔔 Hazır olunca Bildirimler altına da kaydedilecek.";
      if (ackBtn) {
        ackBtn.disabled = true;
        ackBtn.textContent = "Hazırlanıyor...";
      }
      if (modal) modal.classList.add("open");
    }

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Oturum bulunamadı. Lütfen yeniden giriş yapın.");

      const hM = inferHeightM();
      const res = await fetch(PARSE_SCALE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "analyzeBodyComposition",
          height_cm: hM ? Math.round(hM * 100) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.analysis) {
        throw new Error(json.error || "YZ yorumu oluşturulamadı.");
      }

      moduleState.activeAiNotificationId = json.notification_id || null;
      renderBodyAiModalContent(json.analysis, false);
      if (modal) modal.classList.add("open");
      await window.refreshNotifications?.();
    } catch (err) {
      moduleState.activeAiNotificationId = null;
      if (!isAuto) {
        if (bodyEl) {
          bodyEl.innerHTML = `<p class="card-sub" style="color:var(--red);">⚠️ ${esc(err.message)}</p>`;
        }
        if (hintEl) hintEl.textContent = "Lütfen daha sonra tekrar deneyin.";
        if (ackBtn) {
          ackBtn.disabled = false;
          ackBtn.textContent = "Kapat";
        }
      } else {
        toast(`YZ yorumu alınamadı: ${err.message}`);
      }
    } finally {
      moduleState.analyzingAi = false;
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  function onTabShown() {
    renderStructureDonut();
    if (moduleState.donutChart) {
      try {
        moduleState.donutChart.resize();
      } catch (_) {}
    }
  }

  window.openQuickAddSheet = openQuickAddSheet;
  window.closeQuickAddSheet = closeQuickAddSheet;
  window.triggerScaleScreenshotUpload = triggerScreenshotUpload;
  window.openManualScaleModal = openManualModal;
  window.closeScaleReviewModal = closeScaleModal;
  window.submitScaleReviewModal = saveModal;
  window.deleteBodyComposition = deleteRecord;
  window.saveScaleSettings = saveSettings;
  window.retryPendingScaleSync = retryPendingSync;
  window.openBodyMetricModal = openBodyMetricModal;
  window.closeBodyMetricModal = closeBodyMetricModal;
  window.setBodyDetailRange = setBodyDetailRange;
  window.requestBodyAiCommentary = requestBodyAiCommentary;
  window.acknowledgeBodyAiModal = acknowledgeBodyAiModal;
  window.dismissBodyAiModal = dismissBodyAiModal;
  window.openSavedBodyAiCommentary = openSavedBodyAiCommentary;

  window.GarminBodyScale = {
    initForUser,
    reset,
    refresh,
    onTabShown,
    openQuickAddSheet,
    closeQuickAddSheet,
    openManualModal,
    triggerScreenshotUpload,
    closeScaleModal,
    openBodyMetricModal,
    closeBodyMetricModal,
    requestBodyAiCommentary,
    openSavedBodyAiCommentary,
    checkNativeSharedImage,
  };
})();
