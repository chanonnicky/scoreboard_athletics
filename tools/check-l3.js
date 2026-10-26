/* ตรวจชั้นเทมเพลตของช่อง L3 — รันด้วย VS Code Electron เป็น node */
var fs = require("fs");
var path = require("path");
var REPO = path.resolve(__dirname, "..").split(path.sep).join("/");

global.window = {};
require(REPO + "/public/templates.js");
var T = global.window.T;

var l3 = JSON.parse(fs.readFileSync(REPO + "/data/state.default.l3.json", "utf8"));

// ค่าตัวอย่างต่อชนิดฟิลด์ — ครอบทุก kind ที่ทะเบียนประกาศไว้
function sampleFor(fd, type) {
  switch (fd.kind) {
    case "list":
      return fd.k === "items"
        ? ["09:00|พิธีเปิด", "10:00|วิ่ง 100 ม.", "เดี่ยวไม่มีขีด"]
        : ["ข้อความ A", "ข้อความ B"];
    case "images": return ["/uploads/a.png", "/uploads/b.png"];
    case "image": return "/uploads/avatar.png";
    case "num": return fd.k === "cur" ? 2 : (fd.k === "sec2" ? 1 : 20);
    case "datetime": return new Date(Date.now() + 3600e3).toISOString();
    default: return "ข้อความ " + fd.k;
  }
}

var fails = [], pass = 0;
function ck(cond, msg) { if (cond) pass++; else fails.push(msg); }

var types = Object.keys(T.L3_TYPES);
console.log("ชนิดทั้งหมด: " + types.length);

// 1) ทุกชนิดต้อง render ได้ และ metadata ต้องถูกต้อง
var SLOTS = ["full", "top", "lower", "ticker", "bug"];
types.forEach(function (type) {
  var meta = T.L3_TYPES[type];
  ck(!!meta.label, type + ": ไม่มี label");
  ck(!!meta.tag, type + ": ไม่มี tag");
  ck(T.L3_GROUPS.indexOf(meta.group) >= 0, type + ": group ไม่อยู่ใน L3_GROUPS (" + meta.group + ")");
  ck(SLOTS.indexOf(meta.slot) >= 0, type + ": slot ไม่ถูกต้อง (" + meta.slot + ")");
  ck(meta.fields && meta.fields.length > 0, type + ": ไม่มี fields");
  (meta.style || []).forEach(function (k) {
    ck(["accent", "ink", "bg", "align", "size", "anim", "font", "logo"].indexOf(k) >= 0,
      type + ": style knob ไม่รู้จัก " + k);
  });

  var fields = {};
  meta.fields.forEach(function (fd) { fields[fd.k] = sampleFor(fd, type); });

  var html = T.l3(l3, { type: type, fields: fields, style: {}, visible: true });
  ck(html != null, type + ": render ได้ null ทั้งที่ fields ครบ");
  if (html == null) return;
  ck(/^<div class="l3 /.test(html), type + ': ราก HTML ไม่ได้เริ่มด้วย class="l3 "');
  ck(html.indexOf("l3-" + " ") !== 0, type + ": class ว่าง");
  ck(html.indexOf("color-mix(") < 0, type + ": มี color-mix() (CEF เก่าไม่รองรับ)");
  ck(html.indexOf("font-family") < 0, type + ": มี font-family ใน inline style");
  ck(html.indexOf("undefined") < 0, type + ": มีคำว่า undefined ใน HTML");
  ck(html.indexOf("[object") < 0, type + ": มี [object Object] ใน HTML");
  ck(/--l3-accent:#[0-9a-fA-F]{3,8};--l3-ink:#/.test(html), type + ": ไม่มี CSS var accent/ink");

  // 2) ว่างทุกฟิลด์ -> ต้องได้ null (ยกเว้น clock/logobug ที่ไม่ต้องมีข้อความ)
  // ชนิดที่มีเนื้อหาในตัวเองอยู่แล้ว (นาฬิกา / โลโก้ของช่อง) จึงไม่ต้องมีข้อความ
  var NO_TEXT_OK = { clock: 1, timeplace: 1, logobug: 1 };
  var empty = T.l3(l3, { type: type, fields: {}, style: {}, visible: true });
  if (NO_TEXT_OK[type]) ck(empty != null, type + ": ควร render ได้แม้ไม่มีข้อความ");
  else ck(empty == null, type + ": fields ว่างแล้วไม่คืน null");
});

// 3) escaping — ห้าม HTML หลุด
var XSS = '<img src=x onerror=alert(1)>';
types.forEach(function (type) {
  var meta = T.L3_TYPES[type], fields = {};
  meta.fields.forEach(function (fd) {
    fields[fd.k] = fd.kind === "list" || fd.kind === "images" ? [XSS]
      : fd.kind === "num" ? 1
      : fd.kind === "datetime" ? new Date(Date.now() + 3600e3).toISOString()
      : XSS;
  });
  var html = T.l3(l3, { type: type, fields: fields, style: {}, visible: true });
  if (html == null) return;
  // payload ต้องไม่ปรากฏเป็น markup ดิบเลย และต้องเห็นในรูปที่ escape แล้ว
  ck(html.indexOf(XSS) < 0, type + ": XSS หลุด! payload ดิบอยู่ใน HTML");
  ck(html.indexOf("<img src=x") < 0, type + ": XSS หลุด! (<img ดิบ)");
  ck(html.indexOf("&lt;img src=x") >= 0, type + ": payload ไม่ถูก escape (ไม่พบรูปแบบ &lt;img)");
  // ห้ามมี attribute ที่ถูก break ออกมา (เครื่องหมาย \" ของผู้ใช้ต้องกลายเป็น &quot;)
  ck(!/<img[^>]*src="[^"]*"[^>]*onerror=alert/.test(html), type + ": attribute ถูก break");
});

// 4) style ที่เป็นค่าแปลกปลอม ต้องไม่หลุดลง class/style
var evil = T.l3(l3, {
  type: "name", fields: { line1: "ก" },
  style: { accent: 'red;background:url(x)"', align: "left\" onload=\"x", size: "../../x",
           bg: "glass", ink: "dark", anim: "wipe", font: "charm" }, visible: true,
});
ck(evil.indexOf("url(x)") < 0, "accent ที่ไม่ใช่ hex หลุดลง inline style");
ck(evil.indexOf("onload") < 0, "align ที่เป็นค่าแปลกปลอมหลุดลง class");
ck(evil.indexOf("--l3-accent:#e53935") >= 0, "accent ที่ไม่ใช่ hex ควร fallback เป็นค่าตั้งต้น");
ck(evil.indexOf("l3-al-left") >= 0, "align ควร fallback เป็น left");
ck(evil.indexOf("l3-sz-md") >= 0, "size ควร fallback เป็น md");
ck(evil.indexOf("l3-bg-glass") >= 0, "bg glass ควรผ่าน");
ck(evil.indexOf("l3-font-charm") >= 0, "font charm ควรผ่าน");

// 5) auto-hide ด้วย until
ck(T.l3(l3, { type: "name", fields: { line1: "ก" }, until: Date.now() - 1000 }) == null,
  "until ที่เลยมาแล้ว ควรคืน null");
ck(T.l3(l3, { type: "name", fields: { line1: "ก" }, until: Date.now() + 60000 }) != null,
  "until ในอนาคต ควรยัง render");
ck(T.l3(l3, { type: "name", fields: { line1: "ก" }, until: 0 }) != null,
  "until = 0 ควรยัง render");

// 6) ชนิดไม่รู้จัก / conf ว่าง
ck(T.l3(l3, { type: "ไม่มีจริง", fields: { line1: "ก" } }) == null, "ชนิดไม่รู้จักควรคืน null");
ck(T.l3(l3, {}) == null, "conf ว่างควรคืน null");
ck(T.l3() == null, "เรียกเปล่าควรคืน null");

// 7) ชิ้นงาน seed ในไฟล์ default ต้อง render ได้จริง
l3.items.forEach(function (it) {
  var html = T.l3(l3, { type: it.type, itemId: it.id, fields: it.fields, style: it.style || {} });
  ck(html != null, "seed item " + it.id + " (" + it.type + ") render ไม่ได้");
});

// 8) ticker/credits/sponsors ต้องมี animation-duration ที่เป็นตัวเลขสมเหตุสมผล
["ticker", "sponsors", "credits"].forEach(function (type) {
  var meta = T.L3_TYPES[type], fields = {};
  meta.fields.forEach(function (fd) { fields[fd.k] = sampleFor(fd, type); });
  var html = T.l3(l3, { type: type, fields: fields, style: {} });
  var m = /animation-duration:([0-9.]+)s/.exec(html || "");
  ck(!!m, type + ": ไม่มี animation-duration");
  if (m) ck(parseFloat(m[1]) >= 8 && parseFloat(m[1]) <= 600, type + ": duration ผิดช่วง " + m[1]);
});

console.log("ผ่าน " + pass + " ข้อ");
if (fails.length) { console.log("\nไม่ผ่าน " + fails.length + " ข้อ:"); fails.forEach(function (f) { console.log("  - " + f); }); process.exit(1); }
console.log("OK ทั้งหมด");
