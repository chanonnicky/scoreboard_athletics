/* summary.js — หน้าสรุปการแข่งขัน /summary สำหรับทีมงาน (ดูอย่างเดียว)
   รวมภาพรวม คู่ที่กำลังแข่ง ตารางเหรียญ ผลกรีฑา และแมตช์กีฬาทั้งหมดไว้ในหน้าเดียว
   หน้านี้อ่านอย่างเดียว: ใช้แค่ GET /api/state และ /api/events ไม่มีการส่งคำสั่งใด ๆ
   query: ?transport=poll ใช้ polling แทน SSE
*/
(function () {
  "use strict";

  var T = window.T;
  var esc = T.esc;
  var params = new URLSearchParams(location.search);
  var transport = params.get("transport") || "sse";
  var POLL_MS = 300;

  function $(id) { return document.getElementById(id); }

  var lastState = null;
  var prevRows = null;      // signature ของแถวรอบก่อน — ใช้หาแถวที่เพิ่งเปลี่ยน
  var sectionHtml = {};     // HTML รอบก่อนของแต่ละส่วน — ส่วนที่ไม่เปลี่ยนจะไม่ถูกแตะ
  var lastUpdate = null;    // เวลาที่ข้อมูลบนหน้าเปลี่ยนล่าสุด
  var filter = { status: "all", level: "*" };
  // การเรียงอยู่ในเบราว์เซอร์นี้เท่านั้น เหมือนตัวกรอง
  var sort = { ath: "level", sport: "level", medalKey: "rank", medalDir: 1 };

  // สีลงใน inline style จึงรับเฉพาะ hex
  function hex(c) { return /^#[0-9a-f]{3,8}$/i.test(String(c)) ? c : "#888"; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hms(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }

  function teamHtml(state, key, extra) {
    var c = T.comp(state, key);
    return '<span class="team' + (extra ? " " + extra : "") + '" style="--c:' + esc(hex(c.color)) + '">' +
      '<i class="dot"></i>' +
      (c.logo ? '<img src="' + esc(c.logo) + '" alt="" onerror="this.style.display=\'none\'">' : "") +
      '<span class="nm">' + esc(c.name || "—") + "</span></span>";
  }

  // ผลอันดับ 1–3 ของรายการ (ไม่มีแถว = ยังรอผล)
  function top3Of(state, id) {
    return T.sortResults((state.results || {})[id] || []).filter(function (r) {
      var rk = Number(r.rank); return rk >= 1 && rk <= 3;
    });
  }
  function chipsHtml(state, rows) {
    if (!rows.length) return '<span class="wait">รอผล</span>';
    return '<div class="chips">' + rows.map(function (r) {
      var rk = Number(r.rank);
      return '<span class="chip"><b class="rk rk' + rk + '">' + rk + "</b>" + teamHtml(state, r.house) + "</span>";
    }).join("") + "</div>";
  }
  function liveMatchOf(sp) {
    var m = T.currentMatch(sp);
    return m && !m.done ? m : null;
  }
  function eventsDone(state) {
    return (state.events || []).filter(function (e) { return top3Of(state, e.id).length > 0; }).length;
  }
  function matchesDone(sp) {
    return (sp.matches || []).filter(function (m) { return m.done; }).length;
  }

  /* ---- ภาพรวม ---- */
  function kpiHtml(label, done, total) {
    var w = total ? Math.round(done / total * 100) : 0;
    return '<div class="kpi"><div class="kpi-l">' + esc(label) + "</div>" +
      '<div class="kpi-v">' + done + " <small>/ " + total + "</small></div>" +
      '<div class="bar"><i style="width:' + w + '%"></i></div></div>';
  }
  function renderKpis(state) {
    var html = kpiHtml("กรีฑามีผลแล้ว", eventsDone(state), (state.events || []).length);
    (state.sports || []).forEach(function (sp) {
      html += kpiHtml((sp.icon ? sp.icon + " " : "") + (sp.name || sp.key) + " จบแล้ว",
        matchesDone(sp), (sp.matches || []).length);
    });
    return html;
  }

  /* ---- กำลังแข่งตอนนี้ ---- */
  // นาฬิกาที่เดินอยู่ใส่ข้อความคงที่ แล้วให้ tickClocks เติมหลังวาง DOM
  // เพื่อให้ HTML เหมือนเดิมเมื่อข้อมูลไม่เปลี่ยน ส่วนนี้จึงไม่ถูกแทนที่โดยไม่จำเป็น
  function clockHtml(sp, m) {
    var c = m.clock || {};
    var dur = T.clockDur(m.clock, T.sportDurSec(sp));
    var el = Number(c.elapsed) || 0, run = !!c.running;
    var remain = T.remainSec(el, 0, dur, false);
    return '<div class="clk' + (!run && remain <= 0 ? " ended" : "") + '" data-run="' + (run ? 1 : 0) +
      '" data-el="' + el + '" data-since="' + (Number(c.since) || 0) + '" data-dur="' + dur + '">' +
      (run ? "--:--" : T.fmtClock(remain)) + "</div>";
  }
  function renderLive(state) {
    var html = "";
    var sel = state.settings.selEventId;
    (state.events || []).forEach(function (e) {
      if (!sel || e.id !== sel) return;
      var lv = T.eventLevel(e);
      html += '<div class="now" data-k="e:' + esc(e.id) + '"><div class="now-h">' +
        '<div class="now-t">🏃 ' + esc(e.title || "") + (lv ? " <small>" + esc(lv) + "</small>" : "") + "</div>" +
        '<span class="pill live">กำลังแข่ง</span></div>' +
        chipsHtml(state, top3Of(state, e.id)) + "</div>";
    });
    (state.sports || []).forEach(function (sp) {
      var m = liveMatchOf(sp);
      if (!m) return;
      html += '<div class="now" data-k="m:' + esc(sp.key) + ":" + esc(m.id) + '"><div class="now-h">' +
        '<div class="now-t">' + esc((sp.icon ? sp.icon + " " : "") + (sp.name || sp.key)) +
          (m.level ? " <small>" + esc(m.level) + "</small>" : "") +
          (m.title ? " <small>" + esc(m.title) + "</small>" : "") + "</div>" +
        '<span class="pill live">สด</span></div>' +
        '<div class="vs">' + teamHtml(state, m.home) +
          '<div class="vs-mid"><div class="vs-score">' + (Number(m.hs) || 0) + " : " + (Number(m.as) || 0) + "</div>" +
          clockHtml(sp, m) + "</div>" +
          teamHtml(state, m.away) + "</div></div>";
    });
    return html || '<div class="empty">ตอนนี้ยังไม่มีรายการที่กำลังแข่ง</div>';
  }

  /* ---- ตารางเหรียญ (แสดงเสมอ ไม่ขึ้นกับ settings.chartEnabled) ---- */
  function renderMedals(state) {
    var rows = T.medalTally(state);
    if (!rows.length) return '<div class="empty">ยังไม่มีข้อมูล</div>';
    // อันดับคิดจากกติกาเหรียญก่อนเสมอ การเรียงคอลัมน์เปลี่ยนแค่ลำดับแถว ไม่เปลี่ยนเลขอันดับ
    var rank = 0;
    rows.forEach(function (t, i) {
      var p = rows[i - 1];
      if (!p || p.g !== t.g || p.s !== t.s || p.b !== t.b) rank = i + 1;   // เหรียญเท่ากัน = อันดับร่วม
      t.rank = rank; t.pos = i;
    });
    var key = sort.medalKey, dir = sort.medalDir;
    var body = rows.slice().sort(function (a, b) {
      var d = key === "team" ? T.comp(state, a.key).name.localeCompare(T.comp(state, b.key).name, "th")
        : key === "rank" ? a.pos - b.pos
        : a[key] - b[key];
      return d * dir || a.pos - b.pos;
    }).map(function (t) {
      return '<tr data-k="c:' + esc(t.key) + '"><td>' + (t.total ? t.rank : "–") + "</td>" +
        '<td class="c-team">' + teamHtml(state, t.key) + "</td>" +
        "<td>" + t.g + "</td><td>" + t.s + "</td><td>" + t.b + "</td>" +
        '<td class="c-total">' + t.total + "</td></tr>";
    }).join("");
    return '<table class="mtable"><thead><tr>' + medalTh("rank", "อันดับ", "อันดับ") + medalTh("team", "ทีม", "ทีม", "c-team") +
      medalTh("g", "🥇", "ทอง") + medalTh("s", "🥈", "เงิน") + medalTh("b", "🥉", "ทองแดง") + medalTh("total", "รวม", "รวม") +
      "</tr></thead><tbody>" + body + "</tbody></table>";
  }
  function medalTh(key, text, label, cls) {
    var on = sort.medalKey === key;
    return '<th scope="col"' + (cls ? ' class="' + cls + '"' : "") +
      (on ? ' aria-sort="' + (sort.medalDir > 0 ? "ascending" : "descending") + '"' : "") + ">" +
      '<button type="button" data-msort="' + key + '" aria-label="เรียงตาม' + label + '">' + text +
      (on ? " " + (sort.medalDir > 0 ? "▲" : "▼") : "") + "</button></th>";
  }

  /* ---- ผลกรีฑา แบ่งตามระดับชั้น เรียงตามลำดับในตารางแข่ง ---- */
  function eventGroups(state) {
    var groups = [], byLevel = {};
    (state.events || []).forEach(function (e, i) {
      var lv = T.eventLevel(e);
      var id = "L" + lv;   // กันชื่อชนกับ property ของ object
      if (!byLevel[id]) { byLevel[id] = { level: lv, items: [] }; groups.push(byLevel[id]); }
      byLevel[id].items.push({ e: e, no: i + 1, top: top3Of(state, e.id) });
    });
    return groups;
  }
  function syncLevelOptions(groups) {
    var sel = $("levelSel");
    var html = '<option value="*">ทุกระดับชั้น</option>' + groups.map(function (g) {
      return '<option value="' + esc(g.level) + '">' + esc(g.level || "ไม่ระบุระดับชั้น") + "</option>";
    }).join("");
    var known = filter.level === "*" || groups.some(function (g) { return g.level === filter.level; });
    if (!known) filter.level = "*";
    if (html !== sectionHtml.levelSel) { sel.innerHTML = html; sectionHtml.levelSel = html; }
    sel.value = filter.level;
  }
  function renderAthletics(state) {
    var total = (state.events || []).length;
    $("athCount").textContent = total ? eventsDone(state) + " / " + total + " รายการ" : "";
    var groups = eventGroups(state);
    syncLevelOptions(groups);
    if (!total) return '<div class="empty">ยังไม่มีรายการแข่ง</div>';

    var sel = state.settings.selEventId;
    function passStatus(x) {
      return filter.status === "all" || (filter.status === "done") === (x.top.length > 0);
    }
    function rowHtml(x, showLevel) {
      var cur = !!sel && x.e.id === sel;
      var lv = T.eventLevel(x.e);
      return '<div class="ev' + (cur ? " cur" : "") + '" data-k="e:' + esc(x.e.id) + '">' +
        '<div class="ev-no">' + (cur ? "▶" : x.no) + "</div>" +
        '<div class="ev-t">' + esc(x.e.title || "") + (showLevel && lv ? ' <small class="lv">' + esc(lv) + "</small>" : "") +
          (cur ? ' <span class="pill live">กำลังแข่ง</span>' : "") + "</div>" +
        '<div class="ev-r">' + chipsHtml(state, x.top) + "</div></div>";
    }

    // เรียงแบบอื่นนอกจากระดับชั้น = รายการเดียวต่อเนื่อง ไม่แบ่งกลุ่ม และบอกระดับชั้นในแถวแทน
    if (sort.ath !== "level") {
      var flat = [];
      groups.forEach(function (g) {
        if (filter.level === "*" || filter.level === g.level) flat = flat.concat(g.items.filter(passStatus));
      });
      if (!flat.length) return '<div class="empty">ไม่มีรายการตรงกับตัวกรอง</div>';
      flat.sort(function (a, b) {
        var d = sort.ath === "title" ? String(a.e.title || "").localeCompare(String(b.e.title || ""), "th")
          : sort.ath === "done" ? (b.top.length > 0) - (a.top.length > 0)
          : sort.ath === "wait" ? (a.top.length > 0) - (b.top.length > 0)
          : 0;
        return d || a.no - b.no;
      });
      return '<div class="group">' + flat.map(function (x) { return rowHtml(x, true); }).join("") + "</div>";
    }

    var html = groups.map(function (g) {
      if (filter.level !== "*" && filter.level !== g.level) return "";
      var done = g.items.filter(function (x) { return x.top.length; }).length;
      var rows = g.items.filter(passStatus).map(function (x) { return rowHtml(x, false); }).join("");
      if (!rows) return "";
      return '<div class="group"><div class="group-h"><span>' + esc(g.level || "ไม่ระบุระดับชั้น") + "</span>" +
        "<span>" + done + " / " + g.items.length + "</span></div>" + rows + "</div>";
    }).join("");
    return html || '<div class="empty">ไม่มีรายการตรงกับตัวกรอง</div>';
  }

  /* ---- กีฬา ---- */
  // ลำดับสถานะแมตช์: 0 สด · 1 ยังไม่จบ · 2 รอแข่ง · 3 จบแล้ว
  function matchStage(sp, m) {
    if (m.done) return 3;
    if (m.id === sp.currentId) return 0;
    return (Number(m.hs) || 0) > 0 || (Number(m.as) || 0) > 0 ? 1 : 2;
  }
  function matchHtml(state, sp, m, showLevel) {
    var hs = Number(m.hs) || 0, as = Number(m.as) || 0;
    var live = m.id === sp.currentId && !m.done;
    var started = live || m.done || hs > 0 || as > 0;
    var pill = m.done ? '<span class="pill done">จบแล้ว</span>'
      : live ? '<span class="pill live">สด</span>'
      : '<span class="pill">' + (started ? "ยังไม่จบ" : "รอแข่ง") + "</span>";
    return '<div class="mt' + (live ? " cur" : "") + '" data-k="m:' + esc(sp.key) + ":" + esc(m.id) + '">' +
      '<div class="vs">' + teamHtml(state, m.home, m.done && hs > as ? "win" : "") +
        '<div class="vs-mid"><div class="vs-score' + (started ? "" : " idle") + '">' +
          (started ? hs + " : " + as : "VS") + "</div></div>" +
        teamHtml(state, m.away, m.done && as > hs ? "win" : "") + "</div>" +
      '<div class="mt-f">' + (showLevel ? "<span>" + esc(m.level || "ทั่วไป") + "</span>" : "") +
        (m.title ? "<span>" + esc(m.title) + "</span>" : "") + pill + "</div></div>";
  }
  function sortedMatchesHtml(state, sp) {
    var rows = (sp.matches || []).map(function (m, i) { return { m: m, i: i, st: matchStage(sp, m) }; });
    rows.sort(function (a, b) {
      // "จบแล้วก่อน" เอาขั้นจบขึ้นบน ที่เหลือคงลำดับ สด -> ยังไม่จบ -> รอแข่ง
      var sa = sort.sport === "done" ? (a.st + 1) % 4 : a.st;
      var sb = sort.sport === "done" ? (b.st + 1) % 4 : b.st;
      return (sa - sb) || (a.i - b.i);
    });
    return '<div class="group">' + rows.map(function (r) { return matchHtml(state, sp, r.m, true); }).join("") + "</div>";
  }
  function renderSports(state) {
    var sports = state.sports || [];
    if (!sports.length) return '<div class="empty">ยังไม่มีกีฬา</div>';
    return sports.map(function (sp, i) {
      var ms = sp.matches || [];
      var body = !ms.length ? '<div class="empty">ยังไม่มีแมตช์</div>'
        : sort.sport !== "level" ? sortedMatchesHtml(state, sp)
        : T.sportLevels(sp).map(function (lv) {
        var list = T.matchesIn(sp, lv);
        return '<div class="group"><div class="group-h"><span>' + esc(lv) + "</span>" +
          "<span>" + matchesDone({ matches: list }) + " / " + list.length + "</span></div>" +
          list.map(function (m) { return matchHtml(state, sp, m); }).join("") + "</div>";
      }).join("");
      return '<div class="sport" id="sport-' + i + '"><div class="sport-h"><span>' +
        esc((sp.icon ? sp.icon + " " : "") + (sp.name || sp.key)) + '</span><span class="count">' +
        matchesDone(sp) + " / " + ms.length + " แมตช์</span></div>" + body + "</div>";
    }).join("");
  }

  function renderNav(state) {
    var links = [["live", "กำลังแข่ง"], ["medals", "เหรียญ"], ["athletics", "กรีฑา"]];
    (state.sports || []).forEach(function (sp, i) {
      links.push(["sport-" + i, (sp.icon ? sp.icon + " " : "") + (sp.name || sp.key)]);
    });
    return links.map(function (l) { return '<a href="#' + l[0] + '">' + esc(l[1]) + "</a>"; }).join("");
  }

  var SECTIONS = [
    ["secNav", renderNav], ["secKpis", renderKpis], ["secLive", renderLive], ["secMedals", renderMedals],
    ["secAthletics", renderAthletics], ["secSports", renderSports],
  ];
  function renderSections(state) {
    var changed = false;
    SECTIONS.forEach(function (s) {
      var html = s[1](state);
      if (html === sectionHtml[s[0]]) return;
      sectionHtml[s[0]] = html;
      $(s[0]).innerHTML = html;
      changed = true;
    });
    tickClocks();
    return changed;
  }

  /* ---- หาแถวที่เพิ่งเปลี่ยน ---- */
  function rowSigs(state) {
    var sig = {};
    (state.events || []).forEach(function (e) {
      sig["e:" + e.id] = top3Of(state, e.id).map(function (r) { return r.rank + r.house; }).join(",");
    });
    (state.sports || []).forEach(function (sp) {
      (sp.matches || []).forEach(function (m) {
        sig["m:" + sp.key + ":" + m.id] = [m.home, m.away, Number(m.hs) || 0, Number(m.as) || 0, !!m.done].join("|");
      });
    });
    T.medalTally(state).forEach(function (t) { sig["c:" + t.key] = t.g + "|" + t.s + "|" + t.b; });
    return sig;
  }
  function flashRows(prev, next) {
    var els = document.querySelectorAll("[data-k]");
    for (var i = 0; i < els.length; i++) {
      var k = els[i].getAttribute("data-k");
      if (prev[k] !== undefined && prev[k] !== next[k]) els[i].classList.add("flash");
    }
  }

  function renderHead(state) {
    var s = state.settings;
    var meet = s.meetTitle || (T.compMode(state) === "school" ? "การแข่งขัน" : "กีฬาสี");
    if ($("meet").textContent !== meet) {
      $("meet").textContent = meet;
      document.title = "สรุปการแข่งขัน — " + meet;
    }
    var logo = $("logo");
    if ((s.logo || "") !== sectionHtml.logo) {
      sectionHtml.logo = s.logo || "";
      logo.hidden = !s.logo;
      if (s.logo) logo.setAttribute("src", s.logo);
    }
  }
  function renderConn(offline) {
    var c = $("conn");
    c.textContent = offline ? "ขาดการเชื่อมต่อ" : "● อัปเดตสด";
    c.className = "conn " + (offline ? "off" : "on");
    document.body.classList.toggle("is-offline", !!offline);
  }
  function renderUpdated() {
    if (lastUpdate) $("updated").textContent = "ข้อมูลล่าสุด " + hms(lastUpdate);
  }

  function apply(state) {
    if (!state || !state.settings) return;
    lastState = state;
    renderHead(state);

    var general = state.settings.app === "general";
    $("content").hidden = general;
    $("secNav").hidden = general;
    $("notice").hidden = !general;
    if (general) {
      $("notice").textContent = "ตอนนี้ระบบอยู่ในโหมดงานทั่วไป จึงไม่มีข้อมูลการแข่งขันให้สรุป";
      prevRows = null;
      return;
    }

    var next = rowSigs(state);
    if (renderSections(state) || !lastUpdate) {
      lastUpdate = new Date();
      renderUpdated();
    }
    if (prevRows) flashRows(prevRows, next);
    prevRows = next;
  }

  /* ---- ตัวกรอง (อยู่ในเบราว์เซอร์นี้เท่านั้น) ---- */
  $("statusSeg").addEventListener("click", function (e) {
    var v = e.target.getAttribute("data-status");
    if (!v) return;
    filter.status = v;
    var btns = $("statusSeg").querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", btns[i].getAttribute("data-status") === v ? "true" : "false");
    }
    if (lastState) renderSections(lastState);
  });
  $("levelSel").addEventListener("change", function (e) {
    filter.level = e.target.value;
    if (lastState) renderSections(lastState);
  });

  $("athSort").addEventListener("change", function (e) {
    sort.ath = e.target.value;
    if (lastState) renderSections(lastState);
  });
  $("sportSort").addEventListener("change", function (e) {
    sort.sport = e.target.value;
    if (lastState) renderSections(lastState);
  });
  // กดคอลัมน์เดิมซ้ำ = กลับทิศ · คอลัมน์ใหม่เริ่มจากมากไปน้อย (อันดับและชื่อเริ่มจากน้อยไปมาก)
  $("secMedals").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-msort]");
    if (!btn) return;
    var key = btn.getAttribute("data-msort");
    if (sort.medalKey === key) sort.medalDir = -sort.medalDir;
    else { sort.medalKey = key; sort.medalDir = key === "rank" || key === "team" ? 1 : -1; }
    if (!lastState) return;
    renderSections(lastState);
    var again = $("secMedals").querySelector('[data-msort="' + key + '"]');   // ปุ่มถูกสร้างใหม่ คืนโฟกัสให้คีย์บอร์ด
    if (again) again.focus();
  });

  /* ---- นาฬิกาแมตช์ เดินเองระหว่างที่ state ไม่เปลี่ยน ---- */
  function tickClocks() {
    var els = document.querySelectorAll('.clk[data-run="1"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var remain = T.remainSec(el.getAttribute("data-el"), el.getAttribute("data-since"),
                               el.getAttribute("data-dur"), true);
      el.textContent = T.fmtClock(remain);
      el.classList.toggle("ended", remain <= 0);
    }
  }
  setInterval(tickClocks, 500);

  /* ---- การเชื่อมต่อ (SSE + poll fallback) ---- */
  var polling = false;
  function startSSE() {
    var es, gotMsg = false, done = false;
    function fallback() { if (done) return; done = true; try { es.close(); } catch (e) {} startPolling(); }
    try { es = new EventSource("/api/events"); } catch (e) { startPolling(); return; }
    var guard = setTimeout(function () { if (!gotMsg) fallback(); }, 2500);
    es.onopen = function () { renderConn(false); };
    es.onmessage = function (e) {
      gotMsg = true; clearTimeout(guard); renderConn(false);
      try { apply(JSON.parse(e.data)); } catch (err) { /* ข้ามข้อความที่อ่านไม่ได้ */ }
    };
    es.onerror = function () { renderConn(true); if (!gotMsg) { clearTimeout(guard); fallback(); } };
  }
  function startPolling() {
    if (polling) return;
    polling = true;
    var lastText = "", inFlight = false;
    function tick() {
      if (inFlight || document.hidden) return;   // server ช้าไม่ให้คำขอซ้อนกัน · แท็บที่ซ่อนไม่ต้องดึง
      inFlight = true;
      fetch("/api/state", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then(function (txt) {
          inFlight = false;
          renderConn(false);
          if (txt !== lastText) { lastText = txt; apply(JSON.parse(txt)); }
        })
        .catch(function () { inFlight = false; renderConn(true); });
    }
    document.addEventListener("visibilitychange", tick);
    tick();
    setInterval(tick, POLL_MS);
  }

  if (transport === "poll") startPolling();
  else startSSE();
})();
