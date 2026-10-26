/* obs.js — หน้าคุมแบบแคบสำหรับใส่เป็น Custom Browser Dock ใน OBS  →  /obs
   OBS: Docks → Custom Browser Docks… → ตั้งชื่อ + วาง URL http://<ip>:<port>/obs

   เสิร์ฟจาก origin เดียวกับ API จึงส่ง X-Token ได้ตรง ๆ ไม่ติด CORS
   (ทั้ง server.py และ server.ps1 ไม่มี do_OPTIONS / Access-Control-Allow-Headers)

   คุมช่อง state.l3 เท่านั้น — ชุดคำสั่งเดียวกับหน้า /cg                        */
(function () {
  "use strict";

  var esc = T.esc;
  var body = document.getElementById("dockBody");
  var toastEl = document.getElementById("toast");
  var connEl = document.getElementById("conn");

  var state = null;
  var TOKEN_KEY = "cg_token";   // คีย์เดียวกับ /control และ /cg
  var token = "";
  try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { token = ""; }

  var SLOT_ORDER = ["lower", "full", "top", "ticker", "bug"];
  var SLOT_LABEL = {
    lower: "แถบล่าง", full: "เต็มจอ", top: "แถบบน", ticker: "แถบวิ่ง", bug: "มุมจอ",
  };

  // draft ของกล่องคอมโพสด่วน (ชื่อ + ตำแหน่ง เท่านั้น — งานละเอียดทำที่ /cg)
  var quick = { line1: "", line2: "" };

  function hdrs() {
    var h = { "Content-Type": "application/json" };
    if (token) h["X-Token"] = token;
    return h;
  }
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
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.className = "toast"; }, 2400);
  }
  function setConn(ok) {
    connEl.textContent = ok ? "● ต่อแล้ว" : "● หลุด";
    connEl.className = "d-conn " + (ok ? "ok" : "bad");
  }

  function l3() {
    var x = (state && state.l3) || {};
    return { settings: x.settings || {}, onair: x.onair || {}, items: x.items || [] };
  }
  function slotConf(s) { return l3().onair[s] || {}; }
  function itemById(id) {
    var it = l3().items;
    for (var i = 0; i < it.length; i++) if (it[i].id === id) return it[i];
    return null;
  }
  function itemLive(id) {
    for (var i = 0; i < SLOT_ORDER.length; i++) {
      var c = slotConf(SLOT_ORDER[i]);
      if (c.visible && c.itemId && c.itemId === id) return true;
    }
    return false;
  }

  // ---- render ------------------------------------------------------ //
  function render() {
    if (!state) { body.innerHTML = '<p class="muted">กำลังโหลด…</p>'; return; }
    if (!state.l3) {
      body.innerHTML = '<p class="muted">ยังไม่มีช่อง Lower Third — รีสตาร์ตเซิร์ฟเวอร์หนึ่งครั้ง</p>';
      return;
    }
    var items = l3().items;

    // แถบสถานะ 5 ช่อง
    var slots = SLOT_ORDER.map(function (slot) {
      var c = slotConf(slot);
      var on = !!(c.visible && c.type);
      var m = on ? T.L3_TYPES[c.type] : null;
      var f = c.fields || {};
      var txt = "— ว่าง —";
      if (on) {
        var bits = [f.line1, f.label].filter(function (x) { return x; });
        if (!bits.length && f.messages) bits = [T.l3List(f.messages)[0]];
        txt = esc(bits[0] || (m ? m.label : c.type));
      }
      return '<div class="d-slot' + (on ? " on" : "") + '">' +
        '<span class="d-slot-n">' + esc(SLOT_LABEL[slot]) + "</span>" +
        '<span class="d-slot-t">' + txt + "</span>" +
        (on ? '<button class="btn sm" data-act="slot-hide" data-slot="' + slot + '">✕</button>' : "") +
      "</div>";
    }).join("");

    // ชิ้นงาน แยกตามกลุ่ม
    var grouped = "";
    if (items.length) {
      var groups = {}, order = [];
      items.forEach(function (it) {
        var g = it.group || "ไม่จัดกลุ่ม";
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(it);
      });
      grouped = order.map(function (g) {
        return '<div class="d-grp-t">' + esc(g) + "</div>" +
          '<div class="d-items">' + groups[g].map(function (it) {
            var m = T.L3_TYPES[it.type];
            var f = it.fields || {};
            var nm = it.name || f.line1 || f.label || (m ? m.label : it.type);
            return '<button class="d-item' + (itemLive(it.id) ? " is-live" : "") +
                '" data-act="item-air" data-id="' + esc(it.id) + '">' +
              '<span class="d-item-tag">' + esc((m && m.tag) || it.type) + "</span>" +
              '<span class="d-item-n">' + esc(nm) + "</span>" +
            "</button>";
          }).join("") + "</div>";
      }).join("");
    } else {
      grouped = '<p class="muted" style="font-size:12px">ยังไม่มีชิ้นงาน — สร้างที่หน้า ' +
        '<a href="/cg" target="_blank">/cg</a></p>';
    }

    body.innerHTML =
      '<div class="d-sec">กำลังออกอากาศ</div>' +
      '<div class="d-slots">' + slots + "</div>" +

      '<div class="d-sec">คอมโพสด่วน (ชื่อ + ตำแหน่ง)</div>' +
      '<div class="d-quick">' +
        '<input type="text" id="qL1" value="' + esc(quick.line1) + '" placeholder="ชื่อ">' +
        '<input type="text" id="qL2" value="' + esc(quick.line2) + '" placeholder="ตำแหน่ง / คำบรรยาย">' +
        '<div class="d-row">' +
          '<button class="btn primary" data-act="quick-air">▶ ขึ้นจอ</button>' +
          '<button class="btn" data-act="quick-clear">ล้าง</button>' +
        "</div>" +
      "</div>" +

      '<div class="d-sec">คลังชิ้นงาน</div>' + grouped +

      '<div class="d-sec">ตั้งค่า</div>' +
      '<div class="d-tok">token' +
        '<input type="password" id="dockTok" value="' + esc(token) + '" placeholder="(ถ้าตั้งไว้)">' +
      "</div>" +
      '<p class="d-hint">คุมละเอียด (สร้าง/แก้ชิ้นงาน, ปรับสี-ขนาด) ที่ ' +
        '<a href="/cg" target="_blank">/cg</a> · จอที่ต้องใส่ใน OBS: ' +
        '<code>' + esc(location.origin) + '/live/cg</code></p>';
  }

  // ---- handlers ---------------------------------------------------- //
  function qCollect() {
    var a = document.getElementById("qL1"), b = document.getElementById("qL2");
    if (a) quick.line1 = a.value;
    if (b) quick.line2 = b.value;
  }

  var handlers = {
    "hide-all": function () { cmd({ action: "l3HideAll" }); },
    "hide-main": function () { cmd({ action: "l3HideAll", keep: ["top", "ticker", "bug"] }); },
    "slot-hide": function (b) { cmd({ action: "l3Hide", slot: b.getAttribute("data-slot") }); },
    "item-air": function (b) {
      var it = itemById(b.getAttribute("data-id"));
      if (!it) return;
      var m = T.L3_TYPES[it.type];
      if (!m) return;
      var c = { action: "l3Show", slot: m.slot, type: it.type, itemId: it.id,
                fields: it.fields || {}, style: it.style || {} };
      var sec = parseFloat(it.auto) || 0;
      if (sec > 0) c.until = Date.now() + sec * 1000;
      cmd(c);
    },
    "quick-air": function () {
      qCollect();
      if (!(quick.line1 || "").trim() && !(quick.line2 || "").trim()) {
        return toast("ใส่ข้อความก่อน", true);
      }
      cmd({ action: "l3Show", slot: "lower", type: "name", itemId: null,
            fields: { line1: quick.line1, line2: quick.line2 }, style: {} });
    },
    "quick-clear": function () { quick = { line1: "", line2: "" }; render(); },
  };

  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b) return;
    var fn = handlers[b.getAttribute("data-act")];
    if (fn) { e.preventDefault(); fn(b, e); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var t = e.target;
    if (t && (t.id === "qL1" || t.id === "qL2")) { e.preventDefault(); handlers["quick-air"](); }
  });
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === "dockTok") {
      token = t.value.trim();
      try { localStorage.setItem(TOKEN_KEY, token); } catch (x) {}
    }
  });

  // ---- connection: SSE ก่อน ไม่ได้ก็ polling (server.ps1 ไม่มี SSE) ---- //
  function safeRender() {
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || "")) { qCollect(); return; }
    render();
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
            safeRender();
          }
        })
        .catch(function () { setConn(false); });
    }
    tick();
    setInterval(tick, 600);
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
      safeRender();
    };
  })();
})();
