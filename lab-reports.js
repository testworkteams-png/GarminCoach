(function () {
  "use strict";

  const SUPABASE_URL = "https://htooqswstuuzslvrgxsx.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5_1RDXV8unnW9ttkHEA_HQ_n8fJrt4I";
  const PARSE_URL = `${SUPABASE_URL}/functions/v1/parse-lab-report`;

  const st = {
    auth: null,
    sb: null,
    reports: [], // { ...report, results: [] }
    draft: null, // { report_date, lab_name, source, rows: [] }
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
    const latest = st.reports[0];
    if (!latest) {
      el.innerHTML = `<div class="auth-hint-box">Henüz tahlil eklenmedi. PDF veya fotoğraf yükleyerek başla.</div>`;
      if (badge) { badge.className = "badge badge-info"; badge.textContent = "Boş"; }
      return;
    }
    const abnormal = latest.results.filter((r) => ["low", "high"].includes(flagOf(r)));
    if (badge) {
      badge.className = `badge ${abnormal.length ? "badge-warn" : "badge-ok"}`;
      badge.textContent = abnormal.length ? `${abnormal.length} sınır dışı` : "Hepsi normal";
    }
    el.innerHTML = `
      <div class="lab-latest-head">Son tahlil: <strong>${fmtDate(latest.report_date)}</strong>${latest.lab_name ? " · " + esc(latest.lab_name) : ""} · ${latest.results.length} değer</div>
      ${abnormal.length
        ? `<div class="lab-abn-list">${abnormal
            .map((r) => `<span class="lab-chip ${flagOf(r)}">${flagOf(r) === "high" ? "▲" : "▼"} ${esc(r.test_name)}: ${r.value} ${esc(r.unit || "")}</span>`)
            .join("")}</div>`
        : `<div class="card-sub">Referans aralığı belirtilen tüm değerler normal.</div>`}`;
  }

  function allTestNames() {
    const set = new Set();
    st.reports.forEach((rp) => rp.results.forEach((r) => set.add(r.test_name)));
    return [...set].sort((a, b) => a.localeCompare(b, "tr"));
  }

  function renderTrend() {
    const sel = document.getElementById("lab-test-select");
    const canvasWrap = document.getElementById("lab-trend-wrap");
    if (!sel || !canvasWrap) return;
    const names = allTestNames();
    const prev = sel.value;
    sel.innerHTML = names.length
      ? names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("")
      : `<option value="">Veri yok</option>`;
    if (prev && names.includes(prev)) sel.value = prev;
    canvasWrap.style.display = names.length ? "" : "none";
    if (!names.length) {
      if (st.chart) { st.chart.destroy(); st.chart = null; }
      return;
    }
    drawTrend(sel.value);
  }

  function drawTrend(name) {
    const canvas = document.getElementById("lab-trend-chart");
    const info = document.getElementById("lab-trend-info");
    if (!canvas || !window.Chart) return;
    const pts = st.reports
      .map((rp) => {
        const r = rp.results.find((x) => x.test_name === name);
        return r ? { date: rp.report_date, r } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (st.chart) st.chart.destroy();
    const last = pts[pts.length - 1];
    const datasets = [
      { label: `${name}${last?.r.unit ? " (" + last.r.unit + ")" : ""}`, data: pts.map((p) => Number(p.r.value)), borderColor: "#34d399", backgroundColor: "rgba(52,211,153,0.15)", tension: 0.3, pointRadius: 4, fill: false },
    ];
    if (last?.r.ref_high != null) datasets.push({ label: "Üst sınır", data: pts.map(() => Number(last.r.ref_high)), borderColor: "rgba(248,113,113,0.6)", borderDash: [5, 4], pointRadius: 0, fill: false });
    if (last?.r.ref_low != null) datasets.push({ label: "Alt sınır", data: pts.map(() => Number(last.r.ref_low)), borderColor: "rgba(251,191,36,0.6)", borderDash: [5, 4], pointRadius: 0, fill: false });
    st.chart = new window.Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: pts.map((p) => fmtDate(p.date)), datasets },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#9fb0c8", boxWidth: 12 } } }, scales: { x: { ticks: { color: "#9fb0c8" } }, y: { ticks: { color: "#9fb0c8" } } } },
    });
    if (info) {
      info.textContent = pts.length > 1
        ? `${pts.length} ölçüm · Son: ${last.r.value} ${last.r.unit || ""} (önceki: ${pts[pts.length - 2].r.value})`
        : `${pts.length} ölçüm · Son: ${last.r.value} ${last.r.unit || ""}`;
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
        const rows = rp.results
          .map((r) => {
            const f = flagOf(r);
            return `<tr class="lab-${f}"><td>${esc(r.test_name)}</td><td class="mono"><b>${r.value}</b> ${esc(r.unit || "")}</td><td class="mono">${esc(refText(r))}</td><td>${f === "high" ? "▲ Yüksek" : f === "low" ? "▼ Düşük" : f === "ok" ? "✓" : ""}</td></tr>`;
          })
          .join("");
        return `
        <details class="lab-report">
          <summary>
            <span><strong>${fmtDate(rp.report_date)}</strong>${rp.lab_name ? " · " + esc(rp.lab_name) : ""}</span>
            <span class="badge badge-info mono">${rp.results.length} değer</span>
          </summary>
          <div class="lab-table-wrap"><table class="lab-table"><thead><tr><th>Test</th><th>Sonuç</th><th>Referans</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
          <div style="text-align:right; margin-top:8px;"><button type="button" class="btn btn-sm" onclick="deleteLabReport('${rp.id}')">🗑 Raporu Sil</button></div>
        </details>`;
      })
      .join("");
  }

  function renderAll() {
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
    (res.data || []).forEach((r) => (byReport[r.report_id] = byReport[r.report_id] || []).push(r));
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
      <td><input type="text" class="lab-in-name" value="${esc(r.name)}" /></td>
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
      rows.push({ name: g(".lab-in-name"), value: n(".lab-in-value"), unit: g(".lab-in-unit") || null, ref_low: n(".lab-in-lo"), ref_high: n(".lab-in-hi") });
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
      badge.textContent = st.draft.source === "ai" ? "🤖 AI Okuma" : "✏️ Manuel";
      badge.className = `badge ${st.draft.source === "ai" ? "badge-info" : "badge-ok"}`;
    }
  }

  function openModal(draft) {
    if (!st.auth?.authenticated) return toast("Önce giriş yapmalısın.");
    window.closeQuickAddSheet?.();
    st.draft = draft || { report_date: null, lab_name: "", source: "manual", rows: [{ name: "", value: null, unit: "", ref_low: null, ref_high: null }] };
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
    st.draft.rows.push({ name: "", value: null, unit: "", ref_low: null, ref_high: null });
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
        rows.map((r) => ({ user_id: st.auth.userId, report_id: rep.id, test_name: r.name, value: r.value, unit: r.unit, ref_low: r.ref_low, ref_high: r.ref_high })),
      );
      if (e2) {
        await st.sb.from("lab_reports").delete().eq("id", rep.id);
        throw e2;
      }
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

  async function handleFile(file) {
    if (!file || st.parsing) return;
    if (!st.auth?.authenticated) return toast("Önce giriş yapmalısın.");
    st.parsing = true;
    const status = document.getElementById("lab-upload-status");
    if (status) {
      status.textContent = "⏳ Rapor yapay zeka ile okunuyor (dosya sunucuda saklanmaz)...";
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
      toast("✓ Değerler okundu — kontrol edip Kaydet'e bas.");
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

  // E-Nabız vb. uygulamalardan "Paylaş → GarminCoach" ile gelen PDF (Android APK)
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
      selEl.addEventListener("change", (e) => drawTrend(e.target.value));
    }
    renderAll();
    if (!auth?.authenticated || !auth?.userId || !sb) return;
    await refresh();
    await checkNativeSharedPdf();
  }

  function reset() {
    st.auth = null;
    st.reports = [];
    closeModal();
    if (st.chart) { st.chart.destroy(); st.chart = null; }
    renderAll();
  }

  window.triggerLabUpload = triggerUpload;
  window.openLabModal = () => openModal();
  window.closeLabModal = closeModal;
  window.addLabDraftRow = addRow;
  window.removeLabDraftRow = removeRow;
  window.submitLabModal = saveDraft;
  window.deleteLabReport = removeReport;
  window.GarminLabs = { initForUser, reset, refresh, checkNativeSharedPdf };
})();
