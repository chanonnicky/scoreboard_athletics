/* รัน cg.js จริงบน DOM stub เพื่อตรวจว่า 3 วิวเรนเดอร์ได้ และฟอร์มของทั้ง 17 ชนิดถูกสร้างครบ */
var fs = require("fs");
var path = require("path");
var REPO = path.resolve(__dirname, "..").split(path.sep).join("/");

function El(tag) {
  this.tagName = (tag || "div").toUpperCase();
  this.children = []; this.parentNode = null; this._cls = {}; this._html = "";
  this.attrs = {}; this.value = ""; this.files = [];
  this.style = { setProperty: function () {} };
  var self = this;
  this.classList = {
    add: function () { for (var i = 0; i < arguments.length; i++) self._cls[arguments[i]] = 1; },
    remove: function () { for (var i = 0; i < arguments.length; i++) delete self._cls[arguments[i]]; },
    toggle: function (n, on) { if (on) self._cls[n] = 1; else delete self._cls[n]; },
    contains: function (n) { return !!self._cls[n]; },
  };
  this.dataset = {};
}
Object.defineProperty(El.prototype, "className", {
  get: function () { return Object.keys(this._cls).join(" "); },
  set: function (v) { this._cls = {}; String(v).split(/\s+/).forEach(function (c) { if (c) this._cls[c] = 1; }, this); },
});
Object.defineProperty(El.prototype, "innerHTML", {
  get: function () { return this._html; }, set: function (v) { this._html = String(v); },
});
Object.defineProperty(El.prototype, "textContent", {
  get: function () { return this._txt || ""; }, set: function (v) { this._txt = String(v); },
});
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this.attrs[k] == null ? null : this.attrs[k]; };
El.prototype.addEventListener = function (ev, fn) { (this._ls = this._ls || {})[ev] = fn; };
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.focus = function () {};
El.prototype.select = function () {};

var els = {};
function mkDoc() {
  els = {};
  ["panel", "toast", "token", "conn", "onairStatus", "sbToggle", "sbBackdrop", "sbNav"]
    .forEach(function (id) { els[id] = new El("div"); els[id].id = id; });
  els.token.value = "";
  return {
    getElementById: function (id) { return els[id] || null; },
    createElement: function (t) { return new El(t); },
    documentElement: new El("html"),
    body: new El("body"),
    addEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    activeElement: null,
    execCommand: function () { return true; },
  };
}

function boot(hash) {
  global.document = mkDoc();
  global.window = {
    addEventListener: function () {},
    location: { pathname: "/cg", hash: hash || "", origin: "http://127.0.0.1:8080" },
    innerWidth: 1400, innerHeight: 900,
  };
  global.location = global.window.location;
  global.history = { replaceState: function () {} };
  var store = {};
  global.localStorage = {
    getItem: function (k) { return store[k] == null ? null : store[k]; },
    setItem: function (k, v) { store[k] = String(v); },
  };
  global.setTimeout = function () { return 0; };
  global.clearTimeout = function () {};
  global.setInterval = function () { return 0; };
  global.clearInterval = function () {};
  global.EventSource = function () { throw new Error("no sse"); };
  global.fetch = function () {
    return { then: function () { return { then: function () { return { catch: function () {} }; } }; } };
  };
  global.Promise = Promise;
  global.URL = { createObjectURL: function () { return "blob:x"; }, revokeObjectURL: function () {} };
  global.Image = function () {};
  global.FileReader = function () {};
  global.confirm = function () { return true; };

  delete require.cache[require.resolve(REPO + "/public/templates.js")];
  require(REPO + "/public/templates.js");
  global.T = global.window.T;

  var src = fs.readFileSync(REPO + "/public/cg.js", "utf8")
    .replace(/\n\s*markActiveNav\(\);\s*\n\s*panel\.innerHTML[^\n]*\n\}\)\(\);\s*$/,
      "\n  window.__cg = { render: render, setState: function (s) { state = s; firstLoaded = true; }," +
      " setView: function (v) { activeView = v; }, resetUI: function () { ui = null; }," +
      " handlers: handlers, importable: importableLowers, onState: onState };\n})();\n");
  if (src.indexOf("window.__cg") < 0) throw new Error("ไม่สามารถ inject ตัวทดสอบเข้า cg.js ได้");

  new Function("window", "document", "location", "history", "T", "localStorage",
               "setTimeout", "clearTimeout", "setInterval", "clearInterval",
               "EventSource", "fetch", "Promise", "URL", "Image", "FileReader", "confirm", src)(
    global.window, global.document, global.location, global.history, global.T, global.localStorage,
    global.setTimeout, global.clearTimeout, global.setInterval, global.clearInterval,
    global.EventSource, global.fetch, global.Promise, global.URL, global.Image,
    global.FileReader, global.confirm);
  return global.window.__cg;
}

var fails = [], pass = 0;
function ck(c, m) { if (c) pass++; else fails.push(m); }

var l3seed = JSON.parse(fs.readFileSync(REPO + "/data/state.default.l3.json", "utf8"));
function mkState() {
  return {
    settings: { app: "sports", mode: "house" }, events: [], results: {}, sports: [],
    onair: {}, lowers: [
      { id: "l_1", kind: "name", line1: "นิคกี้", line2: "ทดสอบ" },
      { id: "l_2", kind: "topic", line1: "พิธี AAAA", line2: "" },
    ],
    parkedApp: { general: { lowers: [{ id: "l_3", kind: "title", line1: "เก่า", line2: "รอง" }] } },
    l3: JSON.parse(JSON.stringify(l3seed)),
  };
}

// ---------- 1) วิว live ----------
(function () {
  var cg = boot("");
  var st = mkState();
  st.l3.onair.lower = { type: "name", itemId: "b_seed_name",
                        fields: { line1: "นายสมชาย", line2: "ผอ." }, style: {}, visible: true };
  st.l3.onair.ticker = { type: "ticker", fields: { label: "ประกาศ", messages: ["ก"] },
                         style: {}, until: Date.now() + 30000, visible: true };
  cg.setState(st); cg.setView("live"); cg.render();
  var h = els.panel.innerHTML;
  ck(h.indexOf("กำลังออกอากาศ") >= 0, "live: ไม่มีการ์ดกำลังออกอากาศ");
  ck(h.indexOf("คอมโพส") >= 0, "live: ไม่มีกล่องคอมโพส");
  ck(h.indexOf("คลังชิ้นงาน") >= 0, "live: ไม่มีคลังชิ้นงาน");
  ck(h.indexOf('data-act="hide-all"') >= 0, "live: ไม่มีปุ่มลงจอทั้งหมด");
  ck(h.indexOf('data-act="hide-main"') >= 0, "live: ไม่มีปุ่มลงกราฟิกหลัก");
  // แถบสถานะต้องโชว์ครบ 5 ช่อง
  ["แถบล่าง", "เต็มจอ", "แถบบน", "แถบวิ่ง", "มุมจอ"].forEach(function (lb) {
    ck(h.indexOf(lb) >= 0, "live: แถบสถานะไม่มีช่อง " + lb);
  });
  ck(h.indexOf('data-slot="lower"') >= 0, "live: ไม่มีปุ่มลงจอของช่อง lower");
  ck(h.indexOf("cg-until") >= 0, "live: ไม่มีตัวนับถอยหลัง auto-hide");
  ck(h.indexOf("/live/cg?transport=poll") >= 0, "live: iframe พรีวิวต้องชี้ /live/cg");
  ck(h.indexOf('data-act="item-air"') >= 0, "live: การ์ดชิ้นงานต้องกดขึ้นจอได้");
  ck(h.indexOf("is-live") >= 0, "live: ชิ้นงานที่ออกอยู่ต้องติด is-live");
  ck(h.indexOf("undefined") < 0, "live: มีคำว่า undefined ใน HTML");
  ck(h.indexOf("[object") < 0, "live: มี [object Object] ใน HTML");
  // header chips
  var hh = els.onairStatus.innerHTML;
  cg.onState();
  ck(els.onairStatus.innerHTML.indexOf("chip") >= 0, "live: topbar ไม่มี chip สถานะ");
})();

// ---------- 2) ฟอร์มของทั้ง 17 ชนิด ----------
(function () {
  var cg = boot("");
  var types = Object.keys(global.T.L3_TYPES);
  types.forEach(function (type) {
    var st = mkState();
    cg.setState(st); cg.setView("live"); cg.resetUI();
    cg.handlers["type-new"]({ dataset: { type: type } });
    cg.setView("live"); cg.render();
    var h = els.panel.innerHTML;
    var meta = global.T.L3_TYPES[type];
    ck(h.indexOf('data-act="type-pick" data-type="' + type + '"') >= 0,
       type + ": ปุ่มเลือกชนิดไม่อยู่ใน seg");
    // ทุกฟิลด์ของชนิดนี้ต้องมีช่องกรอก
    meta.fields.forEach(function (fd) {
      ck(h.indexOf('data-fk="' + fd.k + '"') >= 0, type + ": ไม่มีช่องกรอก " + fd.k);
      ck(h.indexOf(global.T.esc(fd.label)) >= 0, type + ": ไม่มี label ของ " + fd.k);
    });
    // ทุกปุ่มปรับแต่งของชนิดนี้ต้องมี control
    (meta.style || []).forEach(function (k) {
      ck(h.indexOf('data-sk="' + k + '"') >= 0, type + ": ไม่มีตัวปรับแต่ง " + k);
    });
    ck(h.indexOf('data-auto="1"') >= 0, type + ": ไม่มีช่อง auto-hide");
    ck(h.indexOf("undefined") < 0, type + ": มี undefined ใน HTML");
    // ชนิดที่มีรูปต้องมีช่องอัปโหลด
    var hasImg = meta.fields.some(function (fd) { return fd.kind === "image" || fd.kind === "images"; });
    if (hasImg) ck(h.indexOf("data-upfile=") >= 0, type + ": ไม่มี input อัปโหลดรูป");
  });
})();

// ---------- 3) วิว library ----------
(function () {
  var cg = boot("#library");
  var st = mkState();
  cg.setState(st); cg.setView("library"); cg.render();
  var h = els.panel.innerHTML;
  ck(h.indexOf("คลังชิ้นงาน · 3 ชิ้น") >= 0, "library: นับจำนวนชิ้นงานผิด");
  ck(h.indexOf('data-act="item-up"') >= 0, "library: ไม่มีปุ่มเลื่อนขึ้น");
  ck(h.indexOf('data-act="item-down"') >= 0, "library: ไม่มีปุ่มเลื่อนลง");
  ck(h.indexOf('data-act="item-edit"') >= 0, "library: ไม่มีปุ่มแก้");
  ck(h.indexOf('data-act="item-del"') >= 0, "library: ไม่มีปุ่มลบ");
  ck(h.indexOf("data-libname=") >= 0, "library: ไม่มีช่องแก้ชื่อ");
  ck(h.indexOf("data-libgroup=") >= 0, "library: ไม่มีช่องแก้กลุ่ม");
  ck(h.indexOf('data-act="import-lowers"') >= 0, "library: ไม่มีปุ่มนำเข้าพรีเซ็ตงานทั่วไป");
  ck(h.indexOf("ชนิด CG ที่มีให้ใช้ · 17 ชนิด") >= 0, "library: ไม่ได้ลิสต์ชนิดครบ 17");
  // ปุ่มเลื่อนขึ้นของแถวแรกต้อง disabled
  ck(/data-act="item-up"[^>]*disabled/.test(h), "library: แถวแรกปุ่มเลื่อนขึ้นควร disabled");
  ck(h.indexOf("undefined") < 0, "library: มี undefined");

  // นำเข้าพรีเซ็ต: 3 ชิ้น (name, topic จาก lowers + title จาก parkedApp.general)
  ck(cg.importable().length === 3, "library: ควรนำเข้าได้ 3 ชิ้น แต่ได้ " + cg.importable().length);
  // ถ้ามีชิ้นที่เนื้อหาตรงกันอยู่แล้ว ต้องไม่นับซ้ำ
  var st2 = mkState();
  st2.l3.items.push({ id: "x", type: "name", fields: { line1: "นิคกี้", line2: "ทดสอบ" } });
  cg.setState(st2);
  ck(cg.importable().length === 2, "library: กันซ้ำไม่ทำงาน (ควรเหลือ 2 ได้ " + cg.importable().length + ")");
})();

// ---------- 4) วิว settings ----------
(function () {
  var cg = boot("#settings");
  var st = mkState();
  cg.setState(st); cg.setView("settings"); cg.render();
  var h = els.panel.innerHTML;
  ck(h.indexOf('data-setk="theme"') >= 0, "settings: ไม่มีตัวเลือกธีม");
  ck(h.indexOf('data-setk="accent"') >= 0, "settings: ไม่มีสีเน้นตั้งต้น");
  ck(h.indexOf('data-setk="logo"') >= 0, "settings: ไม่มีช่องโลโก้");
  ck(h.indexOf('data-setk="tickerSec"') >= 0, "settings: ไม่มีความเร็วแถบวิ่ง");
  ck(h.indexOf('data-setk="animMs"') >= 0, "settings: ไม่มี animMs");
  ck(h.indexOf("data-upsetting=") >= 0, "settings: ไม่มีอัปโหลดโลโก้");
  ck(h.indexOf("/live/cg") >= 0, "settings: ไม่มี URL จอ CG");
  ck(h.indexOf("/obs/cglive.lua") >= 0, "settings: ไม่มีลิงก์ดาวน์โหลดสคริปต์ Lua");
  ck(h.indexOf("Custom Browser Dock") >= 0, "settings: ไม่มีคำแนะนำ OBS dock");
  ck(h.indexOf('data-act="reset"') >= 0, "settings: ไม่มีปุ่มรีเซ็ต");
  ck(h.indexOf("ไม่กระทบงานกีฬา") >= 0, "settings: ควรบอกว่ารีเซ็ตไม่กระทบงานกีฬา");
  // ทุกธีมต้องอยู่ใน dropdown
  ck((h.match(/<option value="/g) || []).length >= 15, "settings: ตัวเลือกธีมไม่ครบ");
  ck(h.indexOf("undefined") < 0, "settings: มี undefined");
})();

// ---------- 5) ไม่มี state.l3 ----------
(function () {
  var cg = boot("");
  var st = mkState(); delete st.l3;
  cg.setState(st); cg.setView("live");
  var threw = null;
  try { cg.render(); } catch (e) { threw = e.message; }
  ck(threw === null, "ไม่มี l3: render ต้องไม่ throw (ได้: " + threw + ")");
  ck(els.panel.innerHTML.indexOf("ยังไม่มีช่อง") >= 0, "ไม่มี l3: ควรขึ้นข้อความแนะนำให้รีสตาร์ต");
})();

console.log("ผ่าน " + pass + " ข้อ");
if (fails.length) {
  console.log("\nไม่ผ่าน " + fails.length + " ข้อ:");
  fails.slice(0, 40).forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
}
console.log("OK ทั้งหมด");
