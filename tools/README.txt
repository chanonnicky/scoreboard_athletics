tools/ — ชุดตรวจงานแบบไม่ต้องเปิดเบราว์เซอร์
=============================================

ทั้ง 4 ไฟล์เป็น plain JS รันด้วย node ธรรมดา ไม่ต้องติดตั้งอะไร ไม่มี dependency
(เขียนขึ้นตอนทำช่อง CG ที่สอง — ดูหัวข้อ "Verifying changes without a browser" ใน CLAUDE.md)

วิธีรัน
-------
  node tools/check-l3.js
  node tools/check-regress.js
  node tools/check-overlay.js
  node tools/check-cg.js

บนเครื่อง Windows ที่ไม่มี node ใช้ Electron ของ VS Code แทนได้:

  set ELECTRON_RUN_AS_NODE=1
  "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" tools\check-l3.js

(bash / macOS)
  ELECTRON_RUN_AS_NODE=1 ".../Microsoft VS Code/Code.exe" tools/check-l3.js

ออก exit code 0 = ผ่านหมด · 1 = มีข้อไม่ผ่าน (พิมพ์รายการให้)

แต่ละไฟล์ตรวจอะไร
-------------------
check-l3.js        ชั้นเทมเพลตของช่อง Lower Third (T.L3_TYPES / T.l3)
                   - ทั้ง 17 ชนิด render ได้, metadata ครบ, slot/group ถูกต้อง
                   - fields ว่าง -> คืน null (ยกเว้น clock / timeplace / logobug)
                   - escaping: ยิง <img onerror> เข้าทุกฟิลด์ ต้องไม่หลุดเป็น markup
                   - style ที่เป็นค่าแปลกปลอม ต้อง fallback ไม่หลุดลง class/inline style
                   - auto-hide (until), ชนิดไม่รู้จัก, ความเร็วแถบวิ่งอยู่ในช่วง
                   - ผลลัพธ์ต้องไม่มี color-mix() และไม่มี font-family

check-regress.js   เทมเพลตเดิมทุกตัวต้องให้ HTML "byte-equal" กับ git HEAD
                   (results / top3 / schedule / chart / sport* / gen*) ทั้งโหมด
                   house และ school — กันการเพิ่มของใหม่ไปทำของเดิมเพี้ยน
                   * ต้องรันในโฟลเดอร์ git ที่ commit HEAD มี public/templates.js

check-overlay.js   รัน public/overlay.js จริงบน DOM stub
                   - ช่อง main (/live) ต้องไม่อ่าน state.l3 เลย
                   - ช่อง cg (/live/cg) อ่าน state.l3 และลง slot ถูกช่อง
                   - full/lower กันเอง · top/ticker/bug ค้างจอพร้อมกันได้
                   - l3Sig: เปลี่ยน style หรือ l3.settings แล้วต้อง re-render
                   - until เลยเวลา -> ถอดกราฟิกออก · ไม่มี state.l3 -> ไม่ throw
                   - ?ch=cg ต้องได้ผลเท่ากับ path /live/cg

check-cg.js        รัน public/cg.js จริงบน DOM stub
                   - 3 วิว (live / library / settings) เรนเดอร์ได้ ไม่มี undefined
                   - ฟอร์มของทั้ง 17 ชนิดสร้างครบทุกฟิลด์ + ทุกปุ่มปรับแต่ง
                   - ปุ่มนำเข้าพรีเซ็ตจากงานทั่วไป นับถูกและกันซ้ำได้
                   - ไม่มี state.l3 -> ขึ้นข้อความแนะนำ ไม่ throw

สิ่งที่ยังต้องตรวจด้วยมือ (รายละเอียดใน CLAUDE.md)
--------------------------------------------------
- server.py: ไม่มี Python บนเครื่อง Windows นี้ -> ต้อง py_compile บน macOS
- server.ps1: parse + ASCII-only + ยิงคำสั่งผ่าน HTTP จริง
- public/obs/cglive.lua: compile ด้วย lua51.dll ที่ติดมากับ OBS
- หน้าตาจริงบนจอ (ตำแหน่ง/สี/แอนิเมชัน) ต้องเปิด OBS หรือเบราว์เซอร์ดู
