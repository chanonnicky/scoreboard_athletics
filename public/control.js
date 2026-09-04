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
    sportMatches: "กีฬา · ผลแมตช์",
  };

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

  function onState() {
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
      var ev = (state.events || []).find(function (e) { return e.id === s.eventId; });
      if (ev) label += " · " + ev.title;
      return '<span class="chip on">▶ ' + slot + ": " + esc(label) + "</span>";
    }).join("");
  }

  // ---- sidebar nav ----------------------------------------- //
  function viewFromHash() {
    var h = (location.hash || "").replace(/^#/, "");
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
    var sports = state.sports || [];
    var sig = sports.map(function (s) { return s.key + "|" + (s.name || "") + "|" + (s.icon || ""); }).join("~");
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
  function houseKeys() {
    return Object.keys((state.settings && state.settings.houses) || { red: 1, green: 1, yellow: 1, blue: 1 });
  }
  function houseName(h) {
    var n = state.settings && state.settings.houseNames;
    return (n && n[h]) || h;
  }
  function houseColor(h) {
    var c = state.settings && state.settings.houses;
    return (c && c[h]) || "#888";
  }
  function houseLogo(h) {
    var m = state.settings && state.settings.houseLogos;
    if (m && Object.prototype.hasOwnProperty.call(m, h)) return m[h];
    return "/pictures/house-" + (h || "").replace(/[^a-z]/gi, "") + ".png";
  }
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
    if (!state) { panel.innerHTML = '<p class="muted">กำลังโหลด…</p>'; return; }
    if (MODE === "score") { return SCORE_SPORT ? renderSportScore() : renderScore(); }
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
      if (s.template === "sportMatches" && s.sport) {
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
    var top3On = !!(lo.visible && lo.template === "top3");
    var schedOn = !!(fu.visible && fu.template === "schedule");
    var resOn = !!(fu.visible && fu.template === "results");
    var sportOn = !!(fu.visible && fu.template === "sportMatches");
    var collapsed = localStorage.getItem("cg_preview_collapsed") === "1";

    function cmdBtn(act, on, label, extra) {
      return '<button class="btn primary' + (on ? " is-live" : "") + '" data-act="' + act + '"' + (extra || "") + ">" +
        (on ? "● " : "▶ ") + label + (on ? " · ออกอยู่" : "") + "</button>";
    }
    var sportBtns = (state.sports || []).map(function (sp) {
      var on = fu.visible && fu.template === "sportMatches" && fu.sport === sp.key;
      return cmdBtn("show-full-sport", on, esc((sp.icon ? sp.icon + " " : "") + (sp.name || sp.key)),
        ' data-sport="' + esc(sp.key) + '"');
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
          '<p class="muted" style="margin:0 0 10px">ขึ้นได้ทีละอย่าง — ขึ้นอันใหม่ อันเก่าจะลงเอง</p>' +
          "<h3>แถบล่าง</h3>" +
          '<div class="cmd-grid">' +
            cmdBtn("show-lower-top3", top3On, "อันดับ 1–3", ' style="min-width:170px"') +
            '<button class="btn" data-act="hide-lower"' + (top3On ? "" : " disabled") + ">ซ่อนแถบล่าง</button>" +
          "</div>" +
          "<h3>เต็มจอ</h3>" +
          '<div class="cmd-grid">' +
            cmdBtn("show-full-schedule", schedOn, "ตารางแข่ง") +
            cmdBtn("show-full-results", resOn, "ผลการแข่งขัน") +
            sportBtns +
            '<button class="btn" data-act="hide-full"' + (schedOn || resOn || sportOn ? "" : " disabled") + ">ซ่อนเต็มจอ</button>" +
          "</div>" +
        "</div>" +

        '<div class="card">' +
          '<div class="row"><h2 style="margin:0">กรอกผล — ' + esc(ev ? ev.title : "(เลือกรายการก่อน)") + "</h2></div>" +
          '<div id="resEditor"></div>' +
        "</div>" +

      "</div>" +

      '<div class="preview-wrap' + (collapsed ? " collapsed" : "") + '">' +
        '<div class="row" style="justify-content:space-between;align-items:center">' +
          '<div class="preview-label">พรีวิว overlay (โปร่งใส = ลายตาราง)</div>' +
          '<button class="btn sm" data-act="preview-toggle">' + (collapsed ? "แสดงพรีวิว" : "ซ่อนพรีวิว") + "</button>" +
        "</div>" +
        (collapsed ? "" :
          '<div class="preview"><iframe src="/live?transport=poll" title="preview"></iframe></div>' +
          '<div class="preview-label">มุมมองนี้อัปเดตสดเหมือนที่ออกใน OBS/vMix</div>') +
      "</div>" +

      "</div>";

    renderResEditor();
  }

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

    var tapBtns = hk.map(function (h) {
      return '<button class="hbtn" data-act="res-tap" data-house="' + h + '" style="--hc:' + houseColor(h) + '">' + esc(houseName(h)) + "</button>";
    }).join("");

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
      '<p class="muted">แตะสีคณะ "เรียงตามลำดับเข้าเส้น" — แตะแล้วต่อท้ายอันดับถัดไป</p>' +
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

  // ---- นาฬิกาแมตช์ (สตอปวอตช์ นับขึ้น) ---- //
  function normClock(c) {
    return {
      running: !!(c && c.running),
      elapsed: (c && Number(c.elapsed)) || 0,
      since: (c && Number(c.since)) || 0,
    };
  }
  function clockNow(c) {
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
    el.textContent = T.fmtClock(base + Math.max(0, (Date.now() - since) / 1000));
  }
  function restartSpClockTick() {
    stopSpClockTick();
    var el = document.querySelector('.sp-clock[data-run="1"]');
    if (el) { tickSpClock(); spClockTimer = setInterval(tickSpClock, 500); }
  }

  function sportCollectFromDom() {
    if (!sportDraft) return;
    var nm = document.querySelector("[data-spname]"); if (nm) sportDraft.name = nm.value.trim();
    var ic = document.querySelector("[data-spicon]"); if (ic) sportDraft.icon = ic.value.trim();
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
             currentId: sportDraft.currentId || null, matches: sportDraft.matches };
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
        '<p class="muted">URL ต้องเป็น /score/football หรือ /score/basketball</p></div>';
      return;
    }
    sportEnsureDraft();
    var dl = '<datalist id="lvlList">' + levelOptions().map(function (l) {
      return '<option value="' + esc(l) + '"></option>';
    }).join("") + "</datalist>";

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
      var ckEl = ck.elapsed, ckSince = ck.since;
      var clockRow =
        '<div class="sp-clock-row">' +
          '<div class="sp-clock' + (ckRun ? " run" : "") + '" data-run="' + (ckRun ? 1 : 0) +
            '" data-el="' + ckEl + '" data-since="' + ckSince + '">' +
            T.fmtClock(ckRun ? ckEl + Math.max(0, (Date.now() - ckSince) / 1000) : ckEl) + "</div>" +
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

    panel.innerHTML = dl + liveCard +
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
  function renderSettings() {
    var s = state.settings || {};
    var origin = location.origin;
    panel.innerHTML =
      '<div class="card"><h2>ตั้งค่าทั่วไป</h2>' +
        '<label class="field" style="max-width:360px">ชื่องาน (แสดงบน CG)<input type="text" id="setMeet" value="' + esc(s.meetTitle || "") + '"></label>' +
        '<label class="field" style="max-width:420px;margin-top:12px">โลโก้โรงเรียน (พาธ/URL — เว้นว่าง = ไม่แสดง)' +
          '<input type="text" id="setLogo" value="' + esc(s.logo == null ? "" : s.logo) + '" placeholder="/pictures/logo.png"></label>' +
        '<p class="muted" style="margin-top:4px">วางไฟล์โลโก้ไว้ที่ <code>public/pictures/logo.png</code> — จะขึ้นมุมของ CG ทุกอัน</p>' +
        '<div class="row" style="margin-top:12px">' +
          '<label class="field">ความเร็ว animation (ms)<input type="number" id="setAnim" min="0" step="50" value="' + (s.animMs || 450) + '"></label>' +
        "</div>" +
        '<h3>สีและชื่อคณะ</h3>' +
        '<table class="tbl"><thead><tr><th>คีย์</th><th>สี</th><th>ชื่อที่แสดง</th><th>โลโก้ (พาธ — เว้นว่าง = ปิด)</th></tr></thead><tbody>' +
        houseKeys().map(function (h) {
          return "<tr><td>" + h + "</td>" +
            '<td><input type="color" data-hcolor="' + h + '" value="' + toHex(houseColor(h)) + '"></td>' +
            '<td><input type="text" data-hname="' + h + '" value="' + esc(houseName(h)) + '"></td>' +
            '<td><input type="text" data-hlogo="' + h + '" value="' + esc(houseLogo(h)) + '" placeholder="/pictures/house-' + h + '.png"></td></tr>';
        }).join("") + "</tbody></table>" +
        '<p class="muted" style="margin-top:4px">วางไฟล์โลโก้คณะที่ <code>public/pictures/house-&lt;คีย์&gt;.png</code> — จะขึ้นคู่กับสีตอนโชว์ TOP 3</p>' +
        '<div class="row" style="margin-top:14px">' +
          '<button class="btn ok" data-act="set-save">บันทึกการตั้งค่า</button>' +
          '<span id="dirtyBadge" class="dirty-badge"></span>' +
        "</div>" +
      "</div>" +

      '<div class="card"><h2>จอ Live (ใส่ใน OBS / vMix)</h2>' +
        '<div class="urlbox"><input type="text" id="ovUrl" readonly value="' + origin + '/live">' +
          '<button class="btn" data-act="url-copy">คัดลอก</button></div>' +
        '<div class="linklist">' +
          '<a href="/live" target="_blank">/live &nbsp;— จอ Live (โปร่งใส) สั่งขึ้น/ลงจากหน้าออกอากาศ</a>' +
          '<a href="/live?slot=lower" target="_blank">/live?slot=lower &nbsp;— เฉพาะแถบล่าง</a>' +
          '<a href="/live?slot=full" target="_blank">/live?slot=full &nbsp;— เฉพาะเต็มจอ</a>' +
          '<a href="/live?transport=poll" target="_blank">/live?transport=poll &nbsp;— ถ้าเน็ตบล็อก SSE</a>' +
        "</div>" +
        '<p class="muted" style="margin-top:10px">ตั้งขนาด Browser Source / Web Input เป็น 1920×1080</p>' +
      "</div>" +

      '<div class="card"><h2>จอ Scoreboard (เปิดค้างที่จอในงาน)</h2>' +
        '<div class="urlbox"><input type="text" id="bdUrl" readonly value="' + origin + '/scoreboard?view=all">' +
          '<button class="btn" data-act="board-copy">คัดลอก</button></div>' +
        '<div class="linklist">' +
          '<a href="/scoreboard?view=all" target="_blank">/scoreboard?view=all &nbsp;— วนรวมทุกอย่าง ⭐</a>' +
          '<a href="/scoreboard" target="_blank">/scoreboard &nbsp;— วนเฉพาะผลกรีฑา</a>' +
          (state.sports || []).map(function (sp) {
            return '<a href="/scoreboard/' + esc(sp.key) + '" target="_blank">/scoreboard/' + esc(sp.key) +
              ' &nbsp;— สกอร์สด ' + esc(sp.name || sp.key) + " 🔴</a>";
          }).join("") +
        "</div>" +
        '<p class="muted" style="margin-top:10px">เปิดเต็มจอ (F11) — จอสด (/scoreboard/&lt;กีฬา&gt;) โชว์คู่ที่ตั้ง “สด” จากหน้าจดคะแนน</p>' +
      "</div>" +

      '<div class="card"><h2>หน้าจดคะแนน (แยกคน/แยกกีฬา)</h2>' +
        '<div class="linklist">' +
          '<a href="/score" target="_blank">/score &nbsp;— กรีฑา (แตะสีคณะเรียงอันดับ)</a>' +
          (state.sports || []).map(function (sp) {
            return '<a href="/score/' + esc(sp.key) + '" target="_blank">/score/' + esc(sp.key) +
              " &nbsp;— " + esc(sp.name || sp.key) + " (+/- และตั้งคู่สด)</a>";
          }).join("") +
        "</div>" +
      "</div>" +

      '<div class="card"><h2>รีเซ็ต</h2>' +
        '<p class="muted">คืนค่าข้อมูลทั้งหมดกลับเป็นค่าตั้งต้น (data/state.default.json)</p>' +
        '<button class="btn danger" data-act="set-reset" style="margin-top:8px">รีเซ็ตข้อมูลทั้งหมด</button>' +
      "</div>";
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
    "hide-lower": function () { cmd({ action: "hide", slot: "lower" }); },
    "show-full-results": function () {
      cmd({ action: "show", slot: "full", template: "results", eventId: null });
    },
    "show-full-sport": function (b) {
      cmd({ action: "show", slot: "full", template: "sportMatches", eventId: null, sport: b.dataset.sport });
    },
    "show-full-schedule": function () {
      cmd({ action: "show", slot: "full", template: "schedule", eventId: selectedEventId() });
    },
    "hide-full": function () { cmd({ action: "hide", slot: "full" }); },

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
    "res-add-row": function () { resDraft.rows.push(houseKeys()[0]); renderResEditor(); scheduleResSave(); },

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
      var houses = {}, houseNames = {}, houseLogos = {};
      [].forEach.call(panel.querySelectorAll("[data-hcolor]"), function (i) { houses[i.dataset.hcolor] = i.value; });
      [].forEach.call(panel.querySelectorAll("[data-hname]"), function (i) { houseNames[i.dataset.hname] = i.value.trim(); });
      [].forEach.call(panel.querySelectorAll("[data-hlogo]"), function (i) { houseLogos[i.dataset.hlogo] = i.value.trim(); });
      cmd({
        action: "setSettings",
        settings: {
          meetTitle: document.getElementById("setMeet").value.trim(),
          logo: document.getElementById("setLogo").value.trim(),
          animMs: Number(document.getElementById("setAnim").value) || 450,
          houses: houses, houseNames: houseNames, houseLogos: houseLogos,
        },
      }).then(function (ok) { if (ok) toast("บันทึกการตั้งค่าแล้ว"); });
    },
    "set-reset": function () {
      if (confirm("รีเซ็ตข้อมูลทั้งหมดกลับเป็นค่าตั้งต้น ?")) cmd({ action: "resetState" }).then(function (ok) { if (ok) toast("รีเซ็ตแล้ว"); });
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

    "sp-add": function () {
      sportCollectFromDom();
      var k = houseKeys();
      var last = sportDraft.matches[sportDraft.matches.length - 1];
      sportDraft.matches.push({
        id: newMatchId(), level: (last && last.level) || "ป.1", title: "",
        home: k[0], away: k[1] || k[0], hs: 0, as: 0, done: false,
        clock: { running: false, elapsed: 0, since: 0 },
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
      if (c.running) {
        c.since -= d * 1000;                       // เดินอยู่: เลื่อนจุดเริ่ม -> เวลารวมเปลี่ยน d วินาที
        if (clockNow(c) < 0) { c.elapsed = 0; c.since = Date.now(); }
      } else {
        c.elapsed = Math.max(0, c.elapsed + d);
      }
      cm.clock = c;
      renderSportScore();
      saveSportNow();
    },
    "clk-reset": function () {
      sportCollectFromDom();
      var cm = curDraftMatch();
      if (!cm) return;
      cm.clock = { running: false, elapsed: 0, since: 0 };
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
  // ฟิลด์ในตารางแมตช์ -> บันทึกอัตโนมัติ (debounce)
  function isSportField(t) {
    return !!(t && t.closest && t.closest(".fb-tbl"));
  }
  panel.addEventListener("input", function (e) {
    if (inSportEditor() && isSportField(e.target)) scheduleSportSave();
  });
})();
