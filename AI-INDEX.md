# AI-INDEX.md — Master Context Router

> อ่านไฟล์นี้เป็นประตูด่านแรก แล้วเลือกเข้าอ่านเฉพาะไฟล์ Specs ที่ตรงกับโดเมนงานเท่านั้น

**Version:** 1.1.0 | **Last Updated:** 2026-08-21

---

## 1. Required Reading Order (ลำดับการสืบค้น)

1. อ่าน **`AI-INDEX.md`** (ไฟล์นี้) → ชี้เป้าโดเมนที่ต้องแก้
2. อ่าน **`AGENTS.md`** → กฎเหล็ก, Critical Code Registry, Anti-Hallucination
3. เข้าอ่าน **Spec ที่เกี่ยวข้อง** ตาม Context Routing ด้านล่าง
4. อ่าน **`CHANGELOG.md`** เฉพาะเมื่อต้องสืบค้นประวัติย้อนหลัง

_หลีกเลี่ยงการโหลดเอกสารทั้งหมดพร้อมกัน — อ่านเฉพาะที่จำเป็นเพื่อประหยัด Context Window_

---

## 2. Context Routing Map (แผนที่ชี้เป้าตามโดเมน)

| โดเมนที่ต้องการแก้ไข      | เอกสารอ้างอิง                                                                                          | เนื้อหา                                                     |
| :------------------------ | :----------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| **ภาพรวมสถาปัตยกรรม**     | [BLUEPRINT.md](BLUEPRINT.md)                                                                           | Tech Stack, module ownership, ลำดับความสำคัญงาน             |
| **กฎเหล็ก AI Agent**      | [AGENTS.md](AGENTS.md)                                                                                 | Critical Registry, Anti-Hallucination, Boundaries           |
| **Blueprint สถาปัตยกรรม** | [.docs/ai-context/spec-blueprint.md](.docs/ai-context/spec-blueprint.md)                               | Core Flows (Bill/Visitor/Maintenance), Resilience Rules     |
| **สเปก Backend**          | [.docs/ai-context/spec-backend.md](.docs/ai-context/spec-backend.md)                                   | Thin Controller, ApiResponse, OCC, Prisma Migration         |
| **สเปก Frontend**         | [.docs/ai-context/spec-frontend.md](.docs/ai-context/spec-frontend.md)                                 | React/Vite, Axios, Socket.IO cleanup, Memory Leak           |
| **Data Consistency**      | [.docs/ai-context/spec-consistency.md](.docs/ai-context/spec-consistency.md)                           | State Authority, OCC, Distributed Lock, Trace Correlation   |
| **Infra & DevOps**        | [.docs/ai-context/spec-infra-devops.md](.docs/ai-context/spec-infra-devops.md)                         | Docker Topology, Nginx, Prometheus/Grafana, SLO Targets     |
| **Error Handling**        | [.docs/ai-context/spec-error-handling.md](.docs/ai-context/spec-error-handling.md)                     | OCR Retry Policy, Schema Versioning, Dead Job Handling      |
| **Runtime Modes**         | [.docs/ai-context/spec-runtime-modes.md](.docs/ai-context/spec-runtime-modes.md)                       | พฤติกรรมระบบใน Dev / Staging / Production + กฎบังคับทุกโหมด |
| **State Machines**        | [.docs/ai-context/contracts/state-machine.md](.docs/ai-context/contracts/state-machine.md)             | Bill / Visitor / Maintenance transitions + Lock rules       |
| **REST API Contracts**    | [.docs/ai-context/contracts/api-contracts.md](.docs/ai-context/contracts/api-contracts.md)             | Endpoints, HTTP Methods, JSON Payload ทุกโมดูล              |
| **Socket.IO Contracts**   | [.docs/ai-context/contracts/socket-io-contracts.md](.docs/ai-context/contracts/socket-io-contracts.md) | Real-time Events, Rooms, Payload, Teardown rules            |
| **ฐานข้อมูล Schema**      | [prisma/schema.prisma](prisma/schema.prisma)                                                           | Source of Truth ของ PostgreSQL                              |
| **บทเรียน Enterprise**    | [.docs/Lessons/Enterprise_Architecture_Lessons.md](.docs/Lessons/Enterprise_Architecture_Lessons.md)   | Code patterns, Anti-patterns, ตัวอย่าง TypeScript           |

---

## 3. Quick Routing (ทางลัดตามหน้างาน)

**แก้/เพิ่ม REST Endpoint:**
→ อ่าน `prisma/schema.prisma` + `contracts/api-contracts.md`

**แก้ไขการเปลี่ยนสถานะ (Bill/Visitor/Maintenance):**
→ อ่าน `contracts/state-machine.md` + `spec-consistency.md`

**แก้ Socket.IO Event หรือ Realtime flow:**
→ อ่าน `contracts/socket-io-contracts.md` + `spec-frontend.md`

**แก้ Docker, Nginx, หรือ Infrastructure:**
→ อ่าน `spec-infra-devops.md`

**พบ Critical files registry ถูกละเมิด:**
→ อ่าน `AGENTS.md` §7

**ต้องการตัวอย่างโค้ด Pattern ที่ถูกต้อง:**
→ อ่าน `.docs/Lessons/Enterprise_Architecture_Lessons.md`

---

## 4. Hierarchy of Truth (ลำดับอำนาจข้อมูลเมื่อขัดแย้งกัน)

1. 🔒 กฎในตัว **`AGENTS.md`** — สูงสุดเสมอ ห้ามลดทอน
2. 📜 ข้อสัญญาใน **`.docs/ai-context/contracts/`**
3. 💻 โค้ดที่รันจริง + Automated Tests
4. 📖 `BLUEPRINT.md` และ `CHANGELOG.md`

_ถ้าโค้ดขัดกับ AGENTS.md → แก้ที่โค้ด ไม่ใช่แก้ที่กฎ_

---

## 5. .docs Folder Structure

```text
.docs/
  AI-CHANGELOG/           ← บันทึกการเปลี่ยนแปลงรายวัน (append-only)
    README.md
  Lessons/                ← บทเรียน Architecture พร้อมตัวอย่างโค้ด
    Enterprise_Architecture_Lessons.md
  ai-context/             ← เอกสาร Spec และ Contracts หลัก
    spec-blueprint.md       Core Architecture Flows & Resilience
    spec-backend.md         Node.js/Express/Prisma specifications
    spec-frontend.md        React/Vite/Socket.IO specifications
    spec-consistency.md     Data Consistency & State Authorities
    spec-infra-devops.md    Infrastructure, Docker, Observability
    spec-error-handling.md  OCR Retry, Schema Versioning, Dead Jobs
    spec-runtime-modes.md   Dev / Staging / Production behavior rules
    contracts/
      state-machine.md      Bill/Visitor/Maintenance state transitions
      api-contracts.md      REST API endpoints & JSON schemas
      socket-io-contracts.md Real-time events & room subscriptions
  architecture/          Reference and learning docs; not active contracts
  archive/               Historical documents and retired rules
  qa/                    Feature-specific quality checklists
  archive-sprints/        ← สรุป Sprint history (read-only)
    README.md
```
