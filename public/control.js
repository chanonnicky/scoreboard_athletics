/* control.js — 2 โหมด: /control (operator สั่ง CG) และ /score (คนจดคะแนน) */
(function () {
  "use strict";

  var MODE = location.pathname.replace(/\/+$/, "") === "/score" ? "score" : "control";

  var esc = T.esc;
  var panel = document.getElementById("panel");
  var tabsEl = document.getElementById("tabs");
  var toastEl = document.getElementById("toast");
  var tokenInput = document.getElementById("token");

  if (MODE === "score") {
    document.title = "CG Live — จดคะแนน";
    document.body.classList.add("mode-score");
    tabsEl.hidden = true;
    var brand = document.querySelector(".brand");
    if (brand) brand.innerHTML = "🏁 จดคะแนน <span>กีฬาสี</span>";
  }
  (function crossLink() {
    var bar = document.querySelector(".topbar");
    if (!bar) return;
    var a = document.createElement("a");
    a.className = "mode-link";
    a.href = MODE === "score" ? "/control" : "/score";
    a.textContent = MODE === "score" ? "→ คอนโทรล" : "→ จดคะแนน";
    bar.insertBefore(a, document.getElementById("conn"));
  })();

  var state = null;
  var activeTab = "live";
  var firstLoaded = false;
  var pendingRender = false;

  var sel = { eventId: localStorage.getItem("cg_sel_event") || "" };
  var editing = null; // draft ของ event ที่กำลังแก้
  var resDraft = { eid: null, rows: [] }; // ผลอันดับที่กำลังแก้ (array ของ house key เรียงตามอันดับ)
  var sportSel = null;      // key กีฬาที่กำลังแก้ในแท็บกีฬา
  var sportDraft = null;    // ก้อนกีฬาที่กำลังแก้ (null = โหลดจาก state ใหม่)
  var sportSaveTimer = null; // debounce บันทึกกีฬา

  var TPL_NAMES = {
    top3: "อันดับ 1–3", results: "ผลการแข่งขัน", schedule: "ตารางการแข่งขัน",
    sportMatches: "กีฬา · ผลแมตช์", sportTable: "กีฬา · ตารางคะแนน", sportBracket: "กีฬา · สายน็อกเอาต์",
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

  // ---- tabs -------------------------------------------------- //
  tabsEl.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]");
    if (!b) return;
    activeTab = b.dataset.tab;
    [].forEach.call(tabsEl.children, function (c) { c.classList.toggle("active", c === b); });
    editing = null;
    sportDraft = null; // เข้าแท็บกีฬาใหม่ = โหลดข้อมูลล่าสุด
    render();
  });

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
  function currentEvent() {
    return (state.events || []).find(function (e) { return e.id === sel.eventId; }) || null;
  }
  // เปลี่ยนรายการที่เลือก -> ถ้า "ตารางแข่ง" ออกอากาศอยู่ ให้เลื่อนตามทันที
  function followSelection() {
    var fo = (state.onair || {}).full || {};
    if (fo.visible && fo.template === "schedule") {
      cmd({ action: "show", slot: "full", template: "schedule", eventId: sel.eventId });
    }
  }

  // ---- render dispatch ------------------------------------ //
  function render() {
    pendingRender = false;
    if (!state) { panel.innerHTML = '<p class="muted">กำลังโหลด…</p>'; return; }
    if (!sel.eventId && state.events && state.events[0]) sel.eventId = state.events[0].id;
    if (MODE === "score") { renderScore(); return; }
    ({ live: renderLive, events: renderEvents, sports: renderSports, import: renderImport, settings: renderSettings }[activeTab] || renderLive)();
  }

  // ========================================================= //
  //  SCORE  (หน้า /score — เฉพาะจดคะแนน)
  // ========================================================= //
  function eventIndex() {
    var evs = state.events || [];
    for (var i = 0; i < evs.length; i++) if (evs[i].id === sel.eventId) return i;
    return -1;
  }
  function stepEvent(dir) {
    var evs = state.events || [];
    var ni = eventIndex() + dir;
    if (ni < 0 || ni >= evs.length) return;
    saveResultsNow();
    sel.eventId = evs[ni].id;
    localStorage.setItem("cg_sel_event", sel.eventId);
    followSelection();
    render();
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
          '<label class="field" style="flex:1">รายการที่กำลังกรอกผล' +
            eventSelect("scoreEvent", sel.eventId, ' data-role="selEvent"') +
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
  function renderLive() {
    var ev = currentEvent();
    var o = state.onair || {};
    var idx = eventIndex();
    var nEv = (state.events || []).length;
    function nowLine(slot) {
      var s = o[slot] || {};
      if (!s.visible || !s.template) return "ซ่อนอยู่";
      var label = TPL_NAMES[s.template] || s.template;
      var e2 = (state.events || []).find(function (x) { return x.id === s.eventId; });
      return "<b>▶ " + esc(label) + (e2 ? " · " + esc(e2.title) : "") + "</b>";
    }

    panel.innerHTML =
      '<div class="grid"><div>' +

        '<div class="card"><div class="row">' +
          '<button class="btn" data-act="seek-prev"' + (idx <= 0 ? " disabled" : "") + ' title="รายการก่อนหน้า">‹</button>' +
          '<label class="field" style="flex:1">รายการที่เลือก' +
            eventSelect("liveEvent", sel.eventId, ' data-role="selEvent"') +
          "</label>" +
          '<button class="btn" data-act="seek-next"' + (idx < 0 || idx >= nEv - 1 ? " disabled" : "") + ' title="รายการถัดไป">›</button>' +
          '<button class="btn danger" data-act="hide-all">■ ซ่อนทั้งหมด</button>' +
          '<span id="dirtyBadge" class="dirty-badge"></span>' +
          '<button class="btn sm" data-act="reload">โหลดใหม่</button>' +
        "</div>" +
        (idx >= 0 ? '<p class="muted" style="margin-top:6px">รายการที่ ' + (idx + 1) + " / " + nEv + "</p>" : "") +
        "</div>" +

        '<p class="muted" style="margin:-4px 0 10px">แสดงได้ทีละช่อง — ขึ้นช่องหนึ่งอีกช่องจะลงอัตโนมัติ</p>' +

        '<div class="slot-box">' +
          "<h3>แถบล่าง (Lower third)</h3>" +
          '<div class="now">' + nowLine("lower") + "</div>" +
          '<div class="row">' +
            '<button class="btn primary lg" data-act="show-lower-top3">▶ ขึ้นอันดับ 1–3</button>' +
            '<button class="btn" data-act="hide-lower">ซ่อน</button>' +
          "</div>" +
        "</div>" +

        '<div class="slot-box">' +
          "<h3>เต็มจอ (Full screen)</h3>" +
          '<div class="now">' + nowLine("full") + "</div>" +
          '<div class="row">' +
            '<button class="btn primary" data-act="show-full-schedule">▶ ตารางแข่ง</button>' +
            '<button class="btn primary" data-act="show-full-results">▶ ผลการแข่งขัน</button>' +
            '<button class="btn" data-act="hide-full">ซ่อน</button>' +
          "</div>" +
        "</div>" +

        '<div class="card">' +
          '<div class="row"><h2 style="margin:0">ผลการแข่งขัน — ' + esc(ev ? ev.title : "(เลือกรายการก่อน)") + "</h2></div>" +
          '<div id="resEditor"></div>' +
        "</div>" +

      "</div>" +

      '<div class="preview-wrap"><div class="preview-label">พรีวิว overlay (โปร่งใส = ลายตาราง)</div>' +
        '<div class="preview"><iframe src="/overlay" title="preview"></iframe></div>' +
        '<div class="preview-label">มุมมองนี้อัปเดตสดเหมือนที่ออกใน OBS/vMix</div>' +
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
    if (!sel.eventId) return;
    if (resSaveTimer) clearTimeout(resSaveTimer);
    resSaveTimer = setTimeout(saveResultsNow, 500);
  }
  function saveResultsNow() {
    if (!resSaveTimer) return;            // ไม่มีการแก้ที่ค้างอยู่
    clearTimeout(resSaveTimer); resSaveTimer = null;
    if (!sel.eventId) return;
    var eid = sel.eventId;
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
  var SPORT_STAGES = [
    ["group", "รอบแบ่งกลุ่ม"], ["final", "รอบชิงชนะเลิศ"], ["third", "ชิงอันดับ 3"],
  ];

  function sportsList() { return state.sports || []; }
  function curSportKey() {
    var list = sportsList();
    if (sportSel && list.some(function (s) { return s.key === sportSel; })) return sportSel;
    return list[0] ? list[0].key : null;
  }
  function sportEnsureDraft() {
    var key = curSportKey();
    if (sportDraft && sportDraft.key === key) return;
    var src = null, list = sportsList();
    for (var i = 0; i < list.length; i++) if (list[i].key === key) { src = list[i]; break; }
    src = src || { key: key, name: "", icon: "", points: {}, matches: [] };
    var p = src.points || {};
    sportDraft = {
      key: src.key, name: src.name || "", icon: src.icon || "",
      points: { win: p.win != null ? p.win : 3, draw: p.draw != null ? p.draw : 1, loss: p.loss != null ? p.loss : 0 },
      matches: (src.matches || []).map(function (m) {
        return { id: m.id, level: m.level || "", title: m.title || "", stage: m.stage || "group",
                 home: m.home, away: m.away, hs: m.hs, as: m.as, done: !!m.done };
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

  function sportCollectFromDom() {
    if (!sportDraft) return;
    var nm = document.querySelector("[data-spname]"); if (nm) sportDraft.name = nm.value.trim();
    var ic = document.querySelector("[data-spicon]"); if (ic) sportDraft.icon = ic.value.trim();
    ["win", "draw", "loss"].forEach(function (k) {
      var el = document.querySelector('[data-sppts="' + k + '"]');
      if (el) sportDraft.points[k] = el.value === "" ? 0 : Number(el.value);
    });
    var out = [];
    [].forEach.call(panel.querySelectorAll(".fb-tbl tbody tr[data-i]"), function (tr, i) {
      var g = function (s) { return tr.querySelector(s); };
      var hs = g("[data-hs]").value, as = g("[data-as]").value;
      out.push({
        id: (sportDraft.matches[i] && sportDraft.matches[i].id) || newMatchId(),
        level: g("[data-level]").value.trim(),
        title: g("[data-title]").value.trim(),
        stage: g("[data-stage]").value,
        home: g("[data-home]").value,
        away: g("[data-away]").value,
        hs: hs === "" ? 0 : Number(hs),
        as: as === "" ? 0 : Number(as),
        done: g("[data-done]").checked,
      });
    });
    sportDraft.matches = out;
  }
  function sportBuild() {
    return { key: sportDraft.key, name: sportDraft.name, icon: sportDraft.icon,
             points: sportDraft.points, matches: sportDraft.matches };
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

  // ตัวเลือกระดับชั้น (จากรายการกรีฑา + กีฬาที่มี) ช่วยพิมพ์ให้ตรงกัน
  function levelOptions() {
    var set = {}, out = [];
    function add(l) { if (l && !set[l]) { set[l] = 1; out.push(l); } }
    (state.events || []).forEach(function (e) { add(e.level || e.ageGroup); });
    sportsList().forEach(function (sp) { (sp.matches || []).forEach(function (m) { add(m.level); }); });
    return out;
  }

  function renderSports() {
    var list = sportsList();
    if (!list.length) {
      panel.innerHTML = '<div class="card"><h2>กีฬา</h2><p class="muted">ยังไม่มีกีฬา — รีเซ็ตข้อมูลเพื่อสร้างชุดเริ่มต้น (บอล/บาส/วิ่งเปรี้ยว/ชักเย่อ)</p></div>';
      return;
    }
    sportEnsureDraft();
    var key = sportDraft.key;
    var fo = (state.onair || {}).full || {};
    function onBtn(tpl, label) {
      var on = fo.visible && fo.template === tpl && fo.sport === key;
      return '<button class="btn ' + (on ? "ok" : "") + '" data-act="sp-show" data-tpl="' + tpl + '">' +
        (on ? "▶ " : "") + esc(label) + "</button>";
    }
    var picker = list.map(function (sp) {
      return '<button class="btn ' + (sp.key === key ? "ok" : "") + '" data-act="sp-pick" data-key="' + esc(sp.key) + '">' +
        esc((sp.icon ? sp.icon + " " : "") + (sp.name || sp.key)) + "</button>";
    }).join("");
    var dl = '<datalist id="lvlList">' + levelOptions().map(function (l) {
      return '<option value="' + esc(l) + '"></option>';
    }).join("") + "</datalist>";

    var rows = sportDraft.matches.map(function (m, i) {
      return '<tr data-i="' + i + '">' +
        '<td><input class="fb-lvl" data-level list="lvlList" value="' + esc(m.level || "") + '" placeholder="ม.ต้น"></td>' +
        '<td><input class="fb-ttl" data-title value="' + esc(m.title || "") + '" placeholder="คู่ที่ 1"></td>' +
        '<td><select data-stage>' + SPORT_STAGES.map(function (s) {
          return '<option value="' + s[0] + '"' + (s[0] === m.stage ? " selected" : "") + ">" + s[1] + "</option>";
        }).join("") + "</select></td>" +
        "<td>" + sportHouseSelect("home", m.home) + "</td>" +
        '<td><input class="fb-num" data-hs type="number" min="0" inputmode="numeric" value="' + (m.hs == null ? "" : esc(m.hs)) + '"></td>' +
        '<td class="fb-colon">:</td>' +
        '<td><input class="fb-num" data-as type="number" min="0" inputmode="numeric" value="' + (m.as == null ? "" : esc(m.as)) + '"></td>' +
        "<td>" + sportHouseSelect("away", m.away) + "</td>" +
        '<td><label class="fb-done"><input type="checkbox" data-done' + (m.done ? " checked" : "") + "> จบ</label></td>" +
        '<td><button class="btn danger sm" data-act="sp-del" data-i="' + i + '">✕</button></td>' +
      "</tr>";
    }).join("");

    panel.innerHTML = dl +
      '<div class="card"><h2>เลือกกีฬา</h2><div class="row">' + picker + "</div></div>" +

      '<div class="card"><h2>' + esc((sportDraft.icon ? sportDraft.icon + " " : "") + (sportDraft.name || key)) + " — ขึ้นจอ (ช่องเต็มจอ)</h2>" +
        '<div class="row">' +
          onBtn("sportMatches", "ผลแมตช์") +
          onBtn("sportTable", "ตารางคะแนน") +
          onBtn("sportBracket", "สายน็อกเอาต์") +
          '<button class="btn" data-act="sp-hide">ลง (ซ่อน)</button>' +
        "</div>" +
        '<p class="muted" style="margin-top:8px">แก้สกอร์แล้วจอที่ออกอากาศเปลี่ยนตามทันที · จอวนรวมทุกอย่าง: <code>/board?view=all</code></p>' +
      "</div>" +

      '<div class="card"><h2>ตั้งค่ากีฬานี้</h2><div class="row">' +
        '<label class="field" style="max-width:110px">ไอคอน<input type="text" data-spicon value="' + esc(sportDraft.icon) + '" placeholder="⚽"></label>' +
        '<label class="field" style="max-width:240px">ชื่อกีฬา<input type="text" data-spname value="' + esc(sportDraft.name) + '" placeholder="ฟุตบอล"></label>' +
        '<label class="field" style="max-width:90px">ชนะ<input type="number" min="0" data-sppts="win" value="' + sportDraft.points.win + '"></label>' +
        '<label class="field" style="max-width:90px">เสมอ<input type="number" min="0" data-sppts="draw" value="' + sportDraft.points.draw + '"></label>' +
        '<label class="field" style="max-width:90px">แพ้<input type="number" min="0" data-sppts="loss" value="' + sportDraft.points.loss + '"></label>' +
      "</div></div>" +

      '<div class="card"><h2>แมตช์การแข่งขัน</h2>' +
        '<table class="tbl fb-tbl" style="margin-top:4px"><thead><tr>' +
          "<th>ระดับชั้น</th><th>ชื่อรายการ</th><th>รอบ</th><th>เจ้าบ้าน</th><th>สกอร์</th><th></th><th></th><th>ทีมเยือน</th><th>สถานะ</th><th></th>" +
        "</tr></thead><tbody>" +
          (rows || '<tr><td colspan="10" class="muted">ยังไม่มีแมตช์ — กด “เพิ่มแมตช์”</td></tr>') +
        "</tbody></table>" +
        '<div class="row" style="margin-top:12px">' +
          '<button class="btn" data-act="sp-add">+ เพิ่มแมตช์</button>' +
          '<span class="muted">แบ่งกลุ่ม: ชนะ ' + sportDraft.points.win + " · เสมอ " + sportDraft.points.draw + " · แพ้ " + sportDraft.points.loss + " แต้ม · ตาราง/สายแยกตามระดับชั้น</span>" +
        "</div>" +
      "</div>";
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

      '<div class="card"><h2>ลิงก์สำหรับ OBS / vMix</h2>' +
        '<div class="urlbox"><input type="text" id="ovUrl" readonly value="' + origin + '/overlay">' +
          '<button class="btn" data-act="url-copy">คัดลอก</button></div>' +
        '<div class="linklist">' +
          '<a href="/overlay" target="_blank">/overlay</a>' +
          '<a href="/overlay?slot=lower" target="_blank">/overlay?slot=lower &nbsp;— เฉพาะแถบล่าง</a>' +
          '<a href="/overlay?slot=full" target="_blank">/overlay?slot=full &nbsp;— เฉพาะเต็มจอ</a>' +
          '<a href="/overlay?transport=poll" target="_blank">/overlay?transport=poll &nbsp;— ถ้าเน็ตบล็อก SSE</a>' +
        "</div>" +
        '<p class="muted" style="margin-top:10px">ตั้งขนาด Browser Source / Web Input เป็น 1920×1080</p>' +
      "</div>" +

      '<div class="card"><h2>จอประชาสัมพันธ์ (เปิดค้างที่จอโรงเรียน)</h2>' +
        '<div class="urlbox"><input type="text" id="bdUrl" readonly value="' + origin + '/board">' +
          '<button class="btn" data-act="board-copy">คัดลอก</button></div>' +
        '<div class="linklist">' +
          '<a href="/board?view=all" target="_blank">/board?view=all &nbsp;— วนรวมทุกอย่าง: กรีฑา → ทุกกีฬา ⭐</a>' +
          '<a href="/board" target="_blank">/board &nbsp;— เฉพาะผลการแข่งขันกรีฑา</a>' +
          '<a href="/board?view=football" target="_blank">/board?view=football &nbsp;— เฉพาะกีฬาหนึ่ง (football/basketball/sprint/tugofwar)</a>' +
          '<a href="/board?page=6" target="_blank">/board?page=6 &nbsp;— เปลี่ยนหน้าเร็วขึ้น (วินาที/หน้า)</a>' +
          '<a href="/board?transport=poll" target="_blank">/board?transport=poll &nbsp;— ถ้าเน็ตบล็อก SSE</a>' +
        "</div>" +
        '<p class="muted" style="margin-top:10px">เปิดแบบเต็มจอ (กด F11) บนคอมที่ต่อจอโรงเรียน — ย่อ/ขยายพอดีจอทุกความละเอียดอัตโนมัติ</p>' +
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
      if (!sel.eventId) return toast("เลือกรายการก่อน", true);
      cmd({ action: "show", slot: "lower", template: "top3", eventId: sel.eventId });
    },
    "hide-lower": function () { cmd({ action: "hide", slot: "lower" }); },
    "show-full-results": function () {
      cmd({ action: "show", slot: "full", template: "results", eventId: null });
    },
    "show-full-schedule": function () {
      cmd({ action: "show", slot: "full", template: "schedule", eventId: sel.eventId });
    },
    "hide-full": function () { cmd({ action: "hide", slot: "full" }); },

    "res-tap": function (b) {
      if (!sel.eventId) return toast("เลือกรายการก่อน", true);
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

    "sp-pick": function (b) {
      saveSportNow();          // เซฟกีฬาที่กำลังแก้อยู่ก่อนสลับ
      sportSel = b.dataset.key;
      sportDraft = null;
      renderSports();
    },
    "sp-show": function (b) {
      saveSportNow().then(function () {
        cmd({ action: "show", slot: "full", template: b.dataset.tpl, eventId: null, sport: sportDraft.key });
      });
    },
    "sp-hide": function () { cmd({ action: "hide", slot: "full" }); },
    "sp-add": function () {
      sportCollectFromDom();
      var k = houseKeys();
      var last = sportDraft.matches[sportDraft.matches.length - 1];
      sportDraft.matches.push({
        id: newMatchId(), level: (last && last.level) || "", title: "", stage: "group",
        home: k[0], away: k[1] || k[0], hs: 0, as: 0, done: false,
      });
      renderSports();
      scheduleSportSave();
    },
    "sp-del": function (b) {
      sportCollectFromDom();
      sportDraft.matches.splice(Number(b.dataset.i), 1);
      renderSports();
      scheduleSportSave();
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
      saveResultsNow();  // เซฟผลรายการเดิมที่ค้างอยู่ก่อนสลับ
      sel.eventId = t.value;
      localStorage.setItem("cg_sel_event", sel.eventId);
      followSelection();
      render();
      return;
    }
    if (t.dataset && t.dataset.act === "res-set") {
      resDraft.rows[Number(t.dataset.i)] = t.value;
      scheduleResSave();
      return;
    }
    if (activeTab === "sports" && isSportField(t)) {
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

  // ฟิลด์ในแท็บกีฬา (แมตช์ / ตั้งค่ากีฬา) -> บันทึกอัตโนมัติ (debounce)
  function isSportField(t) {
    if (!t || !t.closest) return false;
    if (t.closest(".fb-tbl")) return true;
    return !!(t.hasAttribute && (t.hasAttribute("data-spname") || t.hasAttribute("data-spicon") || t.hasAttribute("data-sppts")));
  }
  panel.addEventListener("input", function (e) {
    if (activeTab === "sports" && isSportField(e.target)) scheduleSportSave();
  });
})();
