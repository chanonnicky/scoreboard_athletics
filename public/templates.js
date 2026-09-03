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

  /* โลโก้ประจำคณะสี — พาธจาก settings.houseLogos[h] ถ้าไม่ตั้งใช้ /pictures/house-<key>.png
     ตั้ง settings.houseLogos[h] = "" เพื่อปิดโลโก้ของคณะนั้น */
  function houseLogoUrl(state, h) {
    var m = state.settings && state.settings.houseLogos;
    if (m && Object.prototype.hasOwnProperty.call(m, h)) return m[h]; // ตั้งไว้ (อาจเว้นว่าง = ปิด)
    return "/pictures/house-" + (h || "").replace(/[^a-z]/gi, "") + ".png";
  }
  function houseLogoImg(state, h, cls) {
    var url = houseLogoUrl(state, h);
    if (url == null || url === "") return "";
    return '<img class="' + (cls || "house-logo") + '" src="' + esc(url) +
           '" alt="" onerror="this.style.display=\'none\'">';
  }

  /* ---- TOP 3 (lower third) — แถบยาวแถวเดียว, อันดับ 1 เด่นสุด ------- */
  function top3(state, ev, results) {
    var items = [1, 2, 3].map(function (rank) {
      var r = (results || []).find(function (x) { return Number(x.rank) === rank; });
      if (!r) return "";
      return (
        '<div class="t3-item t3-r' + rank + " " + hClass(r.house) + '">' +
          '<div class="t3-medal t3-medal-' + rank + '">' + rank + "</div>" +
          houseLogoImg(state, r.house, "t3-logo") +
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
                     houseLogoImg(state, r.house, "rchip-logo") +
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


  /* ================= โมดูลกีฬาทัวร์นาเมนต์ (generic) ==================
     รองรับหลายกีฬา (บอล / บาส …) ใช้โครงเดียวกัน
     state.sports = [ {
       key, name, icon,
       matches:[ { id, level, title, home, away, hs, as, done } ]
     } ]
     - sportMatches : รายการแมตช์ แยกตามระดับชั้น (สีไหนเจอสีไหน + สกอร์)       */

  // ลำดับระดับชั้นมาตรฐาน ป.1–ม.6 (ใช้เรียงหัวข้อให้ถูกลำดับเสมอ)
  var GRADE_ORDER = ["ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6", "ม.1", "ม.2", "ม.3", "ม.4", "ม.5", "ม.6"];
  function gradeRank(l) {
    var i = GRADE_ORDER.indexOf(l);
    return i < 0 ? 999 : i;
  }

  function getSport(state, key) {
    var list = state.sports || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function sportLevels(sport) {
    var seen = [], set = {}, order = 0;
    (sport.matches || []).forEach(function (m) {
      var lv = m.level || "ทั่วไป";
      if (!set[lv]) { set[lv] = 1; seen.push({ lv: lv, o: order++ }); }
    });
    // เรียงตามลำดับชั้น ป.1→ม.6 ก่อน แล้วชั้นอื่น ๆ ตามลำดับที่พบ
    seen.sort(function (a, b) { return (gradeRank(a.lv) - gradeRank(b.lv)) || (a.o - b.o); });
    return seen.map(function (x) { return x.lv; });
  }
  function matchesIn(sport, level) {
    return (sport.matches || []).filter(function (m) {
      return (m.level || "ทั่วไป") === level;
    });
  }

  function sportHead(state, sport, kicker) {
    var title = (sport.icon ? sport.icon + " " : "") + (sport.name || "กีฬา");
    return '<div class="card-head">' +
      '<div class="card-kicker">' + esc(kicker) + "</div>" +
      '<div class="card-title">' + esc(title) + "</div>" +
      logoImg(state) +
    "</div>";
  }

  /* แถวหนึ่งแมตช์: [เจ้าบ้าน]  (ชื่อรายการ / สกอร์)  [ทีมเยือน] */
  function matchRow(state, m) {
    var hs = Number(m.hs) || 0, as = Number(m.as) || 0;
    var hw = m.done && hs > as, aw = m.done && as > hs;
    var mid = m.done ? (esc(m.hs) + "<i>:</i>" + esc(m.as)) : '<span class="fbm-vs">VS</span>';
    return (
      '<div class="fbm">' +
        '<div class="fbm-team fbm-home ' + hClass(m.home) + (hw ? " win" : "") + '">' +
          '<span class="fbm-name">' + esc(houseName(state, m.home)) + "</span>" +
          houseLogoImg(state, m.home, "fbm-logo") +
        "</div>" +
        '<div class="fbm-mid">' +
          (m.title ? '<div class="fbm-title">' + esc(m.title) + "</div>" : "") +
          '<div class="fbm-score">' + mid + "</div>" +
        "</div>" +
        '<div class="fbm-team fbm-away ' + hClass(m.away) + (aw ? " win" : "") + '">' +
          houseLogoImg(state, m.away, "fbm-logo") +
          '<span class="fbm-name">' + esc(houseName(state, m.away)) + "</span>" +
        "</div>" +
      "</div>"
    );
  }

  /* ---- รายการแมตช์ แยกตามระดับชั้น (ป.1–ม.6) ---- */
  function sportMatches(state, key) {
    var sport = getSport(state, key);
    if (!sport || !(sport.matches || []).length) return null;
    var body = sportLevels(sport).map(function (lv) {
      var list = matchesIn(sport, lv);
      return '<div class="fblv"><div class="fblv-h">' + esc(lv) + "</div>" +
        list.map(function (m) { return matchRow(state, m); }).join("") + "</div>";
    }).join("");
    return '<div class="card tpl-fb-card">' +
      sportHead(state, sport, "ผลการแข่งขัน") +
      '<div class="card-body"><div class="fblist">' + body + "</div></div>" +
    "</div>";
  }

  return {
    top3: top3, results: results, schedule: schedule,
    sportMatches: sportMatches,
    esc: esc,
  };
})();
