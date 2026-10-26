/* overlay.js — โหลดใน OBS Browser Source / vMix Web Browser
   query params:
     ?slot=both|lower|full      ช่องที่จะแสดง (ดีฟอลต์ both)
     ?scale=1.0                 ย่อ/ขยายทั้งจอ
     ?transport=sse|poll        วิธีรับข้อมูล (ดีฟอลต์ sse; ใช้ poll ถ้าเน็ตบล็อก SSE)
     ?ch=main|cg                ช่องสัญญาณ (ดีฟอลต์ main = งานกีฬา/งานทั่วไป)
                                cg = ช่อง Lower Third / Bar (state.l3) — path /live/cg ก็ได้

   สองช่องนี้ "อิสระต่อกัน": เปิดเป็น Browser Source 2 ตัวใน OBS พร้อมกันได้
   สาย main ไม่ถูกแตะเลยจากการเพิ่มช่อง cg (เงื่อนไขทุกอันแยกด้วย CH)
*/
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var view = params.get("slot") || "both";
  // ช่องสัญญาณ: จาก path (/live/cg, /overlay/cg) หรือ ?ch=cg
  var _p = location.pathname.replace(/\/+$/, "");
  var CH = (_p === "/live/cg" || _p === "/overlay/cg" || params.get("ch") === "cg") ? "cg" : "main";
  var IS_CG = CH === "cg";
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
    // ช่อง cg จำธีมของตัวเองที่ l3.settings.theme
    if (!t) {
      var s = IS_CG ? ((state && state.l3 && state.l3.settings) || null)
                    : ((state && state.settings) || null);
      t = (s && s.theme) || "default";
    }
    var el = document.documentElement;
    THEMES.forEach(function (name) { el.classList.toggle(name, t === name); });
  }
  applyTheme(null);

  var stage = document.getElementById("stage");
  // ย่อ/ขยาย + จัดกึ่งกลางเวที 1920x1080 ให้พอดี viewport จริงเสมอ — OBS Browser Source
  // ปกติได้ viewport ตรงตามที่ตั้งอยู่แล้ว (s ~= scale พารามิเตอร์ ไม่ต่างจากเดิม) แต่ vMix Web
  // Browser บางเครื่อง (DPI scaling ของ Windows ฯลฯ) ได้ viewport จริงไม่เท่าที่ตั้งไว้ ทำให้จอ
  // เพี้ยนไปด้านใดด้านหนึ่งถ้าไม่คำนวณสัดส่วนใหม่ทุกครั้ง
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) * scale;
    stage.style.transform = "translate(-50%, -50%) scale(" + s + ")";
  }
  window.addEventListener("resize", fit);
  fit();

  // ช่อง main = 3 ช่องเดิม · ช่อง cg = 5 ช่อง (เพิ่มแถบประกาศบนจอ + แถบวิ่งล่างสุด)
  var SLOTS = IS_CG ? ["full", "top", "lower", "ticker", "bug"] : ["full", "lower", "bug"];
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
  function isSport(t) { return t === "sportMatches" || t === "sportLive" || t === "sportLower" || t === "scoreBug"; }
  // CG งานทั่วไป (Lower Third generator) — เปลี่ยนตามข้อความ + โลโก้
  function isGen(t) { return t === "genLowerName" || t === "genLowerTopic" || t === "genTitle"; }
  function genSig(state, conf) {
    var s = state.settings || {};
    return (conf.template || "") + "||" + (conf.line1 || "") + "||" + (conf.line2 || "") + "||" + (s.logo || "");
  }
  // เทมเพลตสกอร์สด (เดินนาฬิกา + เด้งสกอร์เอง): สกอร์บอร์ดเต็มจอ + แถบล่าง + score bug มุมจอ
  function isLiveSport(t) { return t === "sportLive" || t === "sportLower" || t === "scoreBug"; }

  // ช่อง cg (Lower Third / Bar) — ลายเซ็นต้องครอบ *ทุก* ฟิลด์ที่เทมเพลตอ่าน
  // ไม่งั้นการ push ที่เปลี่ยนแค่ฟิลด์ที่ตกไปจะชน early-return แล้วไม่ขึ้นจอเลย
  function l3Sig(l3, conf) {
    var s = (l3 && l3.settings) || {};
    return (conf.type || "") + "||" + (conf.itemId || "") +
      "||" + JSON.stringify(conf.fields || {}) +
      "||" + JSON.stringify(conf.style || {}) +
      "||" + (conf.until || 0) +
      // ค่าตั้งต้นของช่องมีผลกับทุกชิ้น (style ของชิ้นงานทับค่าพวกนี้)
      "||" + JSON.stringify([s.logo, s.accent, s.ink, s.bg, s.align, s.size, s.anim, s.font,
                             s.tickerSec, s.sponsorSec]);
  }

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

  // ---- ช่อง cg: นาฬิกา / นับถอยหลัง / หมดเวลา auto-hide ------------------ //
  // ตัวเดียวเดินให้ทุกช่อง (ของเบา ๆ แค่แก้ textContent) — state ไม่เปลี่ยนระหว่างนี้
  var l3Timer = null;
  function l3TickAll() {
    var host = document.getElementById("stage");
    if (!host) return;
    // นาฬิกาเวลาปัจจุบัน
    var clocks = host.querySelectorAll(".cg:not(.out) .l3-clock[data-l3clock]");
    for (var i = 0; i < clocks.length; i++) {
      var txt = T.l3Now(clocks[i].getAttribute("data-l3clock") === "1");
      if (clocks[i].textContent !== txt) clocks[i].textContent = txt;
    }
    // นับถอยหลัง
    var cds = host.querySelectorAll(".cg:not(.out) .l3-cd[data-l3cd]");
    for (var j = 0; j < cds.length; j++) {
      var target = parseFloat(cds[j].getAttribute("data-l3cd")) || 0;
      var left = Math.max(0, (target - Date.now()) / 1000);
      var done = cds[j].getAttribute("data-l3done") || "";
      var v = (left <= 0 && done) ? done : T.l3Dur(left);
      if (cds[j].textContent !== v) cds[j].textContent = v;
      if (left <= 0) cds[j].classList.add("l3-ended");
    }
  }
  function startL3Tick() {
    if (l3Timer) return;
    l3Timer = setInterval(function () {
      l3TickAll();
      // auto-hide: ถ้ามีช่องที่ until เลยมาแล้ว ให้ re-render เพื่อถอดออกจากจอ
      if (l3ExpiredNow()) apply(window.__state);
    }, 500);
  }
  // มีช่องที่ยังโชว์อยู่แต่ until เลยเวลาไปแล้วหรือไม่
  function l3ExpiredNow() {
    var st = window.__state;
    var onair = (st && st.l3 && st.l3.onair) || {};
    var now = Date.now();
    for (var k = 0; k < SLOTS.length; k++) {
      var conf = onair[SLOTS[k]];
      if (!conf || !conf.visible) continue;
      var until = parseFloat(conf.until) || 0;
      if (until > 0 && now >= until && last[SLOTS[k]] && last[SLOTS[k]].visible) return true;
    }
    return false;
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
  // แก้ค่าในที่ให้ทั้ง .sportbar (แถบล่าง) และ .scorebug (มุมจอ) — โครงสร้างต่างกันแค่ prefix
  // สกอร์/สถานะจบที่เปลี่ยน ต้องมี animation (เด้งสกอร์ + วูบตอนจบ) เหมือน sportLive ไม่ใช่แค่
  // สลับข้อความเงียบ ๆ — เทียบค่าเก่า/ใหม่ก่อนเขียนทับเสมอ
  function patchLiveBar(bar, html, rootSel, homeSel, awaySel) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var next = tmp.querySelector(rootSel);
    if (!bar || !next) return false;
    function cls(sel) {
      var a = bar.querySelector(sel), b = next.querySelector(sel);
      if (a && b && a.className !== b.className) a.className = b.className;
    }
    ["h", "a"].forEach(function (side) {
      var sel = ".ls-" + side;
      var a = bar.querySelector(sel), b = next.querySelector(sel);
      if (a && b && a.textContent !== b.textContent) {
        a.textContent = b.textContent;
        bumpEl(bar, sel);
      }
    });
    cls(homeSel); cls(awaySel);
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
    if (bar.getAttribute("data-done") !== d) {
      bar.setAttribute("data-done", d);
      if (d === "1") {
        bar.classList.remove("just-final");
        void bar.offsetWidth;
        bar.classList.add("just-final");
      }
    }
    return true;
  }
  function patchSportbar(bar, html) {
    return patchLiveBar(bar, html, ".sportbar", ".sportbar-home", ".sportbar-away");
  }
  function patchScoreBug(bar, html) {
    return patchLiveBar(bar, html, ".scorebug", ".scorebug-home", ".scorebug-away");
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
      case "scoreBug": return T.scoreBug(state, conf.sport);
      case "genLowerName":  return T.genLowerName(state, conf);
      case "genLowerTopic": return T.genLowerTopic(state, conf);
      case "genTitle":      return T.genTitle(state, conf);
      default:         return null;
    }
  }

  function renderSlot(slot, conf, state) {
    var host = document.getElementById("slot-" + slot);
    var prev = last[slot] || {};
    var cur = host.querySelector(".cg:not(.out)");
    var ms = animMs(state);

    // ช่อง cg: เรนเดอร์ด้วย T.l3 ไม่ผ่าน logic ของงานกีฬาเลย (ไม่มี pager / patch / score bump)
    var html = !conf.visible ? null
      : IS_CG ? T.l3(state, conf)
      : buildTemplate(conf, state);
    var isPaged = !IS_CG && html != null && PAGED_TEMPLATES[conf.template];
    var sig = html == null ? null
      : IS_CG ? l3Sig(state, conf)
      : isSport(conf.template) ? sportSig(state, conf.sport)
      : isPaged ? pagedSig(state)
      : conf.template === "chart" ? chartSig(state)
      : conf.template === "schedule" ? schedSig(state, conf.eventId)
      : isGen(conf.template) ? genSig(state, conf)
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
      last[slot] = { template: conf.template, type: conf.type, eventId: conf.eventId,
                     sport: conf.sport, visible: false };
      return;
    }

    // เนื้อหาเดิม -> ไม่ต้องทำอะไร (results: pager เล่นต่อ / schedule: หน้าต่างเท่าเดิม)
    // ช่อง cg ใช้ conf.type เป็นตัวแยกชนิด (ไม่มี conf.template)
    var cont = cur && prev.visible &&
      (IS_CG ? prev.type === conf.type : prev.template === conf.template);
    if (cont && sig != null && prev.sig === sig) return;

    // เทมเพลตผูกกับกีฬา (sportMatches/sportLive/sportLower) ต้องเช็ก "กีฬาเดียวกัน" ด้วย ไม่งั้นสลับบอล<->บาส
    // จะเข้าใจผิดว่าเป็นการ์ดเดิม (eventId ว่างเท่ากันทั้งคู่)
    // CG งานทั่วไป + ช่อง cg: ทุกครั้งที่ push = exit/enter ใหม่ (re-animate) ไม่ patch เงียบ
    var sameShell = !IS_CG && !isGen(conf.template) && ((cont && isPaged) || (cur && prev.visible && prev.template === conf.template &&
      (isSport(conf.template) ? prev.sport === conf.sport : (prev.eventId === conf.eventId || conf.template === "schedule"))));

    // แถบล่างสกอร์สด (sportLower) / score bug มุมจอ (scoreBug): ถ้าคู่/ชื่อคณะ/โลโก้/ชื่อกีฬา
    // ไม่เปลี่ยน -> แก้เฉพาะจุด (สกอร์/นาฬิกา/สถานะ) จุด LIVE ไม่รีสตาร์ต โลโก้ไม่โหลดใหม่ ไม่มีวูบ
    var isBar = !IS_CG && (conf.template === "sportLower" || conf.template === "scoreBug");
    var barSel = conf.template === "scoreBug" ? ".scorebug" : ".sportbar";
    var shell = isBar ? sportbarShell(state, conf.sport) : null;
    if (sameShell && isBar &&
        prev.shell != null && prev.shell === shell &&
        cur.querySelector(barSel)) {
      (conf.template === "scoreBug" ? patchScoreBug : patchSportbar)(cur.querySelector(barSel), html);
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
      wrap.className = IS_CG ? "cg l3cg l3t-" + conf.type : "cg tpl-" + conf.template;
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
    if (!IS_CG && isLiveSport(conf.template)) startClockTick(slot);
    else if (!IS_CG) stopClockTick(slot);

    last[slot] = { template: conf.template, type: conf.type, eventId: conf.eventId,
                   sport: conf.sport, visible: true, sig: sig, shell: shell };
  }

  function apply(state) {
    if (!state) return;
    window.__state = state;
    applyTheme(state);

    // ช่อง cg อ่าน settings/onair ของตัวเองที่ state.l3 (สาย main ไม่เปลี่ยนเลย)
    var src = IS_CG ? (state.l3 || null) : state;
    if (!src || !src.settings) return;

    var root = document.documentElement;
    root.style.setProperty("--anim", animMs(src) + "ms");
    if (!IS_CG) {
      var houses = state.settings.houses || {};
      Object.keys(houses).forEach(function (k) {
        root.style.setProperty("--" + k, houses[k]);
      });
    }

    SLOTS.forEach(function (slot) {
      if (!slotInView(slot)) return;
      var conf = (src.onair && src.onair[slot]) || { visible: false };
      renderSlot(slot, conf, src);
    });

    // ช่อง cg: เดินนาฬิกา/นับถอยหลัง/หมดเวลา auto-hide ตัวเดียวสำหรับทุกช่อง
    if (IS_CG) startL3Tick();
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
