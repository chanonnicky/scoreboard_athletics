/* รัน summary.js จริงบน DOM stub เพื่อตรวจหน้าสรุปการแข่งขัน /summary:
   ทั้งสองโหมด, state ว่าง, งานทั่วไป, การ escape, ตารางเหรียญไม่ติดสวิตช์ chart,
   ตัวกรอง, flash เฉพาะแถวที่เปลี่ยน และหน้านี้อ่านอย่างเดียว */
var fs = require("fs");
var path = require("path");
var REPO = path.resolve(__dirname, "..");

var pass = 0, fails = [];
function ck(ok, msg) { if (ok) pass++; else fails.push(msg); }

function El(id) {
  var self = this;
  this.id = id; this.attrs = {}; this.value = ""; this.hidden = false; this.className = "";
  this._cls = {}; this._html = ""; this.textContent = ""; this._ls = {};
  this.classList = {
    add: function (n) { self._cls[n] = 1; },
    remove: function (n) { delete self._cls[n]; },
    toggle: function (n, on) { if (on) self._cls[n] = 1; else delete self._cls[n]; },
    contains: function (n) { return !!self._cls[n]; },
  };
  this.writes = 0;
}
Object.defineProperty(El.prototype, "innerHTML", {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this.writes++; },
});
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this.attrs[k] == null ? null : this.attrs[k]; };
El.prototype.addEventListener = function (ev, fn) { this._ls[ev] = fn; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.querySelector = function () { return null; };

var IDS = ["logo", "meet", "conn", "updated", "secNav", "notice", "content", "secKpis", "secLive",
           "secMedals", "athCount", "statusSeg", "levelSel", "athSort", "sportSort", "secAthletics", "secSports"];
var SRC = fs.readFileSync(path.join(REPO, "public/summary.js"), "utf8");

function boot() {
  var els = {}, requests = [], rows = [];
  IDS.forEach(function (id) { els[id] = new El(id); });
  global.window = {};
  (0, eval)(fs.readFileSync(path.join(REPO, "public/templates.js"), "utf8"));
  global.location = { search: "?transport=poll", pathname: "/summary" };
  global.document = {
    title: "", hidden: false, body: new El("body"),
    addEventListener: function () {},
    getElementById: function (id) { return els[id] || null; },
    // คืนแถว [data-k] / นาฬิกา จาก HTML ที่วางอยู่ เพื่อให้ flash และ tick ทำงานจริง
    querySelectorAll: function (sel) {
      if (sel !== "[data-k]") return [];
      rows = [];
      IDS.forEach(function (id) {
        (els[id]._html.match(/data-k="[^"]*"/g) || []).forEach(function (m) {
          var r = new El(); r.attrs["data-k"] = m.slice(8, -1).replace(/&#39;/g, "'"); rows.push(r);
        });
      });
      return rows;
    },
  };
  global.fetch = function (url, opt) {
    requests.push({ url: url, method: (opt && opt.method) || "GET" });
    return new Promise(function () {});
  };
  global.setInterval = function () { return 0; };
  global.EventSource = function () { throw new Error("ไม่ควรเปิด SSE เมื่อ transport=poll"); };

  var patched = SRC.replace(/\}\)\(\);\s*$/, "window.__sum = { apply: apply, filter: filter };\n})();");
  if (patched === SRC) throw new Error("หาบรรทัดปิด IIFE ของ summary.js ไม่เจอ");
  (0, eval)(patched);
  return { els: els, requests: requests, api: global.window.__sum, rows: function () { return rows; } };
}

function house() {
  return {
    settings: {
      mode: "house", app: "sports", meetTitle: "กีฬาสีทดสอบ", logo: "/pictures/logo.png", chartEnabled: false,
      houses: { red: "#e53935", green: "#2e9d54", yellow: "#f4c020", blue: "#1e88e5" },
      houseNames: { red: "Red", green: "Green", yellow: "Gold", blue: "Blue" }, selEventId: "e2",
    },
    events: [
      { id: "e1", title: "วิ่ง 100 เมตร", level: "ป.1" },
      { id: "e2", title: "วิ่ง 200 เมตร", level: "ป.1" },
      { id: "e3", title: "กระโดดไกล", level: "ม.1" },
    ],
    results: { e1: [{ rank: 2, house: "green" }, { rank: 1, house: "red" }, { rank: 3, house: "blue" }] },
    sports: [{
      key: "futsal", name: "ฟุตซอล", icon: "⚽", clockMin: 20, currentId: "m2", matches: [
        { id: "m1", level: "ม.1", home: "red", away: "blue", hs: 2, as: 1, done: true },
        { id: "m2", level: "ป.1", home: "green", away: "yellow", hs: 3, as: 1, done: false },
        { id: "m3", level: "ป.1", home: "red", away: "green", hs: 0, as: 0, done: false },
      ],
    }],
  };
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ---------- 1) โหมดสีคณะ ----------
(function () {
  var b = boot(), e = b.els;
  b.api.apply(house());
  ck(e.meet.textContent === "กีฬาสีทดสอบ", "house: ชื่องาน");
  ck(e.secKpis.innerHTML.indexOf("1 <small>/ 3") >= 0, "house: กรีฑามีผล 1/3");
  ck(e.secKpis.innerHTML.indexOf("1 <small>/ 3</small>") >= 0, "house: ฟุตซอลจบ 1/3");
  ck(e.secLive.innerHTML.indexOf("วิ่ง 200 เมตร") >= 0, "house: รายการที่กำลังแข่ง");
  ck(e.secLive.innerHTML.indexOf("3 : 1") >= 0, "house: คู่สดต้องโชว์สกอร์ปัจจุบัน");
  ck(e.secLive.innerHTML.indexOf("20:00") >= 0, "house: แมตช์ไม่มี clock ต้องใช้ clockMin ของกีฬา");
  ck(e.secMedals.innerHTML.indexOf("<table") >= 0, "house: ตารางเหรียญต้องแสดงแม้ chartEnabled ปิด");
  ck(e.secMedals.innerHTML.indexOf("Red") < e.secMedals.innerHTML.indexOf("Green"), "house: เรียงอันดับเหรียญ");
  ck(e.secAthletics.innerHTML.indexOf("รอผล") >= 0, "house: แถวรอผล");
  ck(e.secAthletics.innerHTML.indexOf('class="ev cur"') >= 0, "house: ไฮไลต์รายการที่กำลังแข่ง");
  ck(e.secSports.innerHTML.indexOf("จบแล้ว") >= 0 && e.secSports.innerHTML.indexOf("รอแข่ง") >= 0, "house: สถานะแมตช์");
  ck(e.secNav.innerHTML.indexOf("#sport-0") >= 0, "house: ลิงก์ไปกีฬา");
  ["secKpis", "secLive", "secMedals", "secAthletics", "secSports", "secNav"].forEach(function (id) {
    ck(e[id].innerHTML.indexOf("undefined") < 0 && e[id].innerHTML.indexOf("NaN") < 0, id + ": มี undefined/NaN");
  });
})();

// ---------- 2) โหมดโรงเรียน ----------
(function () {
  var b = boot(), e = b.els, st = house();
  st.settings.mode = "school";
  st.settings.schools = [{ key: "sa", name: "โรงเรียนเอ", logo: "/uploads/a.png" }, { key: "sb", name: "โรงเรียนบี", logo: "" }];
  st.results = { e1: [{ rank: 1, house: "sa" }] };
  st.sports[0].matches = [{ id: "m1", level: "ป.1", home: "sa", away: "sb", hs: 1, as: 0, done: true }];
  st.sports[0].currentId = null;
  b.api.apply(st);
  ck(e.secMedals.innerHTML.indexOf("โรงเรียนเอ") >= 0, "school: ชื่อโรงเรียนในตารางเหรียญ");
  ck(e.secAthletics.innerHTML.indexOf("/uploads/a.png") >= 0, "school: โลโก้โรงเรียน");
  ck(e.secSports.innerHTML.indexOf("/pictures/house-") < 0, "school: ห้ามมีโลโก้สีคณะ");
})();

// ---------- 3) state ว่าง ----------
(function () {
  var b = boot(), e = b.els, threw = null;
  try { b.api.apply({ settings: { houses: {} } }); } catch (x) { threw = x.message; }
  ck(threw === null, "ว่าง: ต้องไม่ throw (" + threw + ")");
  ck(e.secLive.innerHTML.indexOf("ยังไม่มีรายการ") >= 0, "ว่าง: ข้อความกำลังแข่ง");
  ck(e.secAthletics.innerHTML.indexOf("ยังไม่มีรายการแข่ง") >= 0, "ว่าง: ข้อความกรีฑา");
  ck(e.secSports.innerHTML.indexOf("ยังไม่มีกีฬา") >= 0, "ว่าง: ข้อความกีฬา");
})();

// ---------- 4) งานทั่วไป ----------
(function () {
  var b = boot(), e = b.els, st = house();
  st.settings.app = "general";
  b.api.apply(st);
  ck(e.content.hidden === true && e.notice.hidden === false, "general: ต้องซ่อนเนื้อหาและแจ้งข้อความ");
  st.settings.app = "sports";
  b.api.apply(st);
  ck(e.content.hidden === false && e.notice.hidden === true, "general: กลับงานกีฬาแล้วต้องแสดงเนื้อหา");
})();

// ---------- 5) escaping ----------
(function () {
  var b = boot(), e = b.els, st = house(), bad = '<img src=x onerror=alert(1)>"\'';
  st.events[0].title = bad; st.events[0].level = bad;
  st.settings.houseNames.red = bad;
  st.settings.houses.red = "red;background:url(x)";
  st.sports[0].name = bad; st.sports[0].matches[1].title = bad;
  b.api.apply(st);
  ["secLive", "secMedals", "secAthletics", "secSports", "secNav", "levelSel"].forEach(function (id) {
    ck(e[id].innerHTML.indexOf("<img src=x") < 0, id + ": ข้อความหลุดเป็น markup");
  });
  ck(e.secMedals.innerHTML.indexOf("background:url") < 0, "สีที่ไม่ใช่ hex ต้องไม่ลง inline style");
})();

// ---------- 6) ตัวกรอง ----------
(function () {
  var b = boot(), e = b.els;
  b.api.apply(house());
  e.statusSeg._ls.click({ target: { getAttribute: function () { return "wait"; } } });
  ck(e.secAthletics.innerHTML.indexOf("วิ่ง 100 เมตร") < 0, "ตัวกรองรอผล: ต้องซ่อนรายการที่มีผล");
  ck(e.secAthletics.innerHTML.indexOf("กระโดดไกล") >= 0, "ตัวกรองรอผล: ต้องเหลือรายการรอผล");
  e.statusSeg._ls.click({ target: { getAttribute: function () { return "all"; } } });
  e.levelSel._ls.change({ target: { value: "ม.1" } });
  ck(e.secAthletics.innerHTML.indexOf("วิ่ง 100 เมตร") < 0 && e.secAthletics.innerHTML.indexOf("กระโดดไกล") >= 0, "ตัวกรองระดับชั้น");
  var st = house(); st.events = st.events.slice(0, 2);
  b.api.apply(st);
  ck(b.api.filter.level === "*", "ตัวกรองระดับชั้นที่หายไปต้องกลับเป็นทั้งหมด");
})();

// ---------- 7) อัปเดตเฉพาะส่วนที่เปลี่ยน + flash ----------
(function () {
  var b = boot(), e = b.els, st = house();
  b.api.apply(st);
  ck(b.rows().length === 0, "ครั้งแรกต้องไม่ flash");
  var w = { medals: e.secMedals.writes, ath: e.secAthletics.writes, sports: e.secSports.writes };

  b.api.apply(clone(st));
  ck(e.secSports.writes === w.sports && e.secMedals.writes === w.medals, "ข้อมูลเดิมต้องไม่แตะ DOM");

  var s2 = clone(st); s2.sports[0].matches[1].hs = 4;
  b.api.apply(s2);
  ck(e.secSports.writes === w.sports + 1, "สกอร์เปลี่ยน: ต้องวาดส่วนกีฬาใหม่");
  ck(e.secAthletics.writes === w.ath, "สกอร์เปลี่ยน: ต้องไม่แตะส่วนกรีฑา");
  var hit = b.rows().filter(function (r) { return r.classList.contains("flash"); })
    .map(function (r) { return r.getAttribute("data-k"); });
  ck(hit.length === 2 && hit.every(function (k) { return k === "m:futsal:m2"; }),
    "flash ต้องโดนเฉพาะคู่ที่สกอร์เปลี่ยน (ได้: " + hit.join(",") + ")");

  var s3 = clone(s2); s3.results.e3 = [{ rank: 1, house: "yellow" }];
  b.api.apply(s3);
  hit = b.rows().filter(function (r) { return r.classList.contains("flash"); })
    .map(function (r) { return r.getAttribute("data-k"); });
  ck(hit.indexOf("e:e3") >= 0 && hit.indexOf("c:yellow") >= 0, "ผลใหม่: flash รายการและแถวเหรียญ");
  ck(hit.indexOf("e:e1") < 0, "ผลใหม่: ห้าม flash รายการอื่น");
})();

// ---------- 7b) การเรียง ----------
(function () {
  function order(html, words) {
    var at = words.map(function (w) { return html.indexOf(w); });
    return at.every(function (p, i) { return p >= 0 && (i === 0 || at[i - 1] < p); });
  }
  function clickMedal(e, key) {
    e.secMedals._ls.click({ target: { closest: function () {
      return { getAttribute: function () { return key; } };
    } } });
  }
  var b = boot(), e = b.els, st = house();
  st.results.e3 = [{ rank: 1, house: "yellow" }, { rank: 3, house: "yellow" }];
  b.api.apply(st);

  ck(e.secAthletics.innerHTML.indexOf("group-h") >= 0, "เรียงตั้งต้น: แบ่งกลุ่มระดับชั้น");
  e.athSort._ls.change({ target: { value: "title" } });
  ck(order(e.secAthletics.innerHTML, ["กระโดดไกล", "วิ่ง 100 เมตร", "วิ่ง 200 เมตร"]), "กรีฑา: เรียงชื่อ");
  ck(e.secAthletics.innerHTML.indexOf("group-h") < 0, "กรีฑา: เรียงแบบอื่นไม่แบ่งกลุ่ม");
  ck(e.secAthletics.innerHTML.indexOf('class="lv">ม.1') >= 0, "กรีฑา: เรียงแบบอื่นต้องบอกระดับชั้นในแถว");
  e.athSort._ls.change({ target: { value: "wait" } });
  ck(order(e.secAthletics.innerHTML, ["วิ่ง 200 เมตร", "วิ่ง 100 เมตร", "กระโดดไกล"]), "กรีฑา: รอผลก่อน");
  e.athSort._ls.change({ target: { value: "done" } });
  ck(order(e.secAthletics.innerHTML, ["วิ่ง 100 เมตร", "กระโดดไกล", "วิ่ง 200 เมตร"]), "กรีฑา: มีผลก่อน");
  e.levelSel._ls.change({ target: { value: "ม.1" } });
  ck(e.secAthletics.innerHTML.indexOf("วิ่ง 100 เมตร") < 0, "กรีฑา: ตัวกรองยังมีผลตอนเรียง");
  e.levelSel._ls.change({ target: { value: "*" } });
  e.athSort._ls.change({ target: { value: "seq" } });
  ck(order(e.secAthletics.innerHTML, ["วิ่ง 100 เมตร", "วิ่ง 200 เมตร", "กระโดดไกล"]), "กรีฑา: ลำดับการแข่ง");

  ck(order(e.secMedals.innerHTML, ["Red", "Gold", "Green", "Blue"]) === false ||
     e.secMedals.innerHTML.indexOf('aria-sort="ascending"') >= 0, "เหรียญ: ตั้งต้นเรียงตามอันดับ");
  clickMedal(e, "b");
  ck(e.secMedals.innerHTML.indexOf('aria-sort="descending"') >= 0, "เหรียญ: คอลัมน์ใหม่เริ่มมากไปน้อย");
  var body = e.secMedals.innerHTML.slice(e.secMedals.innerHTML.indexOf("<tbody>"));
  ck(body.indexOf("Gold") < body.indexOf("Blue") && body.indexOf("Blue") < body.indexOf("Red"), "เหรียญ: เรียงทองแดง");
  ck(/data-k="c:red"><td>2</.test(body) || /data-k="c:red"><td>1</.test(body), "เหรียญ: เลขอันดับต้องไม่เปลี่ยนตามการเรียง");
  clickMedal(e, "b");
  ck(e.secMedals.innerHTML.indexOf('aria-sort="ascending"') >= 0, "เหรียญ: กดซ้ำกลับทิศ");
  clickMedal(e, "team");
  body = e.secMedals.innerHTML.slice(e.secMedals.innerHTML.indexOf("<tbody>"));
  ck(order(body, ["Blue", "Gold", "Green", "Red"]), "เหรียญ: เรียงชื่อทีม");

  e.sportSort._ls.change({ target: { value: "live" } });
  ck(order(e.secSports.innerHTML, ["m:futsal:m2", "m:futsal:m3", "m:futsal:m1"]), "กีฬา: กำลังแข่งก่อน");
  e.sportSort._ls.change({ target: { value: "done" } });
  ck(order(e.secSports.innerHTML, ["m:futsal:m1", "m:futsal:m2", "m:futsal:m3"]), "กีฬา: จบแล้วก่อน");
  ck(e.secSports.innerHTML.indexOf("<span>ม.1</span>") >= 0, "กีฬา: เรียงแบบอื่นต้องบอกระดับชั้นในแถว");

  // ข้อมูลใหม่ระหว่างเรียงอยู่ ต้องจัดลำดับใหม่ตามการเรียงเดิม และการเรียงเองไม่ flash
  ck(b.rows().filter(function (r) { return r.classList.contains("flash"); }).length === 0, "การเรียงต้องไม่ทำให้แถว flash");
  var s2 = clone(st); s2.sports[0].matches[1].done = true;
  b.api.apply(s2);
  ck(order(e.secSports.innerHTML, ["m:futsal:m1", "m:futsal:m2", "m:futsal:m3"]), "กีฬา: อัปเดตสดแล้วยังเรียงถูก");
})();

// ---------- 7c) แบ่งตามรายการ ----------
(function () {
  function heads(html) {
    return (html.match(/group-h"><span>[^<]*/g) || []).map(function (h) { return h.slice(15); });
  }
  var b = boot(), e = b.els, st = house();
  st.events = [
    { id: "a1", title: "วิ่ง 30 เมตร", level: "ป.1" }, { id: "a2", title: "กระโดดไกล", level: "ป.1" },
    { id: "a3", title: "วิ่ง 30 เมตร", level: "ป.2" }, { id: "a4", title: "", level: "ป.2" },
  ];
  st.results = { a3: [{ rank: 1, house: "red" }] };
  st.settings.selEventId = "";
  st.sports[0].matches = [
    { id: "x1", level: "ม.1", title: "รอบชิง", home: "red", away: "blue", hs: 1, as: 0, done: true },
    { id: "x2", level: "ป.1", title: "รอบแรก", home: "red", away: "green", hs: 0, as: 0, done: false },
    { id: "x3", level: "ป.1", title: "รอบชิง", home: "green", away: "blue", hs: 0, as: 0, done: false },
    { id: "x4", level: "ป.2", title: "", home: "green", away: "yellow", hs: 0, as: 0, done: false },
  ];
  st.sports[0].currentId = null;
  b.api.apply(st);

  e.athSort._ls.change({ target: { value: "event" } });
  var h = e.secAthletics.innerHTML;
  ck(heads(h).join("|") === "กระโดดไกล|วิ่ง 30 เมตร|ไม่มีชื่อรายการ", "กรีฑา: หัวกลุ่มตามรายการ (ได้: " + heads(h).join("|") + ")");
  ck(h.indexOf("<span>1 / 2</span>") >= 0, "กรีฑา: นับผลของรายการข้ามระดับชั้น");
  ck(h.indexOf('data-k="e:a1"') < h.indexOf('data-k="e:a3"'), "กรีฑา: ในกลุ่มเรียงตามลำดับการแข่ง");
  ck(h.indexOf('class="ev-t">ป.2') >= 0, "กรีฑา: แถวในกลุ่มบอกระดับชั้น");
  e.levelSel._ls.change({ target: { value: "ป.2" } });
  ck(e.secAthletics.innerHTML.indexOf("กระโดดไกล") < 0, "กรีฑา: ตัวกรองระดับชั้นยังมีผล");
  e.levelSel._ls.change({ target: { value: "*" } });
  e.statusSeg._ls.click({ target: { getAttribute: function () { return "done"; } } });
  ck(heads(e.secAthletics.innerHTML).join("|") === "วิ่ง 30 เมตร", "กรีฑา: ตัวกรองสถานะซ่อนกลุ่มที่ไม่เหลือแถว");

  e.sportSort._ls.change({ target: { value: "event" } });
  h = e.secSports.innerHTML;
  ck(heads(h).join("|") === "รอบชิง|รอบแรก|ไม่มีชื่อรายการ", "กีฬา: หัวกลุ่มตามรายการ (ได้: " + heads(h).join("|") + ")");
  ck(h.indexOf('m:futsal:x3') < h.indexOf('m:futsal:x1'), "กีฬา: ในกลุ่มเรียงตามระดับชั้น");
  ck(h.indexOf("<span>ม.1</span>") >= 0, "กีฬา: แถวบอกระดับชั้น");
  ck((h.match(/รอบชิง/g) || []).length === 1, "กีฬา: ไม่ซ้ำชื่อรายการในแถว");
})();

// ---------- 8) อ่านอย่างเดียว ----------
(function () {
  var b = boot();
  b.api.apply(house());
  ck(b.requests.length === 1 && b.requests[0].url === "/api/state" && b.requests[0].method === "GET", "ต้องมีแค่ GET /api/state");
  ck(SRC.indexOf("/api/command") < 0 && SRC.indexOf("/api/upload") < 0, "summary.js ห้ามส่งคำสั่ง");
  ck(!/method\s*:/.test(SRC) && SRC.indexOf("X-Token") < 0, "summary.js ห้ามมี POST หรือ token");
  var html = fs.readFileSync(path.join(REPO, "public/summary.html"), "utf8");
  ck(html.indexOf("<form") < 0 && html.indexOf('type="password"') < 0, "summary.html ห้ามมีฟอร์มหรือช่อง token");
})();

console.log("ผ่าน " + pass + " ข้อ");
if (fails.length) {
  console.log("\nไม่ผ่าน " + fails.length + " ข้อ:");
  fails.slice(0, 40).forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
}
console.log("OK ทั้งหมด");
process.exit(0);
