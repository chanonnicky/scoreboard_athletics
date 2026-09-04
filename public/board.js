/* board.js — จอ Scoreboard (เปิดค้างที่จอในงาน) อัปเดตสดจาก server
   2 โหมด ตาม URL:
     /scoreboard  หรือ /board            → วนผลทั้งหมด (ใช้ ?view=all|results|<กีฬา>)
     /scoreboard/<กีฬา>                  → สกอร์บอร์ดสดของคู่ที่กำลังแข่ง (football/basketball)
   query params:
     ?view=all          วนรวมทุกอย่าง: กรีฑา → ทุกกีฬา
         =results       (ดีฟอลต์) วนผลการแข่งขันกรีฑา
         =<กีฬา>        วนการ์ดของกีฬานั้น
     ?page=9            วินาทีต่อหน้า/ต่อการ์ด (ดีฟอลต์ 9)
     ?transport=poll    ใช้ polling แทน SSE
*/
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var transport = params.get("transport") || "sse";
  var VIEW = (params.get("view") || "results").toLowerCase();
  var INTERVAL = (parseFloat(params.get("page") || "9") || 9) * 1000;

  // โหมดสด: /scoreboard/<sport> หรือ /board/<sport>
  var seg = location.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  var LIVE_SPORT = (seg.length >= 2 && (seg[0] === "scoreboard" || seg[0] === "board")) ? seg[1] : null;

  var stage = document.getElementById("stage");
  var board = document.getElementById("board");

  // ---- ย่อ/ขยายเวที 1920×1080 ให้พอดีจอ ---------------------------- //
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = "translate(-50%, -50%) scale(" + s + ")";
  }
  window.addEventListener("resize", fit);
  fit();

  // ---- สร้างชุดการ์ดตาม view -------------------------------------- //
  function sportCards(T, state, key) {
    return [T.sportMatches(state, key)];
  }
  function buildCards(state) {
    var T = window.T;
    var sports = state.sports || [];
    if (VIEW === "all") {
      var cards = [T.results(state)];
      sports.forEach(function (sp) { cards = cards.concat(sportCards(T, state, sp.key)); });
      return cards;
    }
    for (var i = 0; i < sports.length; i++) {
      if (sports[i].key === VIEW) return sportCards(T, state, VIEW);
    }
    return [T.results(state)];
  }

  // ---- pager ภายในการ์ด results (.apage) -------------------------- //
  var pageTimer = null, pageIdx = 0;
  // หน้าย่อยของการ์ดที่กำลังแสดง (results หรือ sportMatches ที่แบ่งหน้า)
  function apages() { return board.querySelectorAll(".apage"); }
  function stopPager() { if (pageTimer) { clearInterval(pageTimer); pageTimer = null; } }
  function startPager() {
    stopPager();
    pageIdx = 0;
    var init = apages();
    if (!init.length) return;
    for (var i = 0; i < init.length; i++) init[i].classList.remove("show", "leaving");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { var p = apages()[0]; if (p) p.classList.add("show"); });
    });
    if (init.length < 2) return;
    pageTimer = setInterval(function () {
      var ps = apages();
      if (ps.length < 2) return;
      var out = ps[pageIdx % ps.length];
      out.classList.remove("show"); out.classList.add("leaving");
      (function (p) { setTimeout(function () { p.classList.remove("leaving"); }, 650); })(out);
      pageIdx = (pageIdx + 1) % ps.length;
      ps[pageIdx].classList.add("show");
    }, INTERVAL);
  }

  // ---- rotator ระหว่างการ์ด ---------------------------------------- //
  // ค้างแต่ละการ์ดนานตามจำนวนหน้าในตัว (results หลายหน้า = ต้องวนครบก่อน
  // ค่อยไปการ์ดถัดไป) ใช้ setTimeout ต่อกันแทน setInterval คงที่
  var cards = [], cardIdx = 0, rotTimer = null;
  function stopRotator() { if (rotTimer) { clearTimeout(rotTimer); rotTimer = null; } }
  function showCard(i) {
    stopRotator();
    cardIdx = i;
    var html = cards[i];
    board.innerHTML = html ? '<div class="cg">' + html + "</div>" : '<div class="board-empty">ยังไม่มีข้อมูล</div>';
    startPager(); // วน .apage ในการ์ด results (ถ้ามี) ทุก INTERVAL
    if (cards.length < 2) return; // การ์ดเดียว ไม่ต้องสลับ
    // ค้างการ์ดนี้ = (จำนวนหน้า) × INTERVAL เพื่อให้โชว์ครบทุกหน้าก่อนสลับ
    var pages = apages().length || 1;
    rotTimer = setTimeout(function () {
      showCard((cardIdx + 1) % cards.length);
    }, pages * INTERVAL);
  }

  // ---- render / live update -------------------------------------- //
  var lastSig = null;
  var livePrev = null;   // {id,hs,as,done} ของคู่สดล่าสุด — ใช้ตรวจว่าสกอร์เปลี่ยนเพื่อเด้งแอนิเมชัน
  function bumpLive(sel) {
    var el = board.querySelector(".live-score " + sel);
    if (!el) return;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }

  // ---- นาฬิกาแมตช์ (สตอปวอตช์) — เดินเองทุกครึ่งวินาทีระหว่างที่ state ไม่เปลี่ยน ---- //
  var clockTimer = null;
  function stopClockTick() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }
  function tickClock() {
    var el = board.querySelector(".live-clock");
    if (!el || el.getAttribute("data-run") !== "1") { stopClockTick(); return; }
    var base = parseFloat(el.getAttribute("data-el")) || 0;
    var since = parseFloat(el.getAttribute("data-since")) || 0;
    el.textContent = window.T.fmtClock(base + Math.max(0, (Date.now() - since) / 1000));
  }
  function startClockTick() {
    stopClockTick();
    var el = board.querySelector('.live-clock[data-run="1"]');
    if (el) { tickClock(); clockTimer = setInterval(tickClock, 500); }
  }
  function sigOf(state) {
    var r = state.results || {}, s = state.settings || {};
    var evs = (state.events || []).map(function (e) {
      return e.id + "~" + (e.title || "") + "~" + (e.level || e.ageGroup || "");
    }).join("|");
    var rs = Object.keys(r).sort().map(function (k) {
      return k + ":" + (r[k] || []).map(function (x) { return x.rank + "" + x.house; }).join(",");
    }).join("|");
    return (LIVE_SPORT || VIEW) + "||" + evs + "||" + rs + "||" + (s.meetTitle || "") +
      "||" + JSON.stringify(s.houseNames || {}) +
      "||" + JSON.stringify(s.houseLogos || {}) +
      "||" + (s.logo || "") +
      "||" + JSON.stringify(state.sports || []);
  }

  function apply(state) {
    if (!state || !state.settings) return;
    var root = document.documentElement;
    var houses = state.settings.houses || {};
    Object.keys(houses).forEach(function (k) { root.style.setProperty("--" + k, houses[k]); });

    var sig = sigOf(state);
    if (sig === lastSig) return; // ไม่เปลี่ยน -> ปล่อยหมุนต่อ
    lastSig = sig;

    // โหมดสด: การ์ดเดียว อัปเดตในที่ (ไม่ fade/ไม่วน) เพื่อสกอร์เปลี่ยนแล้วไม่กระพริบ
    if (LIVE_SPORT) {
      stopRotator(); stopPager();
      var sp = null, sps = state.sports || [];
      for (var si = 0; si < sps.length; si++) if (sps[si].key === LIVE_SPORT) { sp = sps[si]; break; }
      var lm = null;
      if (sp && sp.currentId) {
        var mms = sp.matches || [];
        for (var mi = 0; mi < mms.length; mi++) if (mms[mi].id === sp.currentId) { lm = mms[mi]; break; }
      }
      var lhtml = window.T.sportLive(state, LIVE_SPORT);
      if (!lhtml) {
        board.innerHTML = '<div class="board-empty">ไม่พบกีฬา "' + LIVE_SPORT + '"</div>';
        livePrev = null;
        stopClockTick();
        return;
      }
      // คู่ใหม่/เพิ่งเปิดจอ -> ห่อ .cg ให้ boardIn เล่นเข้า; อัปเดตสกอร์เดิม -> แทนที่ในที่ (ไม่ replay boardIn)
      var freshShow = !livePrev || !lm || livePrev.id !== lm.id;
      if (freshShow) {
        board.innerHTML = '<div class="cg">' + lhtml + "</div>";
      } else {
        board.innerHTML = lhtml;
        if ((Number(lm.hs) || 0) !== livePrev.hs) bumpLive(".ls-h");
        if ((Number(lm.as) || 0) !== livePrev.as) bumpLive(".ls-a");
        if (lm.done && !livePrev.done) {
          var lc = board.querySelector(".tpl-live-card");
          if (lc) lc.classList.add("just-final");
        }
      }
      livePrev = lm ? { id: lm.id, hs: Number(lm.hs) || 0, as: Number(lm.as) || 0, done: !!lm.done } : null;
      startClockTick();
      return;
    }
    stopClockTick();

    var prevCount = cards.length;
    var next = buildCards(state).filter(function (h) { return h != null; });
    if (!next.length) {
      stopRotator(); stopPager();
      cards = [];
      board.innerHTML = '<div class="board-empty">ยังไม่มีข้อมูล</div>';
      return;
    }

    cards = next;   // อัปเดตเนื้อหาเงียบ ๆ — ตัววนจะหยิบไปแสดงเองรอบถัดไป ไม่รีเฟรชจอที่กำลังโชว์

    if (prevCount === 0 || prevCount !== cards.length) {
      // เพิ่งเริ่ม หรือ จำนวนการ์ดเปลี่ยน (เพิ่ม/ลบกีฬา) -> เรนเดอร์ทันที
      showCard(Math.min(cardIdx, cards.length - 1));
    } else if (cards.length === 1) {
      // การ์ดเดียว ไม่มีการวน -> อัปเดตเนื้อหาในที่ (ไม่ replay boardIn, ไม่รีสตาร์ท rotator)
      refreshCurrentCard();
    }
    // ไม่งั้น: ปล่อยให้วนต่อตามเดิม — ข้อมูลใหม่จะขึ้นตอนวนกลับมาถึงการ์ดนั้น
  }

  // อัปเดตเนื้อหาการ์ดที่กำลังแสดง โดยไม่สร้าง .cg ใหม่ (จึงไม่มี boardIn) และไม่แตะ rotTimer
  function refreshCurrentCard() {
    var cg = board.querySelector(".cg");
    if (!cg) { showCard(cardIdx); return; }
    cg.innerHTML = cards[cardIdx] || "";
    startPager();
  }

  // ---- connection (SSE + poll fallback) -------------------------- //
  function setOffline(off) { document.body.classList.toggle("is-offline", !!off); }
  var polling = false;

  function startSSE() {
    var es, gotMsg = false, done = false;
    function fallback() { if (done) return; done = true; try { es.close(); } catch (e) {} startPolling(); }
    try { es = new EventSource("/api/events"); } catch (e) { startPolling(); return; }
    var guard = setTimeout(function () { if (!gotMsg) fallback(); }, 2500);
    es.onopen = function () { setOffline(false); };
    es.onmessage = function (e) {
      gotMsg = true; clearTimeout(guard); setOffline(false);
      try { apply(JSON.parse(e.data)); } catch (err) { /* ignore */ }
    };
    es.onerror = function () { setOffline(true); if (!gotMsg) { clearTimeout(guard); fallback(); } };
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
          if (txt !== lastText) { lastText = txt; apply(JSON.parse(txt)); }
        })
        .catch(function () { setOffline(true); });
    }
    tick();
    setInterval(tick, 300);   // เร็วขึ้น (เดิม 1000) ให้สกอร์สดดูเรียลไทม์แม้ตกมาใช้ poll
  }

  if (transport === "poll") startPolling();
  else startSSE();
})();
