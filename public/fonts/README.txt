ฟอนต์: LINE Seed Sans TH
========================

overlay.css / control.css โหลด "LINE Seed Sans TH" จาก jsDelivr CDN
    https://cdn.jsdelivr.net/gh/lazywasabi/thai-web-fonts@7/fonts/LINESeedSansTH/LINESeedSansTH.css
(ไฟล์เดียวมีทั้งอักษรไทยและละติน — ต้องมีเน็ตตอนเปิดหน้าเว็บครั้งแรก)
ถ้าไม่มีเน็ต ระบบจะ fallback ไปฟอนต์ระบบ Windows ("Leelawadee UI" / "Tahoma") ซึ่งอ่านไทยได้ปกติ

ใช้งานแบบออฟไลน์ (แนะนำสำหรับงานจริง)
------------------------------------
1. ดาวน์โหลด LINE Seed Sans TH จาก https://seed.line.me  (ฟรี, SIL Open Font License)
   หรือดึง .woff2 จาก repo: https://github.com/lazywasabi/thai-web-fonts/tree/main/fonts/LINESeedSansTH
   วางไฟล์เหล่านี้ในโฟลเดอร์นี้:
     LINESeedSansTH-Regular.woff2
     LINESeedSansTH-Bold.woff2
     LINESeedSansTH-ExtraBold.woff2

2. เปิด public/overlay.css และ public/control.css
   - ลบ/คอมเมนต์บรรทัด @import url('https://cdn.jsdelivr.net/...')
   - ปลดคอมเมนต์บล็อก @font-face { font-family:"LINE Seed Sans TH"; ... }
     (มีอยู่แล้วใน overlay.css — ก๊อปไปใส่ control.css ด้วยถ้าต้องการ)

หมายเหตุ: LINE Seed Sans มีน้ำหนัก 100 / 400 / 700 / 800 / 900 (ไม่มี 500/600)
เบราว์เซอร์จะปัดไปน้ำหนักใกล้เคียงให้เอง
