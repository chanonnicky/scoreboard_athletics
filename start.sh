#!/usr/bin/env bash
# เริ่ม CG Live บน macOS / Linux
# วิธีใช้:  ./start.sh              (พอร์ต 8080)
#          ./start.sh --port 9000  (กำหนดพอร์ตเอง)
set -euo pipefail

# ย้ายไปยังโฟลเดอร์ที่ไฟล์นี้อยู่ (รองรับกรณีดับเบิลคลิก / เรียกจากที่อื่น)
cd "$(dirname "$0")"

# หา Python 3
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "  ไม่พบ Python 3 — กรุณาติดตั้งก่อน (https://www.python.org/downloads/)"
  exit 1
fi

echo "  กำลังเริ่ม CG Live ..."
echo
exec "$PY" server.py "$@"
