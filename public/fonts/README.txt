ฟอนต์: LINE Seed Sans TH
========================

ฝังในโปรเจกต์แล้ว — **ไม่ต้องต่อเน็ตเลย** ทั้งตอนเปิดหน้าครั้งแรกและตอนใช้งานจริง
(ก่อนหน้านี้โหลดจาก jsDelivr CDN ตอนเปิดหน้า เปลี่ยนมาเป็นไฟล์ในเครื่องแล้ว)

ไฟล์ในโฟลเดอร์นี้ (น้ำหนัก 100 / 400 / 700 / 800 / 900 — ไม่มี 500/600
เบราว์เซอร์จะปัดไปน้ำหนักใกล้เคียงให้เอง):
    LINESeedSansTH-Thin.woff2
    LINESeedSansTH-Regular.woff2
    LINESeedSansTH-Bold.woff2
    LINESeedSansTH-ExtraBold.woff2
    LINESeedSansTH-Black.woff2
    LINESeedSansTH-OFL.txt            ← ใบอนุญาต (SIL Open Font License 1.1)

`public/overlay.css` และ `public/control.css` ประกาศ `@font-face` ชี้มาที่ไฟล์เหล่านี้
โดยตรง (path `/fonts/...`) — ไม่มี `@import` จาก CDN เหลืออยู่แล้ว
`.gitattributes` ตั้ง `*.woff2 binary` ไว้ให้แล้ว ไม่ต้องทำอะไรเพิ่ม

ที่มา: https://github.com/lazywasabi/thai-web-fonts (mirror ของ
https://seed.line.me) — ดาวน์โหลดครั้งเดียวตอนทำโปรเจกต์นี้ ไฟล์ตัวนี้
อ้างอิงเวอร์ชันแท็ก `@7` ของ repo นั้น

ถ้าต้องอัปเดตฟอนต์เป็นเวอร์ชันใหม่: ดาวน์โหลด `.woff2` ทั้ง 5 ไฟล์มาทับของเดิมในโฟลเดอร์นี้
ชื่อไฟล์เดิม — ไม่ต้องแก้ CSS


Charmonman (เฉพาะธีม "Editorial / Magazine")
===========================================
Charmonman-Regular.ttf / Charmonman-Bold.ttf  —  ฟอนต์ไทยลายมือ (Google Fonts)
ใบอนุญาต SIL Open Font License 1.1  —  ดู Charmonman-OFL.txt (แจกจ่ายซ้ำในโปรเจกต์ได้)

- ฝังในโปรเจกต์แล้ว (ไม่ต้องต่อเน็ต) — public/editorial.css ประกาศ @font-face เอง
  ชี้ไปที่ /fonts/Charmonman-*.ttf
- ใช้เฉพาะ "หัวข้อ/ชื่อทีม-คณะ" ของธีม editorial เท่านั้น (ทับ guard ฟอนต์ LINE ใน
  overlay.css ด้วย !important) — ตัวเลข/นาฬิกา/ป้ายเล็ก ยังเป็น LINE Seed
  (ช่อง CG ที่สอง — Lower Third / Bar — มีสวิตช์ฟอนต์ Charmonman ของตัวเองเช่นกัน
  ที่ `.l3-font-charm` ใน public/l3.css ใช้ไฟล์ตัวนี้ร่วมกัน ไม่ได้โหลดซ้ำ)
- ธีมอื่นทั้งหมดใช้ LINE Seed Sans TH ตามปกติ
