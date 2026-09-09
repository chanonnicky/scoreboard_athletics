/* overlay.js — โหลดใน OBS Browser Source / vMix Web Browser
   query params:
     ?slot=both|lower|full      ช่องที่จะแสดง (ดีฟอลต์ both)
     ?scale=1.0                 ย่อ/ขยายทั้งจอ
     ?transport=sse|poll        วิธีรับข้อมูล (ดีฟอลต์ sse; ใช้ poll ถ้าเน็ตบล็อก SSE)
*/
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var view = params.get("slot") || "both";
  var scale = parseFloat(params.get("scale") || "1") || 1;
  var transport = params.get("transport") || "sse";
  // ธีมแสดงผล (สกินพื้นผิว): URL ?theme=<slug> บังคับเฉพาะจอ; ไม่ใส่ = ตาม settings.theme
  // ?theme=default (หรือ classic) = ปิดทุกสกิน · ?glass=1 = ทางลัดเก่าของ glass
  var THEMES = ["glass", "clay", "claydark", "neu", "retro", "editorial", "broken",
                "bauhaus", "techno", "popart", "illustrative", "y2k", "swiss", "pastel"];
  var themeParam = params.get("theme");
  function applyTheme(state) {
    var t = themeParam;
    if (t === "classic") t = "default";
    if (!t && params.get("glass") === "1") t = "glass";
    if (!t) t = (state && state.settings && state.settings.theme) || "default";
    var el = document.documentElement;
    THEMES.forEach(function (name) { el.classList.toggle(name, t === name); });
  }
  applyTheme(null);

  var stage = document.getElementById("stage");
  stage.style.transform = "scale(" + scale + ")";

  var SLOTS = ["full", "lower", "bug"];
  var last = {}; // slot -> { template, eventId, visible, sig }

  // ---- เทมเพลตแบบแบ่งหน้า (results): สลับ .apage อัตโนมัติทุก 10 วิ ---- //
  var PAGE_INTERVAL = 10000;
  var PAGED_TEMPLATES = { results: 1, sportMatches: 1 };
  var pagerTimers = {};

  function stopPager(slot) {
    if (pagerTimers[slot]) { clearInterval(pagerTimers[slot]); delete pagerTimers[slot]; }
  }

  function pagesOf(slot) {
    var host = document.getElementById("slot-" + slot);
    var cg = host && host.querySelector(".cg:not(.out)");
    return (cg && cg.querySelectorAll(".apage")) || [];
  }

  function startPager(slot) {
    stopPager(slot);
    var idx = 0;
    // แสดงหน้าแรก (ให้แถวไล่เข้าเหมือนตอนเปลี่ยนหน้า)
    var init = pagesOf(slot);
    for (var i = 0; i < init.length; i++) init[i].classList.remove("show", "leaving");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var ps = pagesOf(slot);
        if (ps[0]) ps[0].classList.add("show");
      });
    });
    pagerTimers[slot] = setInterval(function () {
      var pages = pagesOf(slot);
      if (!pages.length) { stopPager(slot); return; }
      if (pages.length < 2) return;
      var out = pages[idx % pages.length];
      out.classList.remove("show");
      out.classList.add("leaving");
      (function (p) { setTimeout(function () { p.classList.remove("leaving"); }, 650); })(out);
      idx = (idx + 1) % pages.length;
      pages[idx].classList.add("show");
    }, PAGE_INTERVAL);
  }

  function eventsSig(state) {
    return (state.events || []).map(function (e) {
      return e.id + "~" + (e.title || "") + "~" + (e.level || e.ageGroup || "");
    }).join("|");
  }
  function pagedSig(state) {
    var r = state.results || {};
    var s = state.settings || {};
    var rs = Object.keys(r).sort().map(function (k) {
      return k + ":" + (r[k] || []).map(function (x) { return x.rank + "" + x.house; }).join(",");
    }).join("|");
    return eventsSig(state) + "||" + rs + "||" + (s.meetTitle || "") + "||" + JSON.stringify(s.houseNames || {}) +
      "||" + (s.mode || "house") + "||" + JSON.stringify(s.schools || []);
  }
  // กราฟเหรียญ: เปลี่ยนตามผล/รายการ/ชื่อ-โหมด + ค่าตั้งกราฟ
  function chartSig(state) {
    var s = state.settings || {};
    return pagedSig(state) + "||" + (s.chartEnabled ? 1 : 0) +
      "|" + (s.chartType || "") + "|" + (s.chartTitle || "");
  }
  // schedule เปลี่ยนตามรายการ + รายการที่เลือก (ไม่สนผลการแข่ง)
  function schedSig(state, eid) {
    var s = state.settings || {};
    return (eid || "") + "||" + eventsSig(state) + "||" + (s.meetTitle || "") + "||" + (s.mode || "house");
  }
  // กีฬา: re-render เมื่อข้อมูลกีฬา/ชื่อ-โลโก้คณะ/โหมด/รายชื่อโรงเรียน เปลี่ยน
  function sportSig(state, sportKey) {
    var s = state.settings || {};
    return (sportKey || "") + "||" + JSON.stringify(state.sports || []) +
      "||" + JSON.stringify(s.houseNames || {}) + "||" + JSON.stringify(s.houseLogos || {}) +
      "||" + (s.mode || "house") + "||" + JSON.stringify(s.schools || []);
  }
  function isSport(t) { return t === "sportMatches" || t === "sportLive" || t === "sportLower"; }
  // เทมเพลตสกอร์สด (เดินนาฬิกา + เด้งสกอร์เอง): สกอร์บอร์ดเต็มจอ + แถบล่าง
  function isLiveSport(t) { return t === "sportLive" || t === "sportLower"; }

  // ---- นาฬิกาแมตช์ (นับถอยหลัง) + สกอร์เด้ง สำหรับ sportLive บนจอ Live ---- //
  var clockTimers = {};  // slot -> interval id
  var liveScores = {};   // slot -> {id,hs,as,done} ของคู่สดล่าสุด (เทียบหาว่าฝั่งไหนสกอร์เปลี่ยน)

  function stopClockTick(slot) {
    if (clockTimers[slot]) { clearInterval(clockTimers[slot]); delete clockTimers[slot]; }
  }
  function tickClock(slot) {
    var host = document.getElementById("slot-" + slot);
    var el = host && host.querySelector(".cg:not(.out) .live-clock");
    if (!el || el.getAttribute("data-run") !== "1") { stopClockTick(slot); return; }
    var base = parseFloat(el.getAttribute("data-el")) || 0;
    var since = parseFloat(el.getAttribute("data-since")) || 0;
    var dur = parseFloat(el.getAttribute("data-dur"));
    if (isNaN(dur)) dur = 600;
    var remain = T.remainSec(base, since, dur, true);
    el.textContent = T.fmtClock(remain);
    if (remain <= 0) el.classList.add("ended");
  }
  function startClockTick(slot) {
    stopClockTick(slot);
    var host = document.getElementById("slot-" + slot);
    var el = host && host.querySelector('.cg:not(.out) .live-clock[data-run="1"]');
    if (el) { tickClock(slot); clockTimers[slot] = setInterval(function () { tickClock(slot); }, 500); }
  }

  function sportCurrentMatch(state, key) {
    var sp = (state.sports || []).find(function (s) { return s.key === key; });
    if (!sp || !sp.currentId) return null;
    return (sp.matches || []).find(function (m) { return m.id === sp.currentId; }) || null;
  }
  function bumpEl(root, sel) {
    var el = root.querySelector(sel);
    if (!el) return;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }
  // root = โหนด .cg ที่กำลังแสดงคู่สดอยู่ (sameShell = โหนดเดิม, entrance ใหม่ = โหนดที่เพิ่งสร้าง)
  // silent = จริงตอนโผล่ครั้งแรก แค่บันทึกสกอร์ตั้งต้น ไม่ต้องเด้ง
  function bumpLiveScore(slot, root, state, sportKey, silent) {
    var lm = sportCurrentMatch(state, sportKey);
    var prevScore = liveScores[slot];
    if (!silent && lm && prevScore && prevScore.id === lm.id) {
      var nhs = Number(lm.hs) || 0, nas = Number(lm.as) || 0;
      if (nhs !== prevScore.hs) bumpEl(root, ".ls-h");
      if (nas !== prevScore.as) bumpEl(root, ".ls-a");
      if (lm.done && !prevScore.done) {
        var card = root.querySelector(".tpl-live-card");
        if (card) card.classList.add("just-final");
      }
    }
    liveScores[slot] = lm ? { id: lm.id, hs: Number(lm.hs) || 0, as: Number(lm.as) || 0, done: !!lm.done } : null;
  }

  // ---- แถบล่างสกอร์สด (sportLower): แก้ค่าในที่ ไม่ re-render ทั้งแถบ ----
  // "เปลือก" ที่ต้องสร้างใหม่จริง ๆ = คู่/ชื่อคณะ/โลโก้/ชื่อกีฬา เปลี่ยน; นอกนั้น (สกอร์/
  // นาฬิกา/สถานะจบ/นำ-ตาม) แก้เฉพาะจุด -> จุด LIVE ไม่รีสตาร์ตกะพริบ, โลโก้ไม่โหลดใหม่
  function sportbarShell(state, sportKey) {
    var lm = sportCurrentMatch(state, sportKey);
    if (!lm) return "";
    var sp = (state.sports || []).find(function (s) { return s.key === sportKey; }) || {};
    var s = state.settings || {};
    return lm.home + "~" + lm.away + "~" + (sp.name || "") + "~" + (sp.icon || "") +
      "~" + JSON.stringify(s.houseNames || {}) + "~" + JSON.stringify(s.houseLogos || {}) +
      "~" + (s.mode || "house") + "~" + JSON.stringify(s.schools || []);
  }
  function patchSportbar(bar, html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var next = tmp.querySelector(".sportbar");
    if (!bar || !next) return false;
    function txt(sel) {
      var a = bar.querySelector(sel), b = next.querySelector(sel);
      if (a && b && a.textContent !== b.textContent) a.textContent = b.textContent;
    }
    function cls(sel) {
      var a = bar.querySelector(sel), b = next.querySelector(sel);
      if (a && b && a.className !== b.className) a.className = b.className;
    }
    txt(".ls-h"); txt(".ls-a");
    cls(".sportbar-home"); cls(".sportbar-away");
    var oc = bar.querySelector(".live-clock"), nc = next.querySelector(".live-clock");
    if (oc && nc) {
      if (oc.className !== nc.className) oc.className = nc.className;
      ["data-run", "data-el", "data-since", "data-dur"].forEach(function (k) {
        var v = nc.getAttribute(k);
        if (oc.getAttribute(k) !== v) oc.setAttribute(k, v);
      });
      if (oc.textContent !== nc.textContent) oc.textContent = nc.textContent;
    }
    var d = next.getAttribute("data-done") || "0";
    if (bar.getAttribute("data-done") !== d) bar.setAttribute("data-done", d);
    return true;
  }

  function animMs(state) {
    return (state.settings && state.settings.animMs) || 450;
  }

  function slotInView(name) {
    return view === "both" || view === name;
  }

  function buildTemplate(conf, state) {
    var ev = conf.eventId ? (state.events || []).find(function (e) { return e.id === conf.eventId; }) : null;
    switch (conf.template) {
      case "top3":     return ev ? T.top3(state, ev, (state.results || {})[ev.id] || []) : null;
      case "results":  return T.results(state);
      case "chart":    return T.chart(state);
      case "schedule": return T.schedule(state, conf.eventId);
      case "sportMatches": return T.sportMatches(state, conf.sport);
      case "sportLive": return T.sportLive(state, conf.sport);
      case "sportLower": return T.sportLower(state, conf.sport);
      default:         return null;
    }
  }

  function renderSlot(slot, conf, state) {
    var host = document.getElementById("slot-" + slot);
    var prev = last[slot] || {};
    var cur = host.querySelector(".cg:not(.out)");
    var ms = animMs(state);

    var html = conf.visible ? buildTemplate(conf, state) : null;
    var isPaged = html != null && PAGED_TEMPLATES[conf.template];
    var sig = html == null ? null
      : isSport(conf.template) ? sportSig(state, conf.sport)
      : isPaged ? pagedSig(state)
      : conf.template === "chart" ? chartSig(state)
      : conf.template === "schedule" ? schedSig(state, conf.eventId)
      : null;

    // ไม่มีอะไรจะแสดง -> เอาออก
    if (html == null) {
      stopPager(slot);
      stopClockTick(slot);
      if (cur) {
        cur.classList.remove("in");
        cur.classList.add("out");
        var d = cur;
        setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms + 60);
      }
      last[slot] = { template: conf.template, eventId: conf.eventId, sport: conf.sport, visible: false };
      return;
    }

    // เนื้อหาเดิม -> ไม่ต้องทำอะไร (results: pager เล่นต่อ / schedule: หน้าต่างเท่าเดิม)
    var cont = cur && prev.visible && prev.template === conf.template;
    if (cont && sig != null && prev.sig === sig) return;

    // เทมเพลตผูกกับกีฬา (sportMatches/sportLive/sportLower) ต้องเช็ก "กีฬาเดียวกัน" ด้วย ไม่งั้นสลับบอล<->บาส
    // จะเข้าใจผิดว่าเป็นการ์ดเดิม (eventId ว่างเท่ากันทั้งคู่)
    var sameShell = (cont && isPaged) || (cur && prev.visible && prev.template === conf.template &&
      (isSport(conf.template) ? prev.sport === conf.sport : (prev.eventId === conf.eventId || conf.template === "schedule")));

    // แถบล่างสกอร์สด: ถ้าคู่/ชื่อคณะ/โลโก้/ชื่อกีฬาไม่เปลี่ยน -> แก้เฉพาะจุด (สกอร์/นาฬิกา/สถานะ)
    // จุด LIVE ไม่รีสตาร์ตกะพริบ โลโก้ไม่โหลดใหม่ ไม่มีวูบ
    var shell = conf.template === "sportLower" ? sportbarShell(state, conf.sport) : null;
    if (sameShell && conf.template === "sportLower" &&
        prev.shell != null && prev.shell === shell &&
        cur.querySelector(".sportbar")) {
      patchSportbar(cur.querySelector(".sportbar"), html);
    } else if (sameShell) {
      // อัปเดตข้อมูลสด ไม่ต้อง re-animate
      cur.innerHTML = html;
      if (conf.template === "sportLive") bumpLiveScore(slot, cur, state, conf.sport, false);
    } else {
      if (cur) {
        cur.classList.remove("in");
        cur.classList.add("out");
        var old = cur;
        setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, ms + 60);
      }
      var wrap = document.createElement("div");
      wrap.className = "cg tpl-" + conf.template;
      wrap.innerHTML = html;
      host.appendChild(wrap);
      void wrap.offsetWidth; // reflow
      // double rAF: การันตีว่าเฟรมแรก (opacity:0) ถูกวาดก่อน แล้วค่อยเริ่ม transition
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { wrap.classList.add("in"); });
      });
      if (conf.template === "sportLive") bumpLiveScore(slot, wrap, state, conf.sport, true);
    }

    if (isPaged) startPager(slot);
    else stopPager(slot);

    // schedule: ไล่แถวเข้าใหม่ทุกครั้ง (โผล่ครั้งแรก / เลื่อนหน้าต่าง)
    if (conf.template === "schedule") {
      var sl = host.querySelector(".cg:not(.out) .slist");
      if (sl) {
        sl.classList.remove("go");
        void sl.offsetWidth;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { sl.classList.add("go"); });
        });
      }
    }

    // สกอร์บอร์ดคู่สด / แถบล่าง: เดินนาฬิกาเอง (state ไม่เปลี่ยนระหว่างที่นาฬิกาวิ่งอยู่)
    if (isLiveSport(conf.template)) startClockTick(slot);
    else stopClockTick(slot);

    last[slot] = { template: conf.template, eventId: conf.eventId, sport: conf.sport, visible: true, sig: sig, shell: shell };
  }

  function apply(state) {
    if (!state || !state.settings) return;
    window.__state = state;
    applyTheme(state);

    var root = document.documentElement;
    root.style.setProperty("--anim", animMs(state) + "ms");
    var houses = state.settings.houses || {};
    Object.keys(houses).forEach(function (k) {
      root.style.setProperty("--" + k, houses[k]);
    });

    SLOTS.forEach(function (slot) {
      if (!slotInView(slot)) return;
      var conf = (state.onair && state.onair[slot]) || { visible: false };
      renderSlot(slot, conf, state);
    });
  }

  // ---- connection --------------------------------------------------- //
  function setOffline(off) {
    document.body.classList.toggle("is-offline", !!off);
  }

  var polling = false;

  function startSSE() {
    var es, gotMsg = false, done = false;
    function fallback() {
      if (done) return;
      done = true;
      try { es.close(); } catch (e) {}
      startPolling();
    }
    try { es = new EventSource("/api/events"); }
    catch (e) { startPolling(); return; }

    var guard = setTimeout(function () { if (!gotMsg) fallback(); }, 2500);
    es.onopen = function () { setOffline(false); };
    es.onmessage = function (e) {
      gotMsg = true; clearTimeout(guard); setOffline(false);
      try { apply(JSON.parse(e.data)); } catch (err) { /* ignore */ }
    };
    es.onerror = function () {
      setOffline(true);
      // ถ้ายังไม่เคยได้ข้อมูลเลย = server ไม่รองรับ SSE -> เปลี่ยนไป polling
      if (!gotMsg) { clearTimeout(guard); fallback(); }
    };
  }

  function startPolling() {
    if (polling) return;
    polling = true;
    var lastText = "";
    function tick() {
      fetch("/api/state", { cache: "no-store" })
        .then(function (r) { return r.text(); })
        .then(function (txt) {
          setOffline(false);
          if (txt !== lastText) {
            lastText = txt;
            apply(JSON.parse(txt));
          }
        })
        .catch(function () { setOffline(true); });
    }
    tick();
    setInterval(tick, 250);
  }

  if (transport === "poll") startPolling();
  else startSSE();
})();
