ฟอนต์ไทยสำหรับ overlay
======================

ค่าเริ่มต้น overlay.css / control.css โหลดฟอนต์ "Kanit" จาก Google Fonts (ต้องมีเน็ต)
ถ้าเครื่องมีเน็ตตอนงาน ไม่ต้องทำอะไรเพิ่ม

ใช้งานแบบออฟไลน์ (แนะนำสำหรับงานจริง)
------------------------------------
1. ดาวน์โหลดไฟล์ .woff2 มาวางในโฟลเดอร์นี้:
     Kanit-Regular.woff2
     Kanit-SemiBold.woff2
     Kanit-Bold.woff2
   ดาวน์โหลดได้จาก https://fonts.google.com/specimen/Kanit  (ปุ่ม "Get font" -> "Download all")
   แล้วแปลง .ttf เป็น .woff2 (เช่นเว็บ https://cloudconvert.com/ttf-to-woff2) หรือใช้ .ttf ตรง ๆ ก็ได้
   (ถ้าใช้ .ttf ให้แก้ src ใน @font-face เป็น format("truetype") และนามสกุล .ttf)

2. เปิดไฟล์ public/overlay.css และ public/control.css
   - ลบ/คอมเมนต์บรรทัด @import url('https://fonts.googleapis.com/...')
   - ปลดคอมเมนต์บล็อก @font-face { font-family:"Kanit"; ... }

ถ้าไม่ทำอะไรเลยและไม่มีเน็ต ระบบจะ fallback ไปใช้ฟอนต์ระบบ Windows
"Leelawadee UI" / "Tahoma" ซึ่งอ่านภาษาไทยได้ปกติ
