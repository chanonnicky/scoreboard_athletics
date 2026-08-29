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
import csv
import io
import json
import os
import queue
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
DATA = os.path.join(ROOT, "data")
STATE_PATH = os.path.join(DATA, "state.json")
DEFAULT_STATE_PATH = os.path.join(DATA, "state.default.json")

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
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


# --------------------------------------------------------------------------- #
#  state load / save
# --------------------------------------------------------------------------- #
def load_state():
    global STATE
    path = STATE_PATH if os.path.exists(STATE_PATH) else DEFAULT_STATE_PATH
    with open(path, encoding="utf-8") as f:
        STATE = json.load(f)


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
def _new_id(prefix="e"):
    return "%s_%d" % (prefix, int(time.time() * 1000))


def apply_command(cmd):
    action = cmd.get("action")
    with _state_lock:
        onair = STATE.setdefault("onair", {})

        if action == "show":
            slot = cmd["slot"]
            onair[slot] = {
                "template": cmd.get("template"),
                "eventId": cmd.get("eventId"),
                "visible": True,
            }

        elif action == "hide":
            slot = cmd["slot"]
            if slot in onair:
                onair[slot]["visible"] = False

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
            STATE.setdefault("settings", {}).update(cmd["settings"])

        elif action == "replaceState":
            STATE.clear()
            STATE.update(cmd["state"])

        elif action == "resetState":
            with open(DEFAULT_STATE_PATH, encoding="utf-8") as f:
                STATE.clear()
                STATE.update(json.load(f))

        else:
            raise ValueError("unknown action: %r" % action)

    save_soon()
    broadcast()


def import_csv(kind, text):
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    fields = [(h or "").strip().lower() for h in (reader.fieldnames or [])]
    reader.fieldnames = fields

    with _state_lock:
        if kind == "roster":
            roster = []
            for i, row in enumerate(reader, 1):
                name = (row.get("name") or "").strip()
                if not name:
                    continue
                roster.append({"id": i, "name": name, "house": (row.get("house") or "").strip()})
            STATE["roster"] = roster
            return {"roster": len(roster)}

        if kind == "startlist":
            groups, order = {}, []
            for row in reader:
                title = (row.get("event") or "").strip()
                if not title:
                    continue
                if title not in groups:
                    groups[title] = []
                    order.append(title)
                lane_raw = (row.get("lane") or "").strip()
                groups[title].append({
                    "lane": int(lane_raw) if lane_raw.isdigit() else lane_raw,
                    "name": (row.get("name") or "").strip(),
                    "house": (row.get("house") or "").strip(),
                })
            events = STATE.setdefault("events", [])
            by_title = {e["title"]: e for e in events}
            for title in order:
                if title in by_title:
                    by_title[title]["lanes"] = groups[title]
                else:
                    events.append({
                        "id": _new_id("e"),
                        "title": title,
                        "ageGroup": "",
                        "round": "",
                        "lanes": groups[title],
                    })
            return {"events": len(order)}

        raise ValueError("unknown import kind: %r" % kind)


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

        if path == "/":
            return self._send(302, b"", extra={"Location": "/control"})
        if path == "/control":
            return self._serve_path(os.path.join(PUBLIC, "control.html"))
        if path == "/overlay":
            return self._serve_path(os.path.join(PUBLIC, "overlay.html"))
        if path == "/api/state":
            with _state_lock:
                body = json.dumps(STATE, ensure_ascii=False)
            return self._send(200, body, "application/json; charset=utf-8")
        if path == "/api/events":
            return self._serve_sse()
        if path == "/healthz":
            return self._send(200, "ok")

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

        if path in ("/api/command", "/api/import") and not self._authed(qs):
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
    print("  Control :  http://%s:%d/control" % (ip, args.port))
    print("  Overlay :  http://%s:%d/overlay      << ใส่ใน OBS / vMix" % (ip, args.port))
    print("  Local   :  http://127.0.0.1:%d/control" % args.port)
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
