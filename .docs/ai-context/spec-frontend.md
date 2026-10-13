# React / Vite Frontend Specs

**Version:** 1.1.0 | **Updated:** 2026-10-13

## 1. Stack & Auth

- **Framework:** React 18+ + Vite + TypeScript
- **HTTP Client:** Axios (instance กลางที่ `../smart-dormitory-frontend/src/services/api.ts`)
- **Realtime:** Socket.IO Client (`socket.io-client`)
- **Auth Storage:** JWT Token เก็บใน httpOnly Cookie สำหรับ Admin และ User **ห้ามเก็บใน localStorage**
- **State:** React Context / useState + Custom Hooks (ไม่บังคับใช้ Redux เพื่อป้องกัน Over-engineering)

---

## 2. Active Routes (เส้นทางหน้าจอระบบ)

อ้างอิง `../smart-dormitory-frontend/src/componants/addminpage/router/AppRouter.tsx`:

| กลุ่ม | Routes |
|---|---|
| Public | `/`, `/login`, `/visitor` |
| Admin | `/dashboard`, `/room-management`, `/students`, `/maintenance`, `/visitors`, `/income-expenses`, `/reports`, `/analysis`, `/admin-panel`, `/access-control` |
| Student | `/student`, `/apply`, `/student/documents`, `/student/maintenance`, `/student/billing`, `/user-identity-flow` |

Admin ใช้ ProtectedRoute และตรวจสิทธิ์ซ้ำที่ API; Student ใช้ StudentRoute. `/agreements` เป็น legacy alias ไป `/students` เพื่อเปิดเอกสารผู้พัก ไม่ใช่หน้าวิเคราะห์ ส่วน aliases ของ Monitor ดู router จริง

---

## 3. HTTP Rules

- **Axios instance กลาง:** ตั้งค่า `baseURL`, `interceptors` โดยใช้ `withCredentials` ส่ง cookie และจัดการ 401 ที่ `../smart-dormitory-frontend/src/services/api.ts`
- **Error interception:** interceptor ดักจับ 401 → redirect ไป `/login` + clear auth state ทันที โดยไม่ต้องเขียนในทุก Component
- **Unwrap ApiResponse:** ควร unwrap `data` ออกจาก `ApiResponse<T>` ใน service helper ไม่ทำซ้ำในแต่ละ Component
- **ห้าม hardcode URL:** ใช้ environment variable (`VITE_API_URL`) เสมอ

---

## 4. Socket.IO & State

- Canonical events อยู่ใน `.docs/ai-context/contracts/socket-io-contracts.md`
- **ห้าม double-register event:** reconnect handler ต้องตรวจ connection state ก่อน register event ใหม่
- **Cleanup บังคับ:** ทุก `socket.on(...)` ต้องมีคู่ `socket.off(...)` ใน useEffect cleanup

---

## 5. Component Rules

- **Separation of Concerns:** Logic ทุกก้อน (fetch, state, transform) ต้องอยู่ใน Custom Hook ไม่อยู่ใน JSX component โดยตรง
- **Loading / Empty / Error:** ต้อง render state เหล่านี้แยกกันชัดเจนทุก Component ที่มี async data fetch
- **Typed Props:** ทุก Component ต้องประกาศ TypeScript interface ของ props ห้ามใช้ `any`
- **Shared Components:** Button, Modal, Badge, Table ให้วางที่ `../smart-dormitory-frontend/src/components/` ห้ามสร้างซ้ำในแต่ละโมดูล

---

## 6. Memory Leak Prevention

- เมื่อ Component ถูกทำลาย (unmount) ต้อง teardown สิ่งเหล่านี้เสมอ:
  1. Socket.IO event listeners (`socket.off(...)`)
  2. Axios request ที่ค้างอยู่ (ผ่าน `AbortController`)
  3. Interval/Timeout ID (`clearInterval`, `clearTimeout`)


## Flow constraints (13 Oct 2026)

- โครงสร้าง repo แยกจาก Backend: auth/visitor/face อยู่ใน src/modules; Admin/User เดิมอยู่ src/componants ห้ามสร้าง frontend/ ซ้อนเพื่อให้ตรงผังเก่า
- สมัครเข้าพักมี 4 ขั้น โดยสัญญาแยกจาก payment. OCR เติมข้อมูลในขั้นแรก ผู้ใช้ตรวจแก้ชื่อ/วันเกิด/ที่อยู่ก่อนส่ง ไม่กรอกซ้ำในสัญญา
- Draft API ส่ง contractTerms จาก server; สัญญาเป็น preview ของเงื่อนไข Admin ไม่มีปุ่มแก้ผู้ให้เช่า/อัตราบริการ หากเปลี่ยนระหว่างทบทวน API ตอบ 409 ให้ refresh และยอมรับใหม่ ยอดชำระเดิมยังอยู่
- ไม่รองรับ 2FA/Push delivery ใน settings ปัจจุบัน; ห้ามแสดงว่าเปิดใช้งานแล้วจาก toggle ที่ไม่มี flow รองรับ
- การลองส่งใบหน้าเก็บ progress ของภาพที่สำเร็จในหน้าเดิม ข้ามภาพที่ส่งแล้ว; server ใช้ owner + hash ของไฟล์กัน metadata ซ้ำ ต้องระบุว่าไม่ได้ rollback ภาพก่อนหน้า และไม่ได้รับรองการ resume ครบ 5 มุมหลัง reload
- browser acceptance ยังต้องตรวจแยกจาก hook/unit tests โดยใช้บัญชี ACTIVE; กล้อง ประตู SMS และ provider จริงเป็น Out of scope รอบนี้
