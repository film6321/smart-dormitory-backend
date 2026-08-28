# Smart Dormitory Management System — System Diagrams

เอกสารนี้รวบรวมไดอะแกรมการทำงานทั้งหมดของระบบ Smart Dormitory Management System ทั้งในฝั่ง Backend (Node.js/Express/TypeScript) และ Frontend (React/Vite/TypeScript)

---

## 1. System Architecture (สถาปัตยกรรมภาพรวมของระบบ)

ไดอะแกรมจำลองโครงสร้างและความสัมพันธ์ของเลเยอร์ต่าง ๆ ภายในระบบ:

```mermaid
graph TD
    subgraph Client ["Client Layer (React Frontend)"]
        React["React (Vite + TypeScript)"]
        Contexts["Auth / Dashboard Contexts"]
        Pages["Admin & Student Pages / Modules"]
    end

    subgraph Proxy ["Gateway / Reverse Proxy"]
        Nginx["Nginx Reverse Proxy"]
    end

    subgraph API ["Backend API Layer (Express.js)"]
        Express["Express.js Server (TS)"]
        Controller["Thin Controllers (Validation & Auth)"]
        Service["Services (Business Logic)"]
        Workers["Background Workers (Reminders & Cleanup)"]
    end

    subgraph Cache ["Operations Cache"]
        Redis["Redis (Rate Limit, Session Lock, Heartbeat)"]
    end

    subgraph Storage ["Database Layer (Source of Truth)"]
        Postgres[(PostgreSQL 16 Database)]
        Prisma["Prisma ORM Client"]
    end

    subgraph ExtAPI ["External Services Wrapper"]
        OCR["External OCR API (ID Card / Slip Validation)"]
        Face["External Face Verification API (Biometrics)"]
    end

    React -->|HTTP / HTTPS Requests| Nginx
    React -->|WebSocket Connections| Express
    Nginx -->|Proxy Pass requests| Express
    
    Express --> Controller
    Controller --> Service
    Service <-->|Prisma ORM Client| Postgres
    Service <-->|Redis Cache & Locks| Redis
    Service -->|Service Wrapper Request| OCR
    Service -->|Service Wrapper Request| Face
    Workers <-->|Read / Write| Postgres
```

---

## 2. Database Entity Relationship Diagram (ERD)

แบบจำลองความสัมพันธ์ของข้อมูล (Entity Relationships) ที่อยู่บน PostgreSQL โดยอิงจาก [schema.prisma](file:///C:/Users/raphi/Documents/smart-dormitory-backend/prisma/schema.prisma):

```mermaid
erDiagram
    User {
        Int id PK
        String email UK
        String password
        Role role
        String firstName
        String lastName
        Int version
        DateTime createdAt
        DateTime updatedAt
    }

    Tenant {
        Int id PK
        Int userId FK "Nullable"
        Int roomId FK "Nullable"
        String fullName
        String phone
        String email
        String studentId
        String citizenId
        String status
        Boolean isActive
        DateTime createdAt
        DateTime updatedAt
    }

    Room {
        Int id PK
        String roomNumber UK
        Int floor
        String status
        Int capacity
        Decimal monthlyRent
        DateTime createdAt
        DateTime updatedAt
    }

    Bill {
        Int id PK
        Int tenantId FK
        Int roomId FK "Nullable"
        Decimal amount
        DateTime dueDate
        BillStatus status
        Int version
        String slipHash
        String reason
        DateTime paidAt
        DateTime createdAt
        DateTime updatedAt
    }

    MaintenanceTicket {
        Int id PK
        Int tenantId FK
        Int roomId FK "Nullable"
        MaintenanceCategory category
        String description
        MaintenanceStatus status
        Int assignedTechnicianId
        String note
        DateTime resolvedAt
        DateTime createdAt
        DateTime updatedAt
    }

    Visitor {
        Int id PK
        Int tenantId FK "Nullable"
        Int roomId FK "Nullable"
        String guestName
        String purpose
        DateTime expectedEntryTime
        VisitorStatus status
        DateTime checkedInAt
        DateTime checkedOutAt
        DateTime createdAt
        DateTime updatedAt
    }

    VisitorLog {
        Int id PK
        Int visitorId FK
        String eventType
        String note
        DateTime createdAt
    }

    OcrJob {
        String id PK
        Int userId FK "Nullable"
        OcrJobStatus status
        String imagePath
        Int resultVerificationId FK "Nullable"
        String errorMessage
        DateTime createdAt
        DateTime updatedAt
    }

    IdCardVerification {
        Int id PK
        Int userId FK "Nullable"
        String imagePath
        Boolean isThaiIdCard
        String citizenIdMasked
        String citizenIdHash
        Boolean idDetected
        Boolean idPresent
        Boolean idChecksumValid
        String reason
        DateTime verifiedAt
        DateTime createdAt
    }

    FaceEmbedding {
        Int id PK
        Int userId FK "Nullable"
        Int visitorId FK "Nullable"
        FloatList vector
        String modelVersion
        Float qualityScore
        DateTime createdAt
    }

    FaceEnrollmentPhoto {
        Int id PK
        Int userId FK "Nullable"
        Int visitorId FK "Nullable"
        String photoPath
        DateTime createdAt
    }

    Notification {
        Int id PK
        Int providerId FK "Nullable"
        Int templateId FK "Nullable"
        Int tenantId FK "Nullable"
        Int userId FK "Nullable"
        NotificationChannel channel
        NotificationType type
        NotificationStatus status
        DateTime scheduledAt
        DateTime sentAt
        DateTime createdAt
    }

    %% Relationships
    User ||--o| Tenant : "has profile"
    User ||--o{ FaceEmbedding : "has embeddings"
    User ||--o{ FaceEnrollmentPhoto : "has photos"
    User ||--o{ IdCardVerification : "requests ID check"
    User ||--o{ OcrJob : "runs jobs"

    Room ||--o{ Tenant : "houses"
    Room ||--o{ Bill : "bills generated for"
    Room ||--o{ MaintenanceTicket : "maintenance issues in"
    Room ||--o{ Visitor : "visited by"

    Tenant ||--o{ Bill : "owes bills"
    Tenant ||--o{ MaintenanceTicket : "reports tickets"
    Tenant ||--o{ Visitor : "registers visitor"

    Visitor ||--o{ VisitorLog : "logs movements"
    Visitor ||--o{ FaceEmbedding : "has embeddings"
    Visitor ||--o{ FaceEnrollmentPhoto : "has photos"

    OcrJob ||--o| IdCardVerification : "saves check to"
```

---

## 3. Core Business Workflows & Sequence Diagrams (โฟลว์การทำงานระบบ)

### 3.1 Authentication / Login Flow
```mermaid
sequenceDiagram
    autonumber
    actor User as Resident / Admin
    participant FE as React Frontend
    participant BE as Express Backend
    participant DB as PostgreSQL Database

    User->>FE: กรอก Email & Password
    FE->>BE: POST /api/auth/login
    BE->>DB: ค้นหา User ตาม email
    DB-->>BE: ข้อมูล User (รหัสผ่านที่เข้ารหัสแล้ว)
    
    alt รหัสผ่านถูกต้อง
        BE->>BE: สร้าง JWT Token (พร้อม Role และสิทธิ์)
        BE-->>FE: HTTP 200 { success: true, token, user }
        FE->>FE: บันทึก Token ใน Local Storage / Context
        FE->>User: นำเข้าสู่หน้า Dashboard
    else รหัสผ่านไม่ถูกต้อง / ไม่พบข้อมูล
        BE-->>FE: HTTP 401 { success: false, message: "Invalid credentials" }
        FE->>User: แสดงข้อความแจ้งเตือนข้อผิดพลาด
    end
```

---

### 3.2 Resident (Tenant) Registration Flow
การลงทะเบียนผู้เช่า (นักศึกษา) ร่วมกับการสแกนบัตรประชาชนด้วย OCR และจัดเก็บลายนิ้วมือ/ใบหน้า:

```mermaid
sequenceDiagram
    autonumber
    actor Student as Resident (นักศึกษา)
    participant FE as React Frontend
    participant BE as Express Backend
    participant OCR as External OCR API
    participant Face as External Face API
    participant DB as PostgreSQL Database

    Student->>FE: อัปโหลดรูปบัตรประชาชน & ถ่ายรูปใบหน้า
    FE->>BE: POST /api/tenants/register
    BE->>OCR: POST /ocr/verify (สแกนรูปบัตรประชาชน)
    OCR-->>BE: คืนค่าข้อมูลที่ได้จากบัตร (เลขบัตร, ชื่อ, วันเกิด)

    alt OCR ตรวจสอบสำเร็จ
        BE->>Face: POST /face/enroll (ส่งภาพถ่ายใบหน้า)
        Face-->>BE: สร้าง Face Embedding (Vector) คืนกลับมา
        
        BE->>DB: บันทึกข้อมูล User, Tenant, FaceEmbedding และ IdCardVerification
        DB-->>BE: บันทึกข้อมูลสำเร็จ
        BE-->>FE: HTTP 201 { success: true, tenant }
        FE->>Student: แสดงสถานะการสมัครเสร็จสมบูรณ์
    else OCR หรือการลงทะเบียนใบหน้าล้มเหลว
        BE-->>FE: HTTP 400 { success: false, message: "OCR / Face Registration failed" }
        FE->>Student: แจ้งข้อผิดพลาดให้ทำรายการใหม่
    end
```

---

### 3.3 Visitor Access Flow (ระบบผู้มาติดต่อ)
กระบวนการลงทะเบียนนัดหมายของผู้ติดต่อและตรวจสอบใบหน้าก่อนเข้า-ออกอาคาร:

```mermaid
sequenceDiagram
    autonumber
    actor Visitor as Visitor (ผู้ติดต่อ)
    actor Guard as Smart Gate (กล้อง + เครื่องสแกน)
    participant BE as Express Backend
    participant Face as External Face API
    participant DB as PostgreSQL Database
    participant AdminFE as Admin Dashboard (Socket.io)

    Note over Visitor, BE: ขั้นตอนที่ 1: ลงทะเบียน (Pre-Registration)
    Visitor->>BE: ลงทะเบียนล่วงหน้า POST /api/visitor/register (ถ่ายภาพใบหน้า)
    BE->>Face: ลงทะเบียนใบหน้า (Enroll Face)
    Face-->>BE: ส่ง Face Vector กลับมา
    BE->>DB: บันทึกข้อมูล Visitor (สถานะ REGISTERED)
    
    Note over Guard, BE: ขั้นตอนที่ 2: สแกนเข้าประตู (Check-In)
    Visitor->>Guard: สแกนใบหน้าที่ประตูกล้องทางเข้า
    Guard->>BE: POST /api/visitor/verify (ส่งภาพถ่ายปัจจุบัน)
    BE->>Face: POST /face/verify (เปรียบเทียบภาพสแกนกับ Face Vector ในระบบ)
    Face-->>BE: คืนค่าเปอร์เซ็นต์ความคล้ายคลึง (Similarity Score)
    
    alt ตรวจสอบใบหน้าและสถานะนัดหมายถูกต้อง
        BE->>DB: อัปเดตสถานะเป็น APPROVED -> CHECKED_IN
        BE->>BE: ทำการล็อก Redis Lock เพื่อกันการสแกนซ้ำซ้อน (TTL 5s)
        BE->>AdminFE: Broadcast เหตุการณ์ผ่าน Socket.io "visitorScanEvent"
        BE-->>Guard: HTTP 200 OK (สั่งประตูล็อกไฟฟ้าเปิด)
        Guard->>Visitor: ประตูเปิดให้เข้าตึก
    else ใบหน้าไม่ตรง / ไม่มีรายการนัดหมาย
        BE-->>Guard: HTTP 403 Forbidden (แจ้งเตือนไม่อนุมัติเข้าตึก)
    end
```

---

### 3.4 Billing Payment Verification Flow (สแกนสลิป)
การสแกนสลิปโอนเงินอัตโนมัติด้วย OCR เพื่อชำระค่าเช่า:

```mermaid
sequenceDiagram
    autonumber
    actor Tenant as ผู้เช่า
    participant FE as React Frontend
    participant BE as Express Backend
    participant OCR as External OCR API
    participant DB as PostgreSQL Database
    participant Admin as Admin Dashboard (Socket.io)

    Tenant->>FE: อัปโหลดสลิปชำระเงินค่าเช่า
    FE->>BE: POST /api/billing/:id/upload-slip
    BE->>DB: อัปเดตสถานะบิลเป็น VERIFYING (ใช้ OCC เช็ค Version)
    
    BE->>BE: ตรวจสอบ MD5/Hash ของไฟล์สลิปในฐานข้อมูล (กัน Double-submission)
    BE->>OCR: POST /ocr/verify-slip (ส่งไฟล์สลิปประมวลผล)
    OCR-->>BE: คืนค่าข้อมูลสลิป (เลขบัญชี, ยอดเงิน, วันที่ชำระ)

    alt ตรวจสอบยอดเงินตรงและข้อมูลสลิปถูกต้อง
        BE->>DB: อัปเดตสถานะบิลเป็น PAID, บันทึก slipHash และยอดชำระสำเร็จ
        DB-->>BE: อัปเดตสำเร็จ
        BE->>Admin: ส่ง Socket.io "billStatusUpdated" (เพื่ออัปเดต Dashboard แอดมิน)
        BE-->>FE: HTTP 200 { success: true, status: "PAID" }
        FE->>Tenant: แสดงข้อความยืนยันการชำระเงินเรียบร้อย
    else OCR ข้อมูลไม่ตรง / สลิปซ้ำ / สแกนไม่ได้ (Timeout)
        BE->>DB: ค้างสถานะบิลเป็น VERIFYING (หรือ FAILED) และรอแอดมินตรวจแบบ Manual
        DB-->>BE: อัปเดตสถานะ
        BE-->>FE: HTTP 400 { success: false, status: "VERIFYING", reason: "OCR_TIMEOUT_WAIT_MANUAL_REVIEW" }
        FE->>Tenant: แจ้งเตือนแอดมินกำลังตรวจสอบสลิปของท่าน
    end
```

---

### 3.5 Maintenance Ticketing Flow (ระบบแจ้งซ่อม)
```mermaid
sequenceDiagram
    autonumber
    actor Resident as ผู้แจ้ง (นักศึกษา)
    participant FE as React Frontend
    participant BE as Express Backend
    participant DB as PostgreSQL Database
    participant AdminFE as Admin Dashboard (Socket.io)

    Resident->>FE: สร้างตั๋วแจ้งซ่อม (เลือกประเภทคำขอ, รายละเอียด)
    FE->>BE: POST /api/maintenance
    BE->>DB: บันทึกตั๋วสถานะ PENDING
    DB-->>BE: ตั๋วถูกสร้าง
    BE->>AdminFE: Broadcast สัญญาณ "maintenanceStatusUpdated" ไปที่แอดมิน
    BE-->>FE: HTTP 201 { success: true, ticket }
    FE->>Resident: แสดงสถานะการส่งคำร้องแจ้งซ่อมเรียบร้อย

    Note over BE, DB: แอดมินจัดการคำสั่งซ่อม
    AdminFE->>BE: อัปเดตสถานะตั๋วและกำหนดช่างผู้รับผิดชอบ
    BE->>DB: อัปเดตสถานะตั๋วเป็น APPROVED -> IN_PROGRESS
    BE->>Resident: ส่งการแจ้งเตือนผ่าน Socket.io / Email แจ้งสถานะแก่ผู้เช่า
```

---

## 4. State Machines (แผนผังการควบคุมสถานะ)

ระบบใช้แนวทางการควบคุมสถานะอย่างเข้มงวด (State Machine Contracts) เพื่อให้การไหลของข้อมูลถูกต้องและปลอดภัยตามกฎธุรกิจ:

### 4.1 Billing Status State Machine
```mermaid
stateDiagram-v2
    [*] --> UNPAID : สร้างบิลใหม่
    UNPAID --> VERIFYING : อัปโหลดสลิปชำระเงิน
    UNPAID --> OVERDUE : เลยกำหนดชำระเงิน
    OVERDUE --> VERIFYING : อัปโหลดสลิปชำระเงิน
    VERIFYING --> PAID : ตรวจสอบสลิปผ่าน (ยอดเงินและข้อมูลตรง)
    VERIFYING --> FAILED : ตรวจสอบสลิปล้มเหลว (สลิปชำรุด/ซ้ำซ้อน)
    FAILED --> UNPAID : ทำการอัปโหลดไฟล์สลิปใหม่
    FAILED --> OVERDUE : หมดอายุชำระใหม่
    PAID --> [*] : เสร็จสิ้น
```

---

### 4.2 Visitor Access State Machine
```mermaid
stateDiagram-v2
    [*] --> REGISTERED : สร้างนัดล่วงหน้าสำเร็จ
    REGISTERED --> VERIFYING : เริ่มสแกนหน้าและสแกนบัตรที่หน้าตึก
    REGISTERED --> EXPIRED : ยกเลิกเนื่องจากเกินเวลานัดหมาย
    VERIFYING --> APPROVED : ยืนยันข้อมูลใบหน้าและเอกสารผ่าน
    VERIFYING --> REJECTED : เอกสารไม่ผ่านหรือติด Blacklist
    REJECTED --> REGISTERED : ลงทะเบียนใหม่อีกครั้ง
    REJECTED --> EXPIRED : บัตรหมดอายุ
    APPROVED --> CHECKED_IN : ประตูเปิด ยืนยันผ่านประตูสำเร็จ
    CHECKED_IN --> CHECKED_OUT : สแกนหน้าออกจากตึก
    CHECKED_IN --> EXPIRED : อยู่เกินเวลาจำกัด
    CHECKED_OUT --> [*]
    EXPIRED --> [*]
```

---

### 4.3 Maintenance Ticket State Machine
```mermaid
stateDiagram-v2
    [*] --> PENDING : ผู้เช่าส่งฟอร์มแจ้งซ่อมเข้ามา
    PENDING --> APPROVED : แอดมินอนุมัติและเตรียมมอบงาน
    PENDING --> CANCELLED : แอดมินปฏิเสธคำร้อง หรือผู้เช่ายกเลิกคำขอ
    APPROVED --> IN_PROGRESS : ช่างรับงานและกำลังดำเนินการซ่อม
    APPROVED --> CANCELLED : ยกเลิกก่อนดำเนินการซ่อม
    IN_PROGRESS --> RESOLVED : ช่างซ่อมงานเสร็จสมบูรณ์และรายงานระบบ
    IN_PROGRESS --> CANCELLED : ยกเลิกงานระหว่างดำเนินการ
    RESOLVED --> CLOSED : ผู้เช่ายืนยันปิดงานซ่อม
    CLOSED --> [*]
    CANCELLED --> [*]
```
