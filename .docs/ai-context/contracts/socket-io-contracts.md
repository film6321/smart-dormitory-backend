# Socket.IO Real-time Contracts

**Endpoint:** `/socket.io` (WebSocket + HTTP Polling fallback)

---

## 1. Transport & Auth Rules

* **Authentication:** Client ต้องแนบ JWT ใน Handshake `auth` option:
  ```javascript
  const socket = io("http://localhost:5000", {
    auth: { token: "JWT_ACCESS_TOKEN" }
  });
  ```
* **Pure Transport Layer:** Socket.IO Handler ทำหน้าที่เพียง authenticate, validate, route — ห้ามมี Business Logic หรือ Prisma call โดยตรง
* **Persist First:** ทุก state change ต้อง save ลง PostgreSQL สำเร็จก่อน broadcast เสมอ

---

## 2. Client → Server Events

| Event Name | Payload | กฎ |
| :--- | :--- | :--- |
| `joinRoom` | `{ room: "admins" \| "room:402" }` | ผูก socket เข้ากับ Room ของกลุ่ม |
| `leaveRoom` | `{ room: "admins" \| "room:402" }` | ออกจาก Room |
| `pingHeartbeat` | (none) | รายงานสถานะ Online ชั่วคราวใน Redis |

---

## 3. Server → Client Events

### `visitorScanEvent`
* **Recipients:** `admins` group
```json
{
  "schemaVersion": 1,
  "visitorId": 801,
  "guestName": "นาย ขยัน มาเยือน",
  "status": "CHECKED_IN",
  "roomNumber": "305",
  "verifiedAt": "2026-06-29T13:02:15Z"
}
```

### `billStatusUpdated`
* **Recipients:** `room:{roomNumber}` (เช่น `room:402`)
```json
{
  "schemaVersion": 1,
  "billId": 101,
  "status": "PAID",
  "amount": 4500.00,
  "updatedAt": "2026-06-29T13:05:00Z"
}
```

### `maintenanceStatusUpdated`
* **Recipients:** `room:{roomNumber}`
```json
{
  "schemaVersion": 1,
  "ticketId": 501,
  "status": "IN_PROGRESS",
  "note": "ช่างกำลังเดินทาง",
  "updatedAt": "2026-06-29T13:06:30Z"
}
```

---

## 4. Room Groups

| Room | Principals | วัตถุประสงค์ |
| :--- | :--- | :--- |
| `admins` | ADMIN role | รับ Access Log, สแกนกล้อง, สถานะผู้ติดต่อ |
| `room:{roomNumber}` | STUDENT เจ้าของห้อง | รับอัปเดตบิลและข่าวซ่อมของตัวเอง |

---

## 5. Naming Rules

* Event names ใช้ `camelCase` เสมอ
* ห้าม rename event โดยไม่อัปเดต contract นี้และ client ทุกตัวพร้อมกัน
* เพิ่ม field ใหม่ (optional) ได้โดยไม่ต้องเพิ่ม `schemaVersion`
* ลบหรือเปลี่ยนชนิด field หลัก → บังคับเพิ่ม `schemaVersion` ขึ้น 1

---

## 6. Frontend Teardown (Memory Leak Prevention)

```typescript
// ✅ ต้องมี cleanup ทุกครั้งใน useEffect
useEffect(() => {
  socket.on("billStatusUpdated", handleBillUpdate);
  socket.on("maintenanceStatusUpdated", handleMaintenanceUpdate);

  return () => {
    socket.off("billStatusUpdated", handleBillUpdate);
    socket.off("maintenanceStatusUpdated", handleMaintenanceUpdate);
  };
}, []);
```

* ห้าม register event ซ้ำในจังหวะ reconnect
* ตรวจ `socket.connected` ก่อน emit ทุกครั้ง
