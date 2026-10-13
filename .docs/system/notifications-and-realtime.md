# 4.10 การพัฒนาระบบแจ้งเตือนและอัปเดตหน้าจอ

## 1. แยกผู้รับและประเภทข้อมูล

| ผู้รับ | ข้อมูลที่แสดง | ขอบเขต |
|---|---|---|
| User/STUDENT | บิลของตน สถานะซ่อมของตน สัญญาใกล้หมดอายุของตน | ไม่เห็นข้อมูลของผู้พักอื่น |
| Admin | ใบสมัคร/ผู้พัก งานซ่อม ผู้มาติดต่อ การเงินและเหตุการณ์งานส่วนกลางที่ระบบเผยแพร่ | ไม่รวม Notification ส่วนบุคคลมาเป็นกระดิ่ง User ซ้ำ |

Admin ยังอ่านรายละเอียดผู้พักผ่าน endpoint งานที่มีสิทธิ์ได้ การแยกกระดิ่งไม่ใช่การยกเลิกสิทธิ์ดูแลข้อมูล และ event ที่มีอยู่ไม่ใช่หลักฐานว่าทุกการเปลี่ยนฐานข้อมูลสร้างแจ้งเตือนครบแล้ว

## 2. REST และ Socket

GET `/api/notifications` รับ ADMIN/STUDENT โดย STUDENT ใช้ authenticated user ไม่เชื่อ query userId รับ direct user records หรือ legacy tenant-only ของตนที่ไม่มี userId ขัดกัน Admin รับเฉพาะ records ที่ userId และ tenantId ว่าง Diagnostic audit/dead-letter เป็น endpoint Admin แยก

Socket ตรวจบัญชีและ session version แล้วเข้าห้อง `user:<id>`; Admin เข้าห้อง admins ด้วย `notificationAlert` ที่มี userId ส่งตรงบัญชีนั้น ส่วนงานที่ไม่มีทั้ง User/Tenant ส่ง admins Legacy ที่มี tenantId แต่หา userId ไม่ได้จะไม่ broadcast และให้ REST ตรวจ ownership ไม่ส่งข้อมูลส่วนตัวไปห้องร่วม

## 3. วิธีสร้างกระดิ่งผู้พัก

ระบบอ่าน `/api/billing`, `/api/maintenance`, `/api/tenants/me` ซึ่งกรองเจ้าของแล้ว สร้างรายการจากสถานะจริง พร้อมลิงก์บิล/งานซ่อม/เอกสาร สัญญาแจ้งเมื่อ active APPROVED/ACTIVE และเหลือ 0–30 วันตาม Asia/Bangkok ไม่แจ้งจากสัญญาเสีย หมดอายุ หรือยังอีกเกิน 30 วัน

ตรวจข้อมูลทุก 30 วินาที เป็นตัวสำรอง และตรวจเมื่อ reconnect/ได้รับ owner notification จึงไม่อ้างว่าทุกการออกบิลหรือแก้งานซ่อมปรากฏทันทีผ่าน push ระบบทั้งหมด Admin ใช้ notificationAlert หลักเพื่อลดซ้ำจาก alias บิล/ซ่อม/visitor ส่วน alias ยังใช้ในหน้าที่เกี่ยวข้องได้

## 4. จุดแดง การอ่าน และ cleanup

กระดิ่ง/รายการ/กล่องเมนูที่เกี่ยวข้องมีจุดแดงเมื่อมีรายการยังไม่อ่าน กดรายการแล้ว markRead พร้อมไปหน้ารายละเอียด กดเมนูทำเครื่องหมายรายการในหมวดนั้น วันที่หรือสถานะรายการเปลี่ยนอาจกลายเป็นรายการใหม่ที่ยังไม่อ่าน

storage แยกด้วย role และ account ID เปลี่ยนบัญชีแล้วต้องซ่อนข้อมูลเดิมทันที state อ่านแล้วเป็น browser-local ไม่ sync ข้ามเครื่อง เมื่อ logout, unmount หรือเปลี่ยนบัญชีต้อง abort HTTP, off Socket listeners และ clear timers ป้องกันผลเก่าทับบัญชีใหม่

หลัง purge ข้อมูลบิล/ซ่อมหมด กระดิ่งที่ derive ต้องหายเมื่อ refresh สำเร็จ ข้อมูล cache ใน browser ไม่ใช่หลักฐานว่าฐานข้อมูลยังมีผู้พัก

## 5. ผลทดสอบ

| กรณี | ผล/หลักฐาน |
|---|---|
| User ใส่ userId คนอื่นใน query | IT ยังอ่านเฉพาะตนเอง |
| tenant legacy ระบุ userId ขัดกัน | IT ไม่ส่งให้เจ้าของ tenant ผิดคน |
| Admin อ่าน Notification | IT ไม่รวมรายการส่วนบุคคล |
| Socket ของส่วนบุคคล | UT transport mock ส่ง user:<id> ไม่มี admins/room peers |
| สลับ account หรือ role | UT frontend แยก storage และซ่อน state เดิม |
| อ่านแล้ว รีเฟรช สถานะเปลี่ยน ลบข้อมูล | UT frontend ตรวจแต่ละกรณี |
| สัญญาวันนี้/เสีย/หมดอายุ/ไกล | UT frontend แจ้งตามช่วงที่กำหนด |
| ไม่มี session หลัง deploy | RT HTTP/body 401 |

ผู้ใช้แจ้งใช้งานปกติเป็น UA รวม ยังไม่มีหลักฐานภาพหรือผลรายกรณีของทุก Socket/browser edge case ไม่รับรอง notification provider/SMS จริง

## 6. รูปและอ้างอิง

ใช้ภาพกระดิ่ง User/Admin รายการจุดแดง ก่อน/หลังอ่าน และกล่องบิล/ซ่อม/เอกสารบนหน้าหลัก แสดงบัญชีทดสอบคนละบัญชีเพื่ออธิบาย ownership

- [Gateway](../../src/realtime/notification-gateway.ts), [Notification repository](../../src/modules/notifications/notification.repository.ts)
- [ส่วนแสดงการแจ้งเตือน](../../../smart-dormitory-frontend/src/components/notifications/RealtimeAlerts.tsx)
- [Tests](../../tests/unit/notification.test.ts), [Integration](../../tests/integration/maintenance-flow.test.ts)
- [Socket contract](../ai-context/contracts/socket-io-contracts.md), [QA](../qa/system-flow-report.md)
