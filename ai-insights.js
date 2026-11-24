(function () {
  "use strict";

  const SUPABASE_URL = "https://htooqswstuuzslvrgxsx.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5_1RDXV8unnW9ttkHEA_HQ_n8fJrt4I";
  const AI_ENGINE_URL = `${SUPABASE_URL}/functions/v1/ai-insights-engine`;
  const DAILY_NOTIF_ID = 202601;

  const CAT_LABELS = {
    uyku: { icon: "😴", text: "Uyku", cls: "badge-info" },
    antrenman: { icon: "🏃", text: "Antrenman", cls: "badge-ok" },
    toparlanma: { icon: "🔋", text: "Toparlanma", cls: "badge-warn" },
    genel: { icon: "✨", text: "Genel Ritim", cls: "badge-info" },
  };

  const moduleState = {
    auth: null,
    sbClient: null,
    insight: null,
    prefs: {
      ai_insights_enabled: true,
      daily_notification_enabled: true,
      notification_time: "09:00",
    },
    loading: false,
    voting: false,
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

  async function aiApiCall(payload) {
    let token = moduleState.auth?.accessToken || null;
    try {
      if (moduleState.sbClient?.auth?.getSession) {
        const { data } = await moduleState.sbClient.auth.getSession();
        if (data?.session?.access_token) {
          token = data.session.access_token;
        }
      }
    } catch (_) {}

    const res = await fetch(AI_ENGINE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  }

  function attachLocalNotificationTapListener() {
    if (moduleState.listenerAttached) return;
    const localNotifs = window.Capacitor?.Plugins?.LocalNotifications;
    if (!localNotifs || typeof localNotifs.addListener !== "function") return;
    moduleState.listenerAttached = true;

    try {
      localNotifs.addListener("localNotificationActionPerformed", (action) => {
        const extra = action?.notification?.extra || {};
        if (!extra.focus_card || extra.focus_card === "ai-daily-insight-card") {
          setTimeout(() => window.focusAiInsightCard(), 180);
        }
      });
    } catch (_) {}
  }

  async function syncLocalDailyNotification(insight) {
    attachLocalNotificationTapListener();

    const localNotifs = window.Capacitor?.Plugins?.LocalNotifications;
    const enabled =
      moduleState.prefs.ai_insights_enabled !== false &&
      moduleState.prefs.daily_notification_enabled !== false;

    const hintEl = document.getElementById("ai-notif-cap-hint");
    if (!localNotifs) {
      if (hintEl) {
        hintEl.textContent = enabled
          ? `🌐 Web sürümündesiniz: ${moduleState.prefs.notification_time} saati uygulama içi bildirim zamanlayıcısına kaydedildi. Android APK'da cihaz alarmı aktif olur.`
          : "🔕 Günlük AI bildirimleri kapalı.";
      }
      return;
    }

    try {
      // Eski zamanlamayı önce temizle (kapatıldıysa tamamen iptal eder, açıksa günceller)
      await localNotifs.cancel({ notifications: [{ id: DAILY_NOTIF_ID }] });

      if (!enabled) {
        if (hintEl) {
          hintEl.textContent = "🔕 Günlük bildirimler kapalı · Cihazdaki tüm zamanlı AI bildirimleri iptal edildi.";
        }
        return;
      }

      let perm = await localNotifs.checkPermissions();
      if (perm.display !== "granted") {
        perm = await localNotifs.requestPermissions();
      }
      if (perm.display !== "granted") {
        if (hintEl) {
          hintEl.textContent = "⚠️ Android bildirim izni verilmedi. Cihaz ayarlarından bildirim iznini açın.";
        }
        return;
      }

      const m = String(moduleState.prefs.notification_time || "09:00").match(/^(\d{2}):(\d{2})$/);
      const hour = m ? Number(m[1]) : 9;
      const minute = m ? Number(m[2]) : 0;

      const bodyText = insight?.title
        ? `${insight.title} — ${insight.action_tip || "Detayı görmek için dokun."}`
        : "Bugünkü Garmin verilerine göre hazırlanan yapay zeka özetin seni bekliyor.";

      await localNotifs.schedule({
        notifications: [
          {
            id: DAILY_NOTIF_ID,
            title: "✨ Active Intelligence · Günlük AI Özeti",
            body: bodyText.slice(0, 220),
            schedule: {
              on: { hour, minute },
              repeats: true,
              allowWhileIdle: true,
            },
            extra: {
              tab: "dashboard",
              focus_card: "ai-daily-insight-card",
            },
          },
        ],
      });

      if (hintEl) {
        hintEl.textContent = `📱 Android cihaz alarmı aktif: Her gün ${moduleState.prefs.notification_time} saatinde bildirim gönderilir.`;
      }
    } catch (err) {
      if (hintEl) {
        hintEl.textContent = `⚠️ Cihaz bildirimi ayarlanamadı: ${err?.message || err}`;
      }
    }
  }

  function renderSettingsControls() {
    const aiToggle = document.getElementById("toggle-ai-insights");
    const notifToggle = document.getElementById("toggle-daily-notif");
    const timeInp = document.getElementById("inp-notif-time");
    const timeRow = document.getElementById("ai-notif-time-row");

    if (aiToggle) aiToggle.checked = moduleState.prefs.ai_insights_enabled !== false;
    if (notifToggle) notifToggle.checked = moduleState.prefs.daily_notification_enabled !== false;
    if (timeInp) {
      timeInp.value = moduleState.prefs.notification_time || "09:00";
      timeInp.disabled = moduleState.prefs.daily_notification_enabled === false;
    }
    if (timeRow) {
      timeRow.style.opacity = moduleState.prefs.daily_notification_enabled === false ? "0.48" : "1";
    }
  }

  function renderInsightCard() {
    const card = document.getElementById("ai-daily-insight-card");
    const catBadge = document.getElementById("ai-insight-cat-badge");
    const dateBadge = document.getElementById("ai-insight-date-badge");
    const titleEl = document.getElementById("ai-insight-title");
    const summaryEl = document.getElementById("ai-insight-summary");
    const tipEl = document.getElementById("ai-insight-tip");
    const fbRow = document.getElementById("ai-insight-feedback-row");
    const upBtn = document.getElementById("btn-ai-fb-up");
    const downBtn = document.getElementById("btn-ai-fb-down");
    const fbStatus = document.getElementById("ai-insight-fb-status");

    if (!card || !titleEl || !summaryEl) return;

    if (moduleState.prefs.ai_insights_enabled === false) {
      if (catBadge) {
        catBadge.textContent = "⏸️ Kapalı";
        catBadge.className = "badge badge-warn";
      }
      if (dateBadge) dateBadge.textContent = "Pasif";
      titleEl.textContent = "AI Günlük Analizleri Devre Dışı";
      summaryEl.textContent = "Ayarlar sekmesindeki 'AI Günlük Analizleri' anahtarını açtığınızda uyku, toparlanma ve antrenman yükünüzün günlük yapay zeka özeti burada görünür.";
      if (tipEl) tipEl.classList.add("hidden");
      if (fbRow) fbRow.classList.add("hidden");
      return;
    }

    if (moduleState.loading && !moduleState.insight) {
      if (catBadge) {
        catBadge.textContent = "✨ Hazırlanıyor";
        catBadge.className = "badge badge-info";
      }
      titleEl.textContent = "Günlük AI Özeti hazırlanıyor...";
      summaryEl.textContent = "Bugünkü biyometrik verileriniz ve son 14 günlük trendiniz analiz ediliyor.";
      if (tipEl) tipEl.classList.add("hidden");
      if (fbRow) fbRow.classList.add("hidden");
      return;
    }

    const ins = moduleState.insight;
    if (!ins) {
      if (catBadge) {
        catBadge.textContent = "📡 Veri Bekleniyor";
        catBadge.className = "badge badge-info";
      }
      if (dateBadge) dateBadge.textContent = "--";
      titleEl.textContent = "Henüz Garmin Verisi Bulunmuyor";
      summaryEl.textContent = "Garmin API bağlantınızı yapıp ilk verinizi senkronize ettiğinizde günlük Active Intelligence özeti otomatik olarak oluşturulacaktır.";
      if (tipEl) tipEl.classList.add("hidden");
      if (fbRow) fbRow.classList.add("hidden");
      return;
    }

    const meta = CAT_LABELS[ins.category] || CAT_LABELS.genel;
    if (catBadge) {
      catBadge.textContent = `${meta.icon} ${meta.text}`;
      catBadge.className = `badge ${meta.cls}`;
    }
    if (dateBadge) dateBadge.textContent = ins.date || "--";
    titleEl.textContent = ins.title || "Günlük AI Özeti";
    summaryEl.textContent = ins.summary || "--";

    if (tipEl) {
      tipEl.classList.remove("hidden");
      tipEl.innerHTML = `<strong>💡 Günün Önerisi:</strong> ${esc(ins.action_tip || "--")}`;
    }

    const alreadyVoted = ins.feedback === 1 || ins.feedback === -1;
    if (fbRow) fbRow.classList.toggle("hidden", alreadyVoted);
    if (upBtn) upBtn.classList.remove("active-up");
    if (downBtn) downBtn.classList.remove("active-down");
    if (fbStatus && !alreadyVoted) {
      fbStatus.textContent = "Bu öneri nasıldı?";
    }
  }

  async function initForUser(settings, auth, sbClient) {
    moduleState.auth = auth || null;
    moduleState.sbClient = sbClient || null;
    moduleState.prefs = {
      ai_insights_enabled: settings?.ai_insights_enabled !== false,
      daily_notification_enabled: settings?.daily_notification_enabled !== false,
      notification_time: settings?.notification_time || "09:00",
    };

    renderSettingsControls();

    if (!auth?.authenticated) return;

    if (moduleState.prefs.ai_insights_enabled === false) {
      moduleState.insight = null;
      renderInsightCard();
      await syncLocalDailyNotification(null);
      return;
    }

    moduleState.loading = true;
    renderInsightCard();

    try {
      const json = await aiApiCall({ action: "generateInsight", force: false });
      if (json.preferences) {
        moduleState.prefs = { ...moduleState.prefs, ...json.preferences };
        renderSettingsControls();
      }
      moduleState.insight = json.insight || null;
    } catch (err) {
      try {
        const fbJson = await aiApiCall({ action: "getLatestInsight" });
        moduleState.insight = fbJson.insight || null;
      } catch (_) {}
    } finally {
      moduleState.loading = false;
      renderInsightCard();
      await syncLocalDailyNotification(moduleState.insight);
    }
  }

  function reset() {
    moduleState.auth = null;
    moduleState.insight = null;
    moduleState.loading = false;
    moduleState.prefs = {
      ai_insights_enabled: true,
      daily_notification_enabled: true,
      notification_time: "09:00",
    };
    renderSettingsControls();
    renderInsightCard();
    syncLocalDailyNotification(null);
  }

  const hostObj = typeof window !== "undefined" ? window : globalThis;

  hostObj.refreshAiInsight = async function (force = true) {
    if (!moduleState.auth?.authenticated) return;
    if (moduleState.prefs.ai_insights_enabled === false) {
      toast("Önce Ayarlar'dan AI Günlük Analizleri açın.");
      return;
    }
    const btn = document.getElementById("btn-ai-refresh");
    if (btn) btn.disabled = true;
    moduleState.loading = true;
    renderInsightCard();

    try {
      const json = await aiApiCall({ action: "generateInsight", force: Boolean(force) });
      moduleState.insight = json.insight || null;
      renderInsightCard();
      await syncLocalDailyNotification(moduleState.insight);
      toast(json.cached ? "Bugünün AI özeti güncel." : "Yeni Günlük AI Özeti oluşturuldu!");
    } catch (err) {
      toast(`AI özet hatası: ${err.message}`);
    } finally {
      moduleState.loading = false;
      if (btn) btn.disabled = false;
      renderInsightCard();
    }
  };

  hostObj.rateAiInsight = async function (vote) {
    const ins = moduleState.insight;
    if (
      !ins?.id ||
      !moduleState.auth?.authenticated ||
      ins.feedback === 1 ||
      ins.feedback === -1 ||
      moduleState.voting ||
      (vote !== 1 && vote !== -1)
    ) {
      return;
    }

    moduleState.voting = true;
    ins.feedback = vote;
    renderInsightCard();

    try {
      const json = await aiApiCall({
        action: "submitFeedback",
        insight_id: ins.id,
        feedback: vote,
      });
      if (json.insight) moduleState.insight = json.insight;
      renderInsightCard();
      toast(
        vote === 1
          ? "Faydalı olarak kaydedildi 👍 Sonraki öneriler buna göre şekillenecek."
          : "Geliştir notu alındı 👎 Sonraki öneriler buna göre iyileştirilecek."
      );
    } catch (err) {
      ins.feedback = null;
      renderInsightCard();
      toast(`Geri bildirim kaydedilemedi: ${err.message}`);
    } finally {
      moduleState.voting = false;
    }
  };

  hostObj.saveAiInsightPreferences = async function () {
    const aiEl = document.getElementById("toggle-ai-insights");
    const notifEl = document.getElementById("toggle-daily-notif");
    const timeEl = document.getElementById("inp-notif-time");

    const aiEnabled = aiEl ? Boolean(aiEl.checked) : true;
    const notifEnabled = notifEl ? Boolean(notifEl.checked) : true;
    const notifTime = timeEl?.value && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeEl.value) ? timeEl.value : "09:00";

    moduleState.prefs = {
      ai_insights_enabled: aiEnabled,
      daily_notification_enabled: notifEnabled,
      notification_time: notifTime,
    };
    renderSettingsControls();

    if (!moduleState.auth?.authenticated) return;

    try {
      const json = await aiApiCall({
        action: "updatePreferences",
        ai_insights_enabled: aiEnabled,
        daily_notification_enabled: notifEnabled,
        notification_time: notifTime,
      });
      if (json.preferences) {
        moduleState.prefs = { ...moduleState.prefs, ...json.preferences };
      }
      if (window.state?.settings) {
        window.state.settings.ai_insights_enabled = moduleState.prefs.ai_insights_enabled;
        window.state.settings.daily_notification_enabled = moduleState.prefs.daily_notification_enabled;
        window.state.settings.notification_time = moduleState.prefs.notification_time;
      }

      if (aiEnabled && !moduleState.insight) {
        await hostObj.refreshAiInsight(false);
      } else {
        renderInsightCard();
        await syncLocalDailyNotification(moduleState.insight);
      }

      toast(
        !notifEnabled
          ? "Günlük bildirimler kapatıldı ve zamanlama iptal edildi."
          : `AI ve bildirim ayarları kaydedildi (${notifTime}).`
      );
    } catch (err) {
      toast(`Tercih güncelleme hatası: ${err.message}`);
    }
  };

  hostObj.focusAiInsightCard = function () {
    const dashBtn = document.querySelector('[data-tab="dashboard"]');
    if (dashBtn) dashBtn.click();
    setTimeout(() => {
      const card = document.getElementById("ai-daily-insight-card");
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("ai-card-pulse");
      setTimeout(() => card.classList.remove("ai-card-pulse"), 2200);
    }, 150);
  };

  hostObj.GarminAiInsights = {
    initForUser,
    reset,
    refresh: () => hostObj.refreshAiInsight(true),
    syncLocalDailyNotification,
    getState: () => moduleState,
  };
})();
