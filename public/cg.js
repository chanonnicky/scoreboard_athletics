/* cg.js — หน้าคุมช่อง CG ที่สอง (Lower Third / Bar แบบ custom)  →  /cg
   เป็นไฟล์แยกจาก control.js โดยตั้งใจ: หน้าคุมงานกีฬาจะไม่พังจากงานนี้
   (ยอมซ้ำโค้ด plumbing ~120 บรรทัด — token / cmd / toast / SSE+poll fallback)

   คุม state.l3 เท่านั้น ผ่านคำสั่ง l3Show / l3Hide / l3HideAll / l3SetItems /
   l3SetSettings / l3Reset — ไม่แตะข้อมูลงานกีฬาหรืองานทั่วไปเลย

   3 วิว สลับด้วย location.hash:  (ว่าง)=live | #library | #settings            */
(function () {
  "use strict";

  var esc = T.esc;
  var panel = document.getElementById("panel");
  var toastEl = document.getElementById("toast");
  var tokenInput = document.getElementById("token");
  var connEl = document.getElementById("conn");

  var state = null;
  var firstLoaded = false;
  var pendingRender = false;

  // draft ของกล่องคอมโพส — { type, fields, style, auto, editId }
  var ui = null;
  var itemsTimer = null;     // debounce บันทึกคลังชิ้นงาน
  var setTimer = null;       // debounce บันทึกตั้งค่าช่อง

  // ต้องประกาศก่อน activeView ด้านล่าง — viewFromHash() อ่านตัวนี้
  var VIEWS = { live: 1, library: 1, settings: 1 };
  var activeView = viewFromHash();

  // ธีมแสดงผล — รายการเดียวกับ control.js / overlay.js / board.js
  // (ถ้าเพิ่มสกินใหม่ ต้องแก้ทั้ง 4 ที่ — ดู CLAUDE.md)
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

  // ป้ายของแต่ละช่อง + ลำดับที่แสดงในหน้าคุม
  var SLOT_ORDER = ["lower", "full", "top", "ticker", "bug"];
  var SLOT_LABEL = {
    lower: "แถบล่าง", full: "เต็มจอ", top: "แถบบน (ประกาศ)",
    ticker: "แถบวิ่ง", bug: "มุมจอ",
  };
  // ป้ายของปุ่มปรับแต่ง
  var STYLE_LABEL = {
    accent: "สีเน้น", ink: "สีตัวอักษรบนสีเน้น", bg: "พื้นหลัง", align: "การจัดวาง",
    size: "ขนาด", anim: "แอนิเมชันเข้า", font: "ฟอนต์", logo: "โลโก้",
  };
  var ENUM_LABEL = {
    ink: { auto: "อัตโนมัติ", light: "สว่าง", dark: "เข้ม" },
    bg: { solid: "ทึบ", grad: "ไล่สี", glass: "กระจก (OBS ใหม่)", none: "ไม่มีพื้น" },
    align: { left: "ซ้าย", center: "กลาง", right: "ขวา" },
    size: { sm: "เล็ก", md: "กลาง", lg: "ใหญ่" },
    anim: { slide: "เลื่อน", fade: "จาง", wipe: "ปาด", type: "พิมพ์" },
    font: { seed: "LINE Seed (ปกติ)", charm: "Charmonman (ลายมือ)" },
  };
  var LOGO_OPTS = [["", "ใช้โลโก้ของช่อง"], ["off", "ไม่แสดงโลโก้"]];

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

  // ---- server calls ------------------------------------------------ //
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
    toast._t = setTimeout(function () { toastEl.className = "toast"; }, 2600);
  }

  // ---- connection (SSE ก่อน, ไม่ได้ก็ polling — server.ps1 ไม่มี SSE) ---- //
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
    setInterval(tick, 500);
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

  // ---- state helper ------------------------------------------------ //
  function l3() {
    var x = (state && state.l3) || {};
    return { settings: x.settings || {}, onair: x.onair || {}, items: x.items || [] };
  }
  function slotConf(slot) { return l3().onair[slot] || {}; }
  function itemById(id) {
    var it = l3().items;
    for (var i = 0; i < it.length; i++) if (it[i].id === id) return it[i];
    return null;
  }
  function typeMeta(t) { return T.L3_TYPES[t] || null; }
  // ชิ้นงานนี้กำลังออกจออยู่ไหม — ผูกด้วย itemId ตรง ๆ (ไม่เทียบค่าข้อความ)
  function itemLiveSlot(id) {
    for (var i = 0; i < SLOT_ORDER.length; i++) {
      var c = slotConf(SLOT_ORDER[i]);
      if (c.visible && c.itemId && c.itemId === id) return SLOT_ORDER[i];
    }
    return null;
  }
  function newItemId() {
    return "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function onState() {
    renderHeader();
    if (!firstLoaded) { firstLoaded = true; render(); return; }
    safeRender();
  }
  // ไม่ rebuild ทั้งหน้าถ้ากำลังพิมพ์อยู่ หรือมีงานบันทึกค้าง (ไม่งั้นพิมพ์หาย +
  // iframe พรีวิวโหลดใหม่) — เหมือน safeRender() ของ control.js
  function safeRender() {
    if (itemsTimer || setTimer) return;
    var a = document.activeElement;
    if (a && panel.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
      pendingRender = true;
      var b = document.getElementById("dirtyBadge");
      if (b) b.textContent = "· มีข้อมูลใหม่จากเซิร์ฟเวอร์ (กด \"โหลดใหม่\")";
      return;
    }
    render();
  }

  function renderHeader() {
    var host = document.getElementById("onairStatus");
    if (!host) return;
    var html = "";
    for (var i = 0; i < SLOT_ORDER.length; i++) {
      var slot = SLOT_ORDER[i], c = slotConf(slot);
      var on = !!(c.visible && c.type);
      if (!on) continue;
      var m = typeMeta(c.type);
      html += '<span class="chip on">' + esc(SLOT_LABEL[slot]) + ": " +
        esc((m && m.tag) || c.type) + "</span>";
    }
    host.innerHTML = html || '<span class="chip">ไม่มีกราฟิกออกจอ</span>';
  }

  // ---- นาวิเกชัน --------------------------------------------------- //
  function viewFromHash() {
    var h = (location.hash || "").replace(/^#/, "");
    return VIEWS[h] && h !== "live" ? h : "live";
  }
  function closeDrawer() { document.body.classList.remove("sb-open"); }
  function goView(v) {
    activeView = v;
    var newHash = v === "live" ? "" : "#" + v;
    if (location.hash !== newHash) {
      if (newHash) { location.hash = newHash; return; }
      history.replaceState("", document.title, location.pathname);
    }
    markActiveNav();
    render();
  }
  window.addEventListener("hashchange", function () {
    activeView = viewFromHash();
    closeDrawer();
    markActiveNav();
    render();
  });
  function markActiveNav() {
    var want = "/cg" + (activeView === "live" ? "" : "#" + activeView);
    [].forEach.call(document.querySelectorAll("#sbNav a[data-nav]"), function (a) {
      a.className = "sb-item" + (a.getAttribute("href") === want ? " active" : "");
    });
  }
  (function wireDrawer() {
    var t = document.getElementById("sbToggle");
    if (t) t.addEventListener("click", function () { document.body.classList.toggle("sb-open"); });
    var bd = document.getElementById("sbBackdrop");
    if (bd) bd.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
    var nav = document.getElementById("sbNav");
    if (nav) nav.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest("a.sb-item") : null;
      if (!a) return;
      closeDrawer();
      var m = (a.getAttribute("href") || "").match(/^\/cg(?:#(library|settings))?$/);
      if (m) { e.preventDefault(); goView(m[1] || "live"); }
    });
  })();

  // ---- draft ของกล่องคอมโพส --------------------------------------- //
  function ensureUI() {
    if (ui) return;
    // ตั้งต้นจากสิ่งที่กำลังออกจออยู่ (ถ้ามี) ไม่งั้นเริ่มที่ชนิดแรก
    for (var i = 0; i < SLOT_ORDER.length; i++) {
      var c = slotConf(SLOT_ORDER[i]);
      if (c.visible && c.type && typeMeta(c.type)) {
        ui = { type: c.type, fields: copy(c.fields || {}), style: copy(c.style || {}),
               auto: 0, editId: c.itemId || null };
        return;
      }
    }
    ui = { type: "name", fields: {}, style: {}, auto: 0, editId: null };
  }
  function copy(o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); }

  // อ่านค่าที่พิมพ์อยู่ใน DOM กลับเข้า draft — เรียกก่อนทุก action ที่ใช้ข้อความ
  // (ใช้ [data-fk] / [data-sk] ไม่ฮาร์ดโค้ด id ฟิลด์ เพราะฟิลด์มาจากทะเบียน)
  function collectUI() {
    if (!ui) return;
    var root = document.getElementById("composeCard");
    if (!root) return;
    [].forEach.call(root.querySelectorAll("[data-fk]"), function (el) {
      var k = el.getAttribute("data-fk");
      ui.fields[k] = el.getAttribute("data-kind") === "list"
        ? el.value.split(/\r?\n/)
        : el.value;
    });
    [].forEach.call(root.querySelectorAll("[data-sk]"), function (el) {
      var k = el.getAttribute("data-sk");
      if (el.value === "") delete ui.style[k];
      else ui.style[k] = el.value;
    });
    var au = root.querySelector("[data-auto]");
    if (au) ui.auto = parseFloat(au.value) || 0;
  }
  // draft มีเนื้อหาพอที่จะขึ้นจอไหม (ให้ T.l3 ตัดสิน — ไม่ต้องรู้ว่าชนิดไหนต้องการอะไร)
  function draftHtml() {
    return T.l3(l3(), { type: ui.type, fields: normFields(ui.fields), style: ui.style });
  }
  // ช่อง list เก็บเป็นอาเรย์เสมอเมื่อส่งขึ้น server
  function normFields(f) {
    var meta = typeMeta(ui ? ui.type : null);
    var out = copy(f);
    if (!meta) return out;
    meta.fields.forEach(function (fd) {
      if (fd.kind === "list" || fd.kind === "images") out[fd.k] = T.l3List(out[fd.k]);
    });
    return out;
  }

  // ---- สร้างฟอร์มจากทะเบียนชนิด ----------------------------------- //
  function fieldHtml(fd, val) {
    var lab = esc(fd.label);
    var ph = esc(fd.ph || "");
    if (fd.kind === "list" || fd.kind === "images") {
      var txt = T.l3List(val).join("\n");
      return '<label class="field cg-f">' + lab +
        '<textarea data-fk="' + esc(fd.k) + '" data-kind="list" rows="4" placeholder="' + ph + '">' +
        esc(txt) + "</textarea></label>" +
        (fd.kind === "images"
          ? '<div class="cg-up"><input type="file" accept="image/*" data-upfile="' + esc(fd.k) +
            '" multiple><span class="muted">เลือกไฟล์เพื่ออัปโหลดแล้วเติม URL ให้อัตโนมัติ</span></div>'
          : "");
    }
    if (fd.kind === "image") {
      return '<label class="field cg-f">' + lab +
        '<input type="text" data-fk="' + esc(fd.k) + '" value="' + esc(val == null ? "" : val) +
        '" placeholder="/uploads/… หรือ /pictures/…"></label>' +
        '<div class="cg-up"><input type="file" accept="image/*" data-upfile="' + esc(fd.k) + '">' +
        (val ? '<img class="cg-thumb" src="' + esc(val) + '" alt="">' : "") + "</div>";
    }
    var type = fd.kind === "num" ? "number" : (fd.kind === "datetime" ? "datetime-local" : "text");
    return '<label class="field cg-f">' + lab +
      '<input type="' + type + '" data-fk="' + esc(fd.k) + '" value="' +
      esc(val == null ? "" : val) + '" placeholder="' + ph + '"></label>';
  }

  function styleHtml(meta, style) {
    var knobs = meta.style || [];
    var out = "";
    knobs.forEach(function (k) {
      var cur = style[k] == null ? "" : style[k];
      if (k === "accent") {
        out += '<label class="field cg-f cg-f-color">' + esc(STYLE_LABEL[k]) +
          '<span class="cg-colorrow">' +
            '<input type="color" data-sk="accent" value="' +
              esc(/^#[0-9a-fA-F]{6}$/.test(cur) ? cur : (l3().settings.accent || "#e53935")) + '">' +
            '<button class="btn sm" data-act="style-clear" data-sk="accent">ใช้ค่าของช่อง</button>' +
          "</span></label>";
        return;
      }
      if (k === "logo") {
        out += '<label class="field cg-f">' + esc(STYLE_LABEL[k]) +
          '<select data-sk="logo">' + LOGO_OPTS.map(function (o) {
            return '<option value="' + o[0] + '"' + (o[0] === cur ? " selected" : "") + ">" +
              esc(o[1]) + "</option>";
          }).join("") + "</select></label>";
        return;
      }
      var vals = T.L3_ENUM[k] || [];
      out += '<label class="field cg-f">' + esc(STYLE_LABEL[k] || k) +
        '<select data-sk="' + esc(k) + '">' +
          '<option value="">(ตามค่าของช่อง)</option>' +
          vals.map(function (v) {
            return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" +
              esc((ENUM_LABEL[k] && ENUM_LABEL[k][v]) || v) + "</option>";
          }).join("") +
        "</select></label>";
    });
    return out;
  }

  function typeSegHtml(cur) {
    var out = "";
    T.L3_GROUPS.forEach(function (g) {
      var inGroup = Object.keys(T.L3_TYPES).filter(function (t) { return T.L3_TYPES[t].group === g; });
      if (!inGroup.length) return;
      out += '<div class="cg-seggrp"><div class="cg-seggrp-t">' + esc(g) + "</div>" +
        '<div class="seg">' + inGroup.map(function (t) {
          return '<button class="seg-btn' + (t === cur ? " is-on" : "") +
            '" data-act="type-pick" data-type="' + esc(t) + '">' +
            esc(T.L3_TYPES[t].label) + "</button>";
        }).join("") + "</div></div>";
    });
    return out;
  }

  // ---- render ------------------------------------------------------ //
  function render() {
    pendingRender = false;
    if (!state) { panel.innerHTML = '<p class="muted">กำลังโหลด…</p>'; return; }
    if (!state.l3) {
      panel.innerHTML = '<div class="card"><h2>ยังไม่มีช่อง Lower Third</h2>' +
        '<p class="muted">เซิร์ฟเวอร์ยังไม่ได้สร้าง <code>state.l3</code> — ' +
        'รีสตาร์ตเซิร์ฟเวอร์หนึ่งครั้งเพื่อให้สร้างให้อัตโนมัติ</p></div>';
      return;
    }
    markActiveNav();
    if (activeView === "library") return renderLibrary();
    if (activeView === "settings") return renderSettings();
    renderLive();
  }

  function previewHtml() {
    var collapsed = localStorage.getItem("cg_preview_collapsed") === "1";
    var theme = l3().settings.theme || "default";
    return '<div class="preview-wrap' + (collapsed ? " collapsed" : "") + '">' +
      '<div class="row" style="justify-content:space-between;align-items:center">' +
        '<div class="preview-label">พรีวิวจอ CG (โปร่งใส = ลายตาราง)</div>' +
        '<button class="btn sm" data-act="preview-toggle">' +
          (collapsed ? "แสดงพรีวิว" : "ซ่อนพรีวิว") + "</button>" +
      "</div>" +
      (collapsed ? "" :
        '<div class="preview"><iframe src="/live/cg?transport=poll&theme=' +
          encodeURIComponent(theme) + '" title="preview"></iframe></div>' +
        '<div class="preview-label">อัปเดตสดเหมือนที่ออกใน OBS · เปลี่ยนธีมที่ “ตั้งค่าช่อง”</div>') +
    "</div>";
  }

  function slotStripHtml() {
    var out = "";
    for (var i = 0; i < SLOT_ORDER.length; i++) {
      var slot = SLOT_ORDER[i], c = slotConf(slot);
      var on = !!(c.visible && c.type);
      var m = on ? typeMeta(c.type) : null;
      var f = c.fields || {};
      var txt = "— ว่าง —";
      if (on) {
        var bits = [f.line1, f.label, f.line2].filter(function (x) { return x; });
        if (!bits.length && f.messages) bits = [T.l3List(f.messages)[0]];
        if (!bits.length && c.type === "clock") bits = ["นาฬิกา"];
        if (!bits.length && c.type === "logobug") bits = ["โลโก้"];
        txt = esc(bits[0] || "(ไม่มีข้อความ)") +
          (bits[1] ? ' <span class="muted">· ' + esc(bits[1]) + "</span>" : "");
      }
      var left = on && c.until ? ' <span class="cg-until" data-until="' + esc(c.until) + '"></span>' : "";
      out += '<div class="gl-slot' + (on ? " on" : "") + '">' +
        '<span class="gl-tag">' + (on ? "● " : "") + esc(SLOT_LABEL[slot]) + "</span>" +
        '<span class="gl-txt' + (on ? "" : " muted") + '">' +
          (on && m ? '<b class="cg-tag">' + esc(m.tag) + "</b> " : "") + txt + left + "</span>" +
        (on ? '<button class="btn sm" data-act="slot-hide" data-slot="' + slot + '">✕ ลงจอ</button>' : "") +
      "</div>";
    }
    return out;
  }

  function libraryGridHtml() {
    var list = l3().items;
    if (!list.length) {
      return '<p class="muted">ยังไม่มีชิ้นงาน — คอมโพสด้านบนแล้วกด “★ บันทึกเป็นชิ้นงาน” ' +
        'หรือไปที่ <a href="#library" data-act="go-library">คลังชิ้นงาน</a></p>';
    }
    var groups = {}, order = [];
    list.forEach(function (it) {
      var g = it.group || "ไม่จัดกลุ่ม";
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(it);
    });
    return order.map(function (g) {
      return '<div class="cg-grp"><div class="cg-grp-t">' + esc(g) + "</div>" +
        '<div class="cg-grid">' + groups[g].map(function (it) {
          var m = typeMeta(it.type);
          var live = itemLiveSlot(it.id);
          var f = it.fields || {};
          var sub = f.line1 || f.label || (f.messages ? T.l3List(f.messages)[0] : "") || "";
          return '<button class="cg-card' + (live ? " is-live" : "") +
              '" data-act="item-air" data-id="' + esc(it.id) + '" title="คลิกเพื่อขึ้นจอ">' +
            '<span class="cg-card-tag">' + esc((m && m.tag) || it.type) + "</span>" +
            '<b class="cg-card-name">' + esc(it.name || sub || "(ไม่มีชื่อ)") + "</b>" +
            (sub ? '<span class="cg-card-sub">' + esc(sub) + "</span>" : "") +
            (live ? '<span class="cg-card-live">● ออกอยู่ · ' + esc(SLOT_LABEL[live]) + "</span>" : "") +
          "</button>";
        }).join("") + "</div></div>";
    }).join("");
  }

  function renderLive() {
    ensureUI();
    var meta = typeMeta(ui.type) || T.L3_TYPES.name;
    var collapsed = localStorage.getItem("cg_preview_collapsed") === "1";
    var liveHtml = draftHtml();
    var composeLive = isComposeLive();

    var fields = meta.fields.map(function (fd) {
      return fieldHtml(fd, ui.fields[fd.k]);
    }).join("");

    panel.innerHTML =
      '<div class="grid' + (collapsed ? " grid-noprev" : "") + '"><div>' +

        '<div class="card">' +
          '<div class="row" style="justify-content:space-between;align-items:center">' +
            '<h2 style="margin:0">กำลังออกอากาศ</h2>' +
            '<div class="row" style="gap:6px">' +
              '<button class="btn" data-act="hide-main">■ ลงกราฟิกหลัก</button>' +
              '<button class="btn danger" data-act="hide-all">■ ลงจอทั้งหมด</button>' +
            "</div>" +
          "</div>" +
          '<p class="muted" style="margin:6px 0 0;font-size:13px">' +
            '“แถบล่าง” กับ “เต็มจอ” ขึ้นได้ทีละอันเดียว · “แถบบน / แถบวิ่ง / มุมจอ” ' +
            'เป็นช่องอิสระ ค้างจอพร้อมกันได้</p>' +
          '<div class="gl-strip" style="margin-top:10px">' + slotStripHtml() + "</div>" +
        "</div>" +

        '<div class="card" id="composeCard">' +
          '<div class="row" style="justify-content:space-between;align-items:center">' +
            '<h2 style="margin:0">คอมโพส</h2>' +
            '<span id="dirtyBadge" class="dirty-badge"></span>' +
          "</div>" +
          typeSegHtml(ui.type) +
          '<p class="muted" style="margin:2px 0 10px">ขึ้นช่อง <b>' +
            esc(SLOT_LABEL[meta.slot] || meta.slot) + "</b> · กด Enter ในช่องข้อความ = ขึ้นจอ</p>" +
          fields +
          '<details class="cg-adv"' + (hasStyle() ? " open" : "") + ">" +
            "<summary>ปรับแต่ง (สี / ตำแหน่ง / ขนาด / แอนิเมชัน)</summary>" +
            '<div class="cg-advgrid">' + styleHtml(meta, ui.style) +
              '<label class="field cg-f">ลงจออัตโนมัติ (วินาที — 0 = ไม่ลง)' +
                '<input type="number" min="0" step="1" data-auto="1" value="' +
                  (ui.auto || 0) + '"></label>' +
            "</div>" +
          "</details>" +
          '<div class="gen-actions">' +
            '<button class="btn primary lg' + (composeLive ? " is-live" : "") + '" data-act="air">' +
              (composeLive ? "● กำลังออก — ส่งซ้ำ" : "▶ ขึ้นจอ") + "</button>" +
            '<button class="btn" data-act="clear">ล้าง</button>' +
            '<button class="btn ok" data-act="save-item">' +
              (ui.editId && itemById(ui.editId) ? "★ อัปเดตชิ้นงาน" : "★ บันทึกเป็นชิ้นงาน") + "</button>" +
            '<button class="btn sm" data-act="reload">โหลดใหม่</button>' +
          "</div>" +
          (liveHtml ? "" : '<p class="muted" style="margin-top:8px">ใส่ข้อความก่อนจึงจะขึ้นจอได้</p>') +
        "</div>" +

        '<div class="card">' +
          '<h2 style="margin:0 0 4px">คลังชิ้นงาน (rundown)</h2>' +
          '<p class="muted" style="margin:2px 0 10px;font-size:13px">คลิกการ์ด = ขึ้นจอทันที · ' +
            'แก้ไข/เรียงลำดับที่ <a href="#library" data-act="go-library">คลังชิ้นงาน</a></p>' +
          libraryGridHtml() +
        "</div>" +

      "</div>" + previewHtml() + "</div>";

    startUntilTick();
  }

  function hasStyle() {
    for (var k in ui.style) if (Object.prototype.hasOwnProperty.call(ui.style, k)) return true;
    return !!ui.auto;
  }
  // draft ตรงกับที่กำลังออกจออยู่ไหม (เทียบเนื้อหา เพราะ draft อาจยังไม่ได้บันทึกเป็นชิ้นงาน)
  function isComposeLive() {
    var meta = typeMeta(ui.type);
    if (!meta) return false;
    var c = slotConf(meta.slot);
    if (!c.visible || c.type !== ui.type) return false;
    return JSON.stringify(c.fields || {}) === JSON.stringify(normFields(ui.fields)) &&
           JSON.stringify(c.style || {}) === JSON.stringify(ui.style || {});
  }

  // นับถอยหลังของ auto-hide ในแถบสถานะ
  var untilTimer = null;
  function startUntilTick() {
    if (untilTimer) { clearInterval(untilTimer); untilTimer = null; }
    function tick() {
      var els = panel.querySelectorAll(".cg-until");
      if (!els.length) { clearInterval(untilTimer); untilTimer = null; return; }
      for (var i = 0; i < els.length; i++) {
        var u = parseFloat(els[i].getAttribute("data-until")) || 0;
        var left = Math.max(0, Math.round((u - Date.now()) / 1000));
        els[i].textContent = left > 0 ? "· ลงจอใน " + left + " วิ" : "· หมดเวลา";
      }
    }
    tick();
    untilTimer = setInterval(tick, 500);
  }

  // ---- วิว: คลังชิ้นงาน ------------------------------------------- //
  function renderLibrary() {
    var list = l3().items;
    var impCount = importableLowers().length;
    var rows = list.map(function (it, idx) {
      var m = typeMeta(it.type);
      var live = itemLiveSlot(it.id);
      var f = it.fields || {};
      var sub = f.line1 || f.label || (f.messages ? T.l3List(f.messages)[0] : "") || "";
      return '<div class="cg-lib-row' + (live ? " is-live" : "") + '" data-id="' + esc(it.id) + '">' +
        '<span class="cg-lib-ord">' + (idx + 1) + "</span>" +
        '<span class="preset-kind">' + esc((m && m.tag) || it.type) + "</span>" +
        '<label class="cg-lib-f"><input type="text" data-libname="' + esc(it.id) +
          '" value="' + esc(it.name || "") + '" placeholder="ชื่อชิ้นงาน"></label>' +
        '<label class="cg-lib-f cg-lib-grp"><input type="text" data-libgroup="' + esc(it.id) +
          '" value="' + esc(it.group || "") + '" placeholder="กลุ่ม"></label>' +
        '<span class="cg-lib-sub muted">' + esc(sub) + "</span>" +
        (live ? '<span class="preset-live">● ออกอยู่</span>' : "") +
        '<span class="cg-lib-btns">' +
          '<button class="btn sm" data-act="item-up" data-id="' + esc(it.id) + '" title="เลื่อนขึ้น"' +
            (idx === 0 ? " disabled" : "") + ">▲</button>" +
          '<button class="btn sm" data-act="item-down" data-id="' + esc(it.id) + '" title="เลื่อนลง"' +
            (idx === list.length - 1 ? " disabled" : "") + ">▼</button>" +
          '<button class="btn sm" data-act="item-edit" data-id="' + esc(it.id) + '">แก้</button>' +
          '<button class="btn sm" data-act="item-air" data-id="' + esc(it.id) + '">▶</button>' +
          '<button class="btn sm danger" data-act="item-del" data-id="' + esc(it.id) + '">✕</button>' +
        "</span>" +
      "</div>";
    }).join("");

    panel.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:center">' +
          '<h2 style="margin:0">คลังชิ้นงาน · ' + list.length + " ชิ้น</h2>" +
          '<span id="dirtyBadge" class="dirty-badge"></span>' +
        "</div>" +
        '<p class="muted" style="margin:2px 0 10px;font-size:13px">แก้ชื่อ/กลุ่มได้ในช่องเลย ' +
          '(บันทึกอัตโนมัติ) · กด “แก้” เพื่อไปแก้ข้อความ/การปรับแต่งในกล่องคอมโพส</p>' +
        (list.length ? '<div class="cg-lib">' + rows + "</div>"
                     : '<p class="muted">ยังไม่มีชิ้นงาน</p>') +
        '<div class="row" style="margin-top:12px">' +
          '<button class="btn ok" data-act="go-live">+ คอมโพสชิ้นใหม่</button>' +
        "</div>" +
      "</div>" +

      (impCount
        ? '<div class="card"><h2>นำเข้าพรีเซ็ตจาก “งานทั่วไป”</h2>' +
          '<p class="muted">พบพรีเซ็ต Lower Third เดิม <b>' + impCount + "</b> ชิ้น " +
          "(จากผลิตภัณฑ์งานทั่วไป) — นำเข้ามาเป็นชิ้นงานของช่องนี้ได้ ของเดิมไม่ถูกลบ " +
          "และกดซ้ำจะไม่เพิ่มของที่นำเข้าแล้ว</p>" +
          '<button class="btn ok" data-act="import-lowers" style="margin-top:8px">' +
            "↓ นำเข้า " + impCount + " ชิ้น</button></div>"
        : "") +

      '<div class="card"><h2>ชนิด CG ที่มีให้ใช้ · ' + Object.keys(T.L3_TYPES).length + " ชนิด</h2>" +
        T.L3_GROUPS.map(function (g) {
          var inG = Object.keys(T.L3_TYPES).filter(function (t) { return T.L3_TYPES[t].group === g; });
          if (!inG.length) return "";
          return "<h3>" + esc(g) + "</h3><div class=\"cg-typelist\">" + inG.map(function (t) {
            var m = T.L3_TYPES[t];
            return '<button class="btn sm" data-act="type-new" data-type="' + esc(t) + '">' +
              esc(m.label) + ' <span class="muted">· ' + esc(SLOT_LABEL[m.slot] || m.slot) +
              "</span></button>";
          }).join("") + "</div>";
        }).join("") +
      "</div>";
  }

  // พรีเซ็ตเดิมของผลิตภัณฑ์ "งานทั่วไป" ที่ยังไม่ได้นำเข้า
  function importableLowers() {
    var src = [];
    function add(arr) { if (arr && arr.length) for (var i = 0; i < arr.length; i++) src.push(arr[i]); }
    add(state && state.lowers);
    if (state && state.parkedApp && state.parkedApp.general) add(state.parkedApp.general.lowers);
    var KIND2TYPE = { name: "name", topic: "topic", title: "title" };
    var have = {};
    l3().items.forEach(function (it) {
      have[it.type + "\u0000" + ((it.fields || {}).line1 || "") + "\u0000" +
           ((it.fields || {}).line2 || "")] = 1;
    });
    var out = [];
    src.forEach(function (p) {
      var type = KIND2TYPE[p.kind];
      if (!type) return;
      var key = type + "\u0000" + (p.line1 || "") + "\u0000" + (p.line2 || "");
      if (have[key]) return;
      have[key] = 1;
      out.push({ type: type, line1: p.line1 || "", line2: p.line2 || "" });
    });
    return out;
  }

  // ---- วิว: ตั้งค่าช่อง -------------------------------------------- //
  function renderSettings() {
    var s = l3().settings;
    var origin = location.origin;
    function sel(k, label) {
      var vals = T.L3_ENUM[k] || [];
      return '<label class="field cg-f">' + esc(label) +
        '<select data-setk="' + esc(k) + '">' + vals.map(function (v) {
          return '<option value="' + esc(v) + '"' + ((s[k] || "") === v ? " selected" : "") + ">" +
            esc((ENUM_LABEL[k] && ENUM_LABEL[k][v]) || v) + "</option>";
        }).join("") + "</select></label>";
    }
    panel.innerHTML =
      '<div class="card"><h2>ตั้งค่าช่อง Lower Third</h2>' +
        '<p class="muted">ค่าพวกนี้เป็น “ค่าตั้งต้น” ของทุกชิ้นงาน — แต่ละชิ้นปรับทับได้เองในกล่องคอมโพส · ' +
          'ช่องนี้แยกจากงานกีฬาและงานทั่วไปโดยสิ้นเชิง (คนละธีม คนละโลโก้)</p>' +
        '<div class="cg-advgrid" style="margin-top:12px">' +
          '<label class="field cg-f">ธีมแสดงผล (จอ CG)' +
            '<select data-setk="theme">' + THEME_OPTS.map(function (o) {
              return '<option value="' + o[0] + '"' + (o[0] === (s.theme || "default") ? " selected" : "") +
                ">" + esc(o[1]) + "</option>";
            }).join("") + "</select></label>" +
          '<label class="field cg-f cg-f-color">สีเน้นตั้งต้น' +
            '<span class="cg-colorrow"><input type="color" data-setk="accent" value="' +
              esc(/^#[0-9a-fA-F]{6}$/.test(s.accent || "") ? s.accent : "#e53935") + '"></span></label>' +
          sel("bg", "พื้นหลังตั้งต้น") +
          sel("align", "การจัดวางตั้งต้น") +
          sel("size", "ขนาดตั้งต้น") +
          sel("anim", "แอนิเมชันตั้งต้น") +
          sel("font", "ฟอนต์ตั้งต้น") +
          sel("ink", "สีตัวอักษรบนสีเน้น") +
          '<label class="field cg-f">ความเร็ว animation (ms)' +
            '<input type="number" min="0" step="50" data-setk="animMs" value="' +
              (s.animMs || 450) + '"></label>' +
          '<label class="field cg-f">แถบวิ่ง — วินาที/รอบ (ต่อ 60 ตัวอักษร)' +
            '<input type="number" min="4" step="1" data-setk="tickerSec" value="' +
              (s.tickerSec || 28) + '"></label>' +
          '<label class="field cg-f">แถบสปอนเซอร์ — วินาที/รอบ' +
            '<input type="number" min="4" step="1" data-setk="sponsorSec" value="' +
              (s.sponsorSec || 4) + '"></label>' +
        "</div>" +
        '<label class="field cg-f" style="max-width:520px;margin-top:12px">โลโก้ของช่อง (พาธ/URL — เว้นว่าง = ไม่แสดง)' +
          '<input type="text" data-setk="logo" value="' + esc(s.logo == null ? "" : s.logo) +
          '" placeholder="/pictures/logo.png"></label>' +
        '<div class="cg-up">' +
          '<input type="file" accept="image/*" data-upsetting="logo">' +
          (s.logo ? '<img class="cg-thumb" src="' + esc(s.logo) + '" alt="">' : "") +
        "</div>" +
      "</div>" +

      '<div class="card"><h2>จอ CG (ใส่ใน OBS / vMix)</h2>' +
        '<div class="urlbox"><input type="text" readonly value="' + origin + '/live/cg">' +
          '<button class="btn" data-act="url-copy">คัดลอก</button></div>' +
        '<div class="linklist">' +
          '<a href="/live/cg" target="_blank">/live/cg &nbsp;— จอ CG ทั้งช่อง (โปร่งใส)</a>' +
          '<a href="/live/cg?slot=lower" target="_blank">/live/cg?slot=lower &nbsp;— เฉพาะแถบล่าง</a>' +
          '<a href="/live/cg?slot=ticker" target="_blank">/live/cg?slot=ticker &nbsp;— เฉพาะแถบวิ่ง</a>' +
          '<a href="/live/cg?slot=top" target="_blank">/live/cg?slot=top &nbsp;— เฉพาะแถบบน</a>' +
          '<a href="/live/cg?slot=bug" target="_blank">/live/cg?slot=bug &nbsp;— เฉพาะมุมจอ</a>' +
          '<a href="/live/cg?transport=poll" target="_blank">/live/cg?transport=poll &nbsp;— ถ้าเน็ตบล็อก SSE</a>' +
        "</div>" +
        '<p class="muted" style="margin-top:8px">ช่องนี้เป็น Browser Source <b>คนละตัว</b> ' +
          'กับจอของงานกีฬา (<code>/live</code>) — ใส่ทั้งสองตัวใน OBS พร้อมกันได้</p>' +
      "</div>" +

      '<div class="card"><h2>🧩 OBS — Dock + สคริปต์ hotkey</h2>' +
        '<p class="muted">สองอย่างนี้ทำให้คุม CG ได้จากใน OBS เลย ไม่ต้องสลับหน้าต่าง</p>' +
        "<h3>1) หน้าคุมใน OBS (Custom Browser Dock)</h3>" +
        '<div class="urlbox"><input type="text" readonly value="' + origin + '/obs">' +
          '<button class="btn" data-act="url-copy">คัดลอก</button></div>' +
        '<p class="muted">ใน OBS: <b>Docks → Custom Browser Docks…</b> → ตั้งชื่อ <code>CG Live</code> ' +
          'แล้ววาง URL ด้านบน → Apply</p>' +
        "<h3>2) สคริปต์ hotkey + สร้าง Browser Source อัตโนมัติ</h3>" +
        '<div class="linklist">' +
          '<a href="/obs/cglive.lua" download>⬇ ดาวน์โหลด cglive.lua</a>' +
        "</div>" +
        '<p class="muted">ใน OBS: <b>Tools → Scripts → +</b> → เลือกไฟล์ที่ดาวน์โหลด → ' +
          'ใส่ Server URL (<code>' + origin + '</code>) + token → กด ' +
          '“Create CG Live scene + sources” · ผูกปุ่มลัดได้ที่ <b>Settings → Hotkeys</b></p>' +
      "</div>" +

      '<div class="card"><h2>รีเซ็ต</h2>' +
        '<p class="muted">คืนค่า<b>ช่อง Lower Third</b> กลับเป็นค่าตั้งต้น ' +
          '(ชิ้นงานทั้งหมดหาย) — <b>ไม่กระทบงานกีฬาและงานทั่วไป</b></p>' +
        '<button class="btn danger" data-act="reset" style="margin-top:8px">รีเซ็ตช่อง Lower Third</button>' +
      "</div>";
  }

  // ---- บันทึก ------------------------------------------------------ //
  function saveItems(list, msg) {
    if (itemsTimer) { clearTimeout(itemsTimer); itemsTimer = null; }
    return cmd({ action: "l3SetItems", items: list }).then(function (ok) {
      if (ok && msg) toast(msg);
      return ok;
    });
  }
  function scheduleItemsSave(list) {
    if (itemsTimer) clearTimeout(itemsTimer);
    itemsTimer = setTimeout(function () {
      itemsTimer = null;
      cmd({ action: "l3SetItems", items: list });
    }, 600);
  }
  function setSettings(patch) {
    return cmd({ action: "l3SetSettings", settings: patch });
  }

  function airConf(type, fields, style, auto, itemId) {
    var meta = typeMeta(type);
    if (!meta) return null;
    var c = {
      action: "l3Show", slot: meta.slot, type: type,
      itemId: itemId || null, fields: fields, style: style || {},
    };
    var sec = parseFloat(auto) || 0;
    if (sec > 0) c.until = Date.now() + sec * 1000;
    return c;
  }

  // ---- handlers ---------------------------------------------------- //
  var handlers = {
    reload: function () { render(); },
    "go-library": function () { goView("library"); },
    "go-live": function () { goView("live"); },
    "preview-toggle": function () {
      var v = localStorage.getItem("cg_preview_collapsed") === "1" ? "0" : "1";
      localStorage.setItem("cg_preview_collapsed", v);
      render();
    },

    "type-pick": function (b) {
      collectUI();
      ui.type = b.dataset.type;
      render();
      var first = panel.querySelector("#composeCard [data-fk]");
      if (first) first.focus();
    },
    "type-new": function (b) {
      ui = { type: b.dataset.type, fields: {}, style: {}, auto: 0, editId: null };
      goView("live");
    },
    "style-clear": function (b) {
      collectUI();
      delete ui.style[b.dataset.sk];
      render();
    },
    air: function () {
      collectUI();
      if (!draftHtml()) return toast("ใส่ข้อความก่อน", true);
      var c = airConf(ui.type, normFields(ui.fields), ui.style, ui.auto, ui.editId);
      if (c) cmd(c);
    },
    clear: function () {
      ui = { type: ui.type, fields: {}, style: {}, auto: 0, editId: null };
      render();
    },
    "save-item": function () {
      collectUI();
      if (!draftHtml()) return toast("ใส่ข้อความก่อน", true);
      var list = JSON.parse(JSON.stringify(l3().items));
      var f = normFields(ui.fields);
      var nameGuess = f.line1 || f.label || (T.l3List(f.messages)[0]) || typeMeta(ui.type).label;
      var existing = ui.editId ? itemById(ui.editId) : null;
      // ชิ้นงานเก็บ slot ไว้ในตัวเอง (มาจากทะเบียนตอนบันทึก) เพื่อให้คำสั่ง l3Air
      // ของเซิร์ฟเวอร์ขึ้นจอให้ได้โดยไม่ต้องรู้ทะเบียนชนิด — สคริปต์ OBS จึงไม่ต้องอ่าน JSON
      if (existing) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === ui.editId) {
            list[i].type = ui.type; list[i].slot = typeMeta(ui.type).slot;
            list[i].fields = f;
            list[i].style = ui.style; list[i].auto = ui.auto || 0;
            break;
          }
        }
        saveItems(list, "อัปเดตชิ้นงานแล้ว");
      } else {
        var id = newItemId();
        list.push({ id: id, type: ui.type, slot: typeMeta(ui.type).slot,
                    name: String(nameGuess).slice(0, 60),
                    group: typeMeta(ui.type).group, fields: f,
                    style: ui.style, auto: ui.auto || 0 });
        ui.editId = id;
        saveItems(list, "บันทึกเป็นชิ้นงานแล้ว");
      }
    },

    "item-air": function (b) {
      var it = itemById(b.dataset.id);
      if (!it) return;
      var c = airConf(it.type, it.fields || {}, it.style || {}, it.auto, it.id);
      if (c) cmd(c);
    },
    "item-edit": function (b) {
      var it = itemById(b.dataset.id);
      if (!it) return;
      ui = { type: it.type, fields: copy(it.fields), style: copy(it.style),
             auto: it.auto || 0, editId: it.id };
      goView("live");
    },
    "item-del": function (b) {
      var it = itemById(b.dataset.id);
      if (!it) return;
      if (!confirm('ลบชิ้นงาน "' + (it.name || it.type) + '" ?')) return;
      var list = l3().items.filter(function (x) { return x.id !== b.dataset.id; });
      if (ui && ui.editId === b.dataset.id) ui.editId = null;
      saveItems(list, "ลบแล้ว");
    },
    "item-up": function (b) { moveItem(b.dataset.id, -1); },
    "item-down": function (b) { moveItem(b.dataset.id, 1); },

    "slot-hide": function (b) { cmd({ action: "l3Hide", slot: b.dataset.slot }); },
    "hide-main": function () { cmd({ action: "l3HideAll", keep: ["top", "ticker", "bug"] }); },
    "hide-all": function () { cmd({ action: "l3HideAll" }); },

    "import-lowers": function () {
      var add = importableLowers();
      if (!add.length) return toast("ไม่มีอะไรให้นำเข้า");
      var list = JSON.parse(JSON.stringify(l3().items));
      add.forEach(function (p) {
        var f = { line1: p.line1 };
        if (p.type !== "topic") f.line2 = p.line2;
        list.push({ id: newItemId(), type: p.type, slot: T.L3_TYPES[p.type].slot,
                    name: String(p.line1 || T.L3_TYPES[p.type].label).slice(0, 60),
                    group: "นำเข้าจากงานทั่วไป", fields: f, style: {}, auto: 0 });
      });
      saveItems(list, "นำเข้า " + add.length + " ชิ้นแล้ว");
    },

    "url-copy": function (b) {
      var box = b.parentNode.querySelector("input");
      if (!box) return;
      box.select();
      try { document.execCommand("copy"); toast("คัดลอกแล้ว"); }
      catch (e) { toast("กด Ctrl+C เพื่อคัดลอก", true); }
    },
    reset: function () {
      if (!confirm("รีเซ็ตช่อง Lower Third กลับค่าตั้งต้น ?\nชิ้นงานทั้งหมดในช่องนี้จะหาย " +
                   "(งานกีฬา/งานทั่วไปไม่ถูกแตะ)")) return;
      cmd({ action: "l3Reset" }).then(function (ok) {
        if (ok) { ui = null; toast("รีเซ็ตช่องแล้ว"); }
      });
    },
  };

  function moveItem(id, dir) {
    var list = JSON.parse(JSON.stringify(l3().items));
    var i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].id === id) { i = k; break; }
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    saveItems(list);
  }

  // click
  panel.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var fn = handlers[b.dataset.act];
    if (fn) { e.preventDefault(); fn(b, e); }
  });

  // Enter ในช่องข้อความของกล่องคอมโพส = ขึ้นจอ
  panel.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var t = e.target;
    if (!t || t.tagName === "TEXTAREA") return;
    if (t.getAttribute && t.getAttribute("data-fk") != null) {
      e.preventDefault();
      handlers.air();
    }
  });

  // change — dropdown / สี / ตั้งค่าช่อง / ไฟล์รูป (ทุกอย่างวิ่งผ่านที่นี่ที่เดียว)
  panel.addEventListener("change", function (e) {
    var t = e.target;
    if (!t) return;

    // ตั้งค่าช่อง
    var sk = t.getAttribute && t.getAttribute("data-setk");
    if (sk) {
      var v = t.value;
      if (sk === "animMs" || sk === "tickerSec" || sk === "sponsorSec") v = parseFloat(v) || 0;
      var patch = {};
      patch[sk] = v;
      setSettings(patch).then(function (ok) { if (ok) toast("บันทึกการตั้งค่าแล้ว"); });
      return;
    }
    // ปุ่มปรับแต่งของ draft
    if (t.getAttribute && t.getAttribute("data-sk") != null) { collectUI(); render(); return; }
    // อัปโหลดรูปของฟิลด์ในกล่องคอมโพส
    var upf = t.getAttribute && t.getAttribute("data-upfile");
    if (upf) {
      var files = [].slice.call(t.files || []);
      if (!files.length) return;
      collectUI();
      var meta = typeMeta(ui.type);
      var fd = null;
      meta.fields.forEach(function (x) { if (x.k === upf) fd = x; });
      toast("กำลังอัปโหลด…");
      Promise.all(files.map(uploadImage)).then(function (urls) {
        urls = urls.filter(function (u) { return u; });
        if (!urls.length) return;
        if (fd && fd.kind === "images") {
          ui.fields[upf] = T.l3List(ui.fields[upf]).concat(urls);
        } else {
          ui.fields[upf] = urls[0];
        }
        render();
        toast("อัปโหลดแล้ว");
      }).catch(function (err) { toast(String(err.message || err), true); });
      return;
    }
    // อัปโหลดโลโก้ของช่อง
    var ups = t.getAttribute && t.getAttribute("data-upsetting");
    if (ups) {
      var f0 = (t.files || [])[0];
      if (!f0) return;
      toast("กำลังอัปโหลด…");
      uploadImage(f0).then(function (url) {
        var p = {}; p[ups] = url;
        return setSettings(p);
      }).then(function (ok) { if (ok) toast("เปลี่ยนโลโก้แล้ว"); })
        .catch(function (err) { toast(String(err.message || err), true); });
    }
  });

  // input — แก้ชื่อ/กลุ่มในคลัง = บันทึกอัตโนมัติ (debounce)
  panel.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var idN = t.getAttribute("data-libname"), idG = t.getAttribute("data-libgroup");
    if (!idN && !idG) return;
    var list = JSON.parse(JSON.stringify(l3().items));
    for (var i = 0; i < list.length; i++) {
      if (idN && list[i].id === idN) list[i].name = t.value;
      if (idG && list[i].id === idG) list[i].group = t.value;
    }
    scheduleItemsSave(list);
  });

  // ---- อัปโหลดรูป (ย่อฝั่ง client ก่อนส่ง เหมือน control.js) --------- //
  function dataUrlBytes(d) {
    var i = d.indexOf(",");
    return i < 0 ? d.length : Math.floor((d.length - i - 1) * 3 / 4);
  }
  function uploadImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error("ไม่มีไฟล์"));
      var SERVER_MAX = 2 * 1024 * 1024, TARGET = 1.6 * 1024 * 1024, MAXDIM = 640;
      var type = (file.type || "").toLowerCase();

      function send(dataUrl) {
        fetch("/api/upload", { method: "POST", headers: hdrs(),
                               body: JSON.stringify({ name: file.name, dataUrl: dataUrl }) })
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
      if (!/^image\/(png|jpe?g|webp|gif)$/.test(type)) { sendOriginal(); return; }

      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onerror = function () { URL.revokeObjectURL(url); sendOriginal(new Error("โหลดรูปไม่ได้")); };
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || 0, h = img.naturalHeight || 0;
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
          var lastTry = canvas.toDataURL("image/webp", 0.8);
          if (lastTry.slice(0, 15) !== "data:image/webp") lastTry = out || canvas.toDataURL("image/png");
          if (!lastTry || dataUrlBytes(lastTry) > SERVER_MAX) {
            return reject(new Error("รูปนี้ใหญ่มากจนบีบไม่พอ — ลองใช้รูปที่เล็กลง"));
          }
          out = lastTry;
        }
        toast("รูปใหญ่ไป — ย่อ/บีบให้อัตโนมัติแล้ว");
        send(out);
      };
      img.src = url;
    });
  }

  markActiveNav();
  panel.innerHTML = '<p class="muted">กำลังโหลด…</p>';
})();
