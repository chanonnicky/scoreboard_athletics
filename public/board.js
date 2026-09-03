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
      var html = window.T.sportLive(state, LIVE_SPORT);
      board.innerHTML = html || '<div class="board-empty">ไม่พบกีฬา "' + LIVE_SPORT + '"</div>';
      return;
    }

    var prevCount = cards.length;
    cards = buildCards(state).filter(function (h) { return h != null; });
    if (!cards.length) {
      stopRotator(); stopPager();
      board.innerHTML = '<div class="board-empty">ยังไม่มีข้อมูล</div>';
      return;
    }
    // จำนวนการ์ดเท่าเดิม = แค่เนื้อหา/สกอร์อัปเดต -> re-render การ์ดที่แสดงอยู่
    // ไม่กระโดดกลับหน้าแรก (เดิม startRotator รีเซ็ตไป card 0 ทุกครั้งที่สกอร์เปลี่ยน)
    showCard(prevCount === cards.length ? Math.min(cardIdx, cards.length - 1) : 0);
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
