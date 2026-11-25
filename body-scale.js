(function () {
  "use strict";

  const SUPABASE_URL = "https://htooqswstuuzslvrgxsx.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5_1RDXV8unnW9ttkHEA_HQ_n8fJrt4I";
  const PARSE_SCALE_URL = `${SUPABASE_URL}/functions/v1/parse-scale-screenshot`;
  const WEIGH_IN_NOTIF_ID = 202602;

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
    chart: null,
    modalSource: "manual",
    parsing: false,
    listenerAttached: false,
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

  function renderLatestSummary() {
    const gridEl = document.getElementById("body-latest-grid");
    const metaEl = document.getElementById("body-latest-meta");
    const extraEl = document.getElementById("body-latest-extras");
    const badgeEl = document.getElementById("body-latest-sync-badge");
    if (!gridEl) return;

    const latest = moduleState.records[0];
    if (!latest) {
      gridEl.innerHTML = `<p class="card-sub" style="grid-column:1/-1;">Henüz vücut ölçümü kaydı yok. Ortadaki <strong>＋</strong> butonundan Honor Scale 2 ekran görüntüsü yükleyebilir veya manuel ölçüm ekleyebilirsin.</p>`;
      if (metaEl) metaEl.textContent = "İlk ölçüm bekleniyor";
      if (extraEl) extraEl.innerHTML = "";
      if (badgeEl) {
        badgeEl.className = "badge badge-info";
        badgeEl.textContent = "Kayıt Yok";
      }
      return;
    }

    if (metaEl) {
      metaEl.textContent = `Son ölçüm: ${fmtDateShort(latest.measured_at)} · ${latest.source === "screenshot_ai" ? "📷 AI Ekran Görüntüsü" : "✏️ Manuel Giriş"}`;
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

    const prev = moduleState.records[1] || null;
    const fmtDelta = (cur, old, unit, invertGood = false) => {
      if (cur == null || old == null) return "";
      const d = Number((Number(cur) - Number(old)).toFixed(1));
      if (d === 0) return `<span class="body-delta neutral">Değişim yok</span>`;
      const pos = d > 0;
      const good = invertGood ? !pos : pos;
      return `<span class="body-delta ${good ? "good" : "warn"}">${pos ? "+" : ""}${d} ${unit}</span>`;
    };

    const cards = [
      {
        label: "Kilo",
        val: latest.weight_kg != null ? `${Number(latest.weight_kg).toFixed(1)}` : "--",
        unit: "kg",
        color: "var(--emerald)",
        delta: fmtDelta(latest.weight_kg, prev?.weight_kg, "kg", true),
      },
      {
        label: "Yağ Oranı",
        val: latest.body_fat_pct != null ? `${Number(latest.body_fat_pct).toFixed(1)}` : "--",
        unit: "%",
        color: "var(--amber)",
        delta: fmtDelta(latest.body_fat_pct, prev?.body_fat_pct, "%", true),
      },
      {
        label: "Kas Kütlesi",
        val: latest.muscle_mass_kg != null ? `${Number(latest.muscle_mass_kg).toFixed(1)}` : "--",
        unit: "kg",
        color: "var(--cyan)",
        delta: fmtDelta(latest.muscle_mass_kg, prev?.muscle_mass_kg, "kg", false),
      },
      {
        label: "İç Organ Yağı",
        val: latest.visceral_fat != null ? `${Number(latest.visceral_fat).toFixed(0)}` : "--",
        unit: "svy",
        color: "var(--purple)",
        delta: fmtDelta(latest.visceral_fat, prev?.visceral_fat, "", true),
      },
    ];

    gridEl.innerHTML = cards
      .map(
        (c) => `
      <div class="body-kpi-card">
        <div class="body-kpi-lbl">${esc(c.label)}</div>
        <div class="body-kpi-val mono" style="color:${c.color};">${esc(c.val)} <span class="body-kpi-unit">${esc(c.unit)}</span></div>
        ${c.delta}
      </div>`
      )
      .join("");

    if (extraEl) {
      const chips = [];
      if (latest.bmi != null) chips.push(`VKİ ${Number(latest.bmi).toFixed(1)}`);
      if (latest.body_water_pct != null) chips.push(`Su %${Number(latest.body_water_pct).toFixed(1)}`);
      if (latest.bone_mass_kg != null) chips.push(`Kemik ${Number(latest.bone_mass_kg).toFixed(2)} kg`);
      if (latest.protein_pct != null) chips.push(`Protein %${Number(latest.protein_pct).toFixed(1)}`);
      if (latest.bmr_kcal != null) chips.push(`BMR ${latest.bmr_kcal} kcal`);
      if (latest.metabolic_age != null) chips.push(`Metabolik Yaş ${latest.metabolic_age}`);
      extraEl.innerHTML = chips.map((t) => `<span class="pill">${esc(t)}</span>`).join("");
    }
  }

  function renderChart() {
    const canvas = document.getElementById("bodyCompositionChart");
    if (!canvas || typeof Chart === "undefined") return;
    if (moduleState.chart) {
      moduleState.chart.destroy();
      moduleState.chart = null;
    }

    const series = [...moduleState.records].slice(0, 30).reverse();
    const emptyEl = document.getElementById("body-chart-empty");
    if (series.length === 0) {
      if (emptyEl) emptyEl.classList.remove("hidden");
      return;
    }
    if (emptyEl) emptyEl.classList.add("hidden");

    const isSunny = document.documentElement.getAttribute("data-theme") === "weather_sunny";
    const tickColor = isSunny ? "#334155" : "#94a3b8";
    const gridColor = isSunny ? "rgba(15,23,42,0.10)" : "rgba(148,163,184,0.10)";
    const legendColor = isSunny ? "#0b1220" : "#cbd5e1";

    moduleState.chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: series.map((r) => fmtChartDay(r.measured_at)),
        datasets: [
          {
            label: "Kilo (kg)",
            data: series.map((r) => r.weight_kg),
            borderColor: isSunny ? "#06634b" : "#00e5a3",
            backgroundColor: isSunny ? "rgba(6,99,75,0.12)" : "rgba(0,229,163,0.12)",
            tension: 0.32,
            borderWidth: 2.5,
            pointRadius: 3.5,
            spanGaps: true,
            yAxisID: "y",
          },
          {
            label: "Kas Kütlesi (kg)",
            data: series.map((r) => r.muscle_mass_kg),
            borderColor: isSunny ? "#075480" : "#38bdf8",
            backgroundColor: "transparent",
            tension: 0.32,
            borderWidth: 2.2,
            pointRadius: 3,
            spanGaps: true,
            yAxisID: "y",
          },
          {
            label: "Yağ Oranı (%)",
            data: series.map((r) => r.body_fat_pct),
            borderColor: isSunny ? "#9a3412" : "#f59e0b",
            backgroundColor: "transparent",
            borderDash: [5, 4],
            tension: 0.32,
            borderWidth: 2.2,
            pointRadius: 3,
            spanGaps: true,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: legendColor, boxWidth: 12, font: { size: 11 } } },
        },
        scales: {
          x: {
            ticks: { color: tickColor, font: { size: 10.5 } },
            grid: { color: gridColor },
          },
          y: {
            position: "left",
            ticks: { color: tickColor, font: { size: 10.5 } },
            grid: { color: gridColor },
            title: { display: true, text: "kg", color: tickColor, font: { size: 10 } },
          },
          y1: {
            position: "right",
            ticks: { color: isSunny ? "#9a3412" : "#f59e0b", font: { size: 10.5 } },
            grid: { drawOnChartArea: false },
            title: { display: true, text: "% Yağ", color: isSunny ? "#9a3412" : "#f59e0b", font: { size: 10 } },
          },
        },
      },
    });
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
    renderChart();
    renderHistoryList();
    renderScaleSettings();
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

  async function initForUser(auth, sbClient) {
    moduleState.auth = auth || null;
    moduleState.sbClient = sbClient || null;
    bindFileInputOnce();
    if (!auth?.authenticated || !auth?.userId || !sbClient) return;
    await refresh();
  }

  function reset() {
    moduleState.auth = null;
    moduleState.records = [];
    if (moduleState.chart) {
      moduleState.chart.destroy();
      moduleState.chart = null;
    }
    closeQuickAddSheet();
    closeScaleModal();
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

  async function handleScreenshotSelected(file) {
    if (!file) return;
    openScaleModal({}, "screenshot_ai");
    const loadingEl = document.getElementById("scale-ai-loading");
    const saveBtn = document.getElementById("btn-scale-save");
    if (loadingEl) {
      loadingEl.textContent = "⏳ Honor Scale 2 ekran görüntüsü yapay zeka ile okunuyor (görsel sunucuya kaydedilmez)...";
      loadingEl.classList.remove("hidden");
    }
    if (saveBtn) saveBtn.disabled = true;

    try {
      const { base64, mimeType } = await fileToResizedJpegBase64(file);
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

  function onTabShown() {
    renderChart();
    if (moduleState.chart) {
      try {
        moduleState.chart.resize();
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
  };
})();
