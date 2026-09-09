#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CG Live — ระบบ Character Generator สำหรับถ่ายทอดสดงานกีฬาสี (กรีฑา)
ใช้ Python standard library ล้วน ไม่ต้อง pip install อะไรเลย

  python server.py [--port 8080] [--host 0.0.0.0] [--token SECRET]

  Control : http://<ip>:<port>/control     (หน้ากรอกข้อมูล / สั่งขึ้น-ลง CG)
  Overlay : http://<ip>:<port>/overlay     (ใส่ใน OBS Browser Source / vMix Web Browser)
"""
import argparse
import base64
import csv
import io
import json
import os
import queue
import re
import socket
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
DATA = os.path.join(ROOT, "data")
STATE_PATH = os.path.join(DATA, "state.json")
DEFAULT_STATE_PATH = os.path.join(DATA, "state.default.json")
DEFAULT_SCHOOL_STATE_PATH = os.path.join(DATA, "state.default.school.json")
DEFAULT_GENERAL_STATE_PATH = os.path.join(DATA, "state.default.general.json")
UPLOADS = os.path.join(DATA, "uploads")
MEDIAMTX_YML = os.path.join(ROOT, "mediamtx.yml")
MEDIAMTX_API = "http://127.0.0.1:9997/v3/paths/get/live"

# state ที่ active อยู่ที่ top-level key เหล่านี้เสมอ; setMode สลับทั้งชุด
# (โหมดที่ไม่ได้ใช้ถูกเก็บไว้ที่ STATE["parked"][<mode>])
PROFILE_KEYS = ("settings", "events", "results", "onair", "sports", "tally")
MODES = ("house", "school")

# แกน "ผลิตภัณฑ์" (settings.app) — สูงกว่าแกน mode (house/school ซึ่งเป็นแกนของงานกีฬาเท่านั้น)
#   "sports"  = CG งานกีฬา (กรีฑา + โมดูลกีฬา) — ทุกอย่างเดิม
#   "general" = CG งานทั่วไป — ตัวสร้าง Lower Third สด
# ผลิตภัณฑ์ที่ไม่ได้ใช้ถูก park ที่ STATE["parkedApp"][<app>] (คนละตัวกับ STATE["parked"] ของ mode)
APPS = ("sports", "general")
# ทุก key ที่อาจเป็นของ profile ผลิตภัณฑ์ใดผลิตภัณฑ์หนึ่ง (setApp เคลียร์ทั้งหมดก่อนโหลดชุดใหม่)
# "parked" (house/school) เป็นส่วนหนึ่งของ profile งานกีฬา จึงเดินทางไปพร้อมกันตอน park งานกีฬา
ALL_PROFILE_KEYS = ("settings", "events", "results", "onair", "sports", "tally", "parked", "lowers")


def _app_profile_keys(app):
    if app == "general":
        return ("settings", "onair", "lowers")
    return ("settings", "events", "results", "onair", "sports", "tally", "parked")


def _app_default_path(app):
    return DEFAULT_GENERAL_STATE_PATH if app == "general" else DEFAULT_STATE_PATH
MAX_UPLOAD = 2 * 1024 * 1024
UPLOAD_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}
_DATA_URL_RE = re.compile(
    r"^data:(image/(?:png|jpe?g|webp|gif|svg\+xml));base64,(.+)$", re.I | re.S
)

TOKEN = ""

STATE = {}
_state_lock = threading.RLock()
_save_timer = None

_subscribers = []          # list[queue.Queue]
_subscribers_lock = threading.Lock()

CTYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


# --------------------------------------------------------------------------- #
#  state load / save
# --------------------------------------------------------------------------- #
def _default_path_for_mode(mode):
    return DEFAULT_SCHOOL_STATE_PATH if mode == "school" else DEFAULT_STATE_PATH


def load_state():
    global STATE
    path = STATE_PATH if os.path.exists(STATE_PATH) else DEFAULT_STATE_PATH
    with open(path, encoding="utf-8") as f:
        STATE = json.load(f)
    # โหมดตั้งต้น (state เดิมทั้งหมด = โหมดสีคณะ)
    changed = False
    if "mode" not in STATE.get("settings", {}):
        STATE.setdefault("settings", {})["mode"] = "house"
        changed = True
    # ผลิตภัณฑ์ตั้งต้น (state เดิมทั้งหมด = งานกีฬา)
    if "app" not in STATE.get("settings", {}):
        STATE.setdefault("settings", {})["app"] = "sports"
        changed = True
    # ล้าง id รายการที่ซ้ำกัน (เช่นข้อมูลเก่าที่ import มาก่อนแก้ _new_id)
    # ถ้ามีการแก้ ให้เขียนไฟล์กลับทันที เพื่อไม่ให้ id ซ้ำวนกลับมาอีก
    deduped = dedupe_event_ids(STATE)
    if deduped:
        print("  [migrate] แก้ id รายการที่ซ้ำ %d รายการ" % deduped)
        changed = True
    # ย้ายโครงเก่า football เดี่ยว -> รายการ sports (โมดูลกีฬาแบบใหม่)
    if "football" in STATE and "sports" not in STATE:
        fb = STATE.pop("football") or {}
        STATE["sports"] = [{
            "key": "futsal", "name": "ฟุตซอล", "icon": "⚽",
            "points": fb.get("points", {"win": 3, "draw": 1, "loss": 0}),
            "matches": fb.get("matches", []),
        }]
        print("  [migrate] ย้าย football -> sports")
        changed = True
    # เปลี่ยนกีฬาเดิม football/ฟุตบอล -> futsal/ฟุตซอล (key + ชื่อ + ที่ onair ชี้อยู่)
    # แก้ชื่อแยกจาก key เพราะ state ที่ server.ps1 ย้ายมาก่อนจะเป็น key=futsal/name=Futsal
    for sp in STATE.get("sports", []):
        if sp.get("key") == "football":
            sp["key"] = "futsal"
            print("  [migrate] football -> futsal")
            changed = True
        if sp.get("key") == "futsal" and sp.get("name") in (
            "ฟุตบอล", "Football", "Futsal", "futsal", "", None
        ):
            sp["name"] = "ฟุตซอล"
            changed = True
    for conf in (STATE.get("onair") or {}).values():
        if isinstance(conf, dict) and conf.get("sport") == "football":
            conf["sport"] = "futsal"
            changed = True
    if changed:
        _save_now()


def _save_now():
    with _state_lock:
        blob = json.dumps(STATE, ensure_ascii=False, indent=2)
    os.makedirs(DATA, exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(blob)
    os.replace(tmp, STATE_PATH)


def save_soon():
    """debounce disk writes so a burst of edits = 1 write"""
    global _save_timer
    if _save_timer:
        _save_timer.cancel()
    _save_timer = threading.Timer(0.5, _save_now)
    _save_timer.daemon = True
    _save_timer.start()


# --------------------------------------------------------------------------- #
#  RTMP relay (MediaMTX sidecar) — read-only status for the /control UI.
#  Video never touches this server; we only parse a few values out of
#  mediamtx.yml and poll MediaMTX's localhost API for live status.
# --------------------------------------------------------------------------- #
def _relay_users(txt):
    """(publishUser, publishPass, readUser, readPass) from authInternalUsers.
    readUser is None when no external (non-localhost) read account exists."""
    m = re.search(r"(?ms)^authInternalUsers:[ \t]*\n(.*?)(?=^\S|\Z)", txt)
    sect = m.group(1) if m else ""
    pub = ("publish", "")
    rd = (None, None)
    for chunk in re.split(r"(?m)^[ \t]*-[ \t]*user:[ \t]*", sect)[1:]:
        name = chunk.split(None, 1)[0].strip() if chunk.strip() else ""
        pm = re.search(r"(?m)^[ \t]*pass:[ \t]*([^\s#]*)", chunk)
        pw = pm.group(1) if pm else ""
        localhost_only = "127.0.0.1" in chunk
        if re.search(r"action:[ \t]*publish", chunk):
            pub = (name, pw)
        elif re.search(r"action:[ \t]*read", chunk) and not localhost_only:
            rd = (name, pw)
    return pub[0], pub[1], rd[0], rd[1]


def _relay_config():
    try:
        with open(MEDIAMTX_YML, "r", encoding="utf-8") as f:
            txt = f.read()
    except OSError:
        return None
    m = re.search(r"^\s*rtmpAddress:\s*\S*?:(\d+)", txt, re.M)
    port = int(m.group(1)) if m else 1935
    pm = re.search(r"^\s*#\s*cglive-public-rtmp-port:\s*(\d+)", txt, re.M)
    public_port = int(pm.group(1)) if pm else port
    pu, pp, ru, rp = _relay_users(txt)
    dm = re.search(r"^\s*runOnAvailable:\s*.*\s(\S+)\s*$", txt, re.M)
    dest = dm.group(1) if dm else ""
    pull_key = "live?user=%s&pass=%s" % (ru, rp) if ru else "live"
    return {
        "configured": True,
        "ingestPort": port,
        "publicPort": public_port,
        "publishUser": pu,
        "publishPass": pp,
        "publishKey": "live?user=%s&pass=%s" % (pu, pp),
        "passIsDefault": pp in ("", "CHANGE_ME_PUBLISH_PASSWORD"),
        "readConfigured": bool(ru),
        "readUser": ru or "",
        "readPass": rp or "",
        "pullKey": pull_key,
        "readIsDefault": (rp or "") in ("", "CHANGE_ME_READ_PASSWORD"),
        "pushConfigured": bool(dest),
        "dest": dest,
        "destIsDefault": ("EDIT_ROOM_HOST" in dest or "EDIT_STREAM_KEY" in dest),
        "recording": bool(re.search(r"^\s*record:\s*true\b", txt, re.M)),
    }


def _relay_live():
    try:
        with urllib.request.urlopen(MEDIAMTX_API, timeout=1.0) as r:
            d = json.loads(r.read().decode("utf-8"))
    except Exception:
        return (False, None)
    src = d.get("source") or {}
    return (True, {
        "publishing": bool(d.get("ready")),
        "sourceType": src.get("type"),
        "bytesReceived": d.get("bytesReceived") or 0,
        "readers": len(d.get("readers") or []),
    })


def relay_info():
    cfg = _relay_config()
    if cfg is None:
        return {"configured": False}
    running, live = _relay_live()
    cfg["running"] = running
    cfg["live"] = live
    return cfg


def broadcast():
    with _state_lock:
        payload = json.dumps(STATE, ensure_ascii=False)
    with _subscribers_lock:
        dead = []
        for q in _subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _subscribers.remove(q)


# --------------------------------------------------------------------------- #
#  commands (mutations)
# --------------------------------------------------------------------------- #
_id_lock = threading.Lock()
_id_last = 0
_id_seq = 0


def _new_id(prefix="e"):
    # ใช้ timestamp(ms) + ตัวนับกันชน เพื่อให้ไม่ซ้ำแม้ถูกเรียกรัว ๆ ในมิลลิวินาทีเดียว
    # (เช่นตอน import CSV หลายสิบรายการในลูปเดียว)
    global _id_last, _id_seq
    with _id_lock:
        now = int(time.time() * 1000)
        if now == _id_last:
            _id_seq += 1
        else:
            _id_last = now
            _id_seq = 0
        return "%s_%d_%d" % (prefix, now, _id_seq)


def dedupe_event_ids(state):
    """ล้าง id รายการที่ซ้ำ/ว่าง ให้ไม่ซ้ำกัน (self-heal ตอนโหลด)
    เก็บ id แรกไว้เหมือนเดิม (results/onair ที่ชี้อยู่จึงยังใช้ได้) เปลี่ยนเฉพาะตัวที่ซ้ำ
    คืนค่าจำนวน id ที่ถูกแก้ — >0 = ควรบันทึกไฟล์กลับเพื่อไม่ให้กลับมาซ้ำอีก"""
    events = state.get("events") or []
    seen = set()
    changed = 0
    for ev in events:
        eid = ev.get("id")
        if eid and eid not in seen:
            seen.add(eid)
            continue
        # id ซ้ำ หรือว่าง -> สร้างใหม่ให้ไม่ชนกับที่มีอยู่ทั้งหมด
        new = _new_id("e")
        while new in seen:
            new = _new_id("e")
        ev["id"] = new
        seen.add(new)
        changed += 1
    return changed


def apply_command(cmd):
    action = cmd.get("action")
    with _state_lock:
        onair = STATE.setdefault("onair", {})

        if action == "show":
            slot = cmd["slot"]
            onair[slot] = {
                "template": cmd.get("template"),
                "eventId": cmd.get("eventId"),
                "sport": cmd.get("sport"),
                "line1": cmd.get("line1"),   # CG งานทั่วไป: ข้อความบรรทัดบน (sports ไม่ใช้)
                "line2": cmd.get("line2"),   # CG งานทั่วไป: ข้อความบรรทัดล่าง
                "visible": True,
            }
            # กราฟิกหลัก (lower/full) แสดงได้ทีละช่องเดียว — ขึ้นช่องนี้ = ซ่อนอีกช่อง
            # 'bug' (score bug) เป็นช่องอิสระ ค้างจอพร้อมกันได้ (hideAll เคลียร์ทั้งหมด)
            if slot in ("lower", "full"):
                for s_key, s_val in onair.items():
                    if s_key in ("lower", "full") and s_key != slot and isinstance(s_val, dict):
                        s_val["visible"] = False

        elif action == "hide":
            slot = cmd["slot"]
            if slot in onair:
                onair[slot]["visible"] = False

        elif action == "hideMain":
            # ซ่อนเฉพาะกราฟิกหลัก (lower/full) — score bug ค้างต่อ
            for k in ("lower", "full"):
                if isinstance(onair.get(k), dict):
                    onair[k]["visible"] = False

        elif action == "hideAll":
            for s in onair.values():
                s["visible"] = False

        elif action == "upsertEvent":
            ev = cmd["event"]
            if not ev.get("id"):
                ev["id"] = _new_id("e")
            events = STATE.setdefault("events", [])
            for i, e in enumerate(events):
                if e["id"] == ev["id"]:
                    events[i] = ev
                    break
            else:
                events.append(ev)

        elif action == "deleteEvent":
            eid = cmd["eventId"]
            STATE["events"] = [e for e in STATE.get("events", []) if e["id"] != eid]
            STATE.get("results", {}).pop(eid, None)
            for s in onair.values():
                if s.get("eventId") == eid:
                    s["eventId"] = None
                    s["visible"] = False

        elif action == "setResults":
            STATE.setdefault("results", {})[cmd["eventId"]] = cmd["results"]

        elif action == "setTally":
            STATE["tally"] = cmd["tally"]

        elif action == "addEventPointsToTally":
            eid = cmd["eventId"]
            pts = STATE.get("settings", {}).get("points", {})
            tally = STATE.setdefault("tally", {})
            for r in STATE.get("results", {}).get(eid, []):
                key = str(r.get("rank"))
                house = r.get("house")
                if house in tally and key in pts:
                    tally[house] = tally.get(house, 0) + pts[key]

        elif action == "setSettings":
            new_settings = cmd["settings"]
            # โลโก้ที่ active อ้างอยู่ "ก่อน" อัปเดต — เผื่อลบโรงเรียน/เปลี่ยนโลโก้ แล้วไฟล์เก่ากลายเป็นขยะ
            gc_candidates = _settings_upload_names(STATE.get("settings")) \
                if any(k in new_settings for k in ("schools", "logo", "houseLogos")) else set()
            STATE.setdefault("settings", {}).update(new_settings)
            _gc_uploads(gc_candidates)

        elif action == "setSport":
            # โมดูลกีฬา: control ส่งก้อนกีฬา 1 ชนิด (key เดียว) มา upsert เข้า list
            sp = cmd["sport"]
            sports = STATE.setdefault("sports", [])
            for i, s in enumerate(sports):
                if s.get("key") == sp.get("key"):
                    sports[i] = sp
                    break
            else:
                sports.append(sp)

        elif action == "deleteSport":
            key = cmd["key"]
            STATE["sports"] = [s for s in STATE.get("sports", []) if s.get("key") != key]

        elif action == "replaceState":
            STATE.clear()
            STATE.update(cmd["state"])

        elif action == "resetState":
            # รีเซ็ตเฉพาะผลิตภัณฑ์ + โหมดที่ active — คง settings.app, และ (เฉพาะงานกีฬา)
            # settings.mode + parked · parkedApp ไม่ถูกแตะเสมอ
            app = STATE.get("settings", {}).get("app") or "sports"
            mode = STATE.get("settings", {}).get("mode") or "house"
            keys = _app_profile_keys(app)
            parked = STATE.get("parked", {})
            parked_app = STATE.get("parkedApp", {})
            gc_candidates = _settings_upload_names(STATE.get("settings"))
            seed_path = _app_default_path(app) if app == "general" else _default_path_for_mode(mode)
            with open(seed_path, encoding="utf-8") as f:
                seed = json.load(f)
            for k in ALL_PROFILE_KEYS:
                STATE.pop(k, None)
            for k in keys:
                if k in seed:
                    STATE[k] = seed[k]
            STATE.setdefault("settings", {})["app"] = app
            if app == "sports":
                STATE["settings"]["mode"] = mode
                STATE["parked"] = parked
            STATE["parkedApp"] = parked_app
            _gc_uploads(gc_candidates)

        elif action == "setApp":
            new_app = cmd.get("app")
            if new_app not in APPS:
                raise ValueError("bad app: %r" % new_app)
            settings = STATE.setdefault("settings", {})
            old_app = settings.get("app") or "sports"
            if new_app != old_app:
                parked_app = STATE.setdefault("parkedApp", {})
                # snapshot ผลิตภัณฑ์ปัจจุบัน (deep copy, ตัด settings.app ออก)
                snap = json.loads(json.dumps(
                    {k: STATE[k] for k in _app_profile_keys(old_app) if k in STATE}
                ))
                snap.get("settings", {}).pop("app", None)
                parked_app[old_app] = snap
                # โหลดผลิตภัณฑ์ใหม่: จาก parkedApp ถ้ามี ไม่งั้น seed จาก default ของผลิตภัณฑ์นั้น
                if new_app in parked_app:
                    incoming = parked_app.pop(new_app)
                else:
                    with open(_app_default_path(new_app), encoding="utf-8") as f:
                        seed = json.load(f)
                    incoming = {k: seed[k] for k in _app_profile_keys(new_app) if k in seed}
                for k in ALL_PROFILE_KEYS:
                    STATE.pop(k, None)
                for k, v in incoming.items():
                    STATE[k] = v
                STATE.setdefault("settings", {})["app"] = new_app
                # สลับผลิตภัณฑ์: ซ่อนกราฟิกทุก slot กันของเก่าค้างจอ
                for s in STATE.get("onair", {}).values():
                    if isinstance(s, dict):
                        s["visible"] = False
                _save_now()

        elif action == "setLowers":
            # CG งานทั่วไป: รายการพรีเซ็ต Lower Third (whole-list replace)
            STATE["lowers"] = cmd["lowers"]

        elif action == "setMode":
            new_mode = cmd.get("mode")
            if new_mode not in MODES:
                raise ValueError("bad mode: %r" % new_mode)
            settings = STATE.setdefault("settings", {})
            old_mode = settings.get("mode") or "house"
            keep_app = settings.get("app") or "sports"   # settings swap must not drop the product axis
            if new_mode != old_mode:
                parked = STATE.setdefault("parked", {})
                # snapshot โหมดปัจจุบัน (deep copy, ตัด settings.mode ออก)
                snap = json.loads(json.dumps(
                    {k: STATE[k] for k in PROFILE_KEYS if k in STATE}
                ))
                snap.get("settings", {}).pop("mode", None)
                parked[old_mode] = snap
                # โหลดโหมดใหม่: จาก parked ถ้ามี ไม่งั้น seed จาก default
                if new_mode in parked:
                    incoming = parked.pop(new_mode)
                else:
                    with open(_default_path_for_mode(new_mode), encoding="utf-8") as f:
                        seed = json.load(f)
                    incoming = {k: seed[k] for k in PROFILE_KEYS if k in seed}
                for k in PROFILE_KEYS:
                    STATE.pop(k, None)
                for k, v in incoming.items():
                    STATE[k] = v
                STATE.setdefault("settings", {})["mode"] = new_mode
                STATE["settings"]["app"] = keep_app
                # สลับโหมด: ซ่อนกราฟิกทุก slot กันของเก่าค้างจอ
                for s in STATE.get("onair", {}).values():
                    if isinstance(s, dict):
                        s["visible"] = False
                _save_now()

        else:
            raise ValueError("unknown action: %r" % action)

    save_soon()
    broadcast()


def import_csv(kind, text):
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    fields = [(h or "").strip().lower() for h in (reader.fieldnames or [])]
    reader.fieldnames = fields

    with _state_lock:
        if kind == "events":
            events = STATE.setdefault("events", [])
            by_title = {e["title"]: e for e in events}
            seen = 0
            for row in reader:
                title = (row.get("title") or row.get("event") or "").strip()
                if not title:
                    continue
                seen += 1
                lvl = (row.get("level") or row.get("agegroup") or row.get("age") or "").strip()
                if title in by_title:
                    by_title[title]["level"] = lvl
                else:
                    ev = {"id": _new_id("e"), "title": title, "level": lvl}
                    events.append(ev)
                    by_title[title] = ev
            return {"events": seen}

        raise ValueError("unknown import kind: %r" % kind)


def _upload_name(url):
    """'/uploads/xxx.png' (หรือมี query) -> 'xxx.png'; อย่างอื่น -> None"""
    if isinstance(url, str) and url.startswith("/uploads/"):
        n = url.split("?", 1)[0].split("#", 1)[0].rsplit("/", 1)[-1].strip()
        if n and "/" not in n and "\\" not in n and n not in (".", ".."):
            return n
    return None


def _settings_upload_names(settings):
    """ชื่อไฟล์ /uploads/ ที่ settings ก้อนหนึ่งอ้างถึง (logo + houseLogos + schools[].logo)"""
    names = set()
    if not isinstance(settings, dict):
        return names
    for v in [settings.get("logo")] + list((settings.get("houseLogos") or {}).values()) + \
             [sc.get("logo") for sc in (settings.get("schools") or []) if isinstance(sc, dict)]:
        n = _upload_name(v)
        if n:
            names.add(n)
    return names


def _referenced_upload_names(state):
    """ไฟล์ /uploads/ ที่ยังถูกอ้างถึง — active, โหมดที่ park (house/school), และผลิตภัณฑ์ที่ park (parkedApp)"""
    profs = [state]
    profs += [p for p in (state.get("parked") or {}).values() if isinstance(p, dict)]
    for app_prof in (state.get("parkedApp") or {}).values():
        if isinstance(app_prof, dict):
            profs.append(app_prof)
            profs += [p for p in (app_prof.get("parked") or {}).values() if isinstance(p, dict)]
    names = set()
    for prof in profs:
        names |= _settings_upload_names(prof.get("settings"))
    return names


def _gc_uploads(candidate_names):
    """ลบไฟล์ที่เคยถูกอ้างถึง (candidate_names) แต่ตอนนี้ไม่มีใครอ้างแล้ว"""
    if not candidate_names:
        return
    still = _referenced_upload_names(STATE)
    for n in candidate_names - still:
        p = os.path.join(UPLOADS, n)
        try:
            if os.path.isfile(p) and os.path.abspath(p).startswith(os.path.abspath(UPLOADS)):
                os.remove(p)
                print("  [uploads] ลบโลโก้ที่ไม่ใช้แล้ว: %s" % n)
        except OSError:
            pass


def save_upload(data_url):
    """รับ data URL รูปภาพ base64 -> เขียนไฟล์ที่ data/uploads/ -> คืน URL /uploads/<file>"""
    m = _DATA_URL_RE.match((data_url or "").strip())
    if not m:
        raise ValueError("unsupported image type")
    mime = m.group(1).lower()
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except Exception:
        raise ValueError("bad base64 data")
    if len(raw) > MAX_UPLOAD:
        raise ValueError("file too large (max 2MB)")
    ext = UPLOAD_EXT.get(mime, ".bin")
    name = _new_id("up") + ext
    os.makedirs(UPLOADS, exist_ok=True)
    tmp = os.path.join(UPLOADS, name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(raw)
    os.replace(tmp, os.path.join(UPLOADS, name))
    return "/uploads/" + name


# --------------------------------------------------------------------------- #
#  HTTP
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CGLive"

    def log_message(self, fmt, *args):  # keep the console readable
        if "/api/events" in self.path:
            return
        print("  %s  %s" % (self.command, self.path))

    # -- helpers ---------------------------------------------------------- #
    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def _authed(self, qs):
        if not TOKEN:
            return True
        got = self.headers.get("X-Token") or (qs.get("token", [None])[0])
        return got == TOKEN

    def _serve_path(self, path):
        if not os.path.isfile(path):
            return self._send(404, "not found")
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as f:
            data = f.read()
        self._send(200, data, CTYPES.get(ext, "application/octet-stream"))

    # -- GET ------------------------------------------------------------- #
    def do_GET(self):
        u = urlparse(self.path)
        path, qs = u.path, parse_qs(u.query)

        if path == "/" or path == "/home":
            return self._serve_path(os.path.join(PUBLIC, "home.html"))
        # หน้าคุม + จดคะแนน (รวมจดคะแนนแยกกีฬา /score/<sport>)
        if path == "/control" or path == "/score" or path.startswith("/score/"):
            return self._serve_path(os.path.join(PUBLIC, "control.html"))
        # จอ Live (OBS) — /live เป็นชื่อใหม่ของ /overlay
        if path in ("/overlay", "/live"):
            return self._serve_path(os.path.join(PUBLIC, "overlay.html"))
        # จอ Scoreboard — /scoreboard (วน) และ /scoreboard/<sport> (สด)
        if path == "/board" or path == "/scoreboard" or path.startswith("/scoreboard/"):
            return self._serve_path(os.path.join(PUBLIC, "board.html"))
        if path == "/api/state":
            with _state_lock:
                body = json.dumps(STATE, ensure_ascii=False)
            return self._send(200, body, "application/json; charset=utf-8")
        if path == "/api/events":
            return self._serve_sse()
        if path == "/healthz":
            return self._send(200, "ok")
        if path == "/api/relay":
            if not self._authed(qs):
                return self._json(401, {"error": "unauthorized"})
            return self._json(200, relay_info())
        if path == "/favicon.ico":
            return self._serve_path(os.path.join(PUBLIC, "pictures", "favicon.png"))
        # โลโก้ที่อัปโหลด (เก็บที่ data/uploads/ นอก public/)
        if path.startswith("/uploads/"):
            rel = os.path.normpath(path[len("/uploads/"):].lstrip("/")).replace("\\", "/")
            full = os.path.join(UPLOADS, rel)
            if not os.path.abspath(full).startswith(os.path.abspath(UPLOADS)):
                return self._send(403, "forbidden")
            return self._serve_path(full)

        rel = os.path.normpath(path.lstrip("/")).replace("\\", "/")
        full = os.path.join(PUBLIC, rel)
        if not os.path.abspath(full).startswith(PUBLIC):
            return self._send(403, "forbidden")
        return self._serve_path(full)

    do_HEAD = do_GET

    # -- SSE ------------------------------------------------------------- #
    def _serve_sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        q = queue.Queue(maxsize=64)
        with _subscribers_lock:
            _subscribers.append(q)
        try:
            with _state_lock:
                init = json.dumps(STATE, ensure_ascii=False)
            self.wfile.write(("retry: 2000\ndata: " + init + "\n\n").encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    payload = q.get(timeout=15)
                    chunk = "data: " + payload + "\n\n"
                except queue.Empty:
                    chunk = ": ping\n\n"
                self.wfile.write(chunk.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with _subscribers_lock:
                if q in _subscribers:
                    _subscribers.remove(q)

    # -- POST ---------------------------------------------------------- #
    def do_POST(self):
        u = urlparse(self.path)
        path, qs = u.path, parse_qs(u.query)
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""

        if path in ("/api/command", "/api/import", "/api/upload") and not self._authed(qs):
            return self._json(401, {"error": "unauthorized"})

        try:
            if path == "/api/command":
                apply_command(json.loads(raw.decode("utf-8")))
                return self._json(200, {"ok": True})
            if path == "/api/import":
                body = json.loads(raw.decode("utf-8"))
                info = import_csv(body["kind"], body["csv"])
                save_soon()
                broadcast()
                return self._json(200, {"ok": True, "imported": info})
            if path == "/api/upload":
                body = json.loads(raw.decode("utf-8"))
                return self._json(200, {"ok": True, "url": save_upload(body.get("dataUrl"))})
        except Exception as exc:  # noqa: BLE001 - report back to the operator
            return self._json(400, {"error": str(exc)})

        return self._send(404, "not found")


# --------------------------------------------------------------------------- #
def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def main():
    global TOKEN
    ap = argparse.ArgumentParser(description="CG Live server")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--token", default=os.environ.get("CG_TOKEN", ""))
    args = ap.parse_args()
    TOKEN = args.token

    os.makedirs(DATA, exist_ok=True)
    load_state()
    if not os.path.exists(STATE_PATH):
        _save_now()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.daemon_threads = True
    ip = lan_ip()

    line = "=" * 60
    print(line)
    print(" CG Live  —  scoreboard_athletics")
    print(line)
    print("  Control  :  http://%s:%d/control            (คุม Live)" % (ip, args.port))
    print("  Score    :  http://%s:%d/score              (จดคะแนน กรีฑา)" % (ip, args.port))
    print("     ฟุตซอล:  http://%s:%d/score/futsal       (จดคะแนน ฟุตซอล)" % (ip, args.port))
    print("     บาส   :  http://%s:%d/score/basketball   (จดคะแนน บาส)" % (ip, args.port))
    print("  Live     :  http://%s:%d/live               << ใส่ใน OBS / vMix" % (ip, args.port))
    print("  Scoreboard: http://%s:%d/scoreboard         (จอวนผลทั้งหมด)" % (ip, args.port))
    print("  สด ฟุตซอล: http://%s:%d/scoreboard/futsal   (สกอร์สด ฟุตซอล)" % (ip, args.port))
    print("     สด บาส: http://%s:%d/scoreboard/basketball (สกอร์สด บาส)" % (ip, args.port))
    print("  Local    :  http://127.0.0.1:%d/control" % args.port)
    if TOKEN:
        print("  Token   :  %s" % TOKEN)
    print(line)
    print("  Ctrl+C เพื่อหยุด")
    print(line, flush=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _save_now()
        print("\nบันทึก state แล้ว — ปิดเซิร์ฟเวอร์")


if __name__ == "__main__":
    main()
