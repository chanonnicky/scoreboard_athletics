/* control.js — หน้าคอนโทรลสำหรับ operator */
(function () {
  "use strict";

  var esc = T.esc;
  var panel = document.getElementById("panel");
  var tabsEl = document.getElementById("tabs");
  var toastEl = document.getElementById("toast");
  var tokenInput = document.getElementById("token");

  var state = null;
  var activeTab = "live";
  var firstLoaded = false;
  var pendingRender = false;

  var sel = { eventId: localStorage.getItem("cg_sel_event") || "" };
  var editing = null; // draft ของ event ที่กำลังแก้
  var resDraft = { eid: null, rows: [] }; // ผลอันดับที่กำลังแก้ (array ของ house key เรียงตามอันดับ)

  var TPL_NAMES = { top3: "อันดับ 1–3", intro: "แนะนำรายการ", results: "ผลเต็มรายการ", tally: "คะแนนรวมคณะสี" };

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

  // ---- render dispatch ------------------------------------ //
  function render() {
    pendingRender = false;
    if (!state) { panel.innerHTML = '<p class="muted">กำลังโหลด…</p>'; return; }
    if (!sel.eventId && state.events && state.events[0]) sel.eventId = state.events[0].id;
    ({ live: renderLive, events: renderEvents, tally: renderTally, import: renderImport, settings: renderSettings }[activeTab] || renderLive)();
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

        '<div class="slot-box">' +
          "<h3>แถบล่าง (Lower third)</h3>" +
          '<div class="now">' + nowLine("lower") + "</div>" +
          '<div class="row">' +
            '<button class="btn primary" data-act="show-lower-top3">▶ อันดับ 1–3</button>' +
            '<button class="btn" data-act="hide-lower">ซ่อน</button>' +
          "</div>" +
        "</div>" +

        '<div class="slot-box">' +
          "<h3>เต็มจอ (Full screen)</h3>" +
          '<div class="now">' + nowLine("full") + "</div>" +
          '<div class="row">' +
            '<button class="btn primary" data-act="show-full-intro">▶ แนะนำรายการ</button>' +
            '<button class="btn primary" data-act="show-full-results">▶ ผลเต็มรายการ</button>' +
            '<button class="btn primary" data-act="show-full-tally">▶ คะแนนรวม</button>' +
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
        '<button class="btn ok" data-act="res-save"' + (ev ? "" : " disabled") + ">บันทึกผล</button>" +
        '<button class="btn" data-act="res-clear">ล้าง</button>' +
        '<button class="btn sm" data-act="res-add-row">+ เพิ่มอันดับ</button>' +
        '<span class="muted">บันทึกแล้วอัปเดต CG ที่แสดงอยู่ทันที</span>' +
      "</div>";
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
        ? '<table class="tbl" style="margin-top:10px"><thead><tr><th>รายการ</th><th>รุ่น</th><th>รอบ</th><th style="width:150px"></th></tr></thead><tbody>' +
          evs.map(function (e) {
            return "<tr>" +
              "<td>" + esc(e.title) + "</td><td>" + esc(e.ageGroup || "") + "</td><td>" + esc(e.round || "") + "</td>" +
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
          '<label class="field" style="flex:1">รุ่นอายุ<input type="text" id="evAge" value="' + esc(e.ageGroup || "") + '" placeholder="รุ่นอายุ 15 ปี"></label>' +
          '<label class="field" style="flex:1">รอบ<input type="text" id="evRound" value="' + esc(e.round || "") + '" placeholder="รอบชิงชนะเลิศ"></label>' +
        "</div>" +
        '<div class="row" style="margin-top:16px">' +
          '<button class="btn ok" data-act="ev-save">บันทึกรายการ</button>' +
          '<button class="btn" data-act="ev-cancel">ยกเลิก</button>' +
        "</div>" +
      "</div>";
  }

  // ========================================================= //
  //  TALLY
  // ========================================================= //
  function renderTally() {
    var t = state.tally || {};
    var p = (state.settings && state.settings.points) || {};
    panel.innerHTML =
      '<div class="card"><h2>คะแนนรวมคณะสี</h2>' +
        '<table class="tbl" style="margin-top:8px"><tbody>' +
        houseKeys().map(function (h) {
          return "<tr><td><span class=\"hswatch\" style=\"background:" + houseColor(h) + "\"></span>" + esc(houseName(h)) + "</td>" +
            '<td><input type="number" name="score" data-house="' + h + '" value="' + (Number(t[h]) || 0) + '"></td></tr>';
        }).join("") +
        "</tbody></table>" +
        '<div class="row" style="margin-top:12px">' +
          '<button class="btn ok" data-act="tally-save">บันทึกคะแนน</button>' +
          '<button class="btn danger" data-act="tally-zero">ล้างเป็น 0</button>' +
          '<span id="dirtyBadge" class="dirty-badge"></span>' +
        "</div>" +
      "</div>" +

      '<div class="card"><h3 style="margin-top:0">บวกแต้มอัตโนมัติจากผลรายการ</h3>' +
        '<p class="muted">อันดับ 1 = ' + (p["1"] || 0) + " แต้ม, อันดับ 2 = " + (p["2"] || 0) + " แต้ม, อันดับ 3 = " + (p["3"] || 0) + ' แต้ม (แก้ได้ในแท็บตั้งค่า)</p>' +
        '<div class="row" style="margin-top:8px">' + eventSelect("ptsEvent", sel.eventId) +
          '<button class="btn primary" data-act="tally-addpts">บวกแต้มจากรายการนี้</button>' +
        "</div>" +
      "</div>";
  }

  // ========================================================= //
  //  IMPORT
  // ========================================================= //
  function renderImport() {
    panel.innerHTML =
      '<div class="card"><h2>นำเข้าตารางรายการแข่ง</h2>' +
        '<p class="muted">คอลัมน์: <code>title,ageGroup,round</code> &nbsp;(<code>title</code> ซ้ำ = รายการเดิม จะอัปเดตทับ)</p>' +
        '<div class="row" style="margin:8px 0"><input type="file" id="eventsFile" accept=".csv,text/csv"></div>' +
        '<textarea id="eventsCsv" placeholder="title,ageGroup,round&#10;วิ่ง 100 เมตร ชาย,รุ่นอายุ 15 ปี,รอบชิงชนะเลิศ">title,ageGroup,round\n</textarea>' +
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
        '<h3>แต้มต่ออันดับ</h3>' +
        '<div class="row">' +
          ["1", "2", "3"].map(function (k) {
            return '<label class="field">อันดับ ' + k + '<input type="number" data-pts="' + k + '" min="0" value="' + (((s.points || {})[k]) || 0) + '"></label>';
          }).join("") +
        "</div>" +
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
    "show-full-intro": function () {
      if (!sel.eventId) return toast("เลือกรายการก่อน", true);
      cmd({ action: "show", slot: "full", template: "intro", eventId: sel.eventId });
    },
    "show-full-results": function () {
      if (!sel.eventId) return toast("เลือกรายการก่อน", true);
      cmd({ action: "show", slot: "full", template: "results", eventId: sel.eventId });
    },
    "show-full-tally": function () { cmd({ action: "show", slot: "full", template: "tally", eventId: null }); },
    "hide-full": function () { cmd({ action: "hide", slot: "full" }); },

    "res-tap": function (b) {
      if (!sel.eventId) return toast("เลือกรายการก่อน", true);
      resDraft.rows.push(b.dataset.house);
      renderResEditor();
    },
    "res-rm": function (b) {
      resDraft.rows.splice(Number(b.dataset.i), 1);
      renderResEditor();
    },
    "res-clear": function () { resDraft.rows = []; renderResEditor(); },
    "res-add-row": function () { resDraft.rows.push(houseKeys()[0]); renderResEditor(); },
    "res-save": function () {
      if (!sel.eventId) return;
      var results = resDraft.rows.map(function (h, i) { return { rank: i + 1, house: h }; });
      cmd({ action: "setResults", eventId: sel.eventId, results: results }).then(function (ok) {
        if (ok) { toast("บันทึกผลแล้ว"); resDraft.eid = null; render(); }
      });
    },

    "ev-new": function () { editing = { id: "", title: "", ageGroup: "", round: "" }; render(); },
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
        ageGroup: document.getElementById("evAge").value.trim(),
        round: document.getElementById("evRound").value.trim(),
      };
      if (!ev.title) return toast("ใส่ชื่อรายการก่อน", true);
      cmd({ action: "upsertEvent", event: ev }).then(function (ok) {
        if (ok) { toast("บันทึกรายการแล้ว"); editing = null; render(); }
      });
    },

    "tally-save": function () {
      var t = {};
      [].forEach.call(panel.querySelectorAll('[name=score]'), function (i) {
        t[i.dataset.house] = Number(i.value) || 0;
      });
      cmd({ action: "setTally", tally: t }).then(function (ok) { if (ok) toast("บันทึกคะแนนแล้ว"); });
    },
    "tally-zero": function () {
      if (!confirm("ล้างคะแนนทุกคณะเป็น 0 ?")) return;
      var t = {};
      houseKeys().forEach(function (h) { t[h] = 0; });
      cmd({ action: "setTally", tally: t });
    },
    "tally-addpts": function () {
      var id = document.getElementById("ptsEvent").value;
      if (!id) return toast("เลือกรายการก่อน", true);
      cmd({ action: "addEventPointsToTally", eventId: id }).then(function (ok) { if (ok) toast("บวกแต้มแล้ว"); });
    },

    "imp-events": function () {
      var csv = document.getElementById("eventsCsv").value.trim();
      if (!csv) return toast("ไม่มีข้อมูล", true);
      importCsv("events", csv).then(function (j) { if (j) toast("นำเข้า " + (j.imported.events || 0) + " รายการ"); });
    },

    "set-save": function () {
      var houses = {}, houseNames = {}, points = {};
      [].forEach.call(panel.querySelectorAll("[data-hcolor]"), function (i) { houses[i.dataset.hcolor] = i.value; });
      [].forEach.call(panel.querySelectorAll("[data-hname]"), function (i) { houseNames[i.dataset.hname] = i.value.trim(); });
      [].forEach.call(panel.querySelectorAll("[data-pts]"), function (i) { points[i.dataset.pts] = Number(i.value) || 0; });
      cmd({
        action: "setSettings",
        settings: {
          meetTitle: document.getElementById("setMeet").value.trim(),
          animMs: Number(document.getElementById("setAnim").value) || 450,
          houses: houses, houseNames: houseNames, points: points,
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
      sel.eventId = t.value;
      localStorage.setItem("cg_sel_event", sel.eventId);
      render();
      return;
    }
    if (t.dataset && t.dataset.act === "res-set") {
      resDraft.rows[Number(t.dataset.i)] = t.value;
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
