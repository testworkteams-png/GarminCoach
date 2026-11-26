(function () {
  "use strict";

  const SUPABASE_URL = "https://htooqswstuuzslvrgxsx.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5_1RDXV8unnW9ttkHEA_HQ_n8fJrt4I";
  const PARSE_URL = `${SUPABASE_URL}/functions/v1/parse-lab-report`;
  const NOTIF_BASE_ID = 303000; // 303000..303999 reserved for medication reminders

  const KIND_META = {
    medication: { icon: "💊", label: "İlaç" },
    supplement: { icon: "🧴", label: "Takviye" },
    vitamin: { icon: "🍊", label: "Vitamin" },
  };

  const PRESETS = {
    d3: { name: "D3 Vitamini", kind: "vitamin", dose: "2000 IU", purpose: "Vitamin D Desteği", times: "09:00", notes: "Kahvaltı sonrası tok karnına" },
    folat: { name: "Folat (B9)", kind: "vitamin", dose: "400 mcg", purpose: "Folat Desteği", times: "09:00", notes: "Sabah öğünü ile" },
    b12: { name: "Vitamin B12", kind: "vitamin", dose: "1000 mcg", purpose: "B12 Desteği", times: "09:00", notes: "Dil altı veya sabah" },
    mag: { name: "Magnezyum Glisinat", kind: "supplement", dose: "400 mg", purpose: "Kas & Uyku Desteği", times: "22:00", notes: "Uyumadan 1 saat önce" },
    omega3: { name: "Omega-3 (EPA/DHA)", kind: "supplement", dose: "1000 mg", purpose: "Kalp & Toparlanma", times: "13:00", notes: "Ana öğünle tok karnına" },
    demir: { name: "Demir", kind: "supplement", dose: "1 tablet", purpose: "Demir & Ferritin Desteği", times: "08:00", notes: "Aç karnına, kahveden ayrı" },
  };

  const st = {
    auth: null,
    sb: null,
    meds: [],
    logs: [], // son 30 gün + gelecek gün kontrolü
    selectedDate: null,
    editingId: null,
    scanDrafts: [],
    scanning: false,
    listenerAttached: false,
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

  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function todayStr() {
    return ymd(new Date());
  }

  function addDays(dateStr, days) {
    const [y, m, d] = String(dateStr || todayStr()).split("-").map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    dt.setDate(dt.getDate() + Number(days || 0));
    return ymd(dt);
  }

  function fmtDateTr(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = String(dateStr).slice(0, 10).split("-");
    return `${d}.${m}.${y}`;
  }

  function calcEndDate(startDate, durationDays) {
    const dur = Number(durationDays);
    if (!startDate || !Number.isFinite(dur) || dur < 1) return null;
    return addDays(startDate, Math.round(dur) - 1);
  }

  function isTaken(medId, date, slot) {
    return st.logs.some((l) => l.medication_id === medId && l.log_date === date && l.time_slot === slot);
  }

  function activeMeds() {
    return st.meds.filter((m) => m.active !== false);
  }

  function slotsOf(m) {
    return Array.isArray(m.times) && m.times.length ? [...m.times].sort() : ["09:00"];
  }

  function isMedScheduledOn(m, dateStr) {
    if (m.active === false || m.as_needed) return false;
    if (m.start_date && m.start_date > dateStr) return false;
    const effEnd = m.end_date || calcEndDate(m.start_date, m.duration_days);
    if (effEnd && effEnd < dateStr) return false;
    return true;
  }

  function slotsForDate(dateStr) {
    const rows = [];
    activeMeds().forEach((m) => {
      if (!isMedScheduledOn(m, dateStr)) return;
      slotsOf(m).forEach((slot) => rows.push({ med: m, slot, taken: isTaken(m.id, dateStr, slot) }));
    });
    rows.sort((a, b) => a.slot.localeCompare(b.slot) || a.med.name.localeCompare(b.med.name, "tr"));
    return rows;
  }

  function nowHHMM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  async function getToken() {
    let token = st.auth?.accessToken || null;
    try {
      const { data } = await st.sb.auth.getSession();
      if (data?.session?.access_token) token = data.session.access_token;
    } catch (_) {}
    return token;
  }

  // ---------- Render: Selected Day & PRN ----------
  function renderToday() {
    const listEl = document.getElementById("med-today-list");
    const badgeEl = document.getElementById("med-today-badge");
    const dayTitleEl = document.getElementById("med-selected-day-title");
    const prnWrap = document.getElementById("med-prn-wrap");
    const prnList = document.getElementById("med-prn-list");
    if (!listEl) return;

    const today = todayStr();
    const selDate = st.selectedDate || today;
    st.selectedDate = selDate;
    const isToday = selDate === today;
    const isFuture = selDate > today;

    if (dayTitleEl) {
      dayTitleEl.textContent = isToday
        ? `Bugünün Planı (${fmtDateTr(selDate)})`
        : `${fmtDateTr(selDate)} Planı${isFuture ? " (Yaklaşan)" : ""}`;
    }

    if (!st.auth?.authenticated) {
      listEl.innerHTML = `<div class="auth-hint-box">Giriş yaptıktan sonra ilaç ve takviye takibini kullanabilirsin.</div>`;
      if (prnWrap) prnWrap.classList.add("hidden");
      if (badgeEl) { badgeEl.className = "badge badge-info mono"; badgeEl.textContent = "--"; }
      return;
    }

    const rows = slotsForDate(selDate);
    const done = rows.filter((r) => r.taken).length;
    if (badgeEl) {
      badgeEl.textContent = rows.length ? `${done}/${rows.length}` : "Boş";
      badgeEl.className = `badge mono ${!rows.length ? "badge-info" : done === rows.length ? "badge-ok" : "badge-warn"}`;
    }

    if (!rows.length) {
      listEl.innerHTML = `<div class="auth-hint-box">${isToday ? "Bugün için düzenli ilaç/takviye yok. 📷 Etiket Tara veya ＋ Elle Ekle ile ekle." : "Bu tarih için planlı doz yok."}</div>`;
    } else {
      const now = nowHHMM();
      listEl.innerHTML = rows
        .map((r) => {
          const meta = KIND_META[r.med.kind] || KIND_META.supplement;
          const late = isToday && !r.taken && r.slot < now;
          const subParts = [r.med.purpose, r.med.dose || meta.label, r.med.notes].filter(Boolean);
          return `
          <div class="med-row ${r.taken ? "taken" : ""} ${late ? "late" : ""}">
            <button type="button" class="med-check" ${isFuture ? "disabled title='Gelecek tarih işaretlenemez'" : ""} aria-label="${r.taken ? "Geri al" : "Aldım"}"
              onclick="toggleMedTaken('${r.med.id}','${esc(r.slot)}')">${r.taken ? "✓" : ""}</button>
            <div class="med-row-body">
              <strong>${meta.icon} ${esc(r.med.name)}</strong>
              <span>${subParts.map(esc).join(" · ")}</span>
            </div>
            <span class="mono med-time">${esc(r.slot)}</span>
          </div>`;
        })
        .join("");
    }

    const prnMeds = activeMeds().filter((m) => m.as_needed && (!m.start_date || m.start_date <= selDate) && (!m.end_date || m.end_date >= selDate));
    if (prnWrap && prnList) {
      prnWrap.classList.toggle("hidden", !prnMeds.length);
      prnList.innerHTML = prnMeds
        .map((m) => {
          const takenPrn = isTaken(m.id, selDate, "PRN");
          const subParts = [m.purpose, m.dose, m.notes].filter(Boolean);
          return `
          <div class="med-row ${takenPrn ? "taken" : ""}">
            <button type="button" class="med-check" ${isFuture ? "disabled" : ""} aria-label="${takenPrn ? "Geri al" : "Aldım"}"
              onclick="toggleMedTaken('${m.id}','PRN')">${takenPrn ? "✓" : ""}</button>
            <div class="med-row-body">
              <strong>⚡ ${esc(m.name)}</strong>
              <span>${subParts.map(esc).join(" · ") || "Gerektiğinde kullan"}</span>
            </div>
            <span class="badge badge-info" style="font-size:10px;">Gerektiğinde</span>
          </div>`;
        })
        .join("");
    }
  }

  function renderWeek() {
    const el = document.getElementById("med-week-strip");
    const sumEl = document.getElementById("med-adherence");
    if (!el) return;

    const today = todayStr();
    const selDate = st.selectedDate || today;
    const days = [];
    for (let offset = -4; offset <= 2; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      days.push(d);
    }

    let plannedPastToday = 0;
    let takenPastToday = 0;
    const cells = days.map((d) => {
      const ds = ymd(d);
      const dayRows = slotsForDate(ds);
      const p = dayRows.length;
      const t = dayRows.filter((r) => r.taken).length;
      if (ds <= today) {
        plannedPastToday += p;
        takenPastToday += t;
      }
      const isFuture = ds > today;
      const pct = p ? Math.round((t / p) * 100) : null;
      const cls = isFuture ? "future" : pct === null ? "none" : pct >= 100 ? "full" : pct > 0 ? "part" : "miss";
      const selCls = ds === selDate ? "selected" : "";
      const wd = new Intl.DateTimeFormat("tr-TR", { weekday: "short" }).format(d);
      const numDay = d.getDate();
      const valTxt = isFuture ? (p ? `${p} doz` : "–") : (pct === null ? "–" : `${pct}%`);
      return `<button type="button" class="med-day ${cls} ${selCls}" onclick="selectMedDate('${ds}')" title="${fmtDateTr(ds)}: ${t}/${p}"><span>${esc(wd)} ${numDay}</span><b>${valTxt}</b></button>`;
    });

    el.innerHTML = cells.join("");
    if (sumEl) {
      sumEl.textContent = plannedPastToday
        ? `Son 5 gün uyum: %${Math.round((takenPastToday / plannedPastToday) * 100)} (${takenPastToday}/${plannedPastToday})`
        : "Günlere dokunarak ilaç planını görüntüle";
    }
  }

  function renderList() {
    const el = document.getElementById("med-list");
    const countEl = document.getElementById("med-count");
    if (!el) return;
    if (countEl) countEl.textContent = `${st.meds.length} kayıt`;
    if (!st.meds.length) {
      el.innerHTML = `<div class="auth-hint-box">Henüz ilaç veya takviye eklenmedi.</div>`;
      return;
    }
    el.innerHTML = st.meds
      .map((m) => {
        const meta = KIND_META[m.kind] || KIND_META.supplement;
        const remOn = m.reminder_enabled !== false && !m.as_needed;
        const effEnd = m.end_date || calcEndDate(m.start_date, m.duration_days);
        const durLabel = m.as_needed
          ? "⚡ Gerektiğinde"
          : effEnd
            ? `${fmtDateTr(m.start_date || todayStr())}–${fmtDateTr(effEnd)}`
            : slotsOf(m).map(esc).join(", ");
        const infoParts = [m.purpose, m.dose || meta.label, durLabel, m.notes].filter(Boolean);
        return `
        <div class="med-item ${m.active === false ? "inactive" : ""}">
          <div class="med-row-body">
            <strong>${meta.icon} ${esc(m.name)} <small>${esc(meta.label)}</small></strong>
            <span>${infoParts.map(esc).join(" · ")}</span>
          </div>
          <div class="med-item-actions">
            ${!m.as_needed ? `<button type="button" class="btn btn-sm" onclick="toggleMedReminder('${m.id}')" title="${remOn ? "Hatırlatıcıyı kapat" : "Hatırlatıcıyı aç"}">${remOn ? "🔔" : "🔕"}</button>` : ""}
            <button type="button" class="btn btn-sm" onclick="exportMedToCalendar('${m.id}')" title="Telefon Takvimine Ekle (.ics)">📅</button>
            <button type="button" class="btn btn-sm" onclick="toggleMedActive('${m.id}')" title="${m.active === false ? "Başlat" : "Durdur"}">${m.active === false ? "▶" : "⏸"}</button>
            <button type="button" class="btn btn-sm" onclick="openMedModal('${m.id}')" title="Düzenle">✏️</button>
            <button type="button" class="btn btn-sm" onclick="deleteMed('${m.id}')" title="Sil">🗑</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderAll() {
    renderToday();
    renderWeek();
    renderList();
  }

  async function refresh() {
    if (!st.sb || !st.auth?.userId) return;
    const uid = st.auth.userId;
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const [medRes, logRes] = await Promise.all([
      st.sb.from("medications").select("*").eq("user_id", uid).order("created_at", { ascending: true }),
      st.sb.from("medication_logs").select("*").eq("user_id", uid).gte("log_date", ymd(since)),
    ]);
    if (medRes.error) {
      toast("İlaç listesi alınamadı: " + medRes.error.message);
    } else {
      st.meds = medRes.data || [];
    }
    if (!logRes.error) st.logs = logRes.data || [];
    renderAll();
    syncReminders();
  }

  async function toggleTaken(medId, slot) {
    if (!st.sb || !st.auth?.userId) return;
    const date = st.selectedDate || todayStr();
    if (date > todayStr()) return toast("Gelecek tarih için işaretleme yapılamaz.");
    const existing = st.logs.find((l) => l.medication_id === medId && l.log_date === date && l.time_slot === slot);
    if (existing) {
      const { error } = await st.sb.from("medication_logs").delete().eq("id", existing.id).eq("user_id", st.auth.userId);
      if (error) return toast("Geri alınamadı: " + error.message);
      st.logs = st.logs.filter((l) => l.id !== existing.id);
    } else {
      const { data, error } = await st.sb
        .from("medication_logs")
        .insert({ user_id: st.auth.userId, medication_id: medId, log_date: date, time_slot: slot })
        .select()
        .single();
      if (error) return toast("Kaydedilemedi: " + error.message);
      st.logs.push(data);
      toast("✓ Alındı olarak işaretlendi");
    }
    renderToday();
    renderWeek();
    syncReminders();
  }

  async function toggleActive(id) {
    const m = st.meds.find((x) => x.id === id);
    if (!m) return;
    const next = m.active === false;
    const { error } = await st.sb.from("medications").update({ active: next }).eq("id", id).eq("user_id", st.auth.userId);
    if (error) return toast("Güncellenemedi: " + error.message);
    m.active = next;
    renderAll();
    syncReminders();
  }

  async function toggleReminder(id) {
    const m = st.meds.find((x) => x.id === id);
    if (!m) return;
    const next = m.reminder_enabled === false;
    const { error } = await st.sb.from("medications").update({ reminder_enabled: next }).eq("id", id).eq("user_id", st.auth.userId);
    if (error) return toast("Güncellenemedi: " + error.message);
    m.reminder_enabled = next;
    renderList();
    syncReminders();
    toast(next ? `🔔 ${m.name} hatırlatıcısı açıldı` : `🔕 ${m.name} hatırlatıcısı kapatıldı`);
  }

  async function removeMed(id) {
    const m = st.meds.find((x) => x.id === id);
    if (!m || !window.confirm(`"${m.name}" ve tüm geçmiş kayıtları silinsin mi?`)) return;
    const { error } = await st.sb.from("medications").delete().eq("id", id).eq("user_id", st.auth.userId);
    if (error) return toast("Silinemedi: " + error.message);
    st.meds = st.meds.filter((x) => x.id !== id);
    st.logs = st.logs.filter((l) => l.medication_id !== id);
    renderAll();
    syncReminders();
  }

  function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = v;
  }

  function setChecked(id, v) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(v);
  }

  function openModal(id) {
    if (!st.auth?.authenticated) return toast("Önce giriş yapmalısın.");
    window.closeQuickAddSheet?.();
    const m = id ? st.meds.find((x) => x.id === id) : null;
    st.editingId = m ? m.id : null;
    setVal("med-name", m?.name || "");
    setVal("med-dose", m?.dose || "");
    setVal("med-kind", m?.kind || "medication");
    setVal("med-purpose", m?.purpose || "");
    setVal("med-times", m ? slotsOf(m).join(", ") : "09:00");
    setVal("med-start-date", m?.start_date || todayStr());
    setVal("med-duration", m?.duration_days ?? "");
    setVal("med-notes", m?.notes || "");
    setChecked("med-as-needed", m?.as_needed);
    setChecked("med-reminder", m ? m.reminder_enabled !== false : true);
    const t = document.getElementById("med-modal-title");
    if (t) t.textContent = m ? "İlaç / Takviye Düzenle" : "İlaç / Takviye Ekle";
    document.getElementById("med-modal")?.classList.add("open");
  }

  function closeModal() {
    document.getElementById("med-modal")?.classList.remove("open");
    st.editingId = null;
  }

  function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    setVal("med-name", p.name);
    setVal("med-kind", p.kind);
    setVal("med-dose", p.dose);
    setVal("med-purpose", p.purpose);
    setVal("med-times", p.times);
    setVal("med-notes", p.notes);
    setChecked("med-as-needed", false);
    setChecked("med-reminder", true);
    toast(`✓ ${p.name} şablonu dolduruldu`);
  }

  function parseTimes(raw) {
    const out = String(raw || "")
      .split(/[,\s;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
        if (!m) return null;
        const h = Number(m[1]);
        const mi = Number(m[2] || 0);
        if (h > 23 || mi > 59) return null;
        return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
      });
    if (out.some((x) => x === null)) return null;
    return [...new Set(out)].sort();
  }

  async function submitModal(ev) {
    ev?.preventDefault();
    if (!st.sb || !st.auth?.userId) return;
    const name = document.getElementById("med-name")?.value.trim();
    if (!name) return toast("İlaç/takviye adı zorunlu.");
    const times = parseTimes(document.getElementById("med-times")?.value);
    if (!times || !times.length) return toast("Saatleri 09:00, 21:00 biçiminde yaz.");
    const startDate = document.getElementById("med-start-date")?.value || todayStr();
    const durVal = document.getElementById("med-duration")?.value.trim();
    const dur = durVal ? Math.max(1, Math.min(365, Math.round(Number(durVal)))) : null;
    const endDate = calcEndDate(startDate, dur);
    const asNeeded = Boolean(document.getElementById("med-as-needed")?.checked);
    const remEnabled = Boolean(document.getElementById("med-reminder")?.checked);

    const row = {
      name,
      dose: document.getElementById("med-dose")?.value.trim() || null,
      kind: document.getElementById("med-kind")?.value || "medication",
      purpose: document.getElementById("med-purpose")?.value.trim() || null,
      times,
      start_date: startDate,
      duration_days: dur,
      end_date: endDate,
      as_needed: asNeeded,
      reminder_enabled: asNeeded ? false : remEnabled,
      notes: document.getElementById("med-notes")?.value.trim() || null,
    };

    let error;
    if (st.editingId) {
      ({ error } = await st.sb.from("medications").update(row).eq("id", st.editingId).eq("user_id", st.auth.userId));
    } else {
      ({ error } = await st.sb.from("medications").insert({ ...row, user_id: st.auth.userId }));
    }
    if (error) return toast("Kaydedilemedi: " + error.message);
    closeModal();
    toast("💊 Kaydedildi");
    await refresh();
  }

  // ---------- AI Label Photo Scan + Multi-Item Review Modal ----------
  function resizeMedPhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Görsel okunamadı."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Görsel yüklenemedi."));
        img.onload = () => {
          const max = 1800;
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

  function showMedScanProgress(pct, step, subText, doneCount, errMsg) {
    const overlay = document.getElementById("lab-parse-overlay");
    if (!overlay) return;
    const icon = document.getElementById("lab-parse-icon");
    const title = document.getElementById("lab-parse-title");
    const meta = document.getElementById("lab-parse-filemeta");
    const fill = document.getElementById("lab-parse-bar-fill");
    const pctEl = document.getElementById("lab-parse-pct");
    const bar = document.getElementById("lab-parse-progressbar");
    const errBox = document.getElementById("lab-parse-error");
    const cancelBtn = document.getElementById("btn-lab-parse-cancel");
    const errBtns = document.getElementById("lab-parse-err-btns");

    const stepTexts = [
      "Etiket fotoğrafı hazırlandı",
      "Yapay zeka ilaç, doz ve saatleri okuyor",
      "Süre, aç/tok ve hatırlatma kuralları çıkarılıyor",
      "Kontrol ekranı açılıyor",
    ];
    document.querySelectorAll("#lab-parse-steps .lab-step-item").forEach((el) => {
      const s = Number(el.getAttribute("data-step") || 0);
      const span = el.querySelector("span:last-child");
      if (span && stepTexts[s - 1]) span.textContent = stepTexts[s - 1];
      el.classList.toggle("done", step > 4 || s < step);
      el.classList.toggle("active", step <= 4 && s === step);
    });

    if (fill) {
      fill.style.width = `${Math.round(pct)}%`;
      fill.classList.toggle("is-error", Boolean(errMsg));
    }
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    if (meta && subText) meta.textContent = subText;

    if (errMsg) {
      if (icon) { icon.textContent = "⚠️"; icon.className = "lab-parse-icon is-error"; }
      if (title) title.textContent = "Etiket Okunamadı";
      if (errBox) { errBox.textContent = errMsg; errBox.classList.remove("hidden"); }
      if (cancelBtn) cancelBtn.classList.add("hidden");
      if (errBtns) errBtns.classList.remove("hidden");
    } else if (doneCount != null) {
      if (icon) { icon.textContent = "✓"; icon.className = "lab-parse-icon is-done"; }
      if (title) title.textContent = `${doneCount} İlaç Okundu!`;
    } else {
      if (icon) { icon.textContent = "📷"; icon.className = "lab-parse-icon"; }
      if (title) title.textContent = "İlaç Etiketi Okunuyor";
      if (errBox) { errBox.textContent = ""; errBox.classList.add("hidden"); }
      if (cancelBtn) cancelBtn.classList.remove("hidden");
      if (errBtns) errBtns.classList.add("hidden");
    }
    overlay.classList.add("open");
  }

  function renderScanDrafts() {
    const listEl = document.getElementById("med-scan-list");
    const subEl = document.getElementById("med-scan-sub");
    if (!listEl) return;
    if (subEl) {
      subEl.textContent = st.scanDrafts.length
        ? `${st.scanDrafts.length} etiket okundu (fotoğraf saklanmaz) · Kontrol edip kaydet`
        : "Liste boş";
    }
    const today = todayStr();
    listEl.innerHTML = st.scanDrafts
      .map((item, i) => `
      <div class="med-scan-card" data-i="${i}">
        <div class="med-scan-card-head">
          <strong>${(KIND_META[item.kind] || KIND_META.medication).icon} İlaç #${i + 1}</strong>
          <button type="button" class="btn btn-sm" onclick="removeMedScanRow(${i})">✕ Kaldır</button>
        </div>
        <div class="med-scan-grid">
          <div class="field" style="grid-column:1/-1;"><label>İlaç / Takviye Adı *</label><input class="ms-name" type="text" value="${esc(item.name)}" /></div>
          <div class="field"><label>Kullanım Amacı</label><input class="ms-purpose" type="text" value="${esc(item.purpose || "")}" placeholder="Ağrı kesici vb." /></div>
          <div class="field"><label>Doz</label><input class="ms-dose" type="text" value="${esc(item.dose || "")}" placeholder="1 tablet" /></div>
          <div class="field"><label>Saatler</label><input class="ms-times" type="text" value="${esc((item.times || ["09:00"]).join(", "))}" /></div>
          <div class="field"><label>Tür</label>
            <select class="ms-kind">
              <option value="medication" ${item.kind === "medication" ? "selected" : ""}>İlaç</option>
              <option value="vitamin" ${item.kind === "vitamin" ? "selected" : ""}>Vitamin</option>
              <option value="supplement" ${item.kind === "supplement" ? "selected" : ""}>Takviye</option>
            </select>
          </div>
          <div class="field"><label>Başlangıç</label><input class="ms-start" type="date" value="${esc(item.start_date || today)}" /></div>
          <div class="field"><label>Süre (Gün)</label><input class="ms-dur" type="number" min="1" max="365" value="${item.duration_days ?? ""}" placeholder="Sürekli" /></div>
          <div class="field" style="grid-column:1/-1;"><label>Talimat / Not</label><input class="ms-notes" type="text" value="${esc(item.notes || "")}" /></div>
          <div style="grid-column:1/-1; display:flex; gap:14px; flex-wrap:wrap;">
            <label class="med-check-row"><input class="ms-prn" type="checkbox" ${item.as_needed ? "checked" : ""} /><span>⚡ Gerektiğinde</span></label>
            <label class="med-check-row"><input class="ms-rem" type="checkbox" ${item.as_needed ? "" : "checked"} /><span>🔔 Hatırlatıcı</span></label>
          </div>
        </div>
      </div>`)
      .join("");
  }

  function collectScanDrafts() {
    const out = [];
    document.querySelectorAll("#med-scan-list .med-scan-card").forEach((card) => {
      const g = (c) => card.querySelector(c)?.value.trim() || "";
      const name = g(".ms-name");
      if (!name) return;
      const times = parseTimes(g(".ms-times")) || ["09:00"];
      const startDate = g(".ms-start") || todayStr();
      const durVal = g(".ms-dur");
      const dur = durVal ? Math.max(1, Math.min(365, Math.round(Number(durVal)))) : null;
      const prn = Boolean(card.querySelector(".ms-prn")?.checked);
      const rem = Boolean(card.querySelector(".ms-rem")?.checked);
      out.push({
        name,
        purpose: g(".ms-purpose") || null,
        dose: g(".ms-dose") || null,
        kind: g(".ms-kind") || "medication",
        times,
        start_date: startDate,
        duration_days: dur,
        end_date: calcEndDate(startDate, dur),
        as_needed: prn,
        reminder_enabled: prn ? false : rem,
        notes: g(".ms-notes") || null,
      });
    });
    return out;
  }

  function openScanModal(items) {
    st.scanDrafts = Array.isArray(items) ? items : [];
    renderScanDrafts();
    document.getElementById("med-scan-modal")?.classList.add("open");
  }

  function closeScanModal() {
    document.getElementById("med-scan-modal")?.classList.remove("open");
    st.scanDrafts = [];
  }

  async function submitMedScan(exportCal) {
    if (!st.sb || !st.auth?.userId) return;
    const rows = collectScanDrafts();
    if (!rows.length) return toast("Kaydedilecek ilaç bulunamadı.");
    const btn1 = document.getElementById("btn-med-scan-save");
    const btn2 = document.getElementById("btn-med-scan-cal");
    if (btn1) btn1.disabled = true;
    if (btn2) btn2.disabled = true;

    try {
      const payload = rows.map((r) => ({ ...r, user_id: st.auth.userId }));
      const { data, error } = await st.sb.from("medications").insert(payload).select();
      if (error) throw error;
      closeScanModal();
      toast(`💊 ${payload.length} ilaç kaydedildi`);
      if (exportCal) {
        downloadIcsForMeds(data || payload);
      }
      await refresh();
    } catch (err) {
      toast("Kaydedilemedi: " + (err.message || err));
    } finally {
      if (btn1) btn1.disabled = false;
      if (btn2) btn2.disabled = false;
    }
  }

  async function handleMedPhoto(file) {
    if (!file || st.scanning) return;
    if (!st.auth?.authenticated) return toast("Önce giriş yapmalısın.");
    st.scanning = true;
    st.progVal = 12;
    showMedScanProgress(14, 1, file.name || "Etiket fotoğrafı");

    st.progTimer = setInterval(() => {
      const rem = 90 - st.progVal;
      if (rem <= 0.4) return;
      st.progVal += Math.max(0.4, rem * 0.08);
      showMedScanProgress(st.progVal, st.progVal >= 60 ? 3 : 2);
    }, 260);

    try {
      const base64 = await resizeMedPhoto(file);
      const token = await getToken();
      if (!token) throw new Error("Oturum bulunamadı.");
      showMedScanProgress(26, 2);

      const res = await fetch(PARSE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "parseMedicationLabel", file_base64: base64, mime_type: "image/jpeg" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok || !Array.isArray(json.items) || !json.items.length) {
        throw new Error(json.error || "Etiket okunamadı.");
      }

      clearInterval(st.progTimer);
      st.progTimer = null;
      showMedScanProgress(100, 5, null, json.items.length);
      await new Promise((r) => setTimeout(r, 380));
      document.getElementById("lab-parse-overlay")?.classList.remove("open");
      openScanModal(json.items);
    } catch (err) {
      clearInterval(st.progTimer);
      st.progTimer = null;
      showMedScanProgress(st.progVal, 2, null, null, err.message || "Etiket okunamadı.");
    } finally {
      if (st.progTimer) { clearInterval(st.progTimer); st.progTimer = null; }
      st.scanning = false;
    }
  }

  function bindPhotoInput() {
    const input = document.getElementById("med-photo-input");
    if (!input || input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("change", (ev) => {
      const f = ev.target?.files?.[0];
      input.value = "";
      if (f) handleMedPhoto(f);
    });
  }

  function triggerPhotoScan() {
    window.closeQuickAddSheet?.();
    if (!st.auth?.authenticated) return toast("Önce giriş yapmalısın.");
    bindPhotoInput();
    document.getElementById("med-photo-input")?.click();
  }

  // ---------- .ics Takvim Dışa Aktarımı ----------
  function icsEscape(s) {
    return String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  function downloadIcsForMeds(medList) {
    const list = (medList || []).filter(Boolean);
    if (!list.length) return;
    const events = [];
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

    list.forEach((m, mi) => {
      const start = (m.start_date || todayStr()).replace(/-/g, "");
      const count = m.duration_days ? Math.max(1, Number(m.duration_days)) : 30;
      const times = m.as_needed ? ["09:00"] : slotsOf(m);
      const desc = [m.purpose, m.dose, m.notes].filter(Boolean).join(" · ");

      times.forEach((slot, si) => {
        const [hh, mm] = slot.split(":");
        const endH = String(Number(hh)).padStart(2, "0");
        const endM = String(Math.min(59, Number(mm) + 15)).padStart(2, "0");
        events.push([
          "BEGIN:VEVENT",
          `UID:gc-med-${mi}-${si}-${Date.now()}@garmincoach`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${start}T${hh}${mm}00`,
          `DTEND:${start}T${endH}${endM}00`,
          m.as_needed ? "" : `RRULE:FREQ=DAILY;COUNT=${count}`,
          `SUMMARY:${icsEscape(`💊 ${m.name}${m.dose ? " (" + m.dose + ")" : ""}`)}`,
          desc ? `DESCRIPTION:${icsEscape(desc)}` : "",
          "BEGIN:VALARM",
          "TRIGGER:-PT5M",
          "ACTION:DISPLAY",
          `DESCRIPTION:${icsEscape(m.name)}`,
          "END:VALARM",
          "END:VEVENT",
        ].filter(Boolean).join("\r\n"));
      });
    });

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//GarminCoach//MedSchedule//TR",
      "CALSCALE:GREGORIAN",
      ...events,
      "END:VCALENDAR",
    ].join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = list.length === 1 ? `${list[0].name.replace(/[^\wÇĞİÖŞÜçğıöşü-]+/g, "_")}.ics` : "ilac_takvimi.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("📅 Takvim dosyası (.ics) indirildi — açıp takvimine ekleyebilirsin.");
  }

  // --- Hatırlatıcılar (Android APK / Capacitor LocalNotifications) ---
  function attachNotifListener() {
    if (st.listenerAttached) return;
    const ln = window.Capacitor?.Plugins?.LocalNotifications;
    if (!ln || typeof ln.addListener !== "function") return;
    st.listenerAttached = true;
    try {
      ln.addListener("localNotificationActionPerformed", (action) => {
        if (action?.notification?.extra?.tab === "health") {
          document.querySelector('[data-tab="health"]')?.click();
        }
      });
    } catch (_) {}
  }

  async function syncReminders() {
    const hintEl = document.getElementById("med-reminder-hint");
    attachNotifListener();
    const ln = window.Capacitor?.Plugins?.LocalNotifications;
    const today = todayStr();
    const eligible = activeMeds().filter((m) => {
      if (m.as_needed || m.reminder_enabled === false) return false;
      const effEnd = m.end_date || calcEndDate(m.start_date, m.duration_days);
      return !effEnd || effEnd >= today;
    });

    if (!ln) {
      if (hintEl) {
        hintEl.textContent = eligible.length
          ? `🔔 ${eligible.length} ilaçta bildirim açık (Android APK'da otomatik çalar) · İstersen 📅 ile takvime ekle.`
          : "🌐 Web sürümündesin: düzenli ilaç bildirimleri APK'da, takvim aktarımı 📅 ile her cihazda çalışır.";
      }
      return;
    }

    try {
      let perm = await ln.checkPermissions();
      if (perm.display !== "granted") perm = await ln.requestPermissions();
      if (perm.display !== "granted") {
        if (hintEl) hintEl.textContent = "⚠️ Cihaz bildirim izni verilmedi.";
        return;
      }
      const pending = await ln.getPending().catch(() => ({ notifications: [] }));
      const old = (pending.notifications || []).filter((n) => n.id >= NOTIF_BASE_ID && n.id < NOTIF_BASE_ID + 1000);
      if (old.length) await ln.cancel({ notifications: old.map((n) => ({ id: n.id })) });

      const notifications = [];
      let idx = 0;
      const now = new Date();
      eligible.forEach((m) => {
        slotsOf(m).forEach((slot) => {
          if (idx >= 999) return;
          const [hh, mm] = slot.split(":").map(Number);
          const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
          if (at.getTime() <= now.getTime() || isTaken(m.id, today, slot)) at.setDate(at.getDate() + 1);
          const nextDs = ymd(at);
          if (m.start_date && m.start_date > nextDs) return;
          const effEnd = m.end_date || calcEndDate(m.start_date, m.duration_days);
          if (effEnd && effEnd < nextDs) return;

          notifications.push({
            id: NOTIF_BASE_ID + idx++,
            title: `${(KIND_META[m.kind] || KIND_META.supplement).icon} ${m.name}`,
            body: `${slot} dozu${m.dose ? " · " + m.dose : ""}${m.purpose ? " · " + m.purpose : ""}`,
            schedule: { at, allowWhileIdle: true },
            extra: { tab: "health" },
          });
        });
      });
      if (notifications.length) await ln.schedule({ notifications });
      if (hintEl) hintEl.textContent = notifications.length ? `✅ ${notifications.length} doz hatırlatıcısı cihaza kuruldu.` : "Aktif doz hatırlatıcısı yok.";
    } catch (err) {
      if (hintEl) hintEl.textContent = "Bildirim zamanlama uyarısı: " + (err.message || err);
    }
  }

  async function initForUser(auth, sb) {
    st.auth = auth || null;
    st.sb = sb || null;
    st.selectedDate = st.selectedDate || todayStr();
    bindPhotoInput();
    renderAll();
    if (!auth?.authenticated || !auth?.userId || !sb) return;
    await refresh();
  }

  function reset() {
    st.auth = null;
    st.meds = [];
    st.logs = [];
    st.selectedDate = todayStr();
    closeModal();
    closeScanModal();
    renderAll();
  }

  window.selectMedDate = function (ds) {
    if (!ds) return;
    st.selectedDate = ds;
    renderToday();
    renderWeek();
  };
  window.toggleMedTaken = toggleTaken;
  window.toggleMedActive = toggleActive;
  window.toggleMedReminder = toggleReminder;
  window.deleteMed = removeMed;
  window.openMedModal = openModal;
  window.closeMedModal = closeModal;
  window.applyMedPreset = applyPreset;
  window.submitMedModal = submitModal;
  window.triggerMedPhotoScan = triggerPhotoScan;
  window.closeMedScanModal = closeScanModal;
  window.removeMedScanRow = function (i) {
    st.scanDrafts = collectScanDrafts();
    st.scanDrafts.splice(i, 1);
    renderScanDrafts();
  };
  window.submitMedScan = submitMedScan;
  window.exportMedToCalendar = function (id) {
    const m = st.meds.find((x) => x.id === id);
    if (m) downloadIcsForMeds([m]);
  };

  window.GarminMeds = { initForUser, reset, refresh, openModal, closeModal, closeScanModal };
})();
