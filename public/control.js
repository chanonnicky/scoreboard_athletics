/* control.js — 2 โหมด: /control (operator สั่ง CG) และ /score (คนจดคะแนน) */
(function () {
  "use strict";

  // เส้นทาง: /control = คุม Live · /score = จดกรีฑา · /score/<sport> = จดคะแนนกีฬานั้น
  var _path = location.pathname.replace(/\/+$/, "");
  var MODE = "control", SCORE_SPORT = null;
  if (_path === "/score") { MODE = "score"; }
  else if (_path.indexOf("/score/") === 0) { MODE = "score"; SCORE_SPORT = _path.slice("/score/".length); }

  var esc = T.esc;
  var panel = document.getElementById("panel");
  var toastEl = document.getElementById("toast");
  var tokenInput = document.getElementById("token");

  if (MODE === "score") {
    document.title = "CG Live — จดคะแนน" + (SCORE_SPORT ? " " + SCORE_SPORT : "");
    document.body.classList.add("mode-score");
    // จดคะแนนกีฬา (บอล/บาส) มีตารางแมตช์หลายคอลัมน์ — ต้องกว้างกว่าหน้าจดกรีฑา
    if (SCORE_SPORT) document.body.classList.add("mode-sport");
    var brand = document.querySelector(".brand");
    if (brand) brand.innerHTML = "🏁 จดคะแนน <span>" + (SCORE_SPORT || "กีฬาสี") + "</span>";
  }

  var state = null;
  var activeView = viewFromHash();   // /control: live | events | import | settings (จาก location.hash)
  var firstLoaded = false;
  var pendingRender = false;

  var selOverride = null;   // ค่ารายการที่เลือกแบบชั่วคราว (optimistic) จนกว่าเซิร์ฟเวอร์จะสะท้อนกลับ
  var lastSelfSet = null;   // รายการที่ "เครื่องนี้" เป็นคนเปลี่ยนล่าสุด (กัน toast เด้งใส่ตัวเอง)
  var selTimer = null;      // debounce ส่ง setSettings.selEventId
  var editing = null; // draft ของ event ที่กำลังแก้
  var resDraft = { eid: null, rows: [] }; // ผลอันดับที่กำลังแก้ (array ของ house key เรียงตามอันดับ)
  var sportSel = null;      // key กีฬาที่กำลังแก้ในแท็บกีฬา
  var sportDraft = null;    // ก้อนกีฬาที่กำลังแก้ (null = โหลดจาก state ใหม่)
  var sportSaveTimer = null; // debounce บันทึกกีฬา

  var TPL_NAMES = {
    top3: "อันดับ 1–3", results: "ผลการแข่งขัน", schedule: "ตารางการแข่งขัน",
    chart: "กราฟเหรียญรางวัล",
    sportMatches: "กีฬา · ผลแมตช์", sportLive: "กีฬา · สกอร์สด",
    sportLower: "แถบล่าง · สกอร์สด", scoreBug: "Score bug",
    genLowerName: "แถบล่าง · ชื่อ-ตำแหน่ง", genLowerTopic: "แถบล่าง · หัวข้อ",
    genTitle: "เต็มจอ · การ์ดหัวเรื่อง",
  };
  function isSportTpl(t) {
    return t === "sportMatches" || t === "sportLive" || t === "sportLower" || t === "scoreBug";
  }

  // ธีมแสดงผล (สกินพื้นผิว บนจอ Live / Scoreboard) — เลือกในแท็บ "ตั้งค่า"
  var THEME_OPTS = [
    ["default", "ปกติ (ทึบ)"],
    ["glass", "🧊 Liquid Glass"],
    ["clay", "🟤 Claymorphism (สว่าง)"],
    ["claydark", "🟤 Claymorphism (เข้ม)"],
    ["neu", "⚪ Neumorphism"],
    ["retro", "🌆 Retro-Futurism"],
    ["editorial", "📰 Editorial / Magazine"],
    ["broken", "📐 Asymmetrical"],
    ["bauhaus", "🔺 Bauhaus"],
    ["techno", "🖤 Dark Techno / Techwear"],
    ["popart", "💥 Pop Art"],
    ["illustrative", "✏️ Illustrative"],
    ["y2k", "🫧 Y2K / Frutiger Aero"],
    ["swiss", "🔲 Swiss / International Typographic"],
    ["pastel", "🍬 Pastel"],
  ];
  function themeLabel(slug) {
    for (var i = 0; i < THEME_OPTS.length; i++) if (THEME_OPTS[i][0] === slug) return THEME_OPTS[i][1];
    return slug;
  }

  // ---- token ------------------------------------------------------- //
  tokenInput.value = localStorage.getItem("cg_token") || "";
  tokenInput.addEventListener("input", function () {
    localStorage.setItem("cg_token", tokenInput.value.trim());
  });
  function hdrs() {
    var h = { "Content-Type": "application/json" };
    var t = tokenInput.value.trim();
    if (t) h["X-Token"] = t;
    return h;
  }

  // ---- server calls --------------------------------------------- //
  function cmd(obj) {
    return fetch("/api/command", { method: "POST", headers: hdrs(), body: JSON.stringify(obj) })
      .then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (e) {
          throw new Error(e.error || ("HTTP " + r.status));
        });
        return true;
      })
      .catch(function (err) { toast(String(err.message || err), true); return false; });
  }
  function importCsv(kind, csv) {
    return fetch("/api/import", { method: "POST", headers: hdrs(), body: JSON.stringify({ kind: kind, csv: csv }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || "import ล้มเหลว");
        return res.j;
      })
      .catch(function (err) { toast(String(err.message || err), true); return null; });
  }

  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.className = "toast"; }, 2600);
  }

  // ---- connection ---------------------------------------------- //
  var connEl = document.getElementById("conn");
  function setConn(ok) {
    connEl.textContent = ok ? "● เชื่อมต่อแล้ว" : "● หลุดการเชื่อมต่อ";
    connEl.className = "conn " + (ok ? "ok" : "bad");
  }
  var polling = false;

  function startPolling() {
    if (polling) return;
    polling = true;
    var lastText = "";
    function tick() {
      fetch("/api/state", { cache: "no-store" })
        .then(function (r) { return r.text(); })
        .then(function (txt) {
          setConn(true);
          if (txt !== lastText) {
            lastText = txt;
            try { state = JSON.parse(txt); } catch (e) { return; }
            onState();
          }
        })
        .catch(function () { setConn(false); });
    }
    tick();
    setInterval(tick, 400);
  }

  (function startSSE() {
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
    es.onopen = function () { setConn(true); };
    es.onerror = function () { setConn(false); if (!gotMsg) { clearTimeout(guard); fallback(); } };
    es.onmessage = function (e) {
      gotMsg = true; clearTimeout(guard); setConn(true);
      try { state = JSON.parse(e.data); } catch (err) { return; }
      onState();
    };
  })();

  // ชื่อกีฬาไทยจาก key (เช่น "futsal" -> "ฟุตซอล") — ต้องรอ state โหลดก่อน
  function sportName(key) {
    var sp = sportByKey(key);
    return (sp && sp.name) || key || "";
  }
  // แบรนด์บน sidebar + topbar ตามผลิตภัณฑ์ (งานกีฬา = "กีฬาสี" · งานทั่วไป = "งานทั่วไป")
  function applyAppBrand() {
    if (MODE === "score") return;   // /score จัดการแบรนด์เองใน renderScoreBrand
    var key = isGeneralApp() ? "gen" : "sports";
    if (applyAppBrand._k === key) return;
    applyAppBrand._k = key;
    var html = (isGeneralApp() ? "🎬" : "🏃") + " CG Live <span>" +
      (isGeneralApp() ? "งานทั่วไป" : "กีฬาสี") + "</span>";
    [].forEach.call(document.querySelectorAll(".brand, .sb-brand"), function (el) { el.innerHTML = html; });
  }

  // แก้หัวข้อ/แบรนด์หน้า /score/<sport> ให้เป็นชื่อกีฬาไทย (บรรทัด 16–23 เป็นแค่ fallback ก่อน state มา)
  function renderScoreBrand() {
    if (MODE !== "score") return;
    if (isGeneralApp()) {
      document.title = "CG Live — งานทั่วไป";
      var b0 = document.querySelector(".brand");
      if (b0) b0.innerHTML = "🎬 CG Live <span>งานทั่วไป</span>";
      return;
    }
    var label = SCORE_SPORT ? sportName(SCORE_SPORT)
      : ((state && state.settings && state.settings.meetTitle) || (isSchool() ? "การแข่งขัน" : "กีฬาสี"));
    document.title = "CG Live — จดคะแนน" + (SCORE_SPORT ? " " + label : "");
    var brand = document.querySelector(".brand");
    if (brand) brand.innerHTML = "🏁 จดคะแนน <span>" + esc(label) + "</span>";
  }

  function onState() {
    document.body.classList.toggle("app-general", isGeneralApp());
    applyAppBrand();
    renderScoreBrand();
    renderHeader();

    // รายการที่เลือก = แชร์ทั้งงาน — เคลียร์ override เมื่อเซิร์ฟเวอร์สะท้อนค่าเรากลับมา
    // และเด้ง toast เมื่อ "เครื่องอื่น" เปลี่ยนรายการ
    var srvSel = (state.settings && state.settings.selEventId) || "";
    var mine = (srvSel === selOverride) || (srvSel === lastSelfSet);
    if (selOverride && srvSel === selOverride) selOverride = null;
    if (firstLoaded && srvSel && !mine && srvSel !== onState._lastSel) {
      var ev = (state.events || []).find(function (e) { return e.id === srvSel; });
      if (ev) toast("รายการถูกเปลี่ยนเป็น: " + ev.title);
    }
    onState._lastSel = srvSel;

    renderSidebar();

    if (!firstLoaded) { firstLoaded = true; render(); return; }
    safeRender();
  }

  function safeRender() {
    var a = document.activeElement;
    // กำลังกรอกผลการแข่งขัน (ยังมีการบันทึกอัตโนมัติค้างอยู่) —
    // ไม่ rebuild ทั้งหน้า พรีวิว overlay จะได้ไม่โหลดใหม่ระหว่างแตะ
    if (resSaveTimer || sportSaveTimer) return;
    if (panel.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
      pendingRender = true;
      var b = document.getElementById("dirtyBadge");
      if (b) b.textContent = "· มีข้อมูลใหม่จากเซิร์ฟเวอร์ (กด \"โหลดใหม่\")";
      return;
    }
    render();
  }

  // ---- header ------------------------------------------------- //
  function renderHeader() {
    if (!state) return;
    var o = state.onair || {};
    document.getElementById("onairStatus").innerHTML = ["lower", "full"].map(function (slot) {
      var s = o[slot] || {};
      if (!s.visible || !s.template) return '<span class="chip">' + slot + ": —</span>";
      var label = TPL_NAMES[s.template] || s.template;
      if (isSportTpl(s.template) && s.sport) {
        var sp = (state.sports || []).find(function (x) { return x.key === s.sport; });
        if (sp) label += " · " + (sp.name || s.sport);
      }
      var ev = (state.events || []).find(function (e) { return e.id === s.eventId; });
      if (ev) label += " · " + ev.title;
      return '<span class="chip on">▶ ' + slot + ": " + esc(label) + "</span>";
    }).join("");
  }

  // ---- sidebar nav ----------------------------------------- //
  function viewFromHash() {
    var h = (location.hash || "").replace(/^#/, "");
    // งานทั่วไป: มีแค่ live | settings (ไม่มีรายการแข่ง/นำเข้า)
    if (state && isGeneralApp()) return (h === "settings") ? "settings" : "live";
    return (h === "events" || h === "import" || h === "settings") ? h : "live";
  }
  function closeDrawer() { document.body.classList.remove("sb-open"); }

  function goView(view) {           // สลับวิวภายในหน้า /control โดยไม่รีโหลด
    editing = null;
    sportDraft = null;
    activeView = view;
    var newHash = view === "live" ? "" : "#" + view;
    if (location.hash !== newHash) {
      if (newHash) { location.hash = newHash; return; }       // hashchange จะ render ให้
      history.replaceState("", document.title, location.pathname);
    }
    markActiveNav();
    render();
  }

  window.addEventListener("hashchange", function () {
    activeView = viewFromHash();
    editing = null;
    sportDraft = null;
    closeDrawer();
    markActiveNav();
    render();
  });

  (function wireDrawer() {
    var t = document.getElementById("sbToggle");
    if (t) t.addEventListener("click", function () { document.body.classList.toggle("sb-open"); });
    var bd = document.getElementById("sbBackdrop");
    if (bd) bd.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
    var nav = document.getElementById("sbNav");
    if (nav) nav.addEventListener("click", function (e) {
      var a = e.target.closest("a.sb-item");
      if (!a) return;
      closeDrawer();
      // ลิงก์ภายในหน้า /control (สลับวิว) — ทำด้วย hash ไม่ต้องรีโหลด
      var m = a.getAttribute("href").match(/^\/control(?:#(events|import|settings))?$/);
      if (m && MODE === "control") { e.preventDefault(); goView(m[1] || "live"); }
    });
  })();

  function renderSidebar() {
    if (!state) return;
    // งานทั่วไป: ซ่อนกลุ่มจดคะแนน + รายการแข่ง/นำเข้า + ลิงก์ Scoreboard (เหลือแค่ /live)
    var gen = isGeneralApp();
    var hide = function (id, h) { var el = document.getElementById(id); if (el) el.hidden = h; };
    hide("sbGroupScore", gen);
    hide("sbNavEvents", gen);
    hide("sbNavImport", gen);
    hide("sbNavBoard", gen);
    var sports = gen ? [] : (state.sports || []);
    var sig = "gen:" + gen + "~" + sports.map(function (s) { return s.key + "|" + (s.name || "") + "|" + (s.icon || ""); }).join("~");
    if (sig !== renderSidebar._sig) {
      renderSidebar._sig = sig;
      var sc = document.getElementById("sbScoreSports");
      var bd = document.getElementById("sbBoardSports");
      if (sc) sc.innerHTML = sports.map(function (sp) {
        return '<a class="sb-item sb-sub" data-nav href="/score/' + esc(sp.key) + '">' +
          esc((sp.icon ? sp.icon + " " : "") + (sp.name || sp.key)) + "</a>";
      }).join("");
      if (bd) bd.innerHTML = sports.map(function (sp) {
        return '<a class="sb-item sb-sub" href="/scoreboard/' + esc(sp.key) + '" target="_blank">🔴 สด ' +
          esc(sp.name || sp.key) + "</a>";
      }).join("");
    }
    markActiveNav();
  }
  function markActiveNav() {
    var p = location.pathname.replace(/\/+$/, ""), hash = location.hash || "";
    [].forEach.call(document.querySelectorAll("#sbNav [data-nav]"), function (a) {
      var href = a.getAttribute("href"), on;
      if (href.indexOf("#") >= 0) on = (p + hash) === href;
      else if (href === "/control") on = (p === "/control") && !hash;
      else on = (p === href);
      a.classList.toggle("active", on);
    });
  }
  markActiveNav();

  // ---- shared bits ----------------------------------------- //
  // ผลิตภัณฑ์: "sports" = CG งานกีฬา (เดิม) · "general" = CG งานทั่วไป (Lower Third)
  function currentApp() { return (state && state.settings && state.settings.app) || "sports"; }
  function isGeneralApp() { return currentApp() === "general"; }
  // โหมด: "house" = 4 สีคณะ · "school" = รายชื่อโรงเรียน (settings.schools)
  function isSchool() { return (state.settings && state.settings.mode) === "school"; }
  function compWord() { return isSchool() ? "โรงเรียน" : "สีคณะ"; }
  function houseKeys() {
    if (isSchool()) {
      return ((state.settings && state.settings.schools) || []).map(function (s) { return s.key; });
    }
    return Object.keys((state.settings && state.settings.houses) || { red: 1, green: 1, yellow: 1, blue: 1 });
  }
  // resolve ผ่าน templates.js ให้ตรงกับที่ CG เรนเดอร์เป๊ะ
  function houseName(h) { return T.comp(state, h).name || h; }
  function houseColor(h) { return T.comp(state, h).color; }
  function houseLogo(h) { return T.comp(state, h).logo; }
  function eventSelect(id, selected, extra) {
    var opts = (state.events || []).map(function (e) {
      return '<option value="' + e.id + '"' + (e.id === selected ? " selected" : "") + ">" + esc(e.title) + "</option>";
    }).join("");
    return '<select id="' + id + '"' + (extra || "") + ">" +
      (opts || '<option value="">— ยังไม่มีรายการ —</option>') + "</select>";
  }
  // ---- รายการที่เลือก (แชร์ทั้งงาน = state.settings.selEventId) ---- //
  function selectedEventId() {
    var evs = (state && state.events) || [];
    function ok(id) { for (var i = 0; i < evs.length; i++) if (evs[i].id === id) return true; return false; }
    if (selOverride && ok(selOverride)) return selOverride;
    var s = (state && state.settings && state.settings.selEventId) || "";
    return ok(s) ? s : (evs[0] ? evs[0].id : "");
  }
  function setSelectedEvent(id) {
    if (!id || id === selectedEventId()) return;
    saveResultsNow();                 // เซฟผลรายการเดิมที่ค้างอยู่ก่อนสลับ
    selOverride = id;
    lastSelfSet = id;
    if (selTimer) clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      selTimer = null;
      cmd({ action: "setSettings", settings: { selEventId: selOverride || id } });
    }, 250);
    if (MODE === "control") followSelection();
    render();
  }
  function currentEvent() {
    return (state.events || []).find(function (e) { return e.id === selectedEventId(); }) || null;
  }
  // เปลี่ยนรายการที่เลือก -> ถ้า "ตารางแข่ง" ออกอากาศอยู่ ให้เลื่อนตามทันที (เฉพาะหน้าคุม)
  function followSelection() {
    if (MODE !== "control") return;
    var fo = (state.onair || {}).full || {};
    if (fo.visible && fo.template === "schedule") {
      cmd({ action: "show", slot: "full", template: "schedule", eventId: selectedEventId() });
    }
  }

  // ---- render dispatch ------------------------------------ //
  function render() {
    pendingRender = false;
    stopRelayPoll();
    if (!state) { panel.innerHTML = '<p class="muted">กำลังโหลด…</p>'; return; }
    if (MODE === "score") {
      if (isGeneralApp()) {
        panel.innerHTML = '<div class="card"><h2>โหมดงานทั่วไป</h2>' +
          '<p class="muted">งานทั่วไปไม่มีการจดคะแนน — ไปที่ <a href="/control">คุม Live</a> เพื่อสั่ง Lower Third</p></div>';
        return;
      }
      return SCORE_SPORT ? renderSportScore() : renderScore();
    }
    if (isGeneralApp()) {
      var gv = (activeView === "settings") ? "settings" : "live";
      return ({ live: renderGeneralLive, settings: renderGeneralSettings }[gv])();
    }
    ({ live: renderLive, events: renderEvents, import: renderImport, settings: renderSettings }[activeView] || renderLive)();
  }

  // ========================================================= //
  //  SCORE  (หน้า /score — เฉพาะจดคะแนน)
  // ========================================================= //
  function eventIndex() {
    var evs = state.events || [];
    var cur = selectedEventId();
    for (var i = 0; i < evs.length; i++) if (evs[i].id === cur) return i;
    return -1;
  }
  function stepEvent(dir) {
    var evs = state.events || [];
    var ni = eventIndex() + dir;
    if (ni < 0 || ni >= evs.length) return;
    setSelectedEvent(evs[ni].id);
  }
  function renderScore() {
    var evs = state.events || [];
    var ev = currentEvent();
    var idx = eventIndex();
    var resById = state.results || {};
    var done = 0;
    evs.forEach(function (e) { if ((resById[e.id] || []).length) done++; });

    panel.innerHTML =
      '<div class="card">' +
        '<div class="row">' +
          '<button class="btn" data-act="seek-prev"' + (idx <= 0 ? " disabled" : "") + ">‹ ก่อนหน้า</button>" +
          '<label class="field" style="flex:1">รายการที่กำลังกรอกผล (ใช้ร่วมทั้งงาน)' +
            eventSelect("scoreEvent", selectedEventId(), ' data-role="selEvent"') +
          "</label>" +
          '<button class="btn" data-act="seek-next"' + (idx < 0 || idx >= evs.length - 1 ? " disabled" : "") + ">ถัดไป ›</button>" +
        "</div>" +
        '<p class="muted" style="margin-top:8px">' +
          (idx >= 0 ? "รายการที่ " + (idx + 1) + " / " + evs.length : "เลือกรายการ") +
          ' &nbsp;·&nbsp; กรอกผลแล้ว ' + done + " / " + evs.length + " รายการ</p>" +
        '<span id="dirtyBadge" class="dirty-badge"></span>' +
      "</div>" +

      '<div class="card">' +
        '<h2 style="margin:0 0 10px">ผลการแข่งขัน — ' + esc(ev ? ev.title : "(เลือกรายการ)") + "</h2>" +
        '<div id="resEditor"></div>' +
      "</div>";

    renderResEditor();
  }

  // ========================================================= //
  //  LIVE
  // ========================================================= //
  // กล่องสถานะ 1 ช่อง (lower/full) ในแผง "ออกอากาศตอนนี้"
  function onairSlotHtml(slot, title) {
    var s = (state.onair || {})[slot] || {};
    var live = !!(s.visible && s.template);
    var inner;
    if (!live) {
      inner = '<div class="oa-empty">— จอว่าง —</div>';
    } else {
      var label = TPL_NAMES[s.template] || s.template;
      if (isSportTpl(s.template) && s.sport) {
        var sp = (state.sports || []).find(function (x) { return x.key === s.sport; });
        if (sp) label += " · " + (sp.name || s.sport);
      }
      var ev2 = (state.events || []).find(function (x) { return x.id === s.eventId; });
      if (ev2) label += " · " + ev2.title;
      inner = '<div class="oa-live"><span class="oa-badge">● LIVE</span>' + esc(label) + "</div>";
    }
    return '<div class="onair-slot' + (live ? " on" : "") + '">' +
      '<div class="oa-name">' + title + "</div>" + inner + "</div>";
  }

  function renderLive() {
    var ev = currentEvent();
    var idx = eventIndex();
    var nEv = (state.events || []).length;
    var lo = (state.onair && state.onair.lower) || {};
    var fu = (state.onair && state.onair.full) || {};
    var bg = (state.onair && state.onair.bug) || {};
    var top3On = !!(lo.visible && lo.template === "top3");
    var sportBarOn = !!(lo.visible && lo.template === "sportLower");
    var bugSport = (bg.visible && bg.template === "scoreBug") ? bg.sport : null;
    var schedOn = !!(fu.visible && fu.template === "schedule");
    var resOn = !!(fu.visible && fu.template === "results");
    var sportOn = !!(fu.visible && fu.template === "sportMatches");
    var sportLiveOn = !!(fu.visible && fu.template === "sportLive");
    var chartOn = !!(fu.visible && fu.template === "chart");
    var chartEnabled = !!(state.settings && state.settings.chartEnabled);
    var collapsed = localStorage.getItem("cg_preview_collapsed") === "1";
    var curTheme = (state.settings && state.settings.theme) || "default";

    function cmdBtn(act, on, label, extra) {
      return '<button class="btn primary' + (on ? " is-live" : "") + '" data-act="' + act + '"' + (extra || "") + ">" +
        (on ? "● " : "▶ ") + label + (on ? " · ออกอยู่" : "") + "</button>";
    }
    // แต่ละกีฬาได้ 2 ปุ่ม: รายการแมตช์ทั้งหมด (sportMatches) + สกอร์บอร์ดคู่สด (sportLive)
    // จับคู่ไว้ในกล่องเดียวกันให้เห็นชัดว่าเป็นของกีฬาเดียวกัน (ไม่ปนกับปุ่มอื่นตอนขึ้นบรรทัดใหม่)
    var sportBtns = (state.sports || []).map(function (sp) {
      var nm = esc((sp.icon ? sp.icon + " " : "") + (sp.name || sp.key));
      var dataSport = ' data-sport="' + esc(sp.key) + '"';
      var onList = fu.visible && fu.template === "sportMatches" && fu.sport === sp.key;
      var onLive = fu.visible && fu.template === "sportLive" && fu.sport === sp.key;
      return '<div class="sport-pair">' +
        cmdBtn("show-full-sport", onList, nm, dataSport) +
        cmdBtn("show-full-sportlive", onLive, "สด " + nm, dataSport) +
      "</div>";
    }).join("");
    // แถบล่าง: แถบสกอร์สดเต็มความกว้างต่อกีฬา (คู่ที่ตั้ง "สด") — อยู่ช่อง lower ทีละอันเดียวกับเต็มจอ
    var sportBarBtns = (state.sports || []).map(function (sp) {
      var nm = esc((sp.icon ? sp.icon + " " : "") + (sp.name || sp.key));
      var on = !!(lo.visible && lo.template === "sportLower" && lo.sport === sp.key);
      return cmdBtn("show-lower-sportbar", on, "สด " + nm, ' data-sport="' + esc(sp.key) + '"');
    }).join("");
    // Score bug: กราฟิกเล็กมุมบนซ้าย โชว์คะแนน+นาฬิกาตลอดเวลา — ช่องอิสระ ค้างจอ (ทีละ 1 กีฬา)
    var bugBtns = (state.sports || []).map(function (sp) {
      var nm = esc((sp.icon ? sp.icon + " " : "") + (sp.name || sp.key));
      return cmdBtn("show-bug", bugSport === sp.key, nm, ' data-sport="' + esc(sp.key) + '"');
    }).join("");

    panel.innerHTML =
      '<div class="grid' + (collapsed ? " grid-noprev" : "") + '"><div>' +

        '<div class="card onair-card">' +
          '<div class="row" style="justify-content:space-between;align-items:center">' +
            '<h2 style="margin:0">ออกอากาศตอนนี้</h2>' +
            '<button class="btn danger lg" data-act="hide-all">■ ลงจอทั้งหมด</button>' +
          "</div>" +
          '<div class="onair-slots">' +
            onairSlotHtml("lower", "แถบล่าง") +
            onairSlotHtml("full", "เต็มจอ") +
            onairSlotHtml("bug", "Score bug") +
          "</div>" +
        "</div>" +

        '<div class="card">' +
          '<div class="row">' +
            '<button class="btn" data-act="seek-prev"' + (idx <= 0 ? " disabled" : "") + ' title="รายการก่อนหน้า">‹</button>' +
            '<label class="field" style="flex:1">รายการแข่งขัน (ใช้ร่วมทั้งงาน)' +
              eventSelect("liveEvent", selectedEventId(), ' data-role="selEvent"') +
            "</label>" +
            '<button class="btn" data-act="seek-next"' + (idx < 0 || idx >= nEv - 1 ? " disabled" : "") + ' title="รายการถัดไป">›</button>' +
            '<button class="btn sm" data-act="reload">โหลดใหม่</button>' +
            '<span id="dirtyBadge" class="dirty-badge"></span>' +
          "</div>" +
          '<p class="muted" style="margin-top:6px">' +
            (idx >= 0 ? "รายการที่ " + (idx + 1) + " / " + nEv + " · " : "") +
            'คนจดคะแนนทุกคนเห็นรายการเดียวกันนี้ — กำหนด “แถบล่าง (อันดับ 1–3)” และ “ตารางแข่ง”' +
          "</p>" +
        "</div>" +

        '<div class="card">' +
          '<h2 style="margin:0 0 4px">สั่งขึ้นจอ</h2>' +
          '<p class="muted" style="margin:0 0 10px">“แถบล่าง” กับ “เต็มจอ” ขึ้นได้ทีละอันเดียว (ขึ้นอันใหม่ อันเดิมลงเอง) · “Score bug” เป็นช่องอิสระ ค้างจอพร้อมกันได้</p>' +
          "<h3>แถบล่าง</h3>" +
          '<div class="cmd-grid">' +
            cmdBtn("show-lower-top3", top3On, "อันดับ 1–3", ' style="min-width:170px"') +
            sportBarBtns +
            '<button class="btn" data-act="hide-lower"' + (top3On || sportBarOn ? "" : " disabled") + ">ซ่อนแถบล่าง</button>" +
          "</div>" +
          "<h3>เต็มจอ</h3>" +
          '<div class="cmd-grid">' +
            cmdBtn("show-full-schedule", schedOn, "ตารางแข่ง") +
            cmdBtn("show-full-results", resOn, "ผลการแข่งขัน") +
            (chartEnabled ? cmdBtn("show-full-chart", chartOn, "กราฟเหรียญ") : "") +
            sportBtns +
          "</div>" +
          '<div class="row" style="margin-top:10px">' +
            '<button class="btn" data-act="hide-full"' + (schedOn || resOn || sportOn || sportLiveOn || chartOn ? "" : " disabled") + ">■ ซ่อนเต็มจอ</button>" +
          "</div>" +
          ((state.sports || []).length
            ? "<h3>Score bug (มุมบนซ้าย — คะแนน+นาฬิกา ค้างจอตลอด)</h3>" +
              '<p class="muted" style="margin:-4px 0 8px">กราฟิกเล็กมุมจอ โชว์สกอร์สด + เวลานับถอยหลังตลอดเวลา ค้างพร้อมกราฟิกอื่นได้ (ทีละ 1 กีฬา · กดกีฬาเดิมซ้ำ = ปิด) — ต้องตั้ง “สด” ให้คู่นั้นในหน้าจดคะแนนก่อน</p>' +
              '<div class="cmd-grid">' +
                bugBtns +
                '<button class="btn" data-act="hide-bug"' + (bugSport ? "" : " disabled") + ">ซ่อน Score bug</button>" +
              "</div>"
            : "") +
        "</div>" +

        '<div class="card">' +
          '<div class="row"><h2 style="margin:0">กรอกผล — ' + esc(ev ? ev.title : "(เลือกรายการก่อน)") + "</h2></div>" +
          '<div id="resEditor"></div>' +
        "</div>" +

      "</div>" +

      '<div class="preview-wrap' + (collapsed ? " collapsed" : "") + '">' +
        '<div class="row" style="justify-content:space-between;align-items:center">' +
          '<div class="preview-label">พรีวิว overlay (โปร่งใส = ลายตาราง)</div>' +
          '<div class="row" style="gap:6px">' +
            '<button class="btn sm" data-act="preview-toggle">' + (collapsed ? "แสดงพรีวิว" : "ซ่อนพรีวิว") + "</button>" +
          "</div>" +
        "</div>" +
        (collapsed ? "" :
          '<div class="preview"><iframe src="/live?transport=poll&theme=' + encodeURIComponent(curTheme) + '" title="preview"></iframe></div>' +
          '<div class="preview-label">มุมมองนี้อัปเดตสดเหมือนที่ออกใน OBS/vMix' + (curTheme !== "default" ? " · ธีม " + esc(themeLabel(curTheme)) : "") + " · เปลี่ยนธีมที่แท็บตั้งค่า</div>") +
      "</div>" +

      "</div>";

    renderResEditor();
  }

  // ========================================================= //
  //  GENERAL (งานทั่วไป — Lower Third generator)
  // ========================================================= //
  // ชนิด CG ของงานทั่วไป — label + ช่อง onair + template + ป้ายช่องข้อความ
  var GEN_KINDS = {
    name:  { label: "ชื่อ + ตำแหน่ง", tag: "ชื่อ", slot: "lower", slotLabel: "แถบล่าง",
             template: "genLowerName", l1: "ชื่อ", l2: "ตำแหน่ง / คำบรรยาย",
             ph1: "เช่น นายสมชาย ใจดี", ph2: "เช่น ผู้อำนวยการโรงเรียน" },
    topic: { label: "หัวข้อ", tag: "หัวข้อ", slot: "lower", slotLabel: "แถบล่าง",
             template: "genLowerTopic", l1: "หัวข้อ", l2: null,
             ph1: "เช่น พิธีเปิดการแข่งขัน" },
    title: { label: "การ์ดเต็มจอ", tag: "เต็มจอ", slot: "full", slotLabel: "เต็มจอ",
             template: "genTitle", l1: "หัวเรื่อง", l2: "คำบรรยายรอง (ไม่บังคับ)",
             ph1: "เช่น การแข่งขันกีฬาสี 2568", ph2: "เช่น สนามกีฬากลางจังหวัด" },
  };
  var GEN_KIND_ORDER = ["name", "topic", "title"];

  // สถานะกล่องคอมโพส (working draft) — { kind, l1, l2, editId }
  var genUI = null;

  function genOnair(slot) { return (state.onair && state.onair[slot]) || {}; }
  function genVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }
  function genEnsureUI() {
    if (genUI) return;
    var lo = genOnair("lower"), fu = genOnair("full");
    if (lo.visible && lo.template === "genLowerName")
      genUI = { kind: "name", l1: lo.line1 || "", l2: lo.line2 || "", editId: null };
    else if (lo.visible && lo.template === "genLowerTopic")
      genUI = { kind: "topic", l1: lo.line1 || "", l2: "", editId: null };
    else if (fu.visible && fu.template === "genTitle")
      genUI = { kind: "title", l1: fu.line1 || "", l2: fu.line2 || "", editId: null };
    else
      genUI = { kind: "name", l1: "", l2: "", editId: null };
  }
  // อ่านค่าที่พิมพ์อยู่ใน DOM กลับเข้า genUI (เรียกก่อนทุก action ที่ใช้ข้อความ)
  function genCollectUI() {
    if (!genUI) return;
    var a = document.getElementById("genL1"), b = document.getElementById("genL2");
    if (a) genUI.l1 = a.value;
    if (b) genUI.l2 = b.value;
  }
  // CG (kind+ข้อความ) กำลังออกจอตรง ๆ อยู่ไหม
  function genIsLive(kind, l1, l2) {
    var m = GEN_KINDS[kind]; if (!m) return false;
    var o = genOnair(m.slot);
    if (!o.visible || o.template !== m.template) return false;
    if ((o.line1 || "") !== (l1 || "")) return false;
    return m.l2 ? (o.line2 || "") === (l2 || "") : true;
  }

  function renderGeneralLive() {
    genEnsureUI();
    var collapsed = localStorage.getItem("cg_preview_collapsed") === "1";
    var curTheme = (state.settings && state.settings.theme) || "default";
    var lowers = state.lowers || [];
    var m = GEN_KINDS[genUI.kind] || GEN_KINDS.name;
    var composeLive = genIsLive(genUI.kind, genUI.l1, genUI.l2);
    var editingP = genUI.editId && lowers.some(function (p) { return p.id === genUI.editId; });

    // --- แถบสถานะออกอากาศ (โชว์ข้อความจริงที่กำลังขึ้น) ---
    function slotStrip(slot, label, act) {
      var o = genOnair(slot);
      var on = !!(o.visible && o.template);
      var txt = on ? (esc(o.line1 || "") + (o.line2 ? ' <span class="muted">· ' + esc(o.line2) + "</span>" : "")) : "— ว่าง —";
      return '<div class="gl-slot' + (on ? " on" : "") + '">' +
        '<span class="gl-tag">' + (on ? "● " : "") + label + "</span>" +
        '<span class="gl-txt' + (on ? "" : " muted") + '">' + txt + "</span>" +
        (on ? '<button class="btn sm" data-act="' + act + '">✕ ลงจอ</button>' : "") +
      "</div>";
    }

    // --- segmented control เลือกชนิด ---
    var seg = '<div class="seg">' + GEN_KIND_ORDER.map(function (k) {
      return '<button class="seg-btn' + (k === genUI.kind ? " is-on" : "") + '" data-act="gen-kind" data-kind="' + k + '">' +
        esc(GEN_KINDS[k].label) + "</button>";
    }).join("") + "</div>";

    // --- ช่องข้อความตามชนิด ---
    var fields = '<label class="field">' + esc(m.l1) +
      '<input type="text" id="genL1" value="' + esc(genUI.l1 || "") + '" placeholder="' + esc(m.ph1 || "") + '"></label>' +
      (m.l2 ? '<label class="field" style="margin-top:8px">' + esc(m.l2) +
        '<input type="text" id="genL2" value="' + esc(genUI.l2 || "") + '" placeholder="' + esc(m.ph2 || "") + '"></label>' : "");

    // --- รายการพรีเซ็ต (คลิกแถว = ขึ้นจอ · ปุ่ม ■ ลงจอ อยู่ที่หัวการ์ด) ---
    var liveP = lowers.filter(function (p) { return genIsLive(p.kind, p.line1, p.line2); })[0];
    var presetRows = lowers.length ? lowers.map(function (p) {
      var pm = GEN_KINDS[p.kind] || GEN_KINDS.name;
      var live = liveP && p.id === liveP.id;
      var sub = pm.l2 && p.line2 ? ' <span class="muted">· ' + esc(p.line2) + "</span>" : "";
      return '<div class="preset-row' + (live ? " is-live" : "") + (p.id === genUI.editId ? " is-edit" : "") +
          '" data-act="preset-air" data-id="' + esc(p.id) + '" title="คลิกเพื่อขึ้นจอ">' +
        '<span class="preset-kind">' + esc(pm.tag) + "</span>" +
        '<span class="preset-txt"><b>' + esc(p.line1 || "(ว่าง)") + "</b>" + sub + "</span>" +
        (live ? '<span class="preset-live">● ออกอยู่</span>' : "") +
        '<button class="btn sm" data-act="preset-load" data-id="' + esc(p.id) + '">แก้</button>' +
        '<button class="btn sm danger" data-act="preset-del" data-id="' + esc(p.id) + '">✕</button>' +
      "</div>";
    }).join("") : '<p class="muted">ยังไม่มีพรีเซ็ต — คอมโพสข้อความด้านบนแล้วกด “★ บันทึกเป็นพรีเซ็ต”</p>';

    panel.innerHTML =
      '<div class="grid' + (collapsed ? " grid-noprev" : "") + '"><div>' +

        '<div class="card">' +
          '<div class="row" style="justify-content:space-between;align-items:center">' +
            '<h2 style="margin:0">กำลังออกอากาศ</h2>' +
            '<button class="btn danger" data-act="hide-all">■ ลงจอทั้งหมด</button>' +
          "</div>" +
          '<div class="gl-strip">' +
            slotStrip("lower", "แถบล่าง", "gen-hide-lower") +
            slotStrip("full", "เต็มจอ", "gen-hide-full") +
          "</div>" +
        "</div>" +

        '<div class="card">' +
          '<h2 style="margin:0 0 10px">คอมโพส</h2>' +
          seg +
          fields +
          '<div class="gen-actions">' +
            '<button class="btn primary lg' + (composeLive ? " is-live" : "") + '" data-act="gen-air">' +
              (composeLive ? "● กำลังออก — ส่งซ้ำ" : "▶ ขึ้นจอ (" + esc(m.slotLabel) + ")") + "</button>" +
            '<button class="btn" data-act="gen-clear">ล้าง</button>' +
            '<button class="btn ok" data-act="gen-save-preset">' + (editingP ? "★ อัปเดตพรีเซ็ต" : "★ บันทึกเป็นพรีเซ็ต") + "</button>" +
          "</div>" +
          (editingP
            ? '<p class="muted" style="margin-top:8px">กำลังผูกกับพรีเซ็ต — “★ อัปเดตพรีเซ็ต” จะทับอันเดิม · <a href="#" data-act="gen-unbind">เลิกผูก</a></p>'
            : '<p class="muted" style="margin-top:8px">กด Enter ในช่องข้อความ = ขึ้นจอ</p>') +
        "</div>" +

        '<div class="card">' +
          '<div class="row" style="justify-content:space-between;align-items:center">' +
            '<h2 style="margin:0">พรีเซ็ต (rundown)</h2>' +
            '<button class="btn danger" data-act="preset-hide"' + (liveP ? "" : " disabled") + ">■ ลงจอ</button>" +
          "</div>" +
          '<p class="muted" style="margin:2px 0 0;font-size:13px">คลิกแถว = ขึ้นจอทันที · “■ ลงจอ” = เอาพรีเซ็ตที่กำลังออกลง</p>' +
          '<div class="preset-list" style="margin-top:10px">' + presetRows + "</div>" +
        "</div>" +

      "</div>" +

      '<div class="preview-wrap' + (collapsed ? " collapsed" : "") + '">' +
        '<div class="row" style="justify-content:space-between;align-items:center">' +
          '<div class="preview-label">พรีวิว overlay (โปร่งใส = ลายตาราง)</div>' +
          '<button class="btn sm" data-act="preview-toggle">' + (collapsed ? "แสดงพรีวิว" : "ซ่อนพรีวิว") + "</button>" +
        "</div>" +
        (collapsed ? "" :
          '<div class="preview"><iframe src="/live?transport=poll&theme=' + encodeURIComponent(curTheme) + '" title="preview"></iframe></div>') +
      "</div>" +

      "</div>";
  }

  function renderGeneralSettings() {
    var s = state.settings || {};
    var origin = location.origin;
    var themeVal = s.theme || "default";
    panel.innerHTML =
      '<div class="card"><h2>ตั้งค่างานทั่วไป</h2>' +
        productToggleHtml() +
        '<div class="field" style="max-width:420px;margin-top:12px">ธีมแสดงผล (จอ Live)' +
          '<select id="setTheme" data-act="theme-set" style="margin-top:6px;width:100%;max-width:320px">' +
            THEME_OPTS.map(function (o) {
              return '<option value="' + o[0] + '"' + (o[0] === themeVal ? " selected" : "") + ">" + esc(o[1]) + "</option>";
            }).join("") +
          "</select>" +
          '<p class="muted" style="margin-top:6px">มีผลกับจอ Live ทันที · เติม <code>?theme=&lt;ชื่อธีม&gt;</code> ต่อท้าย URL เพื่อบังคับเฉพาะจอนั้น</p>' +
        "</div>" +
        '<label class="field" style="max-width:360px;margin-top:12px">ชื่องาน (ไม่บังคับ)<input type="text" id="setMeet" value="' + esc(s.meetTitle || "") + '"></label>' +
        '<label class="field" style="max-width:420px;margin-top:12px">โลโก้ส่วนกลาง (พาธ/URL — เว้นว่าง = ไม่แสดง)' +
          '<input type="text" id="setLogo" value="' + esc(s.logo == null ? "" : s.logo) + '" placeholder="/pictures/logo.png"></label>' +
        '<div class="row" style="margin-top:12px">' +
          '<label class="field">ความเร็ว animation (ms)<input type="number" id="setAnim" min="0" step="50" value="' + (s.animMs || 450) + '"></label>' +
        "</div>" +
        '<div class="row" style="margin-top:14px">' +
          '<button class="btn ok" data-act="gen-set-save">บันทึกการตั้งค่า</button>' +
        "</div>" +
      "</div>" +

      '<div class="card"><h2>จอ Live (ใส่ใน OBS / vMix)</h2>' +
        '<div class="urlbox"><input type="text" id="ovUrl" readonly value="' + origin + '/live">' +
          '<button class="btn" data-act="url-copy">คัดลอก</button></div>' +
        '<div class="linklist">' +
          '<a href="/live" target="_blank">/live &nbsp;— จอ Live (โปร่งใส) สั่งขึ้น/ลงจากหน้าคุม Live</a>' +
          '<a href="/live?slot=lower" target="_blank">/live?slot=lower &nbsp;— เฉพาะแถบล่าง</a>' +
          '<a href="/live?transport=poll" target="_blank">/live?transport=poll &nbsp;— ถ้าเน็ตบล็อก SSE</a>' +
        "</div>" +
      "</div>" +

      relayCardHtml() +

      '<div class="card"><h2>รีเซ็ต</h2>' +
        '<p class="muted">คืนค่าข้อมูลของ<b>งานทั่วไป</b>กลับเป็นค่าตั้งต้น (งานกีฬาไม่ถูกแตะ)</p>' +
        '<button class="btn danger" data-act="set-reset" style="margin-top:8px">รีเซ็ตข้อมูลงานทั่วไป</button>' +
      "</div>";
    startRelayPoll();
  }

  // toggle ผลิตภัณฑ์ — ใช้ทั้งในหน้าตั้งค่างานทั่วไปและงานกีฬา
  function productToggleHtml() {
    var gen = isGeneralApp();
    return '<div class="field" style="max-width:560px">ผลิตภัณฑ์' +
      '<div class="mode-toggle">' +
        '<button class="btn' + (!gen ? " is-live" : "") + '" data-act="app-sports"' + (!gen ? " disabled" : "") + ">🏟️ งานกีฬา</button>" +
        '<button class="btn' + (gen ? " is-live" : "") + '" data-act="app-general"' + (gen ? " disabled" : "") + ">🎬 งานทั่วไป (Lower Third)</button>" +
      "</div>" +
      '<p class="muted" style="margin-top:6px">สลับผลิตภัณฑ์จะสลับชุดข้อมูล/โลโก้/ธีม/ชื่องานทั้งหมด — อีกชุดถูกเก็บไว้ กลับมาเหมือนเดิมเมื่อสลับกลับ</p>' +
    "</div>";
  }

  function switchApp(a) {
    if (currentApp() === a) return;
    var msg = a === "general"
      ? 'สลับไป "งานทั่วไป" (Lower Third) ?\nข้อมูลงานกีฬาตอนนี้จะถูกเก็บไว้ กลับมาได้เมื่อสลับกลับ'
      : 'สลับกลับ "งานกีฬา" ?\nข้อมูลงานทั่วไปตอนนี้จะถูกเก็บไว้ กลับมาได้เมื่อสลับกลับ';
    if (!confirm(msg)) return;
    if (location.hash) history.replaceState("", document.title, location.pathname);
    genUI = null;   // เริ่มกล่องคอมโพสใหม่ตาม on-air ของผลิตภัณฑ์ที่สลับไป
    cmd({ action: "setApp", app: a }).then(function (ok) { if (ok) toast("สลับผลิตภัณฑ์แล้ว"); });
  }

  function genPresetId() { return "l_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function ensureDraft(ev) {
    var eid = ev ? ev.id : null;
    if (resDraft.eid !== eid) {
      resDraft = {
        eid: eid,
        rows: eid ? ((state.results || {})[eid] || []).slice()
          .sort(function (a, b) { return (Number(a.rank) || 99) - (Number(b.rank) || 99); })
          .map(function (r) { return r.house; }) : [],
      };
    }
  }

  function renderResEditor() {
    var host = document.getElementById("resEditor");
    if (!host) return;
    var ev = currentEvent();
    ensureDraft(ev);
    var hk = houseKeys();

    var tapBtns = hk.length ? hk.map(function (h) {
      return '<button class="hbtn" data-act="res-tap" data-house="' + h + '" style="--hc:' + houseColor(h) + '">' + esc(houseName(h)) + "</button>";
    }).join("") : '<span class="muted">' +
      (isSchool() ? 'ยังไม่มีโรงเรียน — เพิ่มในหน้า "ตั้งค่า"' : "ยังไม่มีคณะ") + "</span>";

    var lines = resDraft.rows.map(function (h, i) {
      return '<div class="res-line">' +
        '<span class="res-rank">' + (i + 1) + "</span>" +
        '<select data-act="res-set" data-i="' + i + '">' + hk.map(function (x) {
          return '<option value="' + x + '"' + (x === h ? " selected" : "") + ">" + esc(houseName(x)) + "</option>";
        }).join("") + "</select>" +
        '<button class="btn sm danger" data-act="res-rm" data-i="' + i + '">✕</button>' +
      "</div>";
    }).join("");

    host.innerHTML =
      '<p class="muted">แตะ' + compWord() + ' "เรียงตามลำดับเข้าเส้น" — แตะแล้วต่อท้ายอันดับถัดไป</p>' +
      '<div class="hbtns">' + tapBtns + "</div>" +
      '<div class="res-lines">' + (lines || '<span class="muted">— ยังไม่มีผล —</span>') + "</div>" +
      '<div class="row" style="margin-top:12px">' +
        '<button class="btn" data-act="res-clear">ล้างผล</button>' +
        '<button class="btn sm" data-act="res-add-row">+ เพิ่มอันดับ</button>' +
        '<span class="muted">แตะแล้ว <b>บันทึก + อัปเดต CG อัตโนมัติ</b> (ไม่ต้องกดบันทึก)</span>' +
      "</div>";
  }

  // บันทึกผลอัตโนมัติ (debounce 500ms) — ไม่ต้องกดปุ่มบันทึก
  var resSaveTimer = null;
  function scheduleResSave() {
    if (!selectedEventId()) return;
    if (resSaveTimer) clearTimeout(resSaveTimer);
    resSaveTimer = setTimeout(saveResultsNow, 500);
  }
  function saveResultsNow() {
    if (!resSaveTimer) return;            // ไม่มีการแก้ที่ค้างอยู่
    clearTimeout(resSaveTimer); resSaveTimer = null;
    var eid = (resDraft && resDraft.eid) || selectedEventId();
    if (!eid) return;
    var results = resDraft.rows.map(function (h, i) { return { rank: i + 1, house: h }; });
    cmd({ action: "setResults", eventId: eid, results: results }).then(function (ok) {
      if (ok) toast("บันทึกผลแล้ว");
    });
  }

  // ========================================================= //
  //  EVENTS
  // ========================================================= //
  function renderEvents() {
    if (editing) return renderEventEditor();
    var evs = state.events || [];
    panel.innerHTML =
      '<div class="card"><div class="row"><h2 style="margin:0">รายการแข่งขัน</h2><span class="spacer"></span>' +
        '<button class="btn primary" data-act="ev-new">+ เพิ่มรายการ</button>' +
        '<button class="btn sm" data-act="reload">โหลดใหม่</button>' +
        '<span id="dirtyBadge" class="dirty-badge"></span></div>' +
      (evs.length
        ? '<table class="tbl" style="margin-top:10px"><thead><tr><th>รายการ</th><th>ระดับชั้น</th><th style="width:150px"></th></tr></thead><tbody>' +
          evs.map(function (e) {
            return "<tr>" +
              "<td>" + esc(e.title) + "</td><td>" + esc(e.level || e.ageGroup || "") + "</td>" +
              '<td><button class="btn sm" data-act="ev-edit" data-id="' + e.id + '">แก้ไข</button> ' +
              '<button class="btn sm danger" data-act="ev-del" data-id="' + e.id + '">ลบ</button></td>' +
            "</tr>";
          }).join("") + "</tbody></table>"
        : '<p class="muted" style="margin-top:10px">ยังไม่มีรายการ — เพิ่มเอง หรือไปที่แท็บ "นำเข้า" เพื่อโหลดตารางรายการแข่ง</p>') +
      "</div>";
  }

  function renderEventEditor() {
    var e = editing;
    panel.innerHTML =
      '<div class="card">' +
        "<h2>" + (e.id ? "แก้ไขรายการ" : "รายการใหม่") + "</h2>" +
        '<div class="row" style="margin-top:8px">' +
          '<label class="field" style="flex:2">ชื่อรายการ<input type="text" id="evTitle" value="' + esc(e.title || "") + '" placeholder="เช่น วิ่ง 100 เมตร ชาย"></label>' +
          '<label class="field" style="flex:1">ระดับชั้น<input type="text" id="evLevel" value="' + esc(e.level || e.ageGroup || "") + '" placeholder="เช่น มัธยมต้น"></label>' +
        "</div>" +
        '<div class="row" style="margin-top:16px">' +
          '<button class="btn ok" data-act="ev-save">บันทึกรายการ</button>' +
          '<button class="btn" data-act="ev-cancel">ยกเลิก</button>' +
        "</div>" +
      "</div>";
  }

  // ========================================================= //
  //  IMPORT
  // ========================================================= //
  function renderImport() {
    panel.innerHTML =
      '<div class="card"><h2>นำเข้าตารางรายการแข่ง</h2>' +
        '<p class="muted">คอลัมน์: <code>title,level</code> &nbsp;(<code>title</code> ซ้ำ = รายการเดิม จะอัปเดตทับ)</p>' +
        '<div class="row" style="margin:8px 0"><input type="file" id="eventsFile" accept=".csv,text/csv"></div>' +
        '<textarea id="eventsCsv" placeholder="title,level&#10;วิ่ง 100 เมตร ชาย,มัธยมต้น">title,level\n</textarea>' +
        '<div class="row" style="margin-top:10px"><button class="btn ok" data-act="imp-events">นำเข้ารายการ</button>' +
        '<span class="muted">มีรายการตอนนี้: ' + ((state.events || []).length) + "</span></div>" +
      "</div>";
  }

  // ========================================================= //
  //  SPORTS (โมดูลกีฬา — บอล/บาส/วิ่งเปรี้ยว/ชักเย่อ ใช้โครงเดียวกัน)
  // ========================================================= //
  function sportsList() { return state.sports || []; }
  function sportByKey(k) {
    var l = sportsList();
    for (var i = 0; i < l.length; i++) if (l[i].key === k) return l[i];
    return null;
  }
  function curSportKey() {
    if (SCORE_SPORT) return SCORE_SPORT;           // /score/<sport> ล็อกกีฬาตาม URL
    var list = sportsList();
    if (sportSel && list.some(function (s) { return s.key === sportSel; })) return sportSel;
    return list[0] ? list[0].key : null;
  }
  function sportEnsureDraft() {
    var key = curSportKey();
    if (sportDraft && sportDraft.key === key) return;
    var src = null, list = sportsList();
    for (var i = 0; i < list.length; i++) if (list[i].key === key) { src = list[i]; break; }
    src = src || { key: key, name: "", icon: "", matches: [] };
    sportDraft = {
      key: src.key, name: src.name || "", icon: src.icon || "", currentId: src.currentId || null,
      clockMin: Number(src.clockMin) > 0 ? Number(src.clockMin) : 10,
      matches: (src.matches || []).map(function (m) {
        return { id: m.id, level: m.level || "", title: m.title || "",
                 home: m.home, away: m.away, hs: m.hs, as: m.as, done: !!m.done,
                 clock: normClock(m.clock) };
      }),
    };
    sportSel = key;
  }

  function sportHouseSelect(key, val) {
    return '<select data-' + key + ">" + houseKeys().map(function (h) {
      return '<option value="' + h + '"' + (h === val ? " selected" : "") + ">" + esc(houseName(h)) + "</option>";
    }).join("") + "</select>";
  }
  function newMatchId() { return "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---- นาฬิกาแมตช์ (นับถอยหลัง) ---- //
  var CLK_DEFAULT_DUR = 600;   // ค่าตั้งต้น 10:00 (ปรับด้วยปุ่ม ± ได้)
  function normClock(c) {
    return {
      running: !!(c && c.running),
      elapsed: (c && Number(c.elapsed)) || 0,
      since: (c && Number(c.since)) || 0,
      dur: (c && c.dur != null) ? Math.max(0, Number(c.dur) || 0) : CLK_DEFAULT_DUR,
    };
  }
  function clockNow(c) {                 // เวลาที่เดินไปแล้ว (นับขึ้น)
    c = normClock(c);
    return c.elapsed + (c.running ? Math.max(0, (Date.now() - c.since) / 1000) : 0);
  }
  function pauseClock(c) {
    c = normClock(c);
    if (c.running) { c.elapsed = clockNow(c); c.running = false; c.since = 0; }
    return c;
  }
  // เดินตัวเลข .sp-clock เองระหว่างที่ state ไม่เปลี่ยน (เรียกท้าย renderSportScore + หลังกดปุ่มนาฬิกา)
  var spClockTimer = null;
  function stopSpClockTick() { if (spClockTimer) { clearInterval(spClockTimer); spClockTimer = null; } }
  function tickSpClock() {
    var el = document.querySelector(".sp-clock");
    if (!el || el.getAttribute("data-run") !== "1") { stopSpClockTick(); return; }
    var base = parseFloat(el.getAttribute("data-el")) || 0;
    var since = parseFloat(el.getAttribute("data-since")) || 0;
    var dur = parseFloat(el.getAttribute("data-dur"));
    if (isNaN(dur)) dur = CLK_DEFAULT_DUR;
    var remain = T.remainSec(base, since, dur, true);
    el.textContent = T.fmtClock(remain);
    if (remain <= 0) el.classList.add("ended");
  }
  function restartSpClockTick() {
    stopSpClockTick();
    var el = document.querySelector('.sp-clock[data-run="1"]');
    if (el) { tickSpClock(); spClockTimer = setInterval(tickSpClock, 500); }
  }

  // ---- RTMP relay status card (settings views only) -------------- //
  var relayTimer = null;
  function stopRelayPoll() { if (relayTimer) { clearInterval(relayTimer); relayTimer = null; } }
  function relayCardHtml() {
    return '<div class="card"><h2>RTMP relay — OBS หน้างาน → เข้า OBS อีกตัว</h2>' +
      '<div id="relayBody"><p class="muted">กำลังโหลด…</p></div></div>';
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }
  function renderRelayBody(d) {
    var box = document.getElementById("relayBody");
    if (!box) { stopRelayPoll(); return; }
    // อย่า re-render ทับถ้ากำลังพิมพ์ช่องพอร์ตอยู่
    var ae = document.activeElement;
    if (ae && ae.getAttribute && ae.getAttribute("data-act") === "relay-port" && box.contains(ae)) return;
    var s = state.settings || {};
    var pubPort = Number(s.relayPublicPort) > 0 ? Number(s.relayPublicPort)
      : ((d && (d.publicPort || d.ingestPort)) || 1935);
    var portField =
      '<label class="field" style="max-width:260px">พอร์ตภายนอก (ตาม port-forward)' +
        '<input type="number" min="1" max="65535" data-act="relay-port" value="' + pubPort + '"></label>' +
      '<p class="muted" style="margin-top:4px">ใส่เลขที่ forward มาจากภายนอก (ค่านี้เก็บในเว็บ ไม่แตะ mediamtx.yml)</p>';
    if (!d || !d.configured) {
      box.innerHTML = portField +
        '<p class="muted" style="margin-top:8px">ยังไม่ได้ติดตั้ง relay บนเครื่องนี้ — รัน <code>get-relay.ps1</code> แล้ว <code>start.bat</code> · จากนั้นการ์ดจะโชว์ URL สำหรับ OBS ทั้งสองตัว (ดู README)</p>';
      return;
    }
    var base = "rtmp://" + location.hostname + ":" + pubPort;
    var warn = function (t) { return '<p class="relay-warn">⚠ ' + esc(t) + "</p>"; };
    var urlRow = function (label, id, val) {
      return '<div class="field" style="margin-top:8px">' + esc(label) +
        '<div class="urlbox"><input type="text" id="' + id + '" readonly value="' + esc(val || "") + '">' +
        '<button class="btn" data-act="relay-copy" data-t="' + id + '">คัดลอก</button></div></div>';
    };
    var st;
    if (!d.running) st = '<span class="relay-pill off">● relay ไม่ทำงาน</span> <span class="muted">— เปิด start.bat บนเครื่อง relay</span>';
    else if (!d.live || !d.live.publishing) st = '<span class="relay-pill idle">● พร้อมรับ</span> <span class="muted">— ยังไม่มีสัญญาณจาก OBS หน้างาน</span>';
    else st = '<span class="relay-pill on">● กำลังรับสัญญาณ</span> <span class="muted">— ' + esc(fmtBytes(d.live.bytesReceived)) +
      " · OBS ปลายทางต่ออยู่ " + (d.live.readers || 0) + "</span>";
    box.innerHTML =
      portField +

      '<h3 style="margin:16px 0 0">1) OBS หน้างาน — ส่งเข้า</h3>' +
      '<p class="muted">Settings → Stream → Service = Custom</p>' +
      urlRow("Server", "relayIn", base) +
      urlRow("Stream Key", "relayInKey", d.publishKey) +
      (d.passIsDefault ? warn("ยังไม่ได้ตั้งรหัส (user publish) — แก้ pass: ใน mediamtx.yml") : "") +

      '<h3 style="margin:16px 0 0">2) OBS ปลายทาง — ดึงออก</h3>' +
      '<p class="muted">Sources → + → Media Source → เอาติ๊ก "Local File" ออก → วางที่ช่อง Input · เปิด "Reconnect"</p>' +
      urlRow("Input", "relayOut", base + "/" + d.pullKey) +
      (d.readConfigured ? (d.readIsDefault ? warn("ยังไม่ได้ตั้งรหัส (user read) — แก้ pass: ใน mediamtx.yml") : "")
        : warn("ยังไม่มี user read ใน mediamtx.yml — OBS ปลายทางจะดึงไม่ได้ถ้าไม่ได้อยู่ในวงเดียวกัน")) +

      (d.pushConfigured
        ? '<h3 style="margin:16px 0 0">+ push อัตโนมัติไปที่</h3>' + urlRow("ปลายทาง push", "relayPush", d.dest) +
          (d.destIsDefault ? warn("ยังไม่ได้ตั้ง URL — แก้บรรทัด runOnAvailable ใน mediamtx.yml") : "")
        : "") +

      '<p style="margin-top:16px">สถานะ: ' + st + (d.recording ? ' <span class="muted">· อัดไฟล์สำรองอยู่</span>' : "") + "</p>";
  }
  function startRelayPoll() {
    stopRelayPoll();
    var go = function () {
      fetch("/api/relay", { headers: hdrs(), cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(renderRelayBody)
        .catch(function () { renderRelayBody(null); });
    };
    go();
    relayTimer = setInterval(go, 5000);
  }

  function sportClockMin() { return Number(sportDraft && sportDraft.clockMin) > 0 ? Number(sportDraft.clockMin) : 10; }
  function sportCollectFromDom() {
    if (!sportDraft) return;
    var nm = document.querySelector("[data-spname]"); if (nm) sportDraft.name = nm.value.trim();
    var ic = document.querySelector("[data-spicon]"); if (ic) sportDraft.icon = ic.value.trim();
    var cm = document.querySelector("[data-spclockmin]");
    if (cm) { var v = Math.round(Number(cm.value)); sportDraft.clockMin = (v > 0 && v <= 180) ? v : 10; }
    var out = [];
    [].forEach.call(panel.querySelectorAll(".fb-tbl tbody tr[data-i]"), function (tr, i) {
      var g = function (s) { return tr.querySelector(s); };
      var hs = g("[data-hs]").value, as = g("[data-as]").value;
      var prev = sportDraft.matches[i] || {};
      var done = g("[data-done]").checked;
      var clock = normClock(prev.clock);
      if (done && clock.running) clock = pauseClock(clock);   // จบแมตช์ = หยุดนาฬิกาอัตโนมัติ
      out.push({
        id: prev.id || newMatchId(),
        level: g("[data-level]").value.trim(),
        title: g("[data-title]").value.trim(),
        home: g("[data-home]").value,
        away: g("[data-away]").value,
        hs: hs === "" ? 0 : Number(hs),
        as: as === "" ? 0 : Number(as),
        done: done,
        clock: clock,
      });
    });
    sportDraft.matches = out;
  }
  function sportBuild() {
    return { key: sportDraft.key, name: sportDraft.name, icon: sportDraft.icon,
             currentId: sportDraft.currentId || null, clockMin: sportClockMin(),
             matches: sportDraft.matches };
  }
  function curDraftMatch() {
    if (!sportDraft || !sportDraft.currentId) return null;
    for (var i = 0; i < sportDraft.matches.length; i++)
      if (sportDraft.matches[i].id === sportDraft.currentId) return sportDraft.matches[i];
    return null;
  }
  function saveSportNow() {
    sportCollectFromDom();
    if (sportSaveTimer) { clearTimeout(sportSaveTimer); sportSaveTimer = null; }
    return cmd({ action: "setSport", sport: sportBuild() });
  }
  function scheduleSportSave() {
    sportCollectFromDom();
    if (sportSaveTimer) clearTimeout(sportSaveTimer);
    sportSaveTimer = setTimeout(function () {
      sportSaveTimer = null;
      cmd({ action: "setSport", sport: sportBuild() });
    }, 500);
  }

  // ตัวเลือกระดับชั้น: ป.1–ม.6 ก่อน แล้วต่อด้วยชั้นอื่น ๆ ที่มีอยู่ในข้อมูล
  var GRADE_LEVELS = ["ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6", "ม.1", "ม.2", "ม.3", "ม.4", "ม.5", "ม.6"];
  function levelOptions() {
    var set = {}, out = [];
    function add(l) { if (l && !set[l]) { set[l] = 1; out.push(l); } }
    GRADE_LEVELS.forEach(add);
    sportsList().forEach(function (sp) { (sp.matches || []).forEach(function (m) { add(m.level); }); });
    return out;
  }

  function renderSportScore() {
    var key = curSportKey();
    if (!sportByKey(key)) {
      panel.innerHTML = '<div class="card"><h2>ไม่พบกีฬา "' + esc(key || "") + '"</h2>' +
        '<p class="muted">URL ต้องเป็น /score/futsal หรือ /score/basketball</p></div>';
      return;
    }
    sportEnsureDraft();
    var dl = '<datalist id="lvlList">' + levelOptions().map(function (l) {
      return '<option value="' + esc(l) + '"></option>';
    }).join("") + "</datalist>";

    // ---- ตั้งค่าเวลาเริ่มต้นของกีฬานี้ ----
    var cfgCard = '<div class="card">' +
      '<label class="field" style="max-width:320px">เวลาเริ่มต้นต่อครึ่ง / ควอเตอร์ (นาที)' +
        '<input type="number" min="1" max="180" step="1" data-spclockmin value="' + sportClockMin() + '"></label>' +
      '<p class="muted" style="margin-top:4px">ใช้เป็นค่าตั้งต้นตอนกด “เพิ่มแมตช์” และตอนกด “รีเซ็ต” นาฬิกา</p>' +
    "</div>";

    // ---- แผงคู่ที่กำลังแข่ง (สด) ----
    var cm = curDraftMatch();
    var liveCard;
    if (!cm) {
      liveCard = '<div class="card"><h2>คู่ที่กำลังแข่ง (สด)</h2>' +
        '<p class="muted">ยังไม่ได้เลือกคู่ — กด “ตั้งสด” ที่คู่ด้านล่าง เพื่อให้ <code>/scoreboard/' + esc(key) + '</code> โชว์คู่นั้น</p></div>';
    } else {
      var sub = [cm.level, cm.title].filter(Boolean).join(" · ");
      function ctl(side, val) {
        return '<div class="sp-live-ctl">' +
          '<button class="btn lg" data-act="sp-score" data-side="' + side + '" data-d="-1">−</button>' +
          '<span class="sp-live-n">' + esc(Number(val) || 0) + "</span>" +
          '<button class="btn primary lg" data-act="sp-score" data-side="' + side + '" data-d="1">＋</button>' +
        "</div>";
      }
      var ck = normClock(cm.clock);
      var ckRun = ck.running && !cm.done;
      var ckEl = ck.elapsed, ckSince = ck.since, ckDur = ck.dur;
      var ckRemain = T.remainSec(ckEl, ckSince, ckDur, ckRun);
      var clockRow =
        '<div class="sp-clock-row">' +
          '<div class="sp-clock' + (ckRun ? " run" : "") + (ckRemain <= 0 ? " ended" : "") + '" data-run="' + (ckRun ? 1 : 0) +
            '" data-el="' + ckEl + '" data-since="' + ckSince + '" data-dur="' + ckDur + '">' +
            T.fmtClock(ckRemain) + "</div>" +
          '<button class="btn primary lg" data-act="clk-toggle">' + (ckRun ? "■ หยุด" : "▶ เริ่ม") + "</button>" +
          '<button class="btn" data-act="clk-add" data-d="60">+1:00</button>' +
          '<button class="btn" data-act="clk-add" data-d="-60">−1:00</button>' +
          '<button class="btn" data-act="clk-add" data-d="10">+0:10</button>' +
          '<button class="btn" data-act="clk-add" data-d="-10">−0:10</button>' +
          '<button class="btn danger" data-act="clk-reset">รีเซ็ต</button>' +
        "</div>";

      liveCard = '<div class="card"><h2>คู่ที่กำลังแข่ง (สด)' + (sub ? " — " + esc(sub) : "") + "</h2>" +
        '<div class="sp-live-row">' +
          '<div class="sp-live-team" style="--hc:' + houseColor(cm.home) + '">' + esc(houseName(cm.home)) + "</div>" +
          ctl("home", cm.hs) +
          '<div class="sp-live-vs">:</div>' +
          ctl("away", cm.as) +
          '<div class="sp-live-team" style="--hc:' + houseColor(cm.away) + '">' + esc(houseName(cm.away)) + "</div>" +
        "</div>" +
        clockRow +
        '<div class="row" style="margin-top:10px">' +
          '<label class="fb-done"><input type="checkbox" data-livedone' + (cm.done ? " checked" : "") + "> จบการแข่งขัน</label>" +
          '<span class="muted">โชว์สดที่จอ: <code>/scoreboard/' + esc(key) + "</code></span>" +
        "</div>" +
      "</div>";
    }

    // ---- ตารางแมตช์ทั้งหมด ----
    var rows = sportDraft.matches.map(function (m, i) {
      var isCur = m.id === sportDraft.currentId;
      return '<tr data-i="' + i + '"' + (isCur ? ' class="cur"' : "") + ">" +
        '<td><button class="btn sm ' + (isCur ? "ok" : "") + '" data-act="sp-set-current" data-id="' + esc(m.id) + '">' +
          (isCur ? "● สด" : "ตั้งสด") + "</button></td>" +
        '<td><input class="fb-lvl" data-level list="lvlList" value="' + esc(m.level || "") + '" placeholder="ป.1"></td>' +
        '<td><input class="fb-ttl" data-title value="' + esc(m.title || "") + '" placeholder="ชาย"></td>' +
        "<td>" + sportHouseSelect("home", m.home) + "</td>" +
        '<td><input class="fb-num" data-hs type="number" min="0" inputmode="numeric" value="' + (m.hs == null ? "" : esc(m.hs)) + '"></td>' +
        '<td class="fb-colon">:</td>' +
        '<td><input class="fb-num" data-as type="number" min="0" inputmode="numeric" value="' + (m.as == null ? "" : esc(m.as)) + '"></td>' +
        "<td>" + sportHouseSelect("away", m.away) + "</td>" +
        '<td><label class="fb-done"><input type="checkbox" data-done' + (m.done ? " checked" : "") + "> จบ</label></td>" +
        '<td><button class="btn danger sm" data-act="sp-del" data-i="' + i + '">✕</button></td>' +
      "</tr>";
    }).join("");

    panel.innerHTML = dl + cfgCard + liveCard +
      '<div class="card"><h2>แมตช์ทั้งหมด</h2>' +
        '<div class="fb-tbl-wrap"><table class="tbl fb-tbl"><thead><tr>' +
          "<th>สด</th><th>ชั้น</th><th>ชื่อ</th><th>เจ้าบ้าน</th><th>สกอร์</th><th></th><th></th><th>ทีมเยือน</th><th>สถานะ</th><th></th>" +
        "</tr></thead><tbody>" +
          (rows || '<tr><td colspan="10" class="muted">ยังไม่มีแมตช์ — กด “เพิ่มแมตช์”</td></tr>') +
        "</tbody></table></div>" +
        '<div class="row" style="margin-top:12px">' +
          '<button class="btn" data-act="sp-add">+ เพิ่มแมตช์</button>' +
          '<span class="muted">เลือกระดับชั้น ป.1–ม.6 · กด “ตั้งสด” ให้สกอร์บอร์ดสดโชว์คู่นั้น</span>' +
        "</div>" +
      "</div>";

    restartSpClockTick();
  }

  // ========================================================= //
  //  SETTINGS
  // ========================================================= //
  function newSchoolKey() {
    return "sc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function schoolRowHtml(sc) {
    sc = sc || { key: newSchoolKey(), name: "", logo: "" };
    var logo = sc.logo || "";
    return '<tr data-key="' + esc(sc.key) + '">' +
      '<td><input type="text" data-sname value="' + esc(sc.name || "") + '" placeholder="เช่น โรงเรียนสาธิต"></td>' +
      '<td class="school-logo-cell">' +
        '<img class="school-logo-prev" src="' + esc(logo) + '"' + (logo ? "" : " hidden") + ' alt="">' +
        '<input type="file" accept="image/*" data-slogo-file>' +
        '<input type="hidden" data-slogo value="' + esc(logo) + '">' +
      "</td>" +
      '<td><button class="btn danger sm" data-act="school-rm">✕</button></td>' +
    "</tr>";
  }
  function houseEditorHtml() {
    return '<h3>สีและชื่อคณะ</h3>' +
      '<table class="tbl"><thead><tr><th>คีย์</th><th>สี</th><th>ชื่อที่แสดง</th><th>โลโก้ (พาธ — เว้นว่าง = ปิด)</th></tr></thead><tbody>' +
      houseKeys().map(function (h) {
        return "<tr><td>" + h + "</td>" +
          '<td><input type="color" data-hcolor="' + h + '" value="' + toHex(houseColor(h)) + '"></td>' +
          '<td><input type="text" data-hname="' + h + '" value="' + esc(houseName(h)) + '"></td>' +
          '<td><input type="text" data-hlogo="' + h + '" value="' + esc(houseLogo(h)) + '" placeholder="/pictures/house-' + h + '.png"></td></tr>';
      }).join("") + "</tbody></table>" +
      '<p class="muted" style="margin-top:4px">วางไฟล์โลโก้คณะที่ <code>public/pictures/house-&lt;คีย์&gt;.png</code> — จะขึ้นคู่กับสีตอนโชว์ TOP 3</p>';
  }
  function schoolEditorHtml(s) {
    var rows = (s.schools || []).map(schoolRowHtml).join("");
    return '<h3>โรงเรียนที่ร่วมแข่ง</h3>' +
      '<table class="tbl school-tbl" id="schoolTbl"><thead><tr><th>ชื่อโรงเรียน</th><th>โลโก้</th><th></th></tr></thead><tbody>' +
      (rows || '<tr data-empty><td colspan="3" class="muted">ยังไม่มีโรงเรียน — กด “เพิ่มโรงเรียน”</td></tr>') +
      "</tbody></table>" +
      '<div class="row" style="margin-top:10px">' +
        '<button class="btn" data-act="school-add">+ เพิ่มโรงเรียน</button>' +
        '<span class="muted">อัปโหลดโลโก้ (PNG พื้นหลังโปร่งใส) แล้วกด “บันทึกการตั้งค่า”</span>' +
      "</div>";
  }

  function schoolRowsFromDom() {
    return [].map.call(document.querySelectorAll("#schoolTbl tbody tr[data-key]"), function (tr) {
      var nm = tr.querySelector("[data-sname]"), lg = tr.querySelector("[data-slogo]");
      return { key: tr.getAttribute("data-key"), name: nm ? nm.value.trim() : "", logo: lg ? lg.value : "" };
    });
  }
  function switchMode(m) {
    if (((state.settings && state.settings.mode) || "house") === m) return;
    var msg = m === "school"
      ? 'สลับไปโหมด "แข่งกับภายนอก" ?\nข้อมูลกีฬาสีตอนนี้จะถูกเก็บไว้ กลับมาได้เมื่อสลับกลับ'
      : 'สลับกลับโหมด "กีฬาสีภายใน" ?\nข้อมูลการแข่งภายนอกตอนนี้จะถูกเก็บไว้ กลับมาได้เมื่อสลับกลับ';
    if (!confirm(msg)) return;
    cmd({ action: "setMode", mode: m }).then(function (ok) { if (ok) toast("สลับโหมดแล้ว"); });
  }
  // ประมาณจำนวนไบต์จริงของรูปใน data URL (base64)
  function dataUrlBytes(d) {
    var i = d.indexOf(",");
    return i < 0 ? d.length : Math.floor((d.length - i - 1) * 3 / 4);
  }

  // อัปโหลดรูป -> คืน URL (/uploads/…) ผ่าน POST /api/upload (base64 data URL)
  // รูปแรสเตอร์: ถ้าใหญ่เกิน (มิติ > 640px หรือ ไฟล์ > ~1.6MB) ย่อ/บีบฝั่ง client
  // ให้พอดีก่อน (คงพื้นโปร่งใส: PNG ก่อน, ไม่พอค่อย WebP) — ไม่เด้ง error เรื่องขนาด
  function uploadImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error("ไม่มีไฟล์"));
      var SERVER_MAX = 2 * 1024 * 1024, TARGET = 1.6 * 1024 * 1024, MAXDIM = 640;
      var type = (file.type || "").toLowerCase();

      function send(dataUrl) {
        fetch("/api/upload", { method: "POST", headers: hdrs(), body: JSON.stringify({ name: file.name, dataUrl: dataUrl }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error(res.j.error || "อัปโหลดล้มเหลว");
            resolve(res.j.url);
          })
          .catch(reject);
      }
      function sendOriginal(fallbackErr) {
        if (file.size > SERVER_MAX) return reject(fallbackErr || new Error("ไฟล์ใหญ่เกิน 2MB"));
        var fr = new FileReader();
        fr.onerror = function () { reject(new Error("อ่านไฟล์ไม่ได้")); };
        fr.onload = function () { send(fr.result); };
        fr.readAsDataURL(file);
      }

      // ชนิดที่บีบด้วย canvas ไม่ได้ (svg ฯลฯ) -> ส่งตรง
      if (!/^image\/(png|jpe?g|webp|gif)$/.test(type)) { sendOriginal(); return; }

      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onerror = function () { URL.revokeObjectURL(url); sendOriginal(new Error("โหลดรูปไม่ได้")); };
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || 0, h = img.naturalHeight || 0;
        // เล็กพออยู่แล้ว -> ส่งไฟล์เดิม (คงการบีบอัดของต้นฉบับ)
        if (w && h && Math.max(w, h) <= MAXDIM && file.size <= TARGET) { sendOriginal(); return; }

        var canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
        if (!ctx) { sendOriginal(); return; }
        var base = Math.min(1, MAXDIM / Math.max(w || MAXDIM, h || MAXDIM));
        var steps = [1, 0.82, 0.66, 0.5, 0.4], out = "";
        for (var k = 0; k < steps.length; k++) {
          var sc = base * steps[k];
          canvas.width = Math.max(1, Math.round((w || MAXDIM) * sc));
          canvas.height = Math.max(1, Math.round((h || MAXDIM) * sc));
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          out = canvas.toDataURL("image/png");
          if (dataUrlBytes(out) <= TARGET) break;
          var webp = canvas.toDataURL("image/webp", 0.92);
          if (webp.slice(0, 15) === "data:image/webp" && dataUrlBytes(webp) <= TARGET) { out = webp; break; }
        }
        if (!out || dataUrlBytes(out) > SERVER_MAX) {
          var last = canvas.toDataURL("image/webp", 0.8);
          if (last.slice(0, 15) !== "data:image/webp") last = out || canvas.toDataURL("image/png");
          if (!last || dataUrlBytes(last) > SERVER_MAX) return reject(new Error("รูปนี้ใหญ่มากจนบีบไม่พอ — ลองใช้รูปที่เล็กลง"));
          out = last;
        }
        toast("รูปใหญ่ไป — ย่อ/บีบให้อัตโนมัติแล้ว");
        send(out);
      };
      img.src = url;
    });
  }

  function renderSettings() {
    var s = state.settings || {};
    var origin = location.origin;
    var isSc = isSchool();
    var themeVal = s.theme || "default";
    panel.innerHTML =
      '<div class="card"><h2>ตั้งค่าทั่วไป</h2>' +
        productToggleHtml() +
        '<div class="field" style="max-width:560px;margin-top:12px">โหมดการแข่งขัน' +
          '<div class="mode-toggle">' +
            '<button class="btn' + (!isSc ? " is-live" : "") + '" data-act="mode-house"' + (!isSc ? " disabled" : "") + ">กีฬาสีภายใน (4 คณะ)</button>" +
            '<button class="btn' + (isSc ? " is-live" : "") + '" data-act="mode-school"' + (isSc ? " disabled" : "") + ">แข่งกับโรงเรียนภายนอก</button>" +
          "</div>" +
          '<p class="muted" style="margin-top:6px">สลับโหมดจะสลับชุดข้อมูลทั้งหมด (รายการ / ผล / แมตช์) — ข้อมูลอีกชุดถูกเก็บไว้ กลับมาเหมือนเดิมเมื่อสลับกลับ</p>' +
        "</div>" +
        '<div class="field" style="max-width:420px;margin-top:12px">ธีมแสดงผล (ทุกจอ Live / Scoreboard)' +
          '<select id="setTheme" data-act="theme-set" style="margin-top:6px;width:100%;max-width:320px">' +
            THEME_OPTS.map(function (o) {
              return '<option value="' + o[0] + '"' + (o[0] === themeVal ? " selected" : "") + ">" + esc(o[1]) + "</option>";
            }).join("") +
          "</select>" +
          '<p class="muted" style="margin-top:6px">มีผลกับทุกจอ Live / Scoreboard ทันที (หน้าคุม/จดคะแนนไม่เปลี่ยน) · 🧊 Liquid Glass ต้องใช้ OBS / vMix รุ่นใหม่ (backdrop-filter) ธีมอื่นไม่ต้อง · เติม <code>?theme=&lt;ชื่อธีม&gt;</code> หรือ <code>?theme=default</code> ต่อท้าย URL เพื่อบังคับเฉพาะจอนั้น</p>' +
        "</div>" +
        '<label class="field" style="max-width:360px;margin-top:12px">ชื่องาน (แสดงบน CG)<input type="text" id="setMeet" value="' + esc(s.meetTitle || "") + '"></label>' +
        '<label class="field" style="max-width:420px;margin-top:12px">โลโก้ส่วนกลาง (พาธ/URL — เว้นว่าง = ไม่แสดง)' +
          '<input type="text" id="setLogo" value="' + esc(s.logo == null ? "" : s.logo) + '" placeholder="/pictures/logo.png"></label>' +
        '<p class="muted" style="margin-top:4px">วางไฟล์โลโก้ไว้ที่ <code>public/pictures/logo.png</code> — จะขึ้นมุมของ CG ทุกอัน</p>' +
        '<div class="row" style="margin-top:12px">' +
          '<label class="field">ความเร็ว animation (ms)<input type="number" id="setAnim" min="0" step="50" value="' + (s.animMs || 450) + '"></label>' +
        "</div>" +
        (isSc ? schoolEditorHtml(s) : houseEditorHtml()) +
        '<div class="row" style="margin-top:14px">' +
          '<button class="btn ok" data-act="set-save">บันทึกการตั้งค่า</button>' +
          '<span id="dirtyBadge" class="dirty-badge"></span>' +
        "</div>" +
      "</div>" +

      '<div class="card"><h2>กราฟเหรียญรางวัล (Chart)</h2>' +
        '<p class="muted">นับเหรียญ 🥇🥈🥉 จากผลกรีฑาทุกรายการอัตโนมัติ แล้วโชว์เป็นกราฟบนจอ Live / Scoreboard</p>' +
        '<div class="row" style="margin-top:8px">' +
          '<button class="btn' + (s.chartEnabled ? " is-live" : "") + '" data-act="chart-toggle" data-on="' + (s.chartEnabled ? 1 : 0) + '">' +
            (s.chartEnabled ? "● เปิดอยู่ — กดเพื่อปิด" : "▶ ปิดอยู่ — กดเพื่อเปิด") + "</button>" +
        "</div>" +
        '<label class="field" style="max-width:420px;margin-top:12px">ชนิดกราฟ' +
          '<select data-act="chart-type"' + (s.chartEnabled ? "" : " disabled") + ">" +
            '<option value="bars"' + ((s.chartType || "bars") === "bars" ? " selected" : "") + ">บาร์แนวนอน (จัดอันดับ)</option>" +
            '<option value="columns"' + (s.chartType === "columns" ? " selected" : "") + ">คอลัมน์แนวตั้ง</option>" +
          "</select></label>" +
        '<label class="field" style="max-width:420px;margin-top:12px">ชื่อกราฟ (เว้นว่าง = “ตารางเหรียญรางวัล”)' +
          '<input type="text" data-act="chart-title" value="' + esc(s.chartTitle || "") + '"></label>' +
        '<p class="muted" style="margin-top:6px">เปิดจอเฉพาะกราฟที่ <code>/scoreboard?view=chart</code> — บันทึกทันทีเมื่อแก้ (ไม่ต้องกดปุ่ม)</p>' +
      "</div>" +

      '<div class="card"><h2>จอ Live (ใส่ใน OBS / vMix)</h2>' +
        '<div class="urlbox"><input type="text" id="ovUrl" readonly value="' + origin + '/live">' +
          '<button class="btn" data-act="url-copy">คัดลอก</button></div>' +
        '<div class="linklist">' +
          '<a href="/live" target="_blank">/live &nbsp;— จอ Live (โปร่งใส) สั่งขึ้น/ลงจากหน้าออกอากาศ</a>' +
          '<a href="/live?slot=lower" target="_blank">/live?slot=lower &nbsp;— เฉพาะแถบล่าง</a>' +
          '<a href="/live?slot=full" target="_blank">/live?slot=full &nbsp;— เฉพาะเต็มจอ</a>' +
          '<a href="/live?transport=poll" target="_blank">/live?transport=poll &nbsp;— ถ้าเน็ตบล็อก SSE</a>' +
          '<a href="/live?theme=' + encodeURIComponent(themeVal === "default" ? "glass" : "default") + '" target="_blank">/live?theme=… &nbsp;— บังคับธีมเฉพาะจอนี้ (ดูเทียบ ไม่แตะค่าที่ตั้งไว้)</a>' +
        "</div>" +
        '<p class="muted" style="margin-top:10px">ตั้งขนาด Browser Source / Web Input เป็น 1920×1080 · ธีมใช้ตามที่ตั้งไว้ด้านบน — เติม <code>?theme=&lt;ชื่อธีม&gt;</code> หรือ <code>?theme=default</code> ต่อท้าย URL = บังคับเฉพาะจอนั้น</p>' +
      "</div>" +

      relayCardHtml() +

      '<div class="card"><h2>จอ Scoreboard (เปิดค้างที่จอในงาน)</h2>' +
        '<div class="urlbox"><input type="text" id="bdUrl" readonly value="' + origin + '/scoreboard?view=all">' +
          '<button class="btn" data-act="board-copy">คัดลอก</button></div>' +
        '<div class="linklist">' +
          '<a href="/scoreboard?view=all" target="_blank">/scoreboard?view=all &nbsp;— วนรวมทุกอย่าง ⭐</a>' +
          '<a href="/scoreboard" target="_blank">/scoreboard &nbsp;— วนเฉพาะผลกรีฑา</a>' +
          '<a href="/scoreboard?view=chart" target="_blank">/scoreboard?view=chart &nbsp;— จอกราฟเหรียญรางวัล 📊</a>' +
          (state.sports || []).map(function (sp) {
            return '<a href="/scoreboard/' + esc(sp.key) + '" target="_blank">/scoreboard/' + esc(sp.key) +
              ' &nbsp;— สกอร์สด ' + esc(sp.name || sp.key) + " 🔴</a>";
          }).join("") +
          '<a href="/scoreboard?view=all&theme=default" target="_blank">/scoreboard?view=all&amp;theme=… &nbsp;— เติม ?theme=&lt;ชื่อธีม&gt; บังคับเฉพาะจอนี้</a>' +
        "</div>" +
        '<p class="muted" style="margin-top:10px">เปิดเต็มจอ (F11) — จอสด (/scoreboard/&lt;กีฬา&gt;) โชว์คู่ที่ตั้ง “สด” จากหน้าจดคะแนน</p>' +
      "</div>" +

      '<div class="card"><h2>หน้าจดคะแนน (แยกคน/แยกกีฬา)</h2>' +
        '<div class="linklist">' +
          '<a href="/score" target="_blank">/score &nbsp;— กรีฑา (แตะ' + compWord() + 'เรียงอันดับ)</a>' +
          (state.sports || []).map(function (sp) {
            return '<a href="/score/' + esc(sp.key) + '" target="_blank">/score/' + esc(sp.key) +
              " &nbsp;— " + esc(sp.name || sp.key) + " (+/- และตั้งคู่สด)</a>";
          }).join("") +
        "</div>" +
      "</div>" +

      '<div class="card"><h2>รีเซ็ต</h2>' +
        '<p class="muted">คืนค่าข้อมูลของ<b>โหมดนี้</b>กลับเป็นค่าตั้งต้น (อีกโหมดไม่ถูกแตะ)</p>' +
        '<button class="btn danger" data-act="set-reset" style="margin-top:8px">รีเซ็ตข้อมูลทั้งหมด</button>' +
      "</div>";
    startRelayPoll();
  }

  function toHex(c) {
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    var m = c && c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return "#888888";
    return "#" + [1, 2, 3].map(function (i) { return ("0" + Number(m[i]).toString(16)).slice(-2); }).join("");
  }

  // ========================================================= //
  //  actions
  // ========================================================= //
  var handlers = {
    reload: function () { render(); },

    "hide-all": function () { cmd({ action: "hideAll" }); },
    "show-lower-top3": function () {
      var eid = selectedEventId();
      if (!eid) return toast("เลือกรายการก่อน", true);
      cmd({ action: "show", slot: "lower", template: "top3", eventId: eid });
    },
    "show-lower-sportbar": function (b) {
      cmd({ action: "show", slot: "lower", template: "sportLower", eventId: null, sport: b.dataset.sport });
    },
    "show-bug": function (b) {
      var k = b.dataset.sport;
      var cur = (state.onair && state.onair.bug) || {};
      if (cur.visible && cur.template === "scoreBug" && cur.sport === k) {
        cmd({ action: "hide", slot: "bug" });           // กดกีฬาเดิมซ้ำ = ปิด score bug
      } else {
        cmd({ action: "show", slot: "bug", template: "scoreBug", eventId: null, sport: k });
      }
    },
    "hide-bug": function () { cmd({ action: "hide", slot: "bug" }); },
    "hide-lower": function () { cmd({ action: "hideMain" }); },
    "show-full-results": function () {
      cmd({ action: "show", slot: "full", template: "results", eventId: null });
    },
    "show-full-sport": function (b) {
      cmd({ action: "show", slot: "full", template: "sportMatches", eventId: null, sport: b.dataset.sport });
    },
    "show-full-sportlive": function (b) {
      cmd({ action: "show", slot: "full", template: "sportLive", eventId: null, sport: b.dataset.sport });
    },
    "show-full-schedule": function () {
      cmd({ action: "show", slot: "full", template: "schedule", eventId: selectedEventId() });
    },
    "show-full-chart": function () {
      cmd({ action: "show", slot: "full", template: "chart", eventId: null });
    },
    "hide-full": function () { cmd({ action: "hideMain" }); },

    // ---- งานทั่วไป (general) ----
    "app-sports": function () { switchApp("sports"); },
    "app-general": function () { switchApp("general"); },
    "gen-kind": function (b) {
      genCollectUI();
      genUI.kind = b.dataset.kind;
      render();
      var el = document.getElementById("genL1"); if (el) el.focus();
    },
    "gen-air": function () {
      genCollectUI();
      var m = GEN_KINDS[genUI.kind] || GEN_KINDS.name;
      var l1 = (genUI.l1 || "").trim(), l2 = m.l2 ? (genUI.l2 || "").trim() : "";
      if (!l1 && !l2) return toast("ใส่ข้อความก่อน", true);
      cmd({ action: "show", slot: m.slot, template: m.template, line1: l1, line2: l2 });
    },
    "gen-clear": function () {
      genCollectUI();
      genUI.l1 = ""; genUI.l2 = ""; genUI.editId = null;
      render();
      var el = document.getElementById("genL1"); if (el) el.focus();
    },
    "gen-unbind": function () { genCollectUI(); genUI.editId = null; render(); },
    "gen-hide-lower": function () { cmd({ action: "hide", slot: "lower" }); },
    "gen-hide-full": function () { cmd({ action: "hide", slot: "full" }); },
    "gen-save-preset": function () {
      genCollectUI();
      var m = GEN_KINDS[genUI.kind] || GEN_KINDS.name;
      var l1 = (genUI.l1 || "").trim(), l2 = m.l2 ? (genUI.l2 || "").trim() : "";
      if (!l1) return toast("ใส่ข้อความก่อน", true);
      var list = (state.lowers || []).slice();
      var editing = genUI.editId && list.some(function (p) { return p.id === genUI.editId; });
      if (editing) {
        list = list.map(function (p) {
          return p.id === genUI.editId ? { id: p.id, kind: genUI.kind, line1: l1, line2: l2 } : p;
        });
      } else {
        var np = { id: genPresetId(), kind: genUI.kind, line1: l1, line2: l2 };
        list.push(np);
        genUI.editId = np.id;
      }
      cmd({ action: "setLowers", lowers: list }).then(function (ok) {
        if (ok) toast(editing ? "อัปเดตพรีเซ็ตแล้ว" : "บันทึกพรีเซ็ตแล้ว");
      });
    },
    "gen-set-save": function () {
      cmd({ action: "setSettings", settings: {
        meetTitle: genVal("setMeet"),
        logo: genVal("setLogo"),
        animMs: Number(document.getElementById("setAnim").value) || 450,
      } }).then(function (ok) { if (ok) toast("บันทึกการตั้งค่าแล้ว"); });
    },
    "preset-air": function (b) {
      var p = (state.lowers || []).filter(function (x) { return x.id === b.dataset.id; })[0];
      if (!p) return;
      var m = GEN_KINDS[p.kind] || GEN_KINDS.name;
      cmd({ action: "show", slot: m.slot, template: m.template, line1: p.line1 || "", line2: p.line2 || "" });
    },
    "preset-hide": function () {
      // เอาพรีเซ็ตที่กำลังออกจอลง (มีได้ทีละอัน — เทียบ kind+ข้อความกับ onair)
      var p = (state.lowers || []).filter(function (x) { return genIsLive(x.kind, x.line1, x.line2); })[0];
      if (!p) return toast("ไม่มีพรีเซ็ตที่กำลังออกจอ", true);
      var m = GEN_KINDS[p.kind] || GEN_KINDS.name;
      cmd({ action: "hide", slot: m.slot });
    },
    "preset-load": function (b) {
      var p = (state.lowers || []).filter(function (x) { return x.id === b.dataset.id; })[0];
      if (!p) return;
      genUI = { kind: GEN_KINDS[p.kind] ? p.kind : "name", l1: p.line1 || "", l2: p.line2 || "", editId: p.id };
      render();
      var el = document.getElementById("genL1"); if (el) el.focus();
    },
    "preset-del": function (b) {
      var next = (state.lowers || []).filter(function (x) { return x.id !== b.dataset.id; });
      if (genUI && genUI.editId === b.dataset.id) genUI.editId = null;
      cmd({ action: "setLowers", lowers: next }).then(function (ok) { if (ok) toast("ลบพรีเซ็ตแล้ว"); });
    },

    "preview-toggle": function () {
      var c = localStorage.getItem("cg_preview_collapsed") === "1";
      localStorage.setItem("cg_preview_collapsed", c ? "0" : "1");
      render();
    },
    "res-tap": function (b) {
      if (!selectedEventId()) return toast("เลือกรายการก่อน", true);
      resDraft.rows.push(b.dataset.house);
      renderResEditor();
      scheduleResSave();
    },
    "res-rm": function (b) {
      resDraft.rows.splice(Number(b.dataset.i), 1);
      renderResEditor();
      scheduleResSave();
    },
    "res-clear": function () { resDraft.rows = []; renderResEditor(); scheduleResSave(); },
    "res-add-row": function () {
      var k = houseKeys();
      if (!k.length) return toast(isSchool() ? "เพิ่มโรงเรียนก่อนในหน้าตั้งค่า" : "ยังไม่มีคณะ", true);
      resDraft.rows.push(k[0]); renderResEditor(); scheduleResSave();
    },

    "seek-prev": function () { stepEvent(-1); },
    "seek-next": function () { stepEvent(1); },

    "ev-new": function () { editing = { id: "", title: "", level: "" }; render(); },
    "ev-edit": function (b) {
      var e = (state.events || []).find(function (x) { return x.id === b.dataset.id; });
      if (e) { editing = JSON.parse(JSON.stringify(e)); render(); }
    },
    "ev-del": function (b) {
      var e = (state.events || []).find(function (x) { return x.id === b.dataset.id; });
      if (e && confirm("ลบรายการ \"" + e.title + "\" ?")) cmd({ action: "deleteEvent", eventId: b.dataset.id });
    },
    "ev-cancel": function () { editing = null; render(); },
    "ev-save": function () {
      var ev = {
        id: editing.id,
        title: document.getElementById("evTitle").value.trim(),
        level: document.getElementById("evLevel").value.trim(),
      };
      if (!ev.title) return toast("ใส่ชื่อรายการก่อน", true);
      cmd({ action: "upsertEvent", event: ev }).then(function (ok) {
        if (ok) { toast("บันทึกรายการแล้ว"); editing = null; render(); }
      });
    },

    "imp-events": function () {
      var csv = document.getElementById("eventsCsv").value.trim();
      if (!csv) return toast("ไม่มีข้อมูล", true);
      importCsv("events", csv).then(function (j) { if (j) toast("นำเข้า " + (j.imported.events || 0) + " รายการ"); });
    },

    "set-save": function () {
      var settings = {
        meetTitle: document.getElementById("setMeet").value.trim(),
        logo: document.getElementById("setLogo").value.trim(),
        animMs: Number(document.getElementById("setAnim").value) || 450,
      };
      if (isSchool()) {
        settings.schools = schoolRowsFromDom().filter(function (s) { return s.name || s.logo; });
      } else {
        var houses = {}, houseNames = {}, houseLogos = {};
        [].forEach.call(panel.querySelectorAll("[data-hcolor]"), function (i) { houses[i.dataset.hcolor] = i.value; });
        [].forEach.call(panel.querySelectorAll("[data-hname]"), function (i) { houseNames[i.dataset.hname] = i.value.trim(); });
        [].forEach.call(panel.querySelectorAll("[data-hlogo]"), function (i) { houseLogos[i.dataset.hlogo] = i.value.trim(); });
        settings.houses = houses; settings.houseNames = houseNames; settings.houseLogos = houseLogos;
      }
      cmd({ action: "setSettings", settings: settings }).then(function (ok) { if (ok) toast("บันทึกการตั้งค่าแล้ว"); });
    },
    "set-reset": function () {
      if (confirm("รีเซ็ตข้อมูลของโหมดนี้กลับเป็นค่าตั้งต้น ?")) cmd({ action: "resetState" }).then(function (ok) { if (ok) toast("รีเซ็ตแล้ว"); });
    },
    "mode-house": function () { switchMode("house"); },
    "mode-school": function () { switchMode("school"); },
    "chart-toggle": function (b) {
      cmd({ action: "setSettings", settings: { chartEnabled: b.dataset.on !== "1" } })
        .then(function (ok) { if (ok) toast(b.dataset.on !== "1" ? "เปิดกราฟแล้ว" : "ปิดกราฟแล้ว"); });
    },
    "school-add": function () {
      var tb = document.querySelector("#schoolTbl tbody");
      if (!tb) return;
      var e = tb.querySelector("[data-empty]");
      if (e) e.parentNode.removeChild(e);
      tb.insertAdjacentHTML("beforeend", schoolRowHtml(null));
      cmd({ action: "setSettings", settings: { schools: schoolRowsFromDom() } });
    },
    "school-rm": function (b) {
      var tr = b.closest("tr");
      if (tr) tr.parentNode.removeChild(tr);
      cmd({ action: "setSettings", settings: { schools: schoolRowsFromDom() } });
    },
    "url-copy": function () {
      var u = document.getElementById("ovUrl");
      u.select();
      navigator.clipboard && navigator.clipboard.writeText(u.value);
      toast("คัดลอกลิงก์แล้ว");
    },
    "board-copy": function () {
      var u = document.getElementById("bdUrl");
      u.select();
      navigator.clipboard && navigator.clipboard.writeText(u.value);
      toast("คัดลอกลิงก์แล้ว");
    },
    "relay-copy": function (b) {
      var u = document.getElementById(b.getAttribute("data-t"));
      if (!u) return;
      u.select();
      navigator.clipboard && navigator.clipboard.writeText(u.value);
      toast("คัดลอกแล้ว");
    },

    "sp-add": function () {
      sportCollectFromDom();
      var k = houseKeys();
      if (!k.length) return toast(isSchool() ? "เพิ่มโรงเรียนก่อนในหน้าตั้งค่า" : "ยังไม่มีคณะ", true);
      var last = sportDraft.matches[sportDraft.matches.length - 1];
      sportDraft.matches.push({
        id: newMatchId(), level: (last && last.level) || "ป.1", title: "",
        home: k[0], away: k[1] || k[0], hs: 0, as: 0, done: false,
        clock: { running: false, elapsed: 0, since: 0, dur: sportClockMin() * 60 },
      });
      renderSportScore();
      scheduleSportSave();
    },
    "sp-del": function (b) {
      sportCollectFromDom();
      var removed = sportDraft.matches.splice(Number(b.dataset.i), 1)[0];
      if (removed && removed.id === sportDraft.currentId) sportDraft.currentId = null;
      renderSportScore();
      scheduleSportSave();
    },
    "sp-set-current": function (b) {
      sportCollectFromDom();
      sportDraft.currentId = (sportDraft.currentId === b.dataset.id) ? null : b.dataset.id;
      renderSportScore();
      saveSportNow();
    },
    "sp-score": function (b) {
      sportCollectFromDom();
      var cm = curDraftMatch();
      if (!cm) return;
      var d = Number(b.dataset.d) || 0;
      if (b.dataset.side === "home") cm.hs = Math.max(0, (Number(cm.hs) || 0) + d);
      else cm.as = Math.max(0, (Number(cm.as) || 0) + d);
      renderSportScore();       // DOM อัปเดตสกอร์ใหม่
      saveSportNow();           // เก็บจาก DOM ที่อัปเดตแล้ว -> ส่งทันที
    },

    "clk-toggle": function () {
      sportCollectFromDom();
      var cm = curDraftMatch();
      if (!cm) return;
      var c = normClock(cm.clock);
      if (c.running) { c = pauseClock(c); }
      else { c.running = true; c.since = Date.now(); }
      cm.clock = c;
      renderSportScore();
      saveSportNow();
    },
    "clk-add": function (b) {
      sportCollectFromDom();
      var cm = curDraftMatch();
      if (!cm) return;
      var c = normClock(cm.clock);
      var d = Number(b.dataset.d) || 0;
      c.dur = Math.max(0, c.dur + d);               // นับถอยหลัง: ปุ่ม ± ปรับความยาวเวลา -> เวลาที่เหลือเปลี่ยน d วินาที
      cm.clock = c;
      renderSportScore();
      saveSportNow();
    },
    "clk-reset": function () {
      sportCollectFromDom();
      var cm = curDraftMatch();
      if (!cm) return;
      cm.clock = { running: false, elapsed: 0, since: 0, dur: sportClockMin() * 60 };
      renderSportScore();
      saveSportNow();
    },
  };

  panel.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var fn = handlers[b.dataset.act];
    if (fn) { e.preventDefault(); fn(b, e); }
  });

  // งานทั่วไป: กด Enter ในช่องคอมโพส = ขึ้นจอ
  panel.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var t = e.target;
    if (t && (t.id === "genL1" || t.id === "genL2") && handlers["gen-air"]) {
      e.preventDefault();
      handlers["gen-air"]();
    }
  });

  panel.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.role === "selEvent") {
      setSelectedEvent(t.value);
      return;
    }
    if (t.dataset && t.dataset.act === "res-set") {
      resDraft.rows[Number(t.dataset.i)] = t.value;
      scheduleResSave();
      return;
    }
    if (t.dataset && t.dataset.act === "theme-set") {
      var tv = t.value;
      cmd({ action: "setSettings", settings: { theme: tv } })
        .then(function (ok) { if (ok) toast("ธีม: " + tv); });
      return;
    }
    if (t.dataset && t.dataset.act === "chart-type") {
      cmd({ action: "setSettings", settings: { chartType: t.value } })
        .then(function (ok) { if (ok) toast("ชนิดกราฟ: " + (t.value === "columns" ? "คอลัมน์แนวตั้ง" : "บาร์แนวนอน")); });
      return;
    }
    if (t.dataset && t.dataset.act === "chart-title") {
      cmd({ action: "setSettings", settings: { chartTitle: t.value.trim() } })
        .then(function (ok) { if (ok) toast("บันทึกชื่อกราฟแล้ว"); });
      return;
    }
    if (t.dataset && t.dataset.act === "relay-port") {
      var rp = parseInt(t.value, 10);
      if (rp > 0 && rp < 65536) {
        cmd({ action: "setSettings", settings: { relayPublicPort: rp } })
          .then(function (ok) { if (ok) toast("พอร์ตภายนอก: " + rp); });
      }
      return;
    }
    // ติ๊ก "จบการแข่งขัน" ในแผงคู่สด
    if (t.hasAttribute && t.hasAttribute("data-livedone")) {
      sportCollectFromDom();
      var cm = curDraftMatch();
      if (cm) cm.done = t.checked;
      renderSportScore();
      saveSportNow();
      return;
    }
    if (inSportEditor() && isSportField(t)) {
      scheduleSportSave();
      return;
    }
    // อัปโหลดโลโก้โรงเรียน (หน้าตั้งค่า โหมด school)
    if (t.matches && t.matches("[data-slogo-file]")) {
      var lf = t.files && t.files[0];
      if (!lf) return;
      var trow = t.closest("tr");
      toast("กำลังอัปโหลด…");
      uploadImage(lf).then(function (url) {
        var hid = trow.querySelector("[data-slogo]");
        var img = trow.querySelector(".school-logo-prev");
        if (hid) hid.value = url;
        if (img) { img.src = url; img.hidden = false; }
        t.value = "";
        // บันทึกทันที กัน URL หายถ้าเปลี่ยนหน้า/มี state ใหม่เข้ามา
        cmd({ action: "setSettings", settings: { schools: schoolRowsFromDom() } });
        toast('อัปโหลดโลโก้แล้ว — กด "บันทึกการตั้งค่า" เพื่อยืนยันชื่อ');
      }).catch(function (err) { toast(String(err.message || err), true); });
      return;
    }
    if (t.id === "eventsFile") {
      var f = t.files && t.files[0];
      if (!f) return;
      f.text().then(function (txt) {
        document.getElementById("eventsCsv").value = txt;
        toast("โหลดไฟล์แล้ว — กดปุ่มนำเข้า");
      });
    }
  });

  // อยู่ในหน้าจดคะแนนกีฬา (/score/<sport>) หรือไม่
  function inSportEditor() { return MODE === "score" && !!SCORE_SPORT; }
  // ฟิลด์ในตารางแมตช์ + ตั้งค่าเวลาเริ่มต้น -> บันทึกอัตโนมัติ (debounce)
  function isSportField(t) {
    if (!t || !t.closest) return false;
    if (t.closest(".fb-tbl")) return true;
    return !!(t.matches && t.matches("[data-spclockmin],[data-spname],[data-spicon]"));
  }
  panel.addEventListener("input", function (e) {
    if (inSportEditor() && isSportField(e.target)) scheduleSportSave();
  });
})();
