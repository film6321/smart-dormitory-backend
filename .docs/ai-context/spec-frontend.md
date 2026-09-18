# React / Vite Frontend Specs

**Version:** 1.0.0 | **Updated:** 2026-06-29

## 1. Stack & Auth

- **Framework:** React 18+ + Vite + TypeScript
- **HTTP Client:** Axios (instance กลางที่ `frontend/src/services/api.ts`)
- **Realtime:** Socket.IO Client (`socket.io-client`)
- **Auth Storage:** JWT Token เก็บใน httpOnly Cookie สำหรับ Admin Dashboard **ห้ามเก็บใน localStorage**
- **State:** React Context / useState + Custom Hooks (ไม่บังคับใช้ Redux เพื่อป้องกัน Over-engineering)

---

## 2. Active Routes (เส้นทางหน้าจอระบบ)

```text
/login                  — หน้าเข้าสู่ระบบ
/dashboard              — หน้าหลักแดชบอร์ดผู้ดูแล
/rooms                  — จัดการห้องพักและผู้เช่า
/billing                — จัดการบิลและตรวจสอบสลิป
/maintenance            — ติดตามใบแจ้งซ่อม
/visitor                — บันทึกและตรวจสอบผู้มาติดต่อ
/ocr-verification       — ดูประวัติการตรวจสอบบัตรประชาชน
/profile                — ข้อมูลบัญชีผู้ใช้ปัจจุบัน
```

Admin Dashboard ใช้ `authGuard` + `roleGuard` สำหรับ Role ADMIN ทุก route

---

## 3. HTTP Rules

- **Axios instance กลาง:** ตั้งค่า `baseURL`, `interceptors` สำหรับ token attach และ 401 redirect ที่ `frontend/src/services/api.ts`
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
- **Shared Components:** Button, Modal, Badge, Table ให้วางที่ `frontend/src/components/` ห้ามสร้างซ้ำในแต่ละโมดูล

---

## 6. Memory Leak Prevention

- เมื่อ Component ถูกทำลาย (unmount) ต้อง teardown สิ่งเหล่านี้เสมอ:
  1. Socket.IO event listeners (`socket.off(...)`)
  2. Axios request ที่ค้างอยู่ (ผ่าน `AbortController`)
  3. Interval/Timeout ID (`clearInterval`, `clearTimeout`)
