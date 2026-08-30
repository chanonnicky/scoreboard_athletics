/* ฟังก์ชัน render ของแต่ละ CG template — คืนค่าเป็น HTML string
   ใช้ร่วมกันทั้ง overlay (แสดงจริง) และ control (พรีวิว)
   หมายเหตุ: ระบบนี้แสดง "สีคณะ" อย่างเดียว ไม่มีชื่อนักกีฬา                */
window.T = (function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function houseName(state, h) {
    var n = state.settings && state.settings.houseNames;
    return (n && n[h]) || h || "";
  }

  function hClass(h) {
    return "h-" + (h || "").replace(/[^a-z]/gi, "");
  }

  function sortResults(results) {
    return (results || []).slice().sort(function (a, b) {
      return (Number(a.rank) || 99) - (Number(b.rank) || 99);
    });
  }

  function eventLevel(ev) { return ev.level || ev.ageGroup || ""; }

  /* โลโก้โรงเรียน — แสดงบน CG ทุกอัน (พาธตั้งใน settings.logo, เว้นว่าง = ปิด) */
  function logoImg(state) {
    var url = state.settings && state.settings.logo;
    if (url == null || url === "") return "";
    return '<img class="cg-logo" src="' + esc(url) + '" alt="" onerror="this.style.display=\'none\'">';
  }

  /* ---- TOP 3 (lower third) — แถบยาวแถวเดียว, อันดับ 1 เด่นสุด ------- */
  function top3(state, ev, results) {
    var items = [1, 2, 3].map(function (rank) {
      var r = (results || []).find(function (x) { return Number(x.rank) === rank; });
      if (!r) return "";
      return (
        '<div class="t3-item t3-r' + rank + " " + hClass(r.house) + '">' +
          '<div class="t3-medal t3-medal-' + rank + '">' + rank + "</div>" +
          '<div class="t3-house">' + esc(houseName(state, r.house)) + "</div>" +
        "</div>"
      );
    }).join("");
    if (!items) return null;

    var title = esc(ev.title || "");
    var lv = eventLevel(ev);
    if (lv) title += " &nbsp;·&nbsp; " + esc(lv);
    return '<div class="t3">' +
             '<div class="t3-head">' + logoImg(state) +
               '<span class="t3-title-text">' + title + "</span></div>" +
             '<div class="t3-list">' + items + "</div></div>";
  }

  /* ---- ผลการแข่งขัน (full) — ทุกรายการ + สีคณะที่ได้อันดับ 1/2/3 ----
     คล้ายตารางแข่ง แต่มีคอลัมน์ผล; รายการที่ยังไม่แข่ง = "รอผล"
     แบ่งหน้า — overlay.js สลับ .apage อัตโนมัติทุก ~10 วิ                  */
  var RESULTS_PER_PAGE = 10;
  function results(state) {
    var evs = state.events || [];
    if (!evs.length) return null;
    var resById = state.results || {};

    var pages = [];
    for (var p = 0; p < evs.length; p += RESULTS_PER_PAGE) {
      pages.push(evs.slice(p, p + RESULTS_PER_PAGE));
    }
    var doneCount = 0;
    evs.forEach(function (e) { var r = resById[e.id]; if (r && r.length) doneCount++; });

    var pagesHtml = pages.map(function (grp, pi) {
      var base = pi * RESULTS_PER_PAGE;
      var rows = grp.map(function (e, k) {
        var top3rows = sortResults(resById[e.id] || []).filter(function (r) {
          var rk = Number(r.rank); return rk >= 1 && rk <= 3;
        });
        var right = top3rows.length
          ? '<div class="rres">' + top3rows.map(function (r) {
              return '<span class="rchip ' + hClass(r.house) + '"><b>' + esc(r.rank) + "</b>" +
                     esc(houseName(state, r.house)) + "</span>";
            }).join("") + "</div>"
          : '<div class="rres rwait">— รอผล —</div>';
        var lv = eventLevel(e);
        return (
          '<div class="rrow2">' +
            '<div class="rno">' + (base + k + 1) + "</div>" +
            '<div class="rtitle">' + esc(e.title || "") +
              (lv ? ' <span class="rlevel">' + esc(lv) + "</span>" : "") +
            "</div>" +
            right +
          "</div>"
        );
      }).join("");
      return '<div class="apage"><div class="rlist2">' + rows + "</div></div>";
    }).join("");

    var kicker = "ผลการแข่งขัน &nbsp;·&nbsp; " + doneCount + " / " + evs.length + " รายการ";
    if (pages.length > 1) kicker += " &nbsp;·&nbsp; " + pages.length + " หน้า";

    return (
      '<div class="card tpl-results-card">' +
        '<div class="card-head">' +
          '<div class="card-kicker">' + kicker + "</div>" +
          '<div class="card-title">' + esc((state.settings && state.settings.meetTitle) || "กีฬาสี") + "</div>" +
          logoImg(state) +
        "</div>" +
        '<div class="card-body">' + pagesHtml + "</div>" +
      "</div>"
    );
  }

  /* ---- ตารางแข่งขัน (full) — หน้าต่างรอบ ๆ รายการที่กำลังแข่ง ----
     แสดงแค่ ~11 รายการ โดยรายการที่กำลังแข่งอยู่กลาง (ก่อนหน้า/ถัดไป)
     เปลี่ยนรายการที่เลือกใน control -> หน้าต่างเลื่อนตาม                */
  var SCHED_WIN = 11;
  function schedule(state, currentId) {
    var evs = state.events || [];
    if (!evs.length) return null;

    var idx = -1;
    for (var i = 0; i < evs.length; i++) { if (evs[i].id === currentId) { idx = i; break; } }

    var win = Math.min(SCHED_WIN, evs.length);
    var start = idx < 0 ? 0
      : Math.max(0, Math.min(idx - Math.floor((win - 1) / 2), evs.length - win));
    var slice = evs.slice(start, start + win);

    var rows = slice.map(function (e, k) {
      var gi = start + k;
      var cls = e.id === currentId ? " cur" : (idx >= 0 && gi < idx ? " past" : "");
      return (
        '<div class="srow' + cls + '">' +
          '<div class="smark">' + (e.id === currentId ? "▶" : (gi + 1)) + "</div>" +
          '<div class="stitle">' + esc(e.title || "") + "</div>" +
          '<div class="slevel">' + esc(eventLevel(e)) + "</div>" +
        "</div>"
      );
    }).join("");

    var kicker = "ตารางการแข่งขัน";
    if (idx >= 0) kicker += " &nbsp;·&nbsp; " + (idx + 1) + " / " + evs.length;

    return (
      '<div class="card tpl-sched-card">' +
        '<div class="card-head">' +
          '<div class="card-kicker">' + kicker + "</div>" +
          '<div class="card-title">' + esc((state.settings && state.settings.meetTitle) || "กีฬาสี") + "</div>" +
          logoImg(state) +
        "</div>" +
        '<div class="card-body"><div class="slist">' + rows + "</div></div>" +
      "</div>"
    );
  }

  return { top3: top3, results: results, schedule: schedule, esc: esc };
})();
