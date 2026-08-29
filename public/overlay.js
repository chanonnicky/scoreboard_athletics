/* overlay.js — โหลดใน OBS Browser Source / vMix Web Browser
   query params:
     ?slot=both|lower|full      ช่องที่จะแสดง (ดีฟอลต์ both)
     ?scale=1.0                 ย่อ/ขยายทั้งจอ
     ?transport=sse|poll        วิธีรับข้อมูล (ดีฟอลต์ sse; ใช้ poll ถ้าเน็ตบล็อก SSE)
*/
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var view = params.get("slot") || "both";
  var scale = parseFloat(params.get("scale") || "1") || 1;
  var transport = params.get("transport") || "sse";

  var stage = document.getElementById("stage");
  stage.style.transform = "scale(" + scale + ")";

  var SLOTS = ["full", "lower"];
  var last = {}; // slot -> { template, eventId, visible }

  function animMs(state) {
    return (state.settings && state.settings.animMs) || 450;
  }

  function slotInView(name) {
    return view === "both" || view === name;
  }

  function buildTemplate(conf, state) {
    var ev = conf.eventId ? (state.events || []).find(function (e) { return e.id === conf.eventId; }) : null;
    switch (conf.template) {
      case "top3":    return ev ? T.top3(state, ev, (state.results || {})[ev.id] || []) : null;
      case "results": return ev ? T.results(state, ev, (state.results || {})[ev.id] || []) : null;
      case "intro":   return ev ? T.intro(state, ev) : null;
      case "tally":   return T.tally(state);
      default:        return null;
    }
  }

  function renderSlot(slot, conf, state) {
    var host = document.getElementById("slot-" + slot);
    var prev = last[slot] || {};
    var cur = host.querySelector(".cg:not(.out)");
    var ms = animMs(state);

    var html = conf.visible ? buildTemplate(conf, state) : null;

    // ไม่มีอะไรจะแสดง -> เอาออก
    if (html == null) {
      if (cur) {
        cur.classList.remove("in");
        cur.classList.add("out");
        var d = cur;
        setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms + 60);
      }
      last[slot] = { template: conf.template, eventId: conf.eventId, visible: false };
      return;
    }

    var sameShell = cur && prev.visible &&
      prev.template === conf.template && prev.eventId === conf.eventId;

    if (sameShell) {
      // อัปเดตข้อมูลสด ไม่ต้อง re-animate
      cur.innerHTML = html;
    } else {
      if (cur) {
        cur.classList.remove("in");
        cur.classList.add("out");
        var old = cur;
        setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, ms + 60);
      }
      var wrap = document.createElement("div");
      wrap.className = "cg tpl-" + conf.template;
      wrap.innerHTML = html;
      host.appendChild(wrap);
      void wrap.offsetWidth; // reflow
      requestAnimationFrame(function () { wrap.classList.add("in"); });
    }
    last[slot] = { template: conf.template, eventId: conf.eventId, visible: true };
  }

  function apply(state) {
    if (!state || !state.settings) return;
    window.__state = state;

    var root = document.documentElement;
    root.style.setProperty("--anim", animMs(state) + "ms");
    var houses = state.settings.houses || {};
    Object.keys(houses).forEach(function (k) {
      root.style.setProperty("--" + k, houses[k]);
    });

    SLOTS.forEach(function (slot) {
      if (!slotInView(slot)) return;
      var conf = (state.onair && state.onair[slot]) || { visible: false };
      renderSlot(slot, conf, state);
    });
  }

  // ---- connection --------------------------------------------------- //
  function setOffline(off) {
    document.body.classList.toggle("is-offline", !!off);
  }

  var polling = false;

  function startSSE() {
    var es, gotMsg = false, done = false;
    function fallback() {
      if (done) return;
      done = true;
      try { es.close(); } catch (e) {}
      startPolling();
    }
    try { es = new EventSource("/api/events"); }
    catch (e) { startPolling(); return; }

    var guard = setTimeout(function () { if (!gotMsg) fallback(); }, 2500);
    es.onopen = function () { setOffline(false); };
    es.onmessage = function (e) {
      gotMsg = true; clearTimeout(guard); setOffline(false);
      try { apply(JSON.parse(e.data)); } catch (err) { /* ignore */ }
    };
    es.onerror = function () {
      setOffline(true);
      // ถ้ายังไม่เคยได้ข้อมูลเลย = server ไม่รองรับ SSE -> เปลี่ยนไป polling
      if (!gotMsg) { clearTimeout(guard); fallback(); }
    };
  }

  function startPolling() {
    if (polling) return;
    polling = true;
    var lastText = "";
    function tick() {
      fetch("/api/state", { cache: "no-store" })
        .then(function (r) { return r.text(); })
        .then(function (txt) {
          setOffline(false);
          if (txt !== lastText) {
            lastText = txt;
            apply(JSON.parse(txt));
          }
        })
        .catch(function () { setOffline(true); });
    }
    tick();
    setInterval(tick, 250);
  }

  if (transport === "poll") startPolling();
  else startSSE();
})();
