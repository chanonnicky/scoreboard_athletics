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

  var RANK_TH = { 1: "อันดับ 1", 2: "อันดับ 2", 3: "อันดับ 3" };
  function rankLabel(r) { return RANK_TH[r] || ("อันดับ " + r); }

  function sortResults(results) {
    return (results || []).slice().sort(function (a, b) {
      return (Number(a.rank) || 99) - (Number(b.rank) || 99);
    });
  }

  function eventSub(ev) {
    return [ev.ageGroup, ev.round].filter(Boolean).map(esc).join(" &nbsp;·&nbsp; ");
  }

  /* ---- TOP 3 (lower third) — บล็อกสีคณะใหญ่ ๆ 3 อันดับ ------------- */
  function top3(state, ev, results) {
    var rows = [1, 2, 3].map(function (rank) {
      var r = (results || []).find(function (x) { return Number(x.rank) === rank; });
      if (!r) return "";
      return (
        '<div class="t3-row ' + hClass(r.house) + '">' +
          '<div class="t3-rank">' + rank + "</div>" +
          '<div class="t3-house">' + esc(houseName(state, r.house)) + "</div>" +
        "</div>"
      );
    }).join("");
    if (!rows) return null;

    var title = esc(ev.title || "");
    if (ev.ageGroup) title += " &nbsp;·&nbsp; " + esc(ev.ageGroup);
    return '<div class="t3"><div class="t3-title">' + title + "</div>" +
           '<div class="t3-list">' + rows + "</div></div>";
  }

  /* ---- INTRO — การ์ดชื่อรายการอย่างเดียว ------------------------- */
  function intro(state, ev) {
    var sub = eventSub(ev);
    return (
      '<div class="card card-intro">' +
        '<div class="card-head">' +
          '<div class="card-kicker">' + esc((state.settings && state.settings.meetTitle) || "รายการต่อไป") + "</div>" +
          '<div class="card-title big">' + esc(ev.title || "") + "</div>" +
          (sub ? '<div class="card-sub">' + sub + "</div>" : "") +
        "</div>" +
      "</div>"
    );
  }

  /* ---- ผลเต็มรายการ (full) — rank + สีคณะ ---------------------- */
  function results(state, ev, res) {
    var list = sortResults(res);
    if (!list.length) return null;
    var rows = list.map(function (r) {
      return (
        '<div class="rrow ' + hClass(r.house) + (Number(r.rank) === 1 ? " top" : "") + '">' +
          '<div class="rank">' + esc(rankLabel(r.rank)) + "</div>" +
          '<div class="rhouse">' + esc(houseName(state, r.house)) + "</div>" +
        "</div>"
      );
    }).join("");

    var sub = eventSub(ev);
    return (
      '<div class="card">' +
        '<div class="card-head">' +
          '<div class="card-kicker">ผลการแข่งขัน</div>' +
          '<div class="card-title">' + esc(ev.title || "") + "</div>" +
          (sub ? '<div class="card-sub">' + sub + "</div>" : "") +
        "</div>" +
        '<div class="card-body"><div class="rlist">' + rows + "</div></div>" +
      "</div>"
    );
  }

  /* ---- คะแนนรวมคณะสี (full) ----------------------------------- */
  function tally(state) {
    var t = state.tally || {};
    var houses = Object.keys(state.settings && state.settings.houses || t);
    var entries = houses.map(function (h) { return { house: h, score: Number(t[h]) || 0 }; });
    entries.sort(function (a, b) { return b.score - a.score; });
    var max = Math.max(1, entries[0] ? entries[0].score : 1);
    var lead = entries.length ? entries[0].score : 0;

    var rows = entries.map(function (e) {
      var pct = Math.round((e.score / max) * 100);
      var isLead = e.score === lead && lead > 0;
      return (
        '<div class="trow ' + hClass(e.house) + (isLead ? " lead" : "") + '">' +
          '<div class="tname"><span class="dot"></span>' + esc(houseName(state, e.house)) + "</div>" +
          '<div class="tbar-wrap"><div class="tbar" style="width:' + pct + '%"></div></div>' +
          '<div class="tscore">' + e.score + "</div>" +
        "</div>"
      );
    }).join("");

    return (
      '<div class="card">' +
        '<div class="card-head">' +
          '<div class="card-kicker">' + esc((state.settings && state.settings.meetTitle) || "") + "</div>" +
          '<div class="card-title">คะแนนรวมคณะสี</div>' +
        "</div>" +
        '<div class="card-body"><div class="tally">' + rows + "</div></div>" +
      "</div>"
    );
  }

  return { top3: top3, intro: intro, results: results, tally: tally, esc: esc };
})();
