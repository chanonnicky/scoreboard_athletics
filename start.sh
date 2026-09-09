#!/usr/bin/env bash
# เริ่ม CG Live บน macOS / Linux
# วิธีใช้:  ./start.sh              (พอร์ต 8080)
#          ./start.sh --port 9000  (กำหนดพอร์ตเอง)
set -euo pipefail

# ย้ายไปยังโฟลเดอร์ที่ไฟล์นี้อยู่ (รองรับกรณีดับเบิลคลิก / เรียกจากที่อื่น)
cd "$(dirname "$0")"

# หา Python 3
# บน macOS เลือก system python (/usr/bin/python3 ที่ Apple เซ็นชื่อ) ก่อนเสมอ
# เพราะ python จาก conda/homebrew เป็น unsigned — macOS Application Firewall จะบล็อก
# การเชื่อมต่อขาเข้าจากเครื่องอื่นใน wifi (เข้าจาก 127.0.0.1 ได้ แต่จาก LAN IP ไม่ได้)
if [ "$(uname)" = "Darwin" ] && [ -x /usr/bin/python3 ]; then
  PY=/usr/bin/python3
elif command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "  ไม่พบ Python 3 — กรุณาติดตั้งก่อน (https://www.python.org/downloads/)"
  exit 1
fi

# หาพอร์ตจาก argument (--port 9000 หรือ --port=9000) ค่าเริ่มต้น 8080
PORT=8080
prev=""
for arg in "$@"; do
  case "$arg" in
    --port=*) PORT="${arg#--port=}" ;;
    *) [ "$prev" = "--port" ] && PORT="$arg" ;;
  esac
  prev="$arg"
done

# เช็กว่าพอร์ตว่างไหม (ถ้ามี lsof) — แจ้งเตือนก่อนแทนที่จะโยน traceback ยาวๆ
if command -v lsof >/dev/null 2>&1; then
  PID=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -n1 || true)
  if [ -n "$PID" ]; then
    echo "  พอร์ต $PORT ถูกใช้อยู่แล้ว (PID $PID)"
    echo
    echo "  แก้ได้ 2 ทาง:"
    echo "    1) ใช้พอร์ตอื่น:   ./start.sh --port 9000"
    echo "    2) ปิดตัวที่ค้าง:  kill $PID   แล้วรัน ./start.sh ใหม่"
    echo
    exit 1
  fi
fi

# --- RTMP relay (ทางเลือก) ---------------------------------------------------
# ถ้ามี bin/mediamtx/mediamtx จะเปิด relay คู่กันไป (รับ RTMP จาก OBS หน้างาน
# แล้ว push ต่อห้องถ่ายทอดสด) แล้วปิดให้อัตโนมัติเมื่อ start.sh จบ
# หมายเหตุ: mediamtx.yml ปรับแต่งมาสำหรับ Windows เป็นหลัก (พาธ ffmpeg egress)
#          — บน mac/Linux ต้องแก้ runOnAvailable ใน mediamtx.yml เอง
RELAY_PID=""
if [ -x bin/mediamtx/mediamtx ]; then
  echo "  กำลังเริ่ม RTMP relay (MediaMTX) ..."
  bin/mediamtx/mediamtx mediamtx.yml &
  RELAY_PID=$!
  trap '[ -n "$RELAY_PID" ] && kill "$RELAY_PID" 2>/dev/null || true' EXIT
else
  echo "  [i] ไม่ได้เปิด RTMP relay (ยังไม่มี bin/mediamtx/mediamtx)"
fi
echo

echo "  กำลังเริ่ม CG Live ..."
echo
if [ -n "$RELAY_PID" ]; then
  # ต้องคง trap ไว้ จึงไม่ใช้ exec
  "$PY" server.py "$@"
else
  exec "$PY" server.py "$@"
fi
