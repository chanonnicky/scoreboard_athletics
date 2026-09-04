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

  var stage = document.getElementById("stage");
  stage.style.transform = "scale(" + scale + ")";

  var SLOTS = ["full", "lower"];
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
    return eventsSig(state) + "||" + rs + "||" + (s.meetTitle || "") + "||" + JSON.stringify(s.houseNames || {});
  }
  // schedule เปลี่ยนตามรายการ + รายการที่เลือก (ไม่สนผลการแข่ง)
  function schedSig(state, eid) {
    return (eid || "") + "||" + eventsSig(state) + "||" + ((state.settings || {}).meetTitle || "");
  }
  // กีฬา: re-render เมื่อข้อมูลกีฬา/ชื่อ-โลโก้คณะ เปลี่ยน
  function sportSig(state, sportKey) {
    var s = state.settings || {};
    return (sportKey || "") + "||" + JSON.stringify(state.sports || []) +
      "||" + JSON.stringify(s.houseNames || {}) + "||" + JSON.stringify(s.houseLogos || {});
  }
  function isSport(t) { return t === "sportMatches" || t === "sportLive"; }

  // ---- นาฬิกาแมตช์ (สตอปวอตช์) + สกอร์เด้ง สำหรับ sportLive บนจอ Live ---- //
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
    el.textContent = T.fmtClock(base + Math.max(0, (Date.now() - since) / 1000));
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
      case "schedule": return T.schedule(state, conf.eventId);
      case "sportMatches": return T.sportMatches(state, conf.sport);
      case "sportLive": return T.sportLive(state, conf.sport);
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

    // เทมเพลตผูกกับกีฬา (sportMatches/sportLive) ต้องเช็ก "กีฬาเดียวกัน" ด้วย ไม่งั้นสลับบอล<->บาส
    // จะเข้าใจผิดว่าเป็นการ์ดเดิม (eventId ว่างเท่ากันทั้งคู่)
    var sameShell = (cont && isPaged) || (cur && prev.visible && prev.template === conf.template &&
      (isSport(conf.template) ? prev.sport === conf.sport : (prev.eventId === conf.eventId || conf.template === "schedule")));

    if (sameShell) {
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

    // สกอร์บอร์ดคู่สด: เดินนาฬิกาเอง (state ไม่เปลี่ยนระหว่างที่นาฬิกาวิ่งอยู่)
    if (conf.template === "sportLive") startClockTick(slot);
    else stopClockTick(slot);

    last[slot] = { template: conf.template, eventId: conf.eventId, sport: conf.sport, visible: true, sig: sig };
  }

  function apply(state) {
    if (!state || !state.settings) return;
    window.__state = state;

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
