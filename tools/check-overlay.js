/* รัน overlay.js จริงบน DOM stub เล็ก ๆ เพื่อตรวจว่า
   - ช่อง main (/live) ยังทำงานเหมือนเดิม ไม่อ่าน state.l3
   - ช่อง cg (/live/cg) อ่าน state.l3 และลง slot ถูกช่อง
   - ช่อง full/lower กันเอง · top/ticker/bug ค้างจอพร้อมกันได้
   - l3Sig เปลี่ยนตามทุกฟิลด์ (เปลี่ยน style แล้วต้อง re-render) */
var fs = require("fs");
var path = require("path");
var REPO = path.resolve(__dirname, "..").split(path.sep).join("/");

// ---------- DOM stub ---------- //
function El(tag) {
  this.tagName = (tag || "div").toUpperCase();
  this.children = [];
  this.parentNode = null;
  this._cls = {};
  this.style = { setProperty: function () {}, transform: "" };
  this._html = "";
  this.attrs = {};
  var self = this;
  this.classList = {
    add: function () { for (var i = 0; i < arguments.length; i++) self._cls[arguments[i]] = 1; },
    remove: function () { for (var i = 0; i < arguments.length; i++) delete self._cls[arguments[i]]; },
    toggle: function (n, on) { if (on) self._cls[n] = 1; else delete self._cls[n]; },
    contains: function (n) { return !!self._cls[n]; },
  };
}
Object.defineProperty(El.prototype, "className", {
  get: function () { return Object.keys(this._cls).join(" "); },
  set: function (v) { this._cls = {}; String(v).split(/\s+/).forEach(function (c) { if (c) this._cls[c] = 1; }, this); },
});
Object.defineProperty(El.prototype, "innerHTML", {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); },
});
Object.defineProperty(El.prototype, "offsetWidth", { get: function () { return 1; } });
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.removeChild = function (c) {
  var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null;
};
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this.attrs[k] == null ? null : this.attrs[k]; };
// รองรับเฉพาะ selector ที่ overlay.js ใช้จริง
El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
El.prototype.querySelectorAll = function (sel) {
  var out = [];
  function want(el) {
    if (sel === ".cg:not(.out)") return el.classList.contains("cg") && !el.classList.contains("out");
    if (sel.indexOf(".cg:not(.out) ") === 0) return false; // ไม่มี inner node ใน stub
    if (sel.charAt(0) === ".") return el.classList.contains(sel.slice(1));
    return false;
  }
  (function walk(n) {
    n.children.forEach(function (c) { if (want(c)) out.push(c); walk(c); });
  })(this);
  return out;
};

var els = {};
function mkDoc() {
  els = {};
  ["slot-full", "slot-top", "slot-lower", "slot-ticker", "slot-bug", "stage", "offline"]
    .forEach(function (id) { els[id] = new El("div"); els[id].id = id; });
  return {
    getElementById: function (id) { return els[id] || null; },
    createElement: function (tag) { return new El(tag); },
    documentElement: new El("html"),
    body: new El("body"),
    addEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
  };
}

function runOverlay(path, state) {
  global.window = {
    addEventListener: function () {},
    innerWidth: 1920, innerHeight: 1080,
    location: { search: "?transport=poll", pathname: path },
    URLSearchParams: URLSearchParams,
  };
  global.document = mkDoc();
  global.location = global.window.location;
  global.URLSearchParams = URLSearchParams;
  global.requestAnimationFrame = function (fn) { fn(); };
  global.setInterval = function () { return 0; };
  global.clearInterval = function () {};
  global.setTimeout = function (fn) { return 0; };   // ไม่ลบ node ออกจริงในเทสต์
  global.EventSource = undefined;
  global.fetch = function () { return { then: function () { return { then: function () { return { catch: function () {} }; } }; } }; };

  // templates.js ต้องโหลดใหม่ทุกครั้ง (window ใหม่)
  delete require.cache[require.resolve(REPO + "/public/templates.js")];
  require(REPO + "/public/templates.js");
  global.T = global.window.T;

  var src = fs.readFileSync(REPO + "/public/overlay.js", "utf8");
  new Function("window", "document", "location", "T", "URLSearchParams",
               "requestAnimationFrame", "setInterval", "clearInterval", "setTimeout",
               "EventSource", "fetch", src)(
    global.window, global.document, global.location, global.T, URLSearchParams,
    global.requestAnimationFrame, global.setInterval, global.clearInterval,
    global.setTimeout, global.EventSource, global.fetch);

  // overlay.js ไม่ export apply -> เรียกผ่าน poll fetch ไม่ได้ จึงยิงผ่าน window.__apply ถ้ามี
  return { apply: global.window.__applyForTest || null };
}

// overlay.js ไม่ได้ export apply() — เลยทดสอบผ่านการ "เรียก apply ทางอ้อม":
// แก้ชั่วคราวในหน่วยความจำโดย append บรรทัด export ให้ test เท่านั้น
function runOverlayWithExport(path) {
  global.window = {
    addEventListener: function () {}, innerWidth: 1920, innerHeight: 1080,
    location: { search: "?transport=poll", pathname: path },
  };
  global.document = mkDoc();
  global.requestAnimationFrame = function (fn) { fn(); };
  var timers = [];
  global.setInterval = function (fn) { timers.push(fn); return timers.length; };
  global.clearInterval = function () {};
  global.setTimeout = function () { return 0; };
  global.EventSource = undefined;
  global.fetch = function () {
    return { then: function () { return { then: function () { return { catch: function () {} }; } }; } };
  };

  delete require.cache[require.resolve(REPO + "/public/templates.js")];
  require(REPO + "/public/templates.js");

  var src = fs.readFileSync(REPO + "/public/overlay.js", "utf8");
  // แทน IIFE ท้ายไฟล์ด้วยการผูก apply ออกมาให้เทสต์
  src = src.replace(/\}\)\(\);\s*$/, "  window.__apply = apply;\n})();\n");
  new Function("window", "document", "location", "T", "URLSearchParams",
               "requestAnimationFrame", "setInterval", "clearInterval", "setTimeout",
               "EventSource", "fetch", src)(
    global.window, global.document, global.window.location, global.window.T, URLSearchParams,
    global.requestAnimationFrame, global.setInterval, global.clearInterval,
    global.setTimeout, global.EventSource, global.fetch);
  return { apply: global.window.__apply, timers: timers };
}

function slotHtml(id) {
  var host = els[id];
  if (!host) return null;
  var live = host.children.filter(function (c) {
    return c.classList.contains("cg") && !c.classList.contains("out");
  });
  return live.length ? live[live.length - 1].innerHTML : null;
}
function slotCls(id) {
  var host = els[id];
  var live = host.children.filter(function (c) {
    return c.classList.contains("cg") && !c.classList.contains("out");
  });
  return live.length ? live[live.length - 1].className : null;
}

var fails = [], pass = 0;
function ck(c, m) { if (c) pass++; else fails.push(m); }

var sportState = JSON.parse(fs.readFileSync(REPO + "/data/state.json", "utf8"));
var l3seed = JSON.parse(fs.readFileSync(REPO + "/data/state.default.l3.json", "utf8"));

// ============ 1) ช่อง main ต้องไม่สนใจ state.l3 ============
(function () {
  var o = runOverlayWithExport("/live");
  var st = JSON.parse(JSON.stringify(sportState));
  st.l3 = JSON.parse(JSON.stringify(l3seed));
  st.l3.onair.lower = { type: "name", fields: { line1: "ไม่ควรขึ้น" }, style: {}, visible: true };
  st.onair = { lower: { template: "top3", eventId: (st.events[0] || {}).id, visible: true },
               full: { visible: false } };
  o.apply(st);
  var lower = slotHtml("slot-lower");
  ck(lower != null, "main: slot-lower ควรมีกราฟิก (top3)");
  ck(lower == null || lower.indexOf("ไม่ควรขึ้น") < 0, "main: เผลอเรนเดอร์ของช่อง cg!");
  ck(lower == null || lower.indexOf("t3-") >= 0 || lower.indexOf("podium") >= 0 || lower.length > 50,
     "main: top3 ควรเรนเดอร์ได้");
  ck(slotHtml("slot-ticker") == null, "main: slot-ticker ต้องว่างเสมอ");
  ck(slotHtml("slot-top") == null, "main: slot-top ต้องว่างเสมอ");
  ck((slotCls("slot-lower") || "").indexOf("l3cg") < 0, "main: ไม่ควรมีคลาส l3cg");
})();

// ============ 2) ช่อง cg อ่าน state.l3 ============
(function () {
  var o = runOverlayWithExport("/live/cg");
  var st = JSON.parse(JSON.stringify(sportState));
  st.onair = { lower: { template: "top3", eventId: (st.events[0] || {}).id, visible: true } };
  st.l3 = JSON.parse(JSON.stringify(l3seed));
  st.l3.onair.lower = { type: "name", fields: { line1: "นายสมชาย", line2: "ผอ." }, style: {}, visible: true };
  st.l3.onair.ticker = { type: "ticker", fields: { label: "ประกาศ", messages: ["ก", "ข"] }, style: {}, visible: true };
  st.l3.onair.bug = { type: "clock", fields: { label: "สนามกลาง" }, style: {}, visible: true };
  st.l3.onair.top = { type: "breaking", fields: { label: "ด่วน", line1: "เลื่อนเวลา" }, style: {}, visible: true };
  o.apply(st);

  ck((slotHtml("slot-lower") || "").indexOf("นายสมชาย") >= 0, "cg: lower ต้องเป็น name ของ l3");
  ck((slotHtml("slot-ticker") || "").indexOf("l3-tk-track") >= 0, "cg: ticker ต้องขึ้น");
  ck((slotHtml("slot-bug") || "").indexOf("l3-clock") >= 0, "cg: bug ต้องเป็นนาฬิกา");
  ck((slotHtml("slot-top") || "").indexOf("เลื่อนเวลา") >= 0, "cg: top ต้องเป็น breaking");
  ck((slotCls("slot-lower") || "").indexOf("l3cg") >= 0, "cg: wrapper ต้องมีคลาส l3cg");
  ck((slotCls("slot-lower") || "").indexOf("l3t-name") >= 0, "cg: wrapper ต้องมีคลาส l3t-<type>");
  // ของงานกีฬาต้องไม่โผล่มาในช่อง cg
  ck((slotHtml("slot-lower") || "").indexOf("t3-head") < 0, "cg: เผลอเรนเดอร์ top3 ของงานกีฬา!");

  // ---- full/lower กันเอง (ฝั่ง client แสดงตามที่ server ตั้ง visible) ----
  st.l3.onair.lower.visible = false;
  st.l3.onair.full = { type: "title", fields: { line1: "หัวเรื่อง" }, style: {}, visible: true };
  o.apply(st);
  ck(slotHtml("slot-full") != null, "cg: full ต้องขึ้นเมื่อ visible");
  ck((slotHtml("slot-ticker") || "").indexOf("l3-tk-track") >= 0, "cg: ticker ต้องยังค้างจอ (ช่องอิสระ)");
  ck((slotHtml("slot-bug") || "").indexOf("l3-clock") >= 0, "cg: bug ต้องยังค้างจอ (ช่องอิสระ)");

  // ---- l3Sig: เปลี่ยนแค่ style ต้อง re-render ----
  st.l3.onair.full.style = { accent: "#1e88e5" };
  o.apply(st);
  ck((slotHtml("slot-full") || "").indexOf("#1e88e5") >= 0, "cg: เปลี่ยน style แล้วต้อง re-render (l3Sig)");
  // ---- เปลี่ยนค่าตั้งต้นของช่อง ก็ต้อง re-render ----
  st.l3.settings.size = "lg";
  o.apply(st);
  ck((slotHtml("slot-full") || "").indexOf("l3-sz-lg") >= 0, "cg: เปลี่ยน l3.settings ต้อง re-render");

  // ---- until ที่เลยมาแล้ว ต้องถอดออก ----
  st.l3.onair.full.until = Date.now() - 5000;
  o.apply(st);
  ck(slotHtml("slot-full") == null, "cg: until เลยเวลาแล้ว ต้องถอดกราฟิกออก");

  // ---- hide ----
  st.l3.onair.ticker.visible = false;
  o.apply(st);
  ck(slotHtml("slot-ticker") == null, "cg: ticker visible=false ต้องถอดออก");
})();

// ============ 3) ช่อง cg เมื่อยังไม่มี state.l3 ต้องไม่ระเบิด ============
(function () {
  var o = runOverlayWithExport("/live/cg");
  var st = JSON.parse(JSON.stringify(sportState));
  delete st.l3;
  var threw = null;
  try { o.apply(st); } catch (e) { threw = e.message; }
  ck(threw === null, "cg: ไม่มี state.l3 ต้องไม่ throw (ได้: " + threw + ")");
  ck(slotHtml("slot-lower") == null, "cg: ไม่มี l3 -> ไม่ขึ้นอะไร");
})();

// ============ 4) ?ch=cg ต้องได้ผลเท่ากับ path /live/cg ============
(function () {
  global.window = null;
  var o = runOverlayWithExport("/live");
  // จำลอง ?ch=cg ผ่าน search
  var o2 = (function () {
    global.window = {
      addEventListener: function () {}, innerWidth: 1920, innerHeight: 1080,
      location: { search: "?transport=poll&ch=cg", pathname: "/live" },
    };
    global.document = mkDoc();
    delete require.cache[require.resolve(REPO + "/public/templates.js")];
    require(REPO + "/public/templates.js");
    var src = fs.readFileSync(REPO + "/public/overlay.js", "utf8")
      .replace(/\}\)\(\);\s*$/, "  window.__apply = apply;\n})();\n");
    new Function("window", "document", "location", "T", "URLSearchParams",
                 "requestAnimationFrame", "setInterval", "clearInterval", "setTimeout",
                 "EventSource", "fetch", src)(
      global.window, global.document, global.window.location, global.window.T, URLSearchParams,
      function (fn) { fn(); }, function () { return 0; }, function () {}, function () { return 0; },
      undefined, function () { return { then: function () { return { then: function () { return { catch: function () {} }; } }; } }; });
    return { apply: global.window.__apply };
  })();
  var st = JSON.parse(JSON.stringify(sportState));
  st.l3 = JSON.parse(JSON.stringify(l3seed));
  st.l3.onair.lower = { type: "topic", fields: { line1: "ผ่าน query" }, style: {}, visible: true };
  o2.apply(st);
  ck((slotHtml("slot-lower") || "").indexOf("ผ่าน query") >= 0, "?ch=cg ต้องทำงานเหมือน /live/cg");
})();

console.log("ผ่าน " + pass + " ข้อ");
if (fails.length) {
  console.log("\nไม่ผ่าน " + fails.length + " ข้อ:");
  fails.forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
}
console.log("OK ทั้งหมด");
