# CG Live — ระบบกราฟิกสด งานกีฬาสี (กรีฑา)

ระบบ Character Generator (CG) สำหรับถ่ายทอดสดงานกีฬาสีโรงเรียน เน้นรายการวิ่งกรีฑา
แสดงอันดับ 1–3 แยกตามสีคณะ (แดง / เขียว / เหลือง / ฟ้า) ออกได้ทั้ง **vMix และ OBS พร้อมกัน**

- เซิร์ฟเวอร์เป็น **PowerShell ล้วน** (`server.ps1`) — มีติดมากับ Windows ทุกเครื่อง ไม่ต้องติดตั้งอะไรเลย
  (มี `server.py` เวอร์ชัน Python ให้ด้วย ถ้าเครื่องมี Python — ได้ SSE เรียลไทม์เต็มรูปแบบ)
- Overlay เป็นหน้าเว็บพื้นหลังโปร่งใส ใส่เป็น Browser Source (OBS) / Web Browser (vMix)
- หน้า Control สำหรับกรอกผล/สั่งขึ้น–ลง CG — overlay อัปเดตตามอัตโนมัติ (PowerShell = polling ~0.25 วิ, Python = SSE ทันที)

```
เครื่อง B  ── start.bat ──►      http://<ip-B>:8080/overlay
                                        │
              เครื่อง A  ── OBS  ───────┤  (Browser Source, 1920×1080)
                          └─ vMix ──────┘  (Web Browser input, 1920×1080)
```

---

## เริ่มใช้งาน (เครื่อง B — เครื่องที่รันระบบ)

1. **ครั้งแรกครั้งเดียว:** ดับเบิลคลิก **`setup.bat`** → กด **Yes** ตอนถามสิทธิ์ Administrator
   (เปิดพอร์ต 8080 + firewall ให้เครื่องอื่นเข้าถึงได้)
   *ถ้าข้ามขั้นนี้ `start.bat` จะเด้ง UAC ขอสิทธิ์ให้เองในการรันครั้งแรก*
2. ดับเบิลคลิก **`start.bat`**
3. หน้าต่างจะพิมพ์ URL ออกมา เช่น
   ```
   Control :  http://192.168.1.131:8080/control
   Overlay :  http://192.168.1.131:8080/overlay   <<  ใส่ใน OBS / vMix
   ```
4. เปิด **Control** ในเบราว์เซอร์เพื่อกรอกข้อมูล

ตัวเลือกตอนสั่ง (PowerShell):
```
powershell -ExecutionPolicy Bypass -File server.ps1 -Port 8080 -Token MYSECRET
```
- `-Port` = เปลี่ยนพอร์ต (ถ้าเปลี่ยน ต้องรัน `setup.bat 9000` ด้วยพอร์ตใหม่)
- `-Token` = ถ้าตั้ง ต้องใส่ token เดียวกันในหน้า Control ก่อนจึงสั่งงานได้ (ควรตั้งเมื่อใช้ผ่านอินเทอร์เน็ต)
- `-ListenHost localhost` = ทดสอบบนเครื่องเดียว ไม่ต้องใช้ Administrator

### ใช้ Python แทน (ถ้าเครื่องมี Python 3)
```
python server.py --port 8080 --token MYSECRET
```
เวอร์ชันนี้ push ผ่าน SSE — overlay อัปเดตทันที ไม่ต้อง `setup.bat` (แต่ยังต้องเปิด firewall)
```
netsh advfirewall firewall add rule name="CG Live" dir=in action=allow protocol=TCP localport=8080
```

---

## ตั้งค่าเครื่อง A (เครื่องที่มี OBS + vMix)

ใช้ URL `http://<ip-เครื่อง-B>:8080/overlay`

### OBS
Sources → ➕ → **Browser**
- URL: `http://<ip-B>:8080/overlay`
- Width `1920`  Height `1080`
- เอาติ๊ก **"Shutdown source when not visible"** ออก
- ไม่ต้องใส่ Custom CSS (หน้าเพจโปร่งใสอยู่แล้ว)

### vMix
Add Input → **More…** → **Web Browser**
- URL: `http://<ip-B>:8080/overlay`
- Width `1920`  Height `1080`
- ปิด **Interactive** (กันเมาส์ไปโดน)
- vMix Web Browser รองรับพื้นหลังโปร่งใส (alpha) อยู่แล้ว

> อยากได้เฉพาะบางส่วน: `…/overlay?slot=lower` (เฉพาะแถบล่าง) หรือ `…/overlay?slot=full` (เฉพาะเต็มจอ)

---

## กรณีเครือข่าย (A กับ B เชื่อมกันยังไง)

### 1) อยู่ LAN วงเดียวกัน
ใช้ IP เครื่อง B ตรง ๆ เช่น `http://192.168.1.131:8080/overlay` + เปิด firewall ตามด้านบน

### 2) คนละ subnet แต่ route ถึงกัน (LAN โรงเรียนวงใหญ่)
- ใช้ IP เครื่อง B ที่เครื่อง A มองเห็น (ถามผู้ดูแลเครือข่ายถ้าไม่แน่ใจ)
- ทดสอบก่อนงาน: บนเครื่อง A เปิด CMD แล้วพิมพ์ `curl http://<ip-B>:8080/healthz` ต้องได้คำว่า `ok`
- ถ้ามี VLAN/ไฟร์วอลล์กั้น ให้ผู้ดูแลเปิด TCP 8080 จาก subnet ของ A ไป B

### 3) คนละเน็ต / ผ่าน NAT / ผ่านอินเทอร์เน็ต / เน็ตมือถือ  →  ใช้ Tailscale
1. ติดตั้ง [Tailscale](https://tailscale.com/download) ทั้งสองเครื่อง ล็อกอินบัญชีเดียวกัน
2. แต่ละเครื่องจะได้ IP ถาวรขึ้นต้น `100.x.x.x`
3. ใน OBS/vMix ใช้ `http://100.x.x.x:8080/overlay` (x = ของเครื่อง B) — ไม่ต้องแตะ firewall/พอร์ตฟอร์เวิร์ด
4. ตั้ง token ด้วยเสมอเมื่อวิ่งข้ามอินเทอร์เน็ต (`-Token MYSECRET` / `--token MYSECRET`)

ทางเลือกอื่น: `cloudflared tunnel` เปิดพอร์ต 8080 เป็น URL HTTPS สาธารณะ (เหมาะเมื่อ operator อยู่คนละที่กับทั้ง A และ B)

### ถ้า overlay ไม่อัปเดต (บางเครือข่าย/พร็อกซีบล็อก SSE)
ใช้ `http://<ip-B>:8080/overlay?transport=poll` แทน — จะดึงข้อมูลใหม่ทุก ~0.5 วินาที

---

## การใช้งานหน้า Control

| แท็บ | ทำอะไร |
|---|---|
| **ออกอากาศ** | เลือกรายการ, กรอกผลอันดับ, กดปุ่มขึ้น/ลง CG แต่ละแบบ, ดูพรีวิวสด |
| **รายการ** | สร้าง/แก้รายการแข่ง + ผังลู่วิ่ง |
| **คะแนน** | แก้คะแนนรวมคณะสี หรือกด "บวกแต้มจากรายการ" อัตโนมัติ |
| **นำเข้า** | วาง/อัปโหลด CSV รายชื่อ และสตาร์ทลิสต์ |
| **ตั้งค่า** | สี/ชื่อคณะ, แต้มต่ออันดับ, ความเร็ว animation, ลิงก์ overlay |

**2 ช่องแสดงผล (slot):**
- `แถบล่าง` — lower-third สำหรับ "อันดับ 1–3"
- `เต็มจอ` — "แนะนำรายการ" / "ผลเต็มรายการ" / "คะแนนรวมคณะสี"

ทั้งสองช่องอยู่บน overlay อันเดียว — ตั้งใน OBS/vMix ครั้งเดียวพอ

### รูปแบบไฟล์ CSV
รายชื่อ (`roster`):
```
name,house
สมชาย ใจดี,blue
```
สตาร์ทลิสต์ (`startlist`) — แถวที่ `event` เหมือนกันจะรวมเป็นรายการเดียว:
```
event,lane,name,house
วิ่ง 100 เมตร ชาย,1,สมชาย ใจดี,blue
วิ่ง 100 เมตร ชาย,2,อนุชา แก้วมณี,red
```
`house` ใช้ค่า `red` / `green` / `yellow` / `blue`
ไฟล์ตัวอย่างอยู่ใน `data/roster.sample.csv` และ `data/startlist.sample.csv`

---

## โครงสร้างไฟล์
```
server.ps1                เซิร์ฟเวอร์ PowerShell (ค่าเริ่มต้น)
server.py                 เซิร์ฟเวอร์ Python (ทางเลือก, ได้ SSE)
start.bat                 ตัวเปิด (เรียก server.ps1)
setup.bat                 ตั้งค่าพอร์ต + firewall ครั้งเดียว (ขอสิทธิ์ admin)
public/                   หน้าเว็บ overlay + control
data/state.default.json   ข้อมูลตั้งต้น (มีรายการตัวอย่าง)
data/state.json           ข้อมูลใช้งานจริง (สร้างอัตโนมัติ, ไม่เข้า git)
```

ข้อมูลถูกบันทึกลง `data/state.json` อัตโนมัติ ปิด–เปิดเซิร์ฟเวอร์ใหม่ข้อมูลไม่หาย
รีเซ็ตกลับค่าตั้งต้นได้จากแท็บ "ตั้งค่า"

## ฟอนต์
ดีฟอลต์ใช้ฟอนต์ "Kanit" จาก Google Fonts (ต้องมีเน็ต) — ถ้าไม่มีเน็ตจะ fallback เป็นฟอนต์ระบบ
วิธีฝังฟอนต์ให้ใช้ออฟไลน์: ดู `public/fonts/README.txt`
