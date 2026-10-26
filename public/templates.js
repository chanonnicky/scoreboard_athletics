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

  /* ---- คู่แข่ง (competitor): สีคณะ หรือ โรงเรียน ตาม settings.mode ----------
     โหมด "house" = 4 สีคณะเดิม (สไตล์จาก CSS .h-red …)
     โหมด "school" = settings.schools = [{key,name,logo}] — ไม่มีสีเก็บไว้ กำหนดสีจาก
     palette ตามลำดับใน roster (ใช้แค่ไฮไลต์ผู้นำ/ผู้ตาม) แล้วส่งเป็น inline var */
  var SCHOOL_PALETTE = [
    "#e53935", "#1e88e5", "#2e9d54", "#f4c020", "#8e24aa",
    "#00897b", "#fb8c00", "#3949ab", "#c2185b", "#5d4037",
  ];
  function compMode(state) {
    return (state.settings && state.settings.mode) === "school" ? "school" : "house";
  }
  function contrastInk(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex == null ? "" : hex).trim());
    if (!m) return "#fff";
    var n = parseInt(m[1], 16);
    var L = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return L > 0.6 ? "#1a1a1a" : "#fff";
  }
  function schoolIndex(state, key) {
    var list = (state.settings && state.settings.schools) || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].key === key) return i;
    return -1;
  }
  function comp(state, key) {
    var s = state.settings || {};
    if (compMode(state) === "school") {
      var i = schoolIndex(state, key);
      var sc = i >= 0 ? s.schools[i] : null;
      var color = i >= 0 ? SCHOOL_PALETTE[i % SCHOOL_PALETTE.length] : "#888";
      var ink = contrastInk(color);
      return { name: (sc && sc.name) || key || "", logo: (sc && sc.logo) || "",
               color: color, ink: ink, lightInk: ink !== "#fff" };
    }
    var names = s.houseNames || {}, colors = s.houses || {};
    return { name: names[key] || key || "", logo: houseLogoUrl(state, key),
             color: colors[key] || "#888", ink: "#fff", lightInk: false };
  }
  function compKeys(state) {
    if (compMode(state) === "school") {
      return ((state.settings && state.settings.schools) || []).map(function (s) { return s.key; });
    }
    return Object.keys((state.settings && state.settings.houses) || {});
  }
  // class ของ element ทีม: โหมด school -> "comp[ comp-lightbg]" + ต้องคู่กับ compStyle()
  function compCls(state, key) {
    if (compMode(state) === "school") {
      return "comp" + (comp(state, key).lightInk ? " comp-lightbg" : "");
    }
    return hClass(key);
  }
  // inline CSS var สำหรับโหมด school (โหมด house ใช้ .h-<key> จาก CSS -> คืน "")
  function compStyle(state, key) {
    if (compMode(state) !== "school") return "";
    var x = comp(state, key);
    return ' style="--house:' + x.color + ';--ink:' + x.ink + '"';
  }
  function meetTitleOf(state) {
    return (state.settings && state.settings.meetTitle) ||
           (compMode(state) === "school" ? "การแข่งขัน" : "กีฬาสี");
  }

  function houseName(state, h) {
    return comp(state, h).name;
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

  /* ---- นาฬิกาจับเวลาแมตช์ (นับถอยหลัง) ----
     clock = { running:bool, elapsed:วินาทีที่เดินไปแล้ว, since:unix ms ตอนเริ่มเดินรอบนี้,
               dur:ความยาวครึ่ง/ควอเตอร์ เป็นวินาที (ไม่ระบุ = 600 = 10:00) }
     เวลาที่โชว์ = max(0, dur − เวลาที่เดินไปแล้ว) · ไม่มี clock = หยุดที่ dur เต็ม
     ผู้บริโภค (board/overlay/control) tick เองทุกครึ่งวินาที */
  var CLOCK_DEFAULT_DUR = 600;
  // เวลาตั้งต้นต่อครึ่ง/ควอเตอร์ ของกีฬานั้น (sport.clockMin นาที — ไม่ตั้ง = 10:00)
  function sportDurSec(sport) {
    var m = Number(sport && sport.clockMin);
    return (m > 0 ? m : 10) * 60;
  }
  function clockValue(clock) {            // เวลาที่เดินไปแล้ว (นับขึ้น) — ใช้ภายใน
    if (!clock) return 0;
    var el = Number(clock.elapsed) || 0;
    if (!clock.running) return el;
    return el + Math.max(0, (Date.now() - (Number(clock.since) || 0)) / 1000);
  }
  function clockDur(clock, fallbackSec) {
    if (!clock || clock.dur == null) return fallbackSec != null ? fallbackSec : CLOCK_DEFAULT_DUR;
    return Math.max(0, Number(clock.dur) || 0);
  }
  function clockRemain(clock) {           // เวลาที่เหลือ (นับถอยหลัง)
    return Math.max(0, clockDur(clock) - clockValue(clock));
  }
  function remainSec(base, since, dur, running) {  // สำหรับ tick จาก data-* attribute
    var up = (Number(base) || 0) + (running ? Math.max(0, (Date.now() - (Number(since) || 0)) / 1000) : 0);
    return Math.max(0, (Number(dur) || 0) - up);
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }

  /* โลโก้โรงเรียน — แสดงบน CG ทุกอัน (พาธตั้งใน settings.logo, เว้นว่าง = ปิด) */
  function logoImg(state) {
    var url = state.settings && state.settings.logo;
    if (url == null || url === "") return "";
    return '<img class="cg-logo" src="' + esc(url) + '" alt="" onerror="this.style.display=\'none\'">';
  }

  /* โลโก้ประจำคณะสี — พาธจาก settings.houseLogos[h] ถ้าไม่ตั้งใช้ /pictures/house-<key>.png
     ตั้ง settings.houseLogos[h] = "" เพื่อปิดโลโก้ของคณะนั้น */
  function houseLogoUrl(state, h) {
    if (compMode(state) === "school") {
      var i = schoolIndex(state, h);
      return i >= 0 ? (state.settings.schools[i].logo || "") : "";
    }
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

  /* ---- TOP 3 (lower third) — แท่นรางวัล: อันดับ 1 อยู่กลาง-สูงสุด, 2-3 เตี้ยลงมาด้านข้าง
     ลำดับ DOM ตั้งใจเรียง 2,1,3 (ไม่ใช่ 1,2,3) เพื่อให้อันดับ 1 อยู่กึ่งกลางแถวโดยไม่ต้องใช้
     CSS order — ข้อมูลรายการ/ระดับ อยู่เป็นแถบใต้แท่น (ไม่ใช่หัวด้านบนแบบเดิม)             */
  function top3(state, ev, results) {
    var rows = {};
    (results || []).forEach(function (r) {
      var rk = Number(r.rank);
      if (rk >= 1 && rk <= 3 && !rows[rk]) rows[rk] = r;
    });
    var cols = [2, 1, 3].map(function (rank) {
      var r = rows[rank];
      if (!r) return "";
      return (
        '<div class="t3-col t3-r' + rank + " " + compCls(state, r.house) + '"' + compStyle(state, r.house) + ">" +
          '<div class="t3-figure">' +
            '<div class="t3-medal t3-medal-' + rank + '">' + rank + "</div>" +
            houseLogoImg(state, r.house, "t3-logo") +
            '<div class="t3-house">' + esc(houseName(state, r.house)) + "</div>" +
          "</div>" +
          '<div class="t3-step"></div>' +
        "</div>"
      );
    }).join("");
    if (!cols) return null;

    var title = esc(ev.title || "");
    var lv = eventLevel(ev);
    if (lv) title += " &nbsp;·&nbsp; " + esc(lv);
    return '<div class="t3">' +
             '<div class="t3-stage">' + cols + "</div>" +
             '<div class="t3-head">' + logoImg(state) +
               '<span class="t3-title-text">' + title + "</span></div>" +
           "</div>";
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

    // รายการที่กำลังแข่งอยู่ตอนนี้ (settings.selEventId ที่หน้าคุมตั้งไว้ — แชร์ทั้งงาน)
    // ไฮไลต์ตรงแถวของรายการนั้นเลย แทนที่จะขึ้นแยกเป็นแถวสรุปต่างหาก
    var sel = state.settings && state.settings.selEventId;

    var pagesHtml = pages.map(function (grp, pi) {
      var base = pi * RESULTS_PER_PAGE;
      var rows = grp.map(function (e, k) {
        var isCur = !!sel && e.id === sel;
        var top3rows = sortResults(resById[e.id] || []).filter(function (r) {
          var rk = Number(r.rank); return rk >= 1 && rk <= 3;
        });
        var right = isCur
          ? '<div class="rres rlive"><span class="live-dot"></span>กำลังแข่ง</div>'
          : top3rows.length
          ? '<div class="rres">' + top3rows.map(function (r) {
              return '<span class="rchip ' + compCls(state, r.house) + '"' + compStyle(state, r.house) + "><b>" + esc(r.rank) + "</b>" +
                     houseLogoImg(state, r.house, "rchip-logo") +
                     esc(houseName(state, r.house)) + "</span>";
            }).join("") + "</div>"
          : '<div class="rres rwait">— รอผล —</div>';
        var lv = eventLevel(e);
        return (
          '<div class="rrow2' + (isCur ? " cur" : "") + '">' +
            '<div class="rno">' + (isCur ? "▶" : (base + k + 1)) + "</div>" +
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
          '<div class="card-title">' + esc(meetTitleOf(state)) + "</div>" +
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
          '<div class="card-title">' + esc(meetTitleOf(state)) + "</div>" +
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

  /* แถวหนึ่งแมตช์: [เจ้าบ้าน]  (ชื่อรายการ / สกอร์)  [ทีมเยือน]
     idx = ลำดับในหน้า (ใช้หน่วงแอนิเมชันไล่แถวเข้า — ตั้งเป็น CSS var --fbi)
     isLive = คู่นี้คือ currentId ของกีฬาที่ยังไม่จบ -> ไฮไลต์แถวแทนที่จะขึ้น VS เฉย ๆ */
  function matchRow(state, m, idx, isLive) {
    var hs = Number(m.hs) || 0, as = Number(m.as) || 0;
    var hw = m.done && hs > as, aw = m.done && as > hs;
    var mid = m.done ? (esc(m.hs) + "<i>:</i>" + esc(m.as))
      : isLive ? '<span class="fbm-live"><span class="live-dot"></span>สด</span>'
      : '<span class="fbm-vs">VS</span>';
    return (
      '<div class="fbm' + (isLive ? " cur" : "") + '" style="--fbi:' + (idx || 0) + '">' +
        '<div class="fbm-team fbm-home ' + compCls(state, m.home) + (hw ? " win" : "") + '"' + compStyle(state, m.home) + ">" +
          '<span class="fbm-name">' + esc(houseName(state, m.home)) + "</span>" +
          houseLogoImg(state, m.home, "fbm-logo") +
        "</div>" +
        '<div class="fbm-mid">' +
          (m.title ? '<div class="fbm-title">' + esc(m.title) + "</div>" : "") +
          '<div class="fbm-score">' + mid + "</div>" +
        "</div>" +
        '<div class="fbm-team fbm-away ' + compCls(state, m.away) + (aw ? " win" : "") + '"' + compStyle(state, m.away) + ">" +
          houseLogoImg(state, m.away, "fbm-logo") +
          '<span class="fbm-name">' + esc(houseName(state, m.away)) + "</span>" +
        "</div>" +
      "</div>"
    );
  }

  /* ---- รายการแมตช์ แยกตามระดับชั้น (ป.1–ม.6) — แบ่งหน้าอัตโนมัติ ----
     คิดเป็น "พื้นที่": หัวระดับชั้น ~0.6 + แต่ละแมตช์ 1 หน่วย ต่อหน้าไม่เกิน ~4.6
     (แถวบอลสูงเพราะมีโลโก้ใหญ่) ไม่หั่นระดับชั้นข้ามหน้า
     board.js/overlay.js สลับ .apage เหมือนหน้าผลกรีฑา                        */
  var SPORT_PAGE_UNITS = 4.6, LEVEL_HEAD_UNITS = 0.6;
  function sportMatches(state, key) {
    var sport = getSport(state, key);
    if (!sport || !(sport.matches || []).length) return null;

    var blocks = sportLevels(sport).map(function (lv) {
      var list = matchesIn(sport, lv);
      return { lv: lv, list: list, units: LEVEL_HEAD_UNITS + list.length };
    });

    var pages = [], cur = [], curUnits = 0;
    blocks.forEach(function (b) {
      if (cur.length && curUnits + b.units > SPORT_PAGE_UNITS) { pages.push(cur); cur = []; curUnits = 0; }
      cur.push(b); curUnits += b.units;
    });
    if (cur.length) pages.push(cur);

    var kicker = "ผลการแข่งขัน";
    if (pages.length > 1) kicker += " · " + pages.length + " หน้า";   // sportHead ใช้ esc() -> ห้ามใส่ &nbsp;
    // render แต่ละหน้า พร้อมนับ index ต่อเนื่อง (หัวระดับชั้น + แถวแมตช์) เพื่อไล่แอนิเมชันเข้าทีละแถว
    // ไฮไลต์แถวของคู่ที่กำลังแข่งอยู่ตอนนี้ (sport.currentId ที่ยังไม่ done) ตรงในรายการเลย
    var liveId = sport.currentId;
    var pagesHtml = pages.map(function (blks) {
      var i = 0;
      var inner = blks.map(function (b) {
        var head = '<div class="fblv-h" style="--fbi:' + (i++) + '">' + esc(b.lv) + "</div>";
        var rows = b.list.map(function (m) {
          return matchRow(state, m, i++, m.id === liveId && !m.done);
        }).join("");
        return '<div class="fblv">' + head + rows + "</div>";
      }).join("");
      return '<div class="apage"><div class="fblist">' + inner + "</div></div>";
    }).join("");

    return '<div class="card tpl-fb-card tpl-fb-paged">' +
      sportHead(state, sport, kicker) +
      '<div class="card-body">' + pagesHtml + "</div>" +
    "</div>";
  }

  /* คู่ที่กำลังแข่งของกีฬานั้น (จาก sport.currentId) */
  function currentMatch(sport) {
    if (!sport || !sport.currentId) return null;
    var ms = sport.matches || [];
    for (var i = 0; i < ms.length; i++) if (ms[i].id === sport.currentId) return ms[i];
    return null;
  }

  /* ---- สกอร์บอร์ดสด: คู่ที่กำลังแข่ง (ทีม + สกอร์ใหญ่กลางจอ) ---- */
  function sportLive(state, key) {
    var sport = getSport(state, key);
    if (!sport) return null;
    var title = (sport.icon ? sport.icon + " " : "") + (sport.name || "กีฬา");
    var m = currentMatch(sport);
    if (!m) {
      return '<div class="card tpl-live-card">' +
        '<div class="card-head"><div class="card-kicker">' + esc(title) + " · สกอร์สด</div>" +
          '<div class="card-title">&nbsp;</div>' + logoImg(state) + "</div>" +
        '<div class="card-body"><div class="live-wait">— ยังไม่มีคู่ที่กำลังแข่ง —</div></div>' +
      "</div>";
    }
    var hs = Number(m.hs) || 0, as = Number(m.as) || 0;
    // ทีมที่นำอยู่ตอนนี้ — ไม่ต้องรอจบแมตช์ (เท่ากัน/0-0 ยังไม่มีใครนำ ไม่ไฮไลต์ฝั่งไหน)
    var tied = hs === as;
    var hw = !tied && hs > as, aw = !tied && as > hs;
    var sub = [m.level, m.title].filter(Boolean).join(" · ");
    var status = m.done
      ? '<div class="live-status done">จบการแข่งขัน</div>'
      : '<div class="live-status"><span class="live-dot"></span>กำลังแข่ง</div>';

    // นาฬิกานับถอยหลัง — จบแล้วถือว่าหยุด (board.js อ่าน data-* แล้ว tick เอง)
    var ck = m.clock || {};
    var ckRun = !!ck.running && !m.done;
    var ckEl = Number(ck.elapsed) || 0;
    var ckSince = Number(ck.since) || 0;
    var ckDur = clockDur(ck, sportDurSec(sport));
    var ckRemain = remainSec(ckEl, ckSince, ckDur, ckRun);
    var clockHtml = '<div class="live-clock' + (ckRun ? " run" : " paused") + (ckRemain <= 0 ? " ended" : "") +
      '" data-run="' + (ckRun ? 1 : 0) + '" data-el="' + ckEl + '" data-since="' + ckSince +
      '" data-dur="' + ckDur + '">' + fmtClock(ckRemain) + "</div>";
    return '<div class="card tpl-live-card">' +
      '<div class="card-head">' +
        '<div class="card-kicker">' + esc(title) + " · สกอร์สด</div>" +
        '<div class="card-title">' + esc(sub || " ") + "</div>" +
        logoImg(state) +
      "</div>" +
      '<div class="card-body"><div class="live">' +
        '<div class="live-team live-home ' + compCls(state, m.home) + (hw ? " win" : aw ? " trail" : "") + '"' + compStyle(state, m.home) + ">" +
          houseLogoImg(state, m.home, "live-logo") +
          '<div class="live-name">' + esc(houseName(state, m.home)) + "</div>" +
        "</div>" +
        '<div class="live-mid">' +
          '<div class="live-score"><span class="ls ls-h">' + esc(hs) + '</span><i>:</i><span class="ls ls-a">' + esc(as) + "</span></div>" +
          clockHtml +
          status +
        "</div>" +
        '<div class="live-team live-away ' + compCls(state, m.away) + (aw ? " win" : hw ? " trail" : "") + '"' + compStyle(state, m.away) + ">" +
          houseLogoImg(state, m.away, "live-logo") +
          '<div class="live-name">' + esc(houseName(state, m.away)) + "</div>" +
        "</div>" +
      "</div></div>" +
    "</div>";
  }

  /* ---- แถบล่างสกอร์สด (lower third) — คู่ที่กำลังแข่งของกีฬาเดียว ----------
     ไม่มีพื้นหลัง · สกอร์ตัวใหญ่ · นาฬิกานับถอยหลัง · จุด LIVE คนละบรรทัด · ชื่อกีฬาล่างสุด
     แต่เป็นแถบล่าง จึงขึ้นพร้อมกราฟิกเต็มจอได้
     overlay.js แก้สกอร์/นาฬิกา/สถานะในที่ (patchSportbar) — ไม่ re-render ทั้งแถบ ไม่มีวูบ
     ไม่มีคู่ที่กำลังแข่ง (currentId) -> คืน null (แถบไม่ต้องขึ้น)              */
  function sportLower(state, key) {
    var sport = getSport(state, key);
    if (!sport) return null;
    var m = currentMatch(sport);
    if (!m) return null;

    var sportNm = (sport.icon ? sport.icon + " " : "") + (sport.name || "กีฬา");
    var hs = Number(m.hs) || 0, as = Number(m.as) || 0;
    var tied = hs === as;
    var hw = !tied && hs > as, aw = !tied && as > hs;

    // นาฬิกา — ก๊อปจาก sportLive ให้เหมือนกันเป๊ะ (เพิ่มแค่คลาส sportbar-clock)
    var ck = m.clock || {};
    var ckRun = !!ck.running && !m.done;
    var ckEl = Number(ck.elapsed) || 0;
    var ckSince = Number(ck.since) || 0;
    var ckDur = clockDur(ck, sportDurSec(sport));
    var ckRemain = remainSec(ckEl, ckSince, ckDur, ckRun);
    var clockHtml = '<div class="live-clock sportbar-clock' + (ckRun ? " run" : " paused") +
      (ckRemain <= 0 ? " ended" : "") +
      '" data-run="' + (ckRun ? 1 : 0) + '" data-el="' + ckEl + '" data-since="' + ckSince +
      '" data-dur="' + ckDur + '">' + fmtClock(ckRemain) + "</div>";

    // สถานะ — อยู่คนละบรรทัดกับนาฬิกา · จุดกะพริบ + LIVE (หรือ "จบแล้ว")
    // เรนเดอร์ทั้ง LIVE และ "จบแล้ว" ไว้เสมอ สลับด้วย .sportbar[data-done]
    // เพื่อให้ overlay.js แก้สกอร์/นาฬิกา/สถานะในที่ได้ โดยจุดกะพริบไม่รีสตาร์ตแอนิเมชัน
    var statusHtml =
      '<div class="sportbar-status">' +
        '<span class="live-dot"></span>' +
        '<span class="sportbar-live-word">LIVE</span>' +
        '<span class="sportbar-done-word">จบแล้ว</span>' +
      "</div>";

    return '<div class="sportbar" data-done="' + (m.done ? 1 : 0) + '">' +
      '<div class="sportbar-row">' +
        '<div class="sportbar-team sportbar-home ' + compCls(state, m.home) +
          (hw ? " win" : aw ? " trail" : "") + '"' + compStyle(state, m.home) + ">" +
          '<span class="sportbar-name">' + esc(houseName(state, m.home)) + "</span>" +
          houseLogoImg(state, m.home, "sportbar-logo") +
        "</div>" +
        '<div class="sportbar-mid">' +
          '<div class="sportbar-score">' +
            '<span class="ls ls-h">' + esc(hs) + "</span><i>:</i>" +
            '<span class="ls ls-a">' + esc(as) + "</span>" +
          "</div>" +
          '<div class="sportbar-sub">' + clockHtml + statusHtml + "</div>" +
        "</div>" +
        '<div class="sportbar-team sportbar-away ' + compCls(state, m.away) +
          (aw ? " win" : hw ? " trail" : "") + '"' + compStyle(state, m.away) + ">" +
          houseLogoImg(state, m.away, "sportbar-logo") +
          '<span class="sportbar-name">' + esc(houseName(state, m.away)) + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="sportbar-foot">' + esc(sportNm) + "</div>" +
    "</div>";
  }

  /* ---- score bug — กราฟิกเล็กมุมบนซ้าย โชว์คะแนน + นาฬิกานับถอยหลัง "ตลอดเวลา" -----
     ช่องอิสระ (slot "bug") ค้างจอพร้อมกราฟิกหลักได้ · ทีละ 1 กีฬา
     overlay.js แก้สกอร์/นาฬิกา/สถานะในที่ (patchScoreBug) — จุด LIVE ไม่รีสตาร์ต โลโก้ไม่โหลดใหม่
     ไม่มีคู่ที่กำลังแข่ง (currentId) -> คืน null                                       */
  function scoreBug(state, key) {
    var sport = getSport(state, key);
    if (!sport) return null;
    var m = currentMatch(sport);
    if (!m) return null;

    var sportNm = (sport.icon ? sport.icon + " " : "") + (sport.name || "กีฬา");
    var hs = Number(m.hs) || 0, as = Number(m.as) || 0;
    var tied = hs === as;
    var hw = !tied && hs > as, aw = !tied && as > hs;

    var ck = m.clock || {};
    var ckRun = !!ck.running && !m.done;
    var ckEl = Number(ck.elapsed) || 0;
    var ckSince = Number(ck.since) || 0;
    var ckDur = clockDur(ck, sportDurSec(sport));
    var ckRemain = remainSec(ckEl, ckSince, ckDur, ckRun);
    var clockHtml = '<div class="live-clock scorebug-clock' + (ckRun ? " run" : " paused") +
      (ckRemain <= 0 ? " ended" : "") +
      '" data-run="' + (ckRun ? 1 : 0) + '" data-el="' + ckEl + '" data-since="' + ckSince +
      '" data-dur="' + ckDur + '">' + fmtClock(ckRemain) + "</div>";

    function teamRow(cls, k, win, trail) {
      return '<div class="scorebug-team scorebug-' + cls + " " + compCls(state, k) +
        (win ? " win" : trail ? " trail" : "") + '"' + compStyle(state, k) + ">" +
        houseLogoImg(state, k, "scorebug-logo") +
        '<span class="scorebug-name">' + esc(houseName(state, k)) + "</span>" +
        '<span class="ls ls-' + cls.charAt(0) + ' scorebug-score">' + esc(cls === "home" ? hs : as) + "</span>" +
      "</div>";
    }

    var sbStyle = ' style="--sb-home:' + comp(state, m.home).color +
      ";--sb-away:" + comp(state, m.away).color + '"';

    return '<div class="scorebug" data-done="' + (m.done ? 1 : 0) + '"' + sbStyle + ">" +
      '<div class="scorebug-head">' + esc(sportNm) + "</div>" +
      teamRow("home", m.home, hw, aw) +
      teamRow("away", m.away, aw, hw) +
      '<div class="scorebug-foot">' +
        '<span class="scorebug-status">' +
          '<span class="live-dot"></span>' +
          '<span class="scorebug-live-word">LIVE</span>' +
          '<span class="scorebug-done-word">จบแล้ว</span>' +
        "</span>" +
        clockHtml +
      "</div>" +
    "</div>";
  }

  /* ================= กราฟ / Data Graphic =============================
     นับเหรียญ (🥇🥈🥉) ต่อคณะ/โรงเรียน จาก state.results ของทุกรายการ แล้ววาดเป็นกราฟ
     - settings.chartEnabled : สวิตช์เปิด/ปิด (ปิด = chart() คืน null -> ไม่มีการ์ด)
     - settings.chartType    : "bars" (บาร์แนวนอน จัดอันดับ — ดีฟอลต์) | "columns" (คอลัมน์แนวตั้ง)
     - settings.chartTitle   : ชื่อกราฟ (ว่าง = "ตารางเหรียญรางวัล")
     ไม่ persist — คำนวณสดทุกครั้งที่ render                                     */
  function medalTally(state) {
    var resById = state.results || {};
    var order = compKeys(state);
    var tally = {};
    order.forEach(function (k) { tally[k] = { key: k, g: 0, s: 0, b: 0, total: 0 }; });
    (state.events || []).forEach(function (e) {
      (resById[e.id] || []).forEach(function (r) {
        var t = tally[r.house];
        if (!t) return;
        var rk = Number(r.rank);
        if (rk === 1) t.g++;
        else if (rk === 2) t.s++;
        else if (rk === 3) t.b++;
      });
    });
    return order.map(function (k) {
      var t = tally[k]; t.total = t.g + t.s + t.b; return t;
    }).sort(function (a, b) {
      return (b.g - a.g) || (b.s - a.s) || (b.b - a.b) ||
        (order.indexOf(a.key) - order.indexOf(b.key));
    });
  }

  function chartMedals(t) {
    return '<div class="chart-medals">' +
      '<span class="cm cm-g">🥇 ' + t.g + "</span>" +
      '<span class="cm cm-s">🥈 ' + t.s + "</span>" +
      '<span class="cm cm-b">🥉 ' + t.b + "</span>" +
    "</div>";
  }

  function chart(state) {
    var s = state.settings || {};
    if (!s.chartEnabled) return null;
    var rows = medalTally(state);
    var maxTotal = rows.reduce(function (m, r) { return Math.max(m, r.total); }, 0);
    var kind = s.chartType === "columns" ? "cols" : "bars";
    var kicker = s.chartTitle || "ตารางเหรียญรางวัล";

    var head =
      '<div class="card-head">' +
        '<div class="card-kicker">' + esc(kicker) + "</div>" +
        '<div class="card-title">' + esc(meetTitleOf(state)) + "</div>" +
        logoImg(state) +
      "</div>";

    var body;
    if (maxTotal <= 0) {
      body = '<div class="card-body"><div class="live-wait">— ยังไม่มีผล —</div></div>';
    } else if (kind === "cols") {
      var cols = rows.map(function (t) {
        var h = Math.round((t.total / maxTotal) * 100);
        return '<div class="chart-col ' + compCls(state, t.key) + '"' + compStyle(state, t.key) + ">" +
          '<div class="chart-col-val">' + t.total + "</div>" +
          '<div class="chart-col-track"><div class="chart-col-bar" style="height:' + h + '%"></div></div>' +
          '<div class="chart-col-cap">' +
            houseLogoImg(state, t.key, "chart-logo") +
            '<span class="chart-name">' + esc(houseName(state, t.key)) + "</span>" +
            chartMedals(t) +
          "</div>" +
        "</div>";
      }).join("");
      body = '<div class="card-body"><div class="chart-cols">' + cols + "</div></div>";
    } else {
      var list = rows.map(function (t, i) {
        var w = Math.round((t.total / maxTotal) * 100);
        return '<div class="chart-row ' + compCls(state, t.key) + '"' + compStyle(state, t.key) + ">" +
          '<div class="chart-rank">' + (i + 1) + "</div>" +
          houseLogoImg(state, t.key, "chart-logo") +
          '<div class="chart-name">' + esc(houseName(state, t.key)) + "</div>" +
          '<div class="chart-track"><div class="chart-fill" style="width:' + w + '%">' +
            '<span class="chart-total">' + t.total + "</span></div></div>" +
          chartMedals(t) +
        "</div>";
      }).join("");
      body = '<div class="card-body"><div class="chart-list">' + list + "</div></div>";
    }

    return '<div class="card tpl-chart-card tpl-chart-' + kind + '">' + head + body + "</div>";
  }

  /* ================= CG งานทั่วไป (general) — Lower Third generator =========
     ผลิตภัณฑ์ "งานทั่วไป": operator พิมพ์ข้อความสด สั่งขึ้น/ลงจาก /control
     ทั้ง 3 ฟังก์ชันรับ conf = object ของ onair[slot] ({template,line1,line2,visible})
     - genLowerName  : ช่อง lower — ชื่อ (line1) + ตำแหน่ง/คำบรรยาย (line2)
     - genLowerTopic : ช่อง lower — หัวข้อบรรทัดเดียว (line1)
     - genTitle      : ช่อง full  — การ์ดหัวเรื่องเต็มจอ (line1) + รอง (line2)
     คืน null เมื่อไม่มีข้อความ (slot จะไม่ขึ้น)                                */
  function genLowerName(state, conf) {
    conf = conf || {};
    var name = esc(conf.line1 || ""), role = esc(conf.line2 || "");
    if (!name && !role) return null;
    return '<div class="gen-l3 gen-l3-name">' + logoImg(state) +
      '<div class="gen-l3-bar">' +
        '<div class="gen-l3-name-txt">' + name + "</div>" +
        (role ? '<div class="gen-l3-role-txt">' + role + "</div>" : "") +
      "</div></div>";
  }
  function genLowerTopic(state, conf) {
    conf = conf || {};
    var topic = esc(conf.line1 || "");
    if (!topic) return null;
    return '<div class="gen-l3 gen-topic">' + logoImg(state) +
      '<div class="gen-topic-txt">' + topic + "</div></div>";
  }
  function genTitle(state, conf) {
    conf = conf || {};
    var head = esc(conf.line1 || ""), sub = esc(conf.line2 || "");
    if (!head && !sub) return null;
    return '<div class="card tpl-gentitle-card">' +
      '<div class="card-head">' + logoImg(state) + "</div>" +
      '<div class="card-body gen-title-body">' +
        '<div class="gen-title-h card-title big">' + head + "</div>" +
        (sub ? '<div class="gen-title-sub card-sub">' + sub + "</div>" : "") +
      "</div></div>";
  }

  /* ================= ช่อง CG ที่สอง (l3) — Lower Third / Bar แบบ custom =======
     ผลิตภัณฑ์งานกีฬา/งานทั่วไปไม่เกี่ยวกับส่วนนี้เลย — ช่องนี้มี settings/onair/items
     ของตัวเองที่ state.l3 คุมจากหน้า /cg ออกจอที่ /live/cg

     ทุก renderer รับ (l3, conf) โดย
       l3   = ก้อน state.l3 ({settings, onair, items}) — มี .settings.logo เหมือน state
       conf = ก้อน l3.onair[slot] ({type, itemId, fields, style, until, visible})
     คืน null เมื่อไม่มีเนื้อหา (ช่องจะไม่ขึ้น เหมือน gen* เดิม)

     T.L3_TYPES = ทะเบียนชนิด CG (label / ช่อง / ฟิลด์ / ปุ่มปรับแต่งที่ใช้ได้) — หน้า
     /cg, /obs และ overlay อ่านทะเบียนเดียวกันนี้ ไม่มีใครฮาร์ดโค้ดรายชื่อฟิลด์เอง     */

  var L3_GROUPS = ["พื้นฐาน", "รายการ", "เวลา", "สปอนเซอร์"];

  // ค่าที่อนุญาตของปุ่มปรับแต่ง (กันค่าแปลกปลอมหลุดไปอยู่ใน class / inline style)
  var L3_ENUM = {
    ink: ["auto", "light", "dark"],
    bg: ["solid", "grad", "glass", "none"],
    align: ["left", "center", "right"],
    size: ["sm", "md", "lg"],
    anim: ["slide", "fade", "wipe", "type"],
    font: ["seed", "charm"],
  };
  var L3_STYLE_ALL = ["accent", "ink", "bg", "align", "size", "anim", "font", "logo"];

  var L3_TYPES = {
    /* ---- ชุดพื้นฐาน + แถบวิ่ง ---- */
    name: {
      label: "ชื่อ + ตำแหน่ง", tag: "ชื่อ", group: "พื้นฐาน", slot: "lower",
      fields: [{ k: "line1", label: "ชื่อ", ph: "เช่น นายสมชาย ใจดี" },
               { k: "line2", label: "ตำแหน่ง / คำบรรยาย", ph: "เช่น ผู้อำนวยการโรงเรียน" }],
      style: L3_STYLE_ALL,
    },
    topic: {
      label: "หัวข้อ", tag: "หัวข้อ", group: "พื้นฐาน", slot: "lower",
      fields: [{ k: "line1", label: "หัวข้อ", ph: "เช่น พิธีเปิดการแข่งขัน" }],
      style: L3_STYLE_ALL,
    },
    title: {
      label: "การ์ดเต็มจอ", tag: "เต็มจอ", group: "พื้นฐาน", slot: "full",
      fields: [{ k: "line1", label: "หัวเรื่อง", ph: "เช่น การแข่งขันกีฬาสี 2568" },
               { k: "line2", label: "คำบรรยายรอง (ไม่บังคับ)", ph: "เช่น สนามกีฬากลางจังหวัด" }],
      style: ["accent", "ink", "align", "size", "anim", "font", "logo"],
    },
    nameCard: {
      label: "ชื่อ + รูป", tag: "ชื่อ+รูป", group: "พื้นฐาน", slot: "lower",
      fields: [{ k: "line1", label: "ชื่อ", ph: "เช่น นายสมชาย ใจดี" },
               { k: "line2", label: "ตำแหน่ง / คำบรรยาย", ph: "เช่น ผู้อำนวยการโรงเรียน" },
               { k: "image", label: "รูป / อวตาร", kind: "image" }],
      style: L3_STYLE_ALL,
    },
    strap: {
      label: "แถบเต็มความกว้าง", tag: "แถบ", group: "พื้นฐาน", slot: "lower",
      fields: [{ k: "label", label: "ป้ายหมวด", ph: "เช่น รายงานสด" },
               { k: "line1", label: "พาดหัว", ph: "เช่น เปิดสนามแล้ววันนี้" },
               { k: "line2", label: "บรรยายรอง (ไม่บังคับ)" }],
      style: L3_STYLE_ALL,
    },
    breaking: {
      label: "ประกาศด่วน", tag: "ด่วน", group: "พื้นฐาน", slot: "top",
      fields: [{ k: "label", label: "ป้าย", ph: "เช่น ประกาศ" },
               { k: "line1", label: "ข้อความ", ph: "เช่น เลื่อนการแข่งขันเป็น 14:00" }],
      style: ["accent", "ink", "bg", "align", "size", "anim", "font"],
    },
    ticker: {
      label: "แถบวิ่ง", tag: "แถบวิ่ง", group: "พื้นฐาน", slot: "ticker",
      fields: [{ k: "label", label: "ป้ายหัวแถบ", ph: "เช่น ประกาศ" },
               { k: "messages", label: "ข้อความ (บรรทัดละ 1 ข้อความ)", kind: "list" },
               { k: "sec", label: "ความเร็ว (วินาที/รอบ — ว่าง = ตามค่าช่อง)", kind: "num" }],
      style: ["accent", "ink", "bg", "font"],
    },

    /* ---- ชุดรายการ / คิว ---- */
    nowNext: {
      label: "กำลัง / ถัดไป", tag: "ถัดไป", group: "รายการ", slot: "lower",
      fields: [{ k: "line1", label: "กำลังแข่ง / กำลังทำ", ph: "เช่น วิ่ง 100 เมตร ชาย" },
               { k: "line2", label: "ถัดไป", ph: "เช่น วิ่ง 200 เมตร หญิง" },
               { k: "label", label: "ป้ายซ้าย (ว่าง = กำลัง)", ph: "กำลัง" },
               { k: "label2", label: "ป้ายขวา (ว่าง = ถัดไป)", ph: "ถัดไป" }],
      style: L3_STYLE_ALL,
    },
    rundown: {
      label: "ลำดับรายการ", tag: "ลำดับ", group: "รายการ", slot: "full",
      fields: [{ k: "line1", label: "หัวเรื่อง", ph: "เช่น กำหนดการวันนี้" },
               { k: "items", label: "รายการ (บรรทัดละ 1 — ใช้ | คั่นเวลา เช่น 09:00|พิธีเปิด)", kind: "list" },
               { k: "cur", label: "รายการที่กำลังทำ (ลำดับที่)", kind: "num" }],
      style: ["accent", "ink", "align", "size", "anim", "font", "logo"],
    },
    bullets: {
      label: "หัวข้อย่อย", tag: "ย่อย", group: "รายการ", slot: "full",
      fields: [{ k: "line1", label: "หัวเรื่อง", ph: "เช่น กติกาการแข่งขัน" },
               { k: "items", label: "หัวข้อย่อย (บรรทัดละ 1 ข้อ)", kind: "list" }],
      style: ["accent", "ink", "align", "size", "anim", "font", "logo"],
    },
    credits: {
      label: "เครดิตท้ายรายการ", tag: "เครดิต", group: "รายการ", slot: "full",
      fields: [{ k: "line1", label: "หัวเรื่อง", ph: "เช่น ขอขอบคุณ" },
               { k: "items", label: "รายชื่อ (บรรทัดละ 1 — ใช้ | คั่นหน้าที่ เช่น กำกับ|สมชาย)", kind: "list" },
               { k: "sec", label: "ความเร็ว (วินาที/รอบ — ว่าง = 30)", kind: "num" }],
      style: ["accent", "ink", "align", "font"],
    },

    /* ---- ชุดเวลา / นับถอยหลัง ---- */
    clock: {
      label: "นาฬิกามุมจอ", tag: "นาฬิกา", group: "เวลา", slot: "bug",
      fields: [{ k: "label", label: "ป้าย / สถานที่ (ไม่บังคับ)", ph: "เช่น สนามกีฬากลาง" },
               { k: "sec2", label: "แสดงวินาที (1 = แสดง)", kind: "num" }],
      style: ["accent", "ink", "bg", "size", "font"],
    },
    countdown: {
      label: "นับถอยหลัง", tag: "นับถอย", group: "เวลา", slot: "full",
      fields: [{ k: "line1", label: "หัวเรื่อง", ph: "เช่น เริ่มการแข่งขันใน" },
               { k: "target", label: "เวลาเป้าหมาย", kind: "datetime" },
               { k: "secs", label: "หรือ นับจากนี้ (วินาที)", kind: "num" },
               { k: "line2", label: "ข้อความเมื่อครบเวลา (ไม่บังคับ)", ph: "เช่น เริ่มแล้ว!" }],
      style: ["accent", "ink", "bg", "align", "size", "anim", "font", "logo"],
    },
    timeplace: {
      label: "แถบเวลา + สถานที่", tag: "เวลา", group: "เวลา", slot: "lower",
      fields: [{ k: "line1", label: "สถานที่ / ข้อความ", ph: "เช่น สนามกีฬากลางจังหวัด" },
               { k: "sec2", label: "แสดงวินาที (1 = แสดง)", kind: "num" }],
      style: L3_STYLE_ALL,
    },

    /* ---- ชุดสปอนเซอร์ / โลโก้ ---- */
    sponsors: {
      label: "แถบสปอนเซอร์", tag: "สปอนเซอร์", group: "สปอนเซอร์", slot: "ticker",
      fields: [{ k: "label", label: "ป้ายหัวแถบ", ph: "เช่น ผู้สนับสนุน" },
               { k: "logos", label: "โลโก้สปอนเซอร์", kind: "images" },
               { k: "sec", label: "ความเร็ว (วินาที/รอบ — ว่าง = ตามค่าช่อง)", kind: "num" }],
      style: ["accent", "ink", "bg"],
    },
    supportedBy: {
      label: "สนับสนุนโดย", tag: "สนับสนุน", group: "สปอนเซอร์", slot: "lower",
      fields: [{ k: "label", label: "ป้าย (ว่าง = สนับสนุนโดย)", ph: "สนับสนุนโดย" },
               { k: "line1", label: "ชื่อผู้สนับสนุน", ph: "เช่น บริษัท ตัวอย่าง จำกัด" },
               { k: "image", label: "โลโก้", kind: "image" }],
      style: L3_STYLE_ALL,
    },
    logobug: {
      label: "โลโก้มุมจอ", tag: "โลโก้", group: "สปอนเซอร์", slot: "bug",
      fields: [{ k: "image", label: "โลโก้ (ว่าง = โลโก้ของช่อง)", kind: "image" },
               { k: "label", label: "ข้อความใต้โลโก้ (ไม่บังคับ)" }],
      style: ["accent", "ink", "bg", "size"],
    },
  };

  // ---- helper ของช่อง L3 -------------------------------------------------- //
  // สีต้องเป็น hex เท่านั้น เพราะถูกเขียนลง inline style
  function l3Color(v, dflt) {
    var s = String(v == null ? "" : v).trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? s : dflt;
  }
  function l3Enum(key, v, dflt) {
    var list = L3_ENUM[key] || [];
    var s = String(v == null ? "" : v).trim();
    for (var i = 0; i < list.length; i++) if (list[i] === s) return s;
    return dflt;
  }
  // ข้อความหลายบรรทัด -> อาเรย์ (รับทั้ง array และ string ที่ขึ้นบรรทัดใหม่)
  function l3List(v) {
    var arr = [], out = [];
    if (v == null) return out;
    if (typeof v === "string") arr = v.split(/\r?\n/);
    else if (v.length != null) { for (var i = 0; i < v.length; i++) arr.push(v[i]); }
    for (var j = 0; j < arr.length; j++) {
      var s = String(arr[j] == null ? "" : arr[j]).trim();
      if (s) out.push(s);
    }
    return out;
  }
  function l3Num(v, dflt) {
    var n = parseFloat(v);
    return isFinite(n) ? n : dflt;
  }
  // style ของชิ้นงาน ทับค่าตั้งต้นของช่อง (l3.settings) ทับค่าตั้งต้นของระบบ
  function l3Style(l3state, style) {
    var s = (l3state && l3state.settings) || {}, st = style || {};
    function pick(k) { return (st[k] != null && st[k] !== "") ? st[k] : s[k]; }
    var accent = l3Color(pick("accent"), "#e53935");
    var inkMode = l3Enum("ink", pick("ink"), "auto");
    return {
      accent: accent,
      ink: inkMode === "auto" ? contrastInk(accent) : (inkMode === "dark" ? "#1a1a1a" : "#fff"),
      bg: l3Enum("bg", pick("bg"), "solid"),
      align: l3Enum("align", pick("align"), "left"),
      size: l3Enum("size", pick("size"), "md"),
      anim: l3Enum("anim", pick("anim"), "slide"),
      font: l3Enum("font", pick("font"), "seed"),
    };
  }
  // class + inline var ของรากกราฟิก — ทุก renderer ใช้ตัวนี้ตัวเดียว
  function l3Attrs(l3state, conf, extra) {
    var s = l3Style(l3state, conf && conf.style);
    return ' class="l3 ' + extra + " l3-bg-" + s.bg + " l3-al-" + s.align +
      " l3-sz-" + s.size + " l3-anim-" + s.anim + " l3-font-" + s.font +
      '" style="--l3-accent:' + s.accent + ";--l3-ink:" + s.ink + '"';
  }
  // โลโก้: style.logo = "off" ปิด · เป็น URL = ใช้รูปนั้น · ว่าง/"on" = โลโก้ของช่อง
  function l3LogoImg(l3state, conf, cls) {
    var v = ((conf && conf.style) || {}).logo;
    if (v === "off") return "";
    var url = (v && v !== "on") ? v : ((l3state.settings || {}).logo);
    return l3Img(url, cls || "cg-logo");
  }
  function l3Img(url, cls) {
    if (url == null || url === "") return "";
    return '<img class="' + cls + '" src="' + esc(url) +
      '" alt="" onerror="this.style.display=\'none\'">';
  }
  // ระยะเวลา -> H:MM:SS / M:SS
  function l3Dur(sec) {
    var t = Math.max(0, Math.floor(sec));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return h > 0 ? h + ":" + p(m) + ":" + p(s) : m + ":" + p(s);
  }
  // เวลาปัจจุบันแบบ 24 ชม.
  function l3Now(withSec) {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + (withSec ? ":" + p(d.getSeconds()) : "");
  }
  // เป้าหมายของชิ้นนับถอยหลัง -> epoch ms (0 = ไม่มี)
  function l3Target(f) {
    if (f.target) {
      var t = Date.parse(f.target);
      if (isFinite(t)) return t;
    }
    var secs = l3Num(f.secs, 0);
    return secs > 0 ? Date.now() + secs * 1000 : 0;
  }
  // ความเร็วแถบวิ่ง: เนื้อหายาวขึ้น = ใช้เวลามากขึ้น ความเร็วอ่านจึงคงที่
  function l3ScrollSec(l3state, f, chars, dfltKey) {
    var base = l3Num(f.sec, 0) || l3Num((l3state.settings || {})[dfltKey], 0) || 28;
    var sec = base * (Math.max(chars, 20) / 60);
    return Math.max(8, Math.min(600, Math.round(sec * 10) / 10));
  }

  // ---- renderer แต่ละชนิด ------------------------------------------------- //
  function l3Name(l3state, conf, f) {
    var a = esc(f.line1 || ""), b = esc(f.line2 || "");
    if (!a && !b) return null;
    return "<div" + l3Attrs(l3state, conf, "l3-name") + ">" + l3LogoImg(l3state, conf) +
      '<div class="l3-bar">' +
        (a ? '<div class="l3-h">' + a + "</div>" : "") +
        (b ? '<div class="l3-sub">' + b + "</div>" : "") +
      "</div></div>";
  }
  function l3Topic(l3state, conf, f) {
    var a = esc(f.line1 || "");
    if (!a) return null;
    return "<div" + l3Attrs(l3state, conf, "l3-topic") + ">" + l3LogoImg(l3state, conf) +
      '<div class="l3-bar"><div class="l3-h">' + a + "</div></div></div>";
  }
  function l3Title(l3state, conf, f) {
    var a = esc(f.line1 || ""), b = esc(f.line2 || "");
    if (!a && !b) return null;
    return "<div" + l3Attrs(l3state, conf, "card l3-card l3-titlecard") + ">" +
      '<div class="card-head">' + l3LogoImg(l3state, conf) + "</div>" +
      '<div class="card-body l3-titlebody">' +
        (a ? '<div class="card-title big l3-h">' + a + "</div>" : "") +
        (b ? '<div class="card-sub l3-sub">' + b + "</div>" : "") +
      "</div></div>";
  }
  function l3NameCard(l3state, conf, f) {
    var a = esc(f.line1 || ""), b = esc(f.line2 || "");
    if (!a && !b) return null;
    return "<div" + l3Attrs(l3state, conf, "l3-namecard") + ">" +
      (f.image ? '<div class="l3-avatar">' + l3Img(f.image, "l3-avatar-img") + "</div>" : "") +
      '<div class="l3-bar">' +
        (a ? '<div class="l3-h">' + a + "</div>" : "") +
        (b ? '<div class="l3-sub">' + b + "</div>" : "") +
      "</div>" + l3LogoImg(l3state, conf) + "</div>";
  }
  function l3Strap(l3state, conf, f) {
    var a = esc(f.line1 || ""), b = esc(f.line2 || ""), lb = esc(f.label || "");
    if (!a && !b) return null;
    return "<div" + l3Attrs(l3state, conf, "l3-strap") + ">" +
      (lb ? '<div class="l3-chip">' + lb + "</div>" : "") +
      '<div class="l3-bar">' +
        (a ? '<div class="l3-h">' + a + "</div>" : "") +
        (b ? '<div class="l3-sub">' + b + "</div>" : "") +
      "</div>" + l3LogoImg(l3state, conf) + "</div>";
  }
  function l3Breaking(l3state, conf, f) {
    var a = esc(f.line1 || "");
    if (!a) return null;
    return "<div" + l3Attrs(l3state, conf, "l3-breaking") + ">" +
      '<div class="l3-chip l3-chip-pulse">' + esc(f.label || "ประกาศ") + "</div>" +
      '<div class="l3-bar"><div class="l3-h">' + a + "</div></div></div>";
  }
  function l3Ticker(l3state, conf, f) {
    var msgs = l3List(f.messages);
    if (!msgs.length) return null;
    var chars = 0, run = "";
    for (var i = 0; i < msgs.length; i++) {
      chars += msgs[i].length + 3;
      run += (i ? '<span class="l3-tk-dot">&bull;</span>' : "") +
        '<span class="l3-tk-item">' + esc(msgs[i]) + "</span>";
    }
    run += '<span class="l3-tk-dot">&bull;</span>';
    var sec = l3ScrollSec(l3state, f, chars, "tickerSec");
    var lb = esc(f.label || "");
    // เนื้อหาซ้ำ 2 ชุด + เลื่อน -50% = วนต่อเนื่องไม่มีรอยต่อ
    return "<div" + l3Attrs(l3state, conf, "l3-ticker") + ">" +
      (lb ? '<div class="l3-tk-label">' + lb + "</div>" : "") +
      '<div class="l3-tk-win"><div class="l3-tk-track" style="animation-duration:' + sec + 's">' +
        '<span class="l3-tk-run">' + run + "</span>" +
        '<span class="l3-tk-run">' + run + "</span>" +
      "</div></div></div>";
  }
  function l3NowNext(l3state, conf, f) {
    var a = esc(f.line1 || ""), b = esc(f.line2 || "");
    if (!a && !b) return null;
    return "<div" + l3Attrs(l3state, conf, "l3-nownext") + ">" + l3LogoImg(l3state, conf) +
      '<div class="l3-bar">' +
        (a ? '<div class="l3-nn-row"><span class="l3-chip">' + esc(f.label || "กำลัง") +
             '</span><span class="l3-h">' + a + "</span></div>" : "") +
        (b ? '<div class="l3-nn-row l3-nn-next"><span class="l3-chip l3-chip-ghost">' +
             esc(f.label2 || "ถัดไป") + '</span><span class="l3-sub">' + b + "</span></div>" : "") +
      "</div></div>";
  }
  function l3Rundown(l3state, conf, f) {
    var rows = l3List(f.items);
    if (!rows.length) return null;
    var cur = l3Num(f.cur, 0), body = "";
    for (var i = 0; i < rows.length; i++) {
      var parts = rows[i].split("|");
      var t = parts.length > 1 ? parts[0].trim() : "";
      var nm = (parts.length > 1 ? parts.slice(1).join("|") : rows[i]).trim();
      body += '<div class="l3-rd-row' + (i + 1 === cur ? " l3-cur" : "") + '">' +
        '<span class="l3-rd-t">' + esc(t) + "</span>" +
        '<span class="l3-rd-n">' + esc(nm) + "</span>" +
        (i + 1 === cur ? '<span class="l3-rd-now">กำลังทำ</span>' : "") +
      "</div>";
    }
    return "<div" + l3Attrs(l3state, conf, "card l3-card l3-rundowncard") + ">" +
      '<div class="card-head"><div class="card-title">' + esc(f.line1 || "") + "</div>" +
        l3LogoImg(l3state, conf) + "</div>" +
      '<div class="card-body"><div class="l3-rd">' + body + "</div></div></div>";
  }
  function l3Bullets(l3state, conf, f) {
    var rows = l3List(f.items);
    if (!rows.length) return null;
    var body = "";
    for (var i = 0; i < rows.length; i++) {
      body += '<div class="l3-bl-row" style="animation-delay:' + (0.08 * i).toFixed(2) + 's">' +
        '<span class="l3-bl-dot"></span><span class="l3-bl-t">' + esc(rows[i]) + "</span></div>";
    }
    return "<div" + l3Attrs(l3state, conf, "card l3-card l3-bulletscard") + ">" +
      '<div class="card-head"><div class="card-title">' + esc(f.line1 || "") + "</div>" +
        l3LogoImg(l3state, conf) + "</div>" +
      '<div class="card-body"><div class="l3-bl">' + body + "</div></div></div>";
  }
  function l3Credits(l3state, conf, f) {
    var rows = l3List(f.items);
    if (!rows.length) return null;
    var body = "";
    for (var i = 0; i < rows.length; i++) {
      var parts = rows[i].split("|");
      body += parts.length > 1
        ? '<div class="l3-cr-row"><span class="l3-cr-role">' + esc(parts[0].trim()) +
          '</span><span class="l3-cr-name">' + esc(parts.slice(1).join("|").trim()) + "</span></div>"
        : '<div class="l3-cr-row l3-cr-solo">' + esc(rows[i]) + "</div>";
    }
    var sec = l3Num(f.sec, 0) || 30;
    return "<div" + l3Attrs(l3state, conf, "l3-credits") + ">" +
      '<div class="l3-cr-win"><div class="l3-cr-roll" style="animation-duration:' + sec + 's">' +
        (f.line1 ? '<div class="l3-cr-head">' + esc(f.line1) + "</div>" : "") + body +
      "</div></div></div>";
  }
  function l3Clock(l3state, conf, f) {
    var withSec = l3Num(f.sec2, 0) === 1;
    return "<div" + l3Attrs(l3state, conf, "l3-clockbug") + ">" +
      '<div class="l3-clock" data-l3clock="' + (withSec ? "1" : "0") + '">' +
        l3Now(withSec) + "</div>" +
      (f.label ? '<div class="l3-sub">' + esc(f.label) + "</div>" : "") +
    "</div>";
  }
  function l3Countdown(l3state, conf, f) {
    var target = l3Target(f);
    if (!target) return null;
    var left = Math.max(0, (target - Date.now()) / 1000);
    var done = esc(f.line2 || "");
    return "<div" + l3Attrs(l3state, conf, "card l3-card l3-cdcard") + ">" +
      '<div class="card-head"><div class="card-title">' + esc(f.line1 || "") + "</div>" +
        l3LogoImg(l3state, conf) + "</div>" +
      '<div class="card-body l3-cdbody">' +
        '<div class="l3-cd' + (left <= 0 ? " l3-ended" : "") + '" data-l3cd="' + target +
          '" data-l3done="' + done + '">' +
          (left <= 0 && done ? done : l3Dur(left)) + "</div>" +
      "</div></div>";
  }
  function l3TimePlace(l3state, conf, f) {
    var withSec = l3Num(f.sec2, 0) === 1, a = esc(f.line1 || "");
    return "<div" + l3Attrs(l3state, conf, "l3-timeplace") + ">" + l3LogoImg(l3state, conf) +
      '<div class="l3-bar">' +
        '<span class="l3-clock" data-l3clock="' + (withSec ? "1" : "0") + '">' +
          l3Now(withSec) + "</span>" +
        (a ? '<span class="l3-tp-sep"></span><span class="l3-h">' + a + "</span>" : "") +
      "</div></div>";
  }
  function l3Sponsors(l3state, conf, f) {
    var logos = l3List(f.logos);
    if (!logos.length) return null;
    var run = "";
    for (var i = 0; i < logos.length; i++) run += l3Img(logos[i], "l3-sp-logo");
    var sec = l3ScrollSec(l3state, f, logos.length * 24, "sponsorSec");
    var lb = esc(f.label || "");
    return "<div" + l3Attrs(l3state, conf, "l3-sponsors") + ">" +
      (lb ? '<div class="l3-tk-label">' + lb + "</div>" : "") +
      '<div class="l3-tk-win"><div class="l3-tk-track" style="animation-duration:' + sec + 's">' +
        '<span class="l3-tk-run">' + run + "</span>" +
        '<span class="l3-tk-run">' + run + "</span>" +
      "</div></div></div>";
  }
  function l3SupportedBy(l3state, conf, f) {
    var a = esc(f.line1 || "");
    if (!a && !f.image) return null;
    return "<div" + l3Attrs(l3state, conf, "l3-supby") + ">" +
      '<div class="l3-bar">' +
        '<span class="l3-kicker">' + esc(f.label || "สนับสนุนโดย") + "</span>" +
        l3Img(f.image, "l3-supby-logo") +
        (a ? '<span class="l3-h">' + a + "</span>" : "") +
      "</div></div>";
  }
  function l3LogoBug(l3state, conf, f) {
    var url = f.image || ((l3state.settings || {}).logo);
    if (url == null || url === "") return null;
    return "<div" + l3Attrs(l3state, conf, "l3-logobug") + ">" +
      l3Img(url, "l3-bug-img") +
      (f.label ? '<div class="l3-sub">' + esc(f.label) + "</div>" : "") +
    "</div>";
  }

  var L3_RENDER = {
    name: l3Name, topic: l3Topic, title: l3Title, nameCard: l3NameCard,
    strap: l3Strap, breaking: l3Breaking, ticker: l3Ticker,
    nowNext: l3NowNext, rundown: l3Rundown, bullets: l3Bullets, credits: l3Credits,
    clock: l3Clock, countdown: l3Countdown, timeplace: l3TimePlace,
    sponsors: l3Sponsors, supportedBy: l3SupportedBy, logobug: l3LogoBug,
  };

  /* ทางเข้าเดียวของช่อง L3 — คืน null เมื่อชนิดไม่รู้จัก / ไม่มีเนื้อหา / หมดเวลาแล้ว */
  function l3(l3state, conf) {
    l3state = l3state || {};
    conf = conf || {};
    var fn = L3_RENDER[conf.type];
    if (!fn) return null;
    // auto-hide: until = epoch ms (0 = ไม่หมดเวลา) — ทุกจอหมดเวลาพร้อมกันเอง
    var until = l3Num(conf.until, 0);
    if (until > 0 && Date.now() >= until) return null;
    return fn(l3state, conf, conf.fields || {});
  }

  return {
    top3: top3, results: results, schedule: schedule,
    sportMatches: sportMatches, sportLive: sportLive, sportLower: sportLower,
    scoreBug: scoreBug, chart: chart, medalTally: medalTally,
    genLowerName: genLowerName, genLowerTopic: genLowerTopic, genTitle: genTitle,
    esc: esc, clockValue: clockValue, clockDur: clockDur, clockRemain: clockRemain,
    remainSec: remainSec, fmtClock: fmtClock,
    comp: comp, compMode: compMode, compKeys: compKeys,
    // ช่อง CG ที่สอง (Lower Third / Bar)
    l3: l3, L3_TYPES: L3_TYPES, L3_GROUPS: L3_GROUPS, L3_ENUM: L3_ENUM,
    l3Dur: l3Dur, l3Now: l3Now, l3List: l3List, l3Style: l3Style,
  };
})();
