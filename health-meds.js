(function () {
  "use strict";

  const NOTIF_BASE_ID = 303000; // 303000..303999 reserved for medication reminders
  const KIND_META = {
    medication: { icon: "💊", label: "İlaç" },
    supplement: { icon: "🧴", label: "Takviye" },
    vitamin: { icon: "🍊", label: "Vitamin" },
  };

  const st = {
    auth: null,
    sb: null,
    meds: [],
    logs: [], // son 30 gün
    editingId: null,
    listenerAttached: false,
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

  function isTaken(medId, date, slot) {
    return st.logs.some((l) => l.medication_id === medId && l.log_date === date && l.time_slot === slot);
  }

  function activeMeds() {
    return st.meds.filter((m) => m.active !== false);
  }

  function slotsOf(m) {
    return Array.isArray(m.times) && m.times.length ? [...m.times].sort() : ["08:00"];
  }

  function todaySlots() {
    const date = todayStr();
    const rows = [];
    activeMeds().forEach((m) => {
      if (m.start_date && m.start_date > date) return;
      slotsOf(m).forEach((slot) => rows.push({ med: m, slot, taken: isTaken(m.id, date, slot) }));
    });
    rows.sort((a, b) => a.slot.localeCompare(b.slot) || a.med.name.localeCompare(b.med.name, "tr"));
    return rows;
  }

  function nowHHMM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function renderToday() {
    const listEl = document.getElementById("med-today-list");
    const badgeEl = document.getElementById("med-today-badge");
    if (!listEl) return;

    if (!st.auth?.authenticated) {
      listEl.innerHTML = `<div class="auth-hint-box">Giriş yaptıktan sonra ilaç ve takviye takibini kullanabilirsin.</div>`;
      if (badgeEl) {
        badgeEl.className = "badge badge-info";
        badgeEl.textContent = "--";
      }
      return;
    }

    const rows = todaySlots();
    const done = rows.filter((r) => r.taken).length;
    if (badgeEl) {
      badgeEl.textContent = rows.length ? `${done}/${rows.length}` : "Boş";
      badgeEl.className = `badge ${!rows.length ? "badge-info" : done === rows.length ? "badge-ok" : "badge-warn"}`;
    }

    if (!rows.length) {
      listEl.innerHTML = `<div class="auth-hint-box">Bugün için planlı doz yok. Aşağıdan ilaç / takviye ekleyebilirsin.</div>`;
      return;
    }

    const now = nowHHMM();
    listEl.innerHTML = rows
      .map((r) => {
        const meta = KIND_META[r.med.kind] || KIND_META.supplement;
        const late = !r.taken && r.slot < now;
        return `
        <div class="med-row ${r.taken ? "taken" : ""} ${late ? "late" : ""}">
          <button type="button" class="med-check" aria-label="${r.taken ? "Geri al" : "Aldım"}"
            onclick="toggleMedTaken('${r.med.id}','${esc(r.slot)}')">${r.taken ? "✓" : ""}</button>
          <div class="med-row-body">
            <strong>${meta.icon} ${esc(r.med.name)}</strong>
            <span>${esc(r.med.dose || meta.label)}${r.med.notes ? " · " + esc(r.med.notes) : ""}</span>
          </div>
          <span class="mono med-time">${esc(r.slot)}</span>
        </div>`;
      })
      .join("");
  }

  function renderWeek() {
    const el = document.getElementById("med-week-strip");
    const sumEl = document.getElementById("med-adherence");
    if (!el) return;
    const meds = activeMeds();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d);
    }
    let planned = 0;
    let takenTotal = 0;
    const cells = days.map((d) => {
      const ds = ymd(d);
      let p = 0;
      let t = 0;
      meds.forEach((m) => {
        if (m.start_date && m.start_date > ds) return;
        slotsOf(m).forEach((slot) => {
          p++;
          if (isTaken(m.id, ds, slot)) t++;
        });
      });
      planned += p;
      takenTotal += t;
      const pct = p ? Math.round((t / p) * 100) : null;
      const cls = pct === null ? "none" : pct >= 100 ? "full" : pct > 0 ? "part" : "miss";
      const label = new Intl.DateTimeFormat("tr-TR", { weekday: "short" }).format(d);
      return `<div class="med-day ${cls}" title="${ds}: ${t}/${p}"><span>${esc(label)}</span><b>${pct === null ? "–" : pct + "%"}</b></div>`;
    });
    el.innerHTML = cells.join("");
    if (sumEl) {
      sumEl.textContent = planned ? `Son 7 gün uyum: %${Math.round((takenTotal / planned) * 100)} (${takenTotal}/${planned})` : "Henüz veri yok";
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
        return `
        <div class="med-item ${m.active === false ? "inactive" : ""}">
          <div class="med-row-body">
            <strong>${meta.icon} ${esc(m.name)} <small>${esc(meta.label)}</small></strong>
            <span>${esc(m.dose || "Doz belirtilmedi")} · ${slotsOf(m).map(esc).join(", ")}${m.notes ? " · " + esc(m.notes) : ""}</span>
          </div>
          <div class="med-item-actions">
            <button type="button" class="btn btn-sm" onclick="toggleMedActive('${m.id}')">${m.active === false ? "▶ Aç" : "⏸ Durdur"}</button>
            <button type="button" class="btn btn-sm" onclick="openMedModal('${m.id}')">✏️</button>
            <button type="button" class="btn btn-sm" onclick="deleteMed('${m.id}')">🗑</button>
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
    const date = todayStr();
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

  function openModal(id) {
    if (!st.auth?.authenticated) return toast("Önce giriş yapmalısın.");
    window.closeQuickAddSheet?.();
    const m = id ? st.meds.find((x) => x.id === id) : null;
    st.editingId = m ? m.id : null;
    setVal("med-name", m?.name || "");
    setVal("med-dose", m?.dose || "");
    setVal("med-kind", m?.kind || "supplement");
    setVal("med-times", m ? slotsOf(m).join(", ") : "08:00");
    setVal("med-notes", m?.notes || "");
    const t = document.getElementById("med-modal-title");
    if (t) t.textContent = m ? "İlaç / Takviye Düzenle" : "İlaç / Takviye Ekle";
    document.getElementById("med-modal")?.classList.add("open");
  }

  function closeModal() {
    document.getElementById("med-modal")?.classList.remove("open");
    st.editingId = null;
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
    if (!name) return toast("Ad zorunlu.");
    const times = parseTimes(document.getElementById("med-times")?.value);
    if (!times || !times.length) return toast("Saatleri 08:00, 20:30 biçiminde yaz.");
    const row = {
      name,
      dose: document.getElementById("med-dose")?.value.trim() || null,
      kind: document.getElementById("med-kind")?.value || "supplement",
      times,
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
    if (!ln) {
      if (hintEl) hintEl.textContent = "🌐 Web sürümündesin: doz hatırlatıcıları Android APK'da otomatik kurulur.";
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
      const today = todayStr();
      activeMeds().forEach((m) => {
        slotsOf(m).forEach((slot) => {
          if (idx >= 999) return;
          const [hh, mm] = slot.split(":").map(Number);
          const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
          // Bugünkü doz alındıysa veya saati geçtiyse yarına kur
          if (at.getTime() <= now.getTime() || isTaken(m.id, today, slot)) at.setDate(at.getDate() + 1);
          notifications.push({
            id: NOTIF_BASE_ID + idx++,
            title: `${(KIND_META[m.kind] || KIND_META.supplement).icon} ${m.name}`,
            body: `${slot} dozu zamanı${m.dose ? " · " + m.dose : ""}`,
            schedule: { at, allowWhileIdle: true },
            extra: { tab: "health" },
          });
        });
      });
      if (notifications.length) await ln.schedule({ notifications });
      if (hintEl) hintEl.textContent = notifications.length ? `✅ ${notifications.length} doz hatırlatıcısı cihaza kuruldu.` : "Aktif doz yok.";
    } catch (err) {
      if (hintEl) hintEl.textContent = "Bildirim zamanlama uyarısı: " + (err.message || err);
    }
  }

  async function initForUser(auth, sb) {
    st.auth = auth || null;
    st.sb = sb || null;
    renderAll();
    if (!auth?.authenticated || !auth?.userId || !sb) return;
    await refresh();
  }

  function reset() {
    st.auth = null;
    st.meds = [];
    st.logs = [];
    closeModal();
    renderAll();
  }

  window.toggleMedTaken = toggleTaken;
  window.toggleMedActive = toggleActive;
  window.deleteMed = removeMed;
  window.openMedModal = openModal;
  window.closeMedModal = closeModal;
  window.submitMedModal = submitModal;

  window.GarminMeds = { initForUser, reset, refresh, openModal, closeModal };
})();
