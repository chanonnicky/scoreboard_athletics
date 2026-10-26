/* เทมเพลตเดิมทุกตัวต้องให้ผลลัพธ์ byte-equal กับก่อนแก้ (งานนี้เป็นการเพิ่มล้วน ๆ)
   เทียบ public/templates.js ปัจจุบัน กับ git show HEAD:public/templates.js */
var fs = require("fs"), cp = require("child_process");
var path = require("path");
var REPO = path.resolve(__dirname, "..").split(path.sep).join("/");

function loadT(src, tag) {
  var file = process.env.TMP + "/tpl_" + tag + ".js";
  fs.writeFileSync(file, src);
  var sandbox = { window: {} };
  var fn = new Function("window", src + "\nreturn window.T;");
  return fn(sandbox.window);
}

var curSrc = fs.readFileSync(REPO + "/public/templates.js", "utf8");
var headSrc = cp.execSync("git show HEAD:public/templates.js", { cwd: REPO, maxBuffer: 1 << 26 }).toString("utf8");

var A = loadT(curSrc, "cur");   // ปัจจุบัน
var B = loadT(headSrc, "head"); // HEAD

var st = JSON.parse(fs.readFileSync(REPO + "/data/state.json", "utf8"));

// โหมดโรงเรียน (เช็กว่าสายโรงเรียนก็ไม่เปลี่ยน)
var school = JSON.parse(JSON.stringify(st));
school.settings.mode = "school";
school.settings.houses = {};
school.settings.schools = [
  { key: "sc_a", name: "โรงเรียน ก", logo: "/uploads/a.png" },
  { key: "sc_b", name: "โรงเรียน ข", logo: "" },
];

var ev = (st.events || [])[0] || { id: "e_demo", title: "x" };
var res = (st.results || {})[ev.id] || [];

var cases = [];
function add(name, fn) { cases.push([name, fn]); }
add("results", function (T, s) { return T.results(s); });
add("top3", function (T, s) { return T.top3(s, ev, res); });
add("schedule", function (T, s) { return T.schedule(s, ev.id); });
add("chart", function (T, s) { return T.chart(s); });
add("chart-on", function (T, s) {
  var c = JSON.parse(JSON.stringify(s)); c.settings.chartEnabled = true; return T.chart(c);
});
add("sportMatches-futsal", function (T, s) { return T.sportMatches(s, "futsal"); });
add("sportLive-futsal", function (T, s) { return T.sportLive(s, "futsal"); });
add("sportLower-futsal", function (T, s) { return T.sportLower(s, "futsal"); });
add("scoreBug-futsal", function (T, s) { return T.scoreBug(s, "futsal"); });
add("sportMatches-bask", function (T, s) { return T.sportMatches(s, "basketball"); });
add("sportLive-bask", function (T, s) { return T.sportLive(s, "basketball"); });
add("genLowerName", function (T, s) { return T.genLowerName(s, { line1: "นายสมชาย", line2: "ผอ." }); });
add("genLowerTopic", function (T, s) { return T.genLowerTopic(s, { line1: "พิธีเปิด" }); });
add("genTitle", function (T, s) { return T.genTitle(s, { line1: "หัวเรื่อง", line2: "รอง" }); });
add("genLowerName-empty", function (T, s) { return T.genLowerName(s, {}); });

var bad = [], n = 0;
[["house", st], ["school", school]].forEach(function (pair) {
  var mode = pair[0], state = pair[1];
  cases.forEach(function (c) {
    var a, b;
    try { a = c[1](A, state); } catch (e) { a = "THREW:" + e.message; }
    try { b = c[1](B, state); } catch (e) { b = "THREW:" + e.message; }
    n++;
    if (String(a) !== String(b)) {
      bad.push(mode + "/" + c[0] + ":\n    cur =" + String(a).slice(0, 220) +
               "\n    HEAD=" + String(b).slice(0, 220));
    }
  });
});

// helper ที่ export อยู่เดิมต้องยังทำงานเหมือนกัน
["fmtClock", "clockDur", "clockRemain", "compMode"].forEach(function (k) {
  n++;
  if (typeof A[k] !== typeof B[k]) bad.push("export " + k + " หายไป/ชนิดเปลี่ยน");
});
n++;
if (String(A.fmtClock(125)) !== String(B.fmtClock(125))) bad.push("fmtClock ผลไม่เท่าเดิม");
n++;
if (JSON.stringify(A.medalTally(st)) !== JSON.stringify(B.medalTally(st))) bad.push("medalTally ผลไม่เท่าเดิม");

console.log("เทียบ " + n + " เคส (house + school)");
if (bad.length) {
  console.log("ไม่ byte-equal " + bad.length + " เคส:");
  bad.forEach(function (b) { console.log("  - " + b); });
  process.exit(1);
}
console.log("byte-equal ทั้งหมด OK");
