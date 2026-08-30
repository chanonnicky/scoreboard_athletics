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

  var TPL_NAMES = {
    top3: "อันดับ 1–3", results: "ผลการแข่งขัน", schedule: "ตารางการแข่งขัน",
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
    if (resSaveTimer) return;
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
    ({ live: renderLive, events: renderEvents, import: renderImport, settings: renderSettings }[activeTab] || renderLive)();
  }

  // ========================================================= //
  //  SCORE  (หน้า /score — เฉพาะจดคะแนน)
  // ========================================================= //
  function eventIndex() {
    var evs = state.events || [];
    for (var i = 0; i < evs.length; i++) if (evs[i].id === sel.eventId) return i;
    return -1;
  }
  function scoreStep(dir) {
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
          '<button class="btn" data-act="score-prev"' + (idx <= 0 ? " disabled" : "") + ">‹ ก่อนหน้า</button>" +
          '<label class="field" style="flex:1">รายการที่กำลังกรอกผล' +
            eventSelect("scoreEvent", sel.eventId, ' data-role="selEvent"') +
          "</label>" +
          '<button class="btn" data-act="score-next"' + (idx < 0 || idx >= evs.length - 1 ? " disabled" : "") + ">ถัดไป ›</button>" +
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
          '<label class="field" style="flex:1">รายการที่เลือก' +
            eventSelect("liveEvent", sel.eventId, ' data-role="selEvent"') +
          "</label>" +
          '<button class="btn danger" data-act="hide-all">■ ซ่อนทั้งหมด</button>' +
          '<span id="dirtyBadge" class="dirty-badge"></span>' +
          '<button class="btn sm" data-act="reload">โหลดใหม่</button>' +
        "</div></div>" +

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
        '<table class="tbl"><thead><tr><th>คีย์</th><th>สี</th><th>ชื่อที่แสดง</th></tr></thead><tbody>' +
        houseKeys().map(function (h) {
          return "<tr><td>" + h + "</td>" +
            '<td><input type="color" data-hcolor="' + h + '" value="' + toHex(houseColor(h)) + '"></td>' +
            '<td><input type="text" data-hname="' + h + '" value="' + esc(houseName(h)) + '"></td></tr>';
        }).join("") + "</tbody></table>" +
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

    "score-prev": function () { scoreStep(-1); },
    "score-next": function () { scoreStep(1); },

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
      var houses = {}, houseNames = {};
      [].forEach.call(panel.querySelectorAll("[data-hcolor]"), function (i) { houses[i.dataset.hcolor] = i.value; });
      [].forEach.call(panel.querySelectorAll("[data-hname]"), function (i) { houseNames[i.dataset.hname] = i.value.trim(); });
      cmd({
        action: "setSettings",
        settings: {
          meetTitle: document.getElementById("setMeet").value.trim(),
          logo: document.getElementById("setLogo").value.trim(),
          animMs: Number(document.getElementById("setAnim").value) || 450,
          houses: houses, houseNames: houseNames,
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
    if (t.id === "eventsFile") {
      var f = t.files && t.files[0];
      if (!f) return;
      f.text().then(function (txt) {
        document.getElementById("eventsCsv").value = txt;
        toast("โหลดไฟล์แล้ว — กดปุ่มนำเข้า");
      });
    }
  });
})();
