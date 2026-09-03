/* board.js — จอประชาสัมพันธ์ (เปิดค้างที่จอโรงเรียน) อัปเดตสดจาก server
   query params:
     ?view=all          วนรวมทุกอย่าง: กรีฑา → ทุกกีฬา (แมตช์/ตาราง/สาย)
         =results       (ดีฟอลต์) วนผลการแข่งขันกรีฑาทีละหน้า
         =<กีฬา>        วน 3 การ์ดของกีฬานั้น เช่น football, basketball, sprint, tugofwar
     ?page=9            วินาทีต่อหน้า/ต่อการ์ด (ดีฟอลต์ 9)
     ?transport=poll    ใช้ polling แทน SSE
*/
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var transport = params.get("transport") || "sse";
  var VIEW = (params.get("view") || "results").toLowerCase();
  var INTERVAL = (parseFloat(params.get("page") || "9") || 9) * 1000;

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
  function apages() {
    var cg = board.querySelector(".tpl-results-card");
    return (cg && cg.querySelectorAll(".apage")) || [];
  }
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

  // ---- rotator ระหว่างการ์ด (football = หลายใบ) ------------------- //
  var cards = [], cardIdx = 0, rotTimer = null;
  function stopRotator() { if (rotTimer) { clearInterval(rotTimer); rotTimer = null; } }
  function showCard(i) {
    cardIdx = i;
    var html = cards[i];
    board.innerHTML = html ? '<div class="cg">' + html + "</div>" : '<div class="board-empty">ยังไม่มีข้อมูล</div>';
    startPager(); // มีผลเฉพาะการ์ด results ที่มี .apage
  }
  function startRotator() {
    stopRotator();
    showCard(0);
    if (cards.length < 2) return;
    rotTimer = setInterval(function () {
      showCard((cardIdx + 1) % cards.length);
    }, INTERVAL);
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
    return VIEW + "||" + evs + "||" + rs + "||" + (s.meetTitle || "") +
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

    cards = buildCards(state).filter(function (h) { return h != null; });
    if (!cards.length) {
      stopRotator(); stopPager();
      board.innerHTML = '<div class="board-empty">ยังไม่มีข้อมูล</div>';
      return;
    }
    startRotator();
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
    setInterval(tick, 1000);
  }

  if (transport === "poll") startPolling();
  else startSSE();
})();
