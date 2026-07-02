# Smart Dormitory Management System - Block Diagram

## System Overview Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT LAYER (Browser)                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    React + Vite + TypeScript                            │   │
│  │  ┌────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │   │
│  │  │   Auth     │  │  Admin   │  │ Student  │  │ Visitor  │            │   │
│  │  │  Module    │  │ Dashboard│  │ Dashboard│  │ Module   │            │   │
│  │  └────────────┘  └──────────┘  └──────────┘  └──────────┘            │   │
│  │  ┌────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │   │
│  │  │  Billing   │  │Maintenance│  │   OCR    │  │   Visitor│            │   │
│  │  │   Module   │  │  Module  │  │ Upload   │  │  Module  │            │   │
│  │  └────────────┘  └──────────┘  └──────────┘  └──────────┘            │   │
│  │                                                                        │   │
│  │    Axios HTTP Client (src/services/api.ts)                           │   │
│  │    Socket.IO Client (Real-time subscriptions)                        │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                           │
│                    HTTP REST + WebSocket                                      │
└────────────────────────────────────┼───────────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼───────────────────────────────────────────┐
│                                    ▼                                           │
│                      NGINX REVERSE PROXY (Port 80/443)                         │
│                   (Load balancing, SSL termination)                            │
└────────────────────────────────────┼───────────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
┌───────────────────▼──────────────────────────┐     │
│         BACKEND API SERVER LAYER             │     │
│      Express.js + TypeScript (Port 3000)     │     │
│                                              │     │
│  ┌──────────────────────────────────────┐   │     │
│  │      Global Middleware Stack         │   │     │
│  │  • Auth (JWT Verification)           │   │     │
│  │  • CORS & Security (Helmet)          │   │     │
│  │  • Rate Limiting (Redis-backed)      │   │     │
│  │  • Request Logging (Pino)            │   │     │
│  │  • Error Handler                     │   │     │
│  └──────────────────────────────────────┘   │     │
│                    │                         │     │
│  ┌─────────────────▼──────────────────────┐ │     │
│  │        API Routes (Modular)            │ │     │
│  │  ┌──────────────────────────────────┐  │ │     │
│  │  │  POST /auth/login, /auth/register│  │ │     │
│  │  │  GET  /health, /metrics          │  │ │     │
│  │  └──────────────────────────────────┘  │ │     │
│  │                                         │ │     │
│  │  ┌──────────────────────────────────┐  │ │     │
│  │  │  BILLING MODULE                  │  │ │     │
│  │  │  GET    /api/billing             │  │ │     │
│  │  │  POST   /api/billing/:id/upload  │  │ │     │
│  │  │  PATCH  /api/billing/:id/status  │  │ │     │
│  │  └──────────────────────────────────┘  │ │     │
│  │                                         │ │     │
│  │  ┌──────────────────────────────────┐  │ │     │
│  │  │  MAINTENANCE MODULE              │  │ │     │
│  │  │  GET    /api/maintenance         │  │ │     │
│  │  │  POST   /api/maintenance         │  │ │     │
│  │  │  PATCH  /api/maintenance/:id     │  │ │     │
│  │  └──────────────────────────────────┘  │ │     │
│  │                                         │ │     │
│  │  ┌──────────────────────────────────┐  │ │     │
│  │  │  VISITOR MODULE                  │  │ │     │
│  │  │  GET    /api/visitor             │  │ │     │
│  │  │  POST   /api/visitor/register    │  │ │     │
│  │  │  PATCH  /api/visitor/:id/status  │  │ │     │
│  │  └──────────────────────────────────┘  │ │     │
│  │                                         │ │     │
│  │  ┌──────────────────────────────────┐  │ │     │
│  │  │  OCR MODULE (API Wrapper)        │  │ │     │
│  │  │  POST   /api/ocr/verify-id-card  │  │ │     │
│  │  │  GET    /api/ocr/jobs/:id        │  │ │     │
│  │  │  POST   /api/ocr/verify          │  │ │     │
│  │  └──────────────────────────────────┘  │ │     │
│  │                                         │ │     │
│  │  ┌──────────────────────────────────┐  │ │     │
│  │  │  USERS MODULE                    │  │ │     │
│  │  │  GET    /api/users               │  │ │     │
│  │  │  GET    /api/users/:id           │  │ │     │
│  │  └──────────────────────────────────┘  │ │     │
│  └─────────────────┬──────────────────────┘ │     │
│                    │                        │     │
│  ┌─────────────────▼──────────────────────┐ │     │
│  │      Service Layer (Business Logic)    │ │     │
│  │  • BillingService                      │ │     │
│  │  • MaintenanceService                  │ │     │
│  │  • VisitorService                      │ │     │
│  │  • OcrService (External API Wrapper)   │ │     │
│  │  • UsersService                        │ │     │
│  │  • AuthService                         │ │     │
│  └─────────────────┬──────────────────────┘ │     │
│                    │                        │     │
│  ┌─────────────────▼──────────────────────┐ │     │
│  │      Data Access Layer (ORM)           │ │     │
│  │  • Prisma Client Instance              │ │     │
│  │    (src/database/db.ts)                │ │     │
│  └─────────────────┬──────────────────────┘ │     │
│                    │                        │     │
└────────────────────┼────────────────────────┘     │
                     │                              │
        ┌────────────┴────────────┬────────────┐    │
        │                         │            │    │
┌───────▼──────────┐   ┌──────────▼───────┐   │    │
│   PostgreSQL 16  │   │   Redis Cache    │   │    │
│   (Port 5432)    │   │   (Port 6379)    │   │    │
│                  │   │                  │   │    │
│  ┌────────────┐  │   │  ┌─────────────┐ │   │    │
│  │   Room     │  │   │  │ Rate Limits │ │   │    │
│  │  Tenant    │  │   │  │ OCR Locks   │ │   │    │
│  │   Bill     │  │   │  │ Cache Layer │ │   │    │
│  │Maintenance │  │   │  │ Session     │ │   │    │
│  │  Visitor   │  │   │  │ Heartbeat   │ │   │    │
│  │   User     │  │   │  │ API Cache   │ │   │    │
│  │ IdCardVer. │  │   │  └─────────────┘ │   │    │
│  │  OcrJob    │  │   │                  │   │    │
│  │AccessLog   │  │   │  ┌─────────────┐ │   │    │
│  │Transaction │  │   │  │ Job Queue   │ │   │    │
│  └────────────┘  │   │  │ (OCR/batch) │ │   │    │
│                  │   │  └─────────────┘ │   │    │
└──────────────────┘   └──────────────────┘   │    │
                                              │    │
        ┌─────────────────────────────────────┘    │
        │                                          │
┌───────▼────────────────────────────────────┐    │
│   BACKGROUND WORKERS & QUEUE PROCESSING    │    │
│  • ocrJobWorker.ts                         │    │
│  • accessLogQueue.ts                       │    │
│  (Process OCR jobs, batch logs to DB)      │    │
└────────────────────────────────────────────┘    │
                                                  │
        ┌─────────────────────────────────────┐   │
        │                                     │   │
┌───────▼──────────────────┐   ┌──────────────▼──┐│
│   External APIs          │   │ Socket.IO Real- ││
│  (Service Wrappers)      │   │ time Updates    ││
│                          │   │                 ││
│ • OCR API                │   │ • billStatusUpd.││
│   (Verify ID cards,      │   │ • maintenance.  ││
│    Process slips)        │   │   statusUpd.    ││
│                          │   │ • visitor.      ││
│ • Face Verification API  │   │   statusUpd.    ││
│   (Optional for mvp)     │   │ • accessControl ││
│                          │   │                 ││
└──────────────────────────┘   └─────────────────┘│
                                                  │
└──────────────────────────────────────────────────┘
```

## Data Flow Examples

### 1. Bill Payment & OCR Verification Flow

```
Frontend                    Backend                 Database         External API
   │                           │                        │                 │
   │ 1. Upload slip image       │                        │                 │
   ├──────────────────────────► │                        │                 │
   │    POST /api/billing       │ 2. Store to disk       │                 │
   │    /:id/upload-slip        ├───────────────────────► │                 │
   │                            │ 3. Hash slip           │                 │
   │                            │ 4. Change status→      │                 │
   │                            │    VERIFYING           │                 │
   │                            ├───────────────────────► │                 │
   │                            │ 5. Enqueue OCR job     │                 │
   │                            │    to Redis            │                 │
   │                            ├──────────┐             │                 │
   │                            │ (Worker) │             │                 │
   │                            │          │ 6. Send to OCR API              │
   │                            ├──────────────────────────────────────────► │
   │                            │          │                            │   │
   │                            │          │             │        (Process) │
   │                            │          │             │                 │
   │                            │ 7. Receive OCR result  │                 │
   │                            │◄──────────────────────────────────────────┤
   │                            │ 8. Update Bill→PAID    │                 │
   │                            ├───────────────────────► │                 │
   │                            │ 9. Broadcast via       │                 │
   │                            │    Socket.IO           │                 │
   │◄──────────────────────────┤                        │                 │
   │ 10. Update UI real-time    │                        │                 │
```

### 2. Visitor Registration & Access Flow

```
Frontend                    Backend                 Database         External API
   │                           │                        │                 │
   │ 1. Register visitor        │                        │                 │
   ├──────────────────────────► │                        │                 │
   │    POST /api/visitor       │ 2. Create record→      │                 │
   │    /register               │    REGISTERED          │                 │
   │                            ├───────────────────────► │                 │
   │                            │ 3. Scan ID card        │                 │
   │                            │    (OCR process)       │                 │
   │                            │    OCR API             │                 │
   │                            ├──────────────────────────────────────────► │
   │                            │ 4. Status→ VERIFYING   │                 │
   │                            ├───────────────────────► │                 │
   │                            │                        │  (OCR processes)│
   │                            │ 5. Face Verification   │                 │
   │                            ├──────────────────────────────────────────► │
   │                            │ 6. Status→APPROVED or  │                 │
   │                            │    REJECTED            │                 │
   │                            ├───────────────────────► │                 │
   │                            │ 7. Socket.IO broadcast │                 │
   │◄──────────────────────────┤    visitor status      │                 │
   │ 8. Show approval msg       │                        │                 │
   │ & key card scan            │                        │                 │
   │                            │                        │                 │
   │ 9. Scan key card (reader)  │                        │                 │
   ├──────────────────────────► │                        │                 │
   │    POST /api/visitor       │ 10. Check if APPROVED  │                 │
   │    /:id/check-in           ├───────────────────────► │                 │
   │                            │ 11. Lock session       │                 │
   │                            │    (Redis Lock)        │                 │
   │                            ├──────────────────┐     │                 │
   │                            │ 12. Status→     │     │                 │
   │                            │    CHECKED_IN   │     │                 │
   │                            ├─────────────────────────────────┐        │
   │                            │ 13. Broadcast event             │        │
   │◄──────────────────────────┤    Socket.IO                    │        │
   │ 14. Grant door access      │                                │        │
```

### 3. Maintenance Ticket Lifecycle

```
Frontend                    Backend                 Database
   │                           │                        │
   │ 1. Create ticket           │                        │
   ├──────────────────────────► │                        │
   │    POST /api/maintenance   │ 2. Status→ PENDING     │
   │                            ├───────────────────────► │
   │                            │ 3. Assign to technician│
   │                            ├───────────────────────► │
   │◄──────────────────────────┤ 4. Notify (Socket.IO)  │
   │ 5. Real-time update        │                        │
   │                            │                        │
   │ (Admin)                    │ 6. Approve ticket      │
   │ 6. Admin approval          │                        │
   ├──────────────────────────► │                        │
   │    PATCH /api/maintenance  │ 7. Status→ APPROVED    │
   │    /:id/status             ├───────────────────────► │
   │                            │                        │
   │ (Technician)               │ 8. Technician confirms │
   │ 8. Technician marks start  │    IN_PROGRESS         │
   ├──────────────────────────► │                        │
   │    PATCH /api/maintenance  ├───────────────────────► │
   │    /:id/status             │                        │
   │                            │ 9. Technician marks    │
   │ 9. Technician marks done   │    RESOLVED            │
   ├──────────────────────────► │                        │
   │    PATCH /api/maintenance  ├───────────────────────► │
   │    /:id/status             │                        │
   │                            │ 10. Auto-close after   │
   │                            │     review (CLOSED)    │
   │◄──────────────────────────┤ 11. Notify (Socket.IO) │
   │ 12. Show completion msg    │                        │
```

## Component Communication Patterns

### REST API Response Format (Standardized)

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Operation successful",
  "data": {
    /* domain-specific payload */
  }
}
```

### Socket.IO Real-time Events

```typescript
// Broadcast to specific room or admin group
socket.to("room:402").emit("billStatusUpdated", {
  billId: 42,
  status: "PAID",
  timestamp: "2026-07-02T10:30:00Z",
});

socket.to("admins").emit("maintenanceTicketUpdated", {
  ticketId: 7,
  status: "IN_PROGRESS",
});
```

### Database Transaction Example (Billing Update)

```sql
BEGIN TRANSACTION;
  -- Check version for OCC (Optimistic Concurrency Control)
  UPDATE Bill
  SET status = 'PAID', version = version + 1
  WHERE id = 42 AND version = 1;

  -- Create audit log
  INSERT INTO AccessLog (...) VALUES (...);

COMMIT;
```

## Infrastructure Stack

| Layer         | Technology                               | Purpose                                  |
| ------------- | ---------------------------------------- | ---------------------------------------- |
| Client        | React 18, Vite, TypeScript, Axios        | Frontend UI & API client                 |
| API Gateway   | Nginx (reverse proxy, SSL, load balance) | Request routing & security               |
| Backend       | Express.js, Node.js, TypeScript          | REST API & WebSocket server              |
| ORM           | Prisma + PostgreSQL 16                   | Data persistence & migrations            |
| Cache         | Redis                                    | Session, locks, rate limiting, job queue |
| Logging       | Pino                                     | Structured logging with correlation IDs  |
| Monitoring    | Prometheus + Grafana                     | Metrics collection & visualization       |
| Container     | Docker + Docker Compose                  | Service orchestration                    |
| External APIs | OCR Service, Face Verification           | Third-party processing                   |

## Key Design Patterns

1. **Thin Controller, Fat Service**: Business logic in services, controllers only handle HTTP transport.
2. **Modular Architecture**: Each domain (billing, maintenance, visitor) is a self-contained module.
3. **Standardized API Response**: All endpoints return a consistent `ApiResponse<T>` wrapper.
4. **Optimistic Concurrency Control (OCC)**: Using `version` field to prevent race conditions.
5. **Redis-backed Rate Limiting**: Distributed rate limits for API endpoints.
6. **Job Queue Pattern**: Asynchronous OCR processing via Redis queue and worker.
7. **Real-time Notifications**: Socket.IO for pushing state changes to connected clients.
8. **Private Upload Storage**: Secure isolated storage for sensitive files (ID cards, slips).

---

## Frontend Architecture (React + Vite + TypeScript)

### Frontend Component Hierarchy

```
src/
├── App.tsx (Root component, route setup, Socket.IO connection)
│
├── modules/
│   ├── auth/
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx          (Transport layer: form display)
│   │   │   └── RegisterPage.tsx
│   │   ├── components/
│   │   │   ├── LoginForm.tsx          (Presentation: form inputs)
│   │   │   └── RegisterForm.tsx
│   │   ├── hooks/
│   │   │   ├── useLogin.ts            (Business logic: API call, storage)
│   │   │   ├── useRegister.ts
│   │   │   └── useAuth.ts             (State: auth context)
│   │   ├── types/
│   │   │   └── auth.types.ts          (LoginRequest, AuthResponse DTO)
│   │   └── services/
│   │       └── authService.ts         (HTTP client for /api/auth)
│   │
│   ├── admin/
│   │   ├── pages/
│   │   │   ├── AdminDashboard.tsx
│   │   │   ├── BillingManagement.tsx
│   │   │   └── MaintenanceOverview.tsx
│   │   ├── components/
│   │   │   ├── BillApprovalList.tsx
│   │   │   ├── MaintenanceQueue.tsx
│   │   │   └── VisitorLog.tsx
│   │   ├── hooks/
│   │   │   ├── useBills.ts            (Fetch, filter, approve bills)
│   │   │   ├── useMaintenanceTickets.ts
│   │   │   └── useVisitorLogs.ts
│   │   └── services/
│   │       ├── adminService.ts
│   │       └── statsService.ts        (Dashboard metrics)
│   │
│   ├── student/
│   │   ├── pages/
│   │   │   └── StudentDashboard.tsx
│   │   ├── components/
│   │   │   ├── MyBills.tsx
│   │   │   ├── BillUploadForm.tsx
│   │   │   └── RequestMaintenance.tsx
│   │   ├── hooks/
│   │   │   ├── useMyBills.ts
│   │   │   ├── useUploadSlip.ts       (File upload + OCR tracking)
│   │   │   └── useMyTickets.ts
│   │   └── services/
│   │       └── studentService.ts
│   │
│   ├── billing/
│   │   ├── pages/
│   │   │   └── BillingPage.tsx
│   │   ├── components/
│   │   │   ├── BillCard.tsx
│   │   │   ├── SlipUploadWidget.tsx
│   │   │   └── BillHistory.tsx
│   │   ├── hooks/
│   │   │   ├── useBillList.ts
│   │   │   ├── useSlipUpload.ts       (Progress + OCR status tracking)
│   │   │   └── useBillStatusUpdate.ts (Real-time Socket.IO listener)
│   │   ├── types/
│   │   │   └── billing.types.ts       (Bill DTO, upload status enum)
│   │   └── services/
│   │       └── billingService.ts      (API calls for /api/billing)
│   │
│   ├── maintenance/
│   │   ├── pages/
│   │   │   └── MaintenancePage.tsx
│   │   ├── components/
│   │   │   ├── TicketForm.tsx
│   │   │   └── TicketTimeline.tsx
│   │   ├── hooks/
│   │   │   ├── useCreateTicket.ts
│   │   │   ├── useTicketList.ts
│   │   │   └── useTicketStatusStream.ts (Real-time updates)
│   │   ├── types/
│   │   │   └── maintenance.types.ts
│   │   └── services/
│   │       └── maintenanceService.ts
│   │
│   ├── visitor/
│   │   ├── pages/
│   │   │   └── VisitorPage.tsx
│   │   ├── components/
│   │   │   ├── VisitorForm.tsx
│   │   │   └── VisitorStatus.tsx
│   │   ├── hooks/
│   │   │   ├── useRegisterVisitor.ts
│   │   │   ├── useVisitorList.ts
│   │   │   └── useVisitorAccessStream.ts
│   │   ├── types/
│   │   │   └── visitor.types.ts
│   │   └── services/
│   │       └── visitorService.ts
│   │
│   └── ocr/
│       ├── components/
│       │   ├── IdCardScanner.tsx
│       │   ├── SlipImagePreview.tsx
│       │   └── OcrStatus.tsx
│       ├── hooks/
│       │   ├── useOcrJob.ts           (Poll/subscribe OCR job status)
│       │   └── useIdCardVerification.ts
│       ├── types/
│       │   └── ocr.types.ts
│       └── services/
│           └── ocrService.ts          (API calls for /api/ocr)
│
├── services/
│   ├── api.ts                         (Axios instance + interceptors)
│   ├── socketIo.ts                    (Socket.IO instance + event setup)
│   └── storage.ts                     (localStorage/sessionStorage helpers)
│
├── hooks/
│   ├── useAsync.ts                    (Generic async data fetching)
│   ├── useLocalStorage.ts
│   ├── useDebounce.ts
│   └── useOnlineStatus.ts
│
├── components/
│   ├── Layout/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   └── Footer.tsx
│   ├── Common/
│   │   ├── LoadingSpinner.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── ConfirmDialog.tsx
│   │   └── Toast.tsx                  (Success/error notifications)
│   └── Form/
│       ├── FileUpload.tsx
│       ├── FormField.tsx
│       └── ValidationError.tsx
│
├── types/
│   ├── api.types.ts                   (ApiResponse<T>, HTTP DTOs)
│   ├── user.types.ts
│   ├── common.types.ts
│   └── index.ts                       (Export all types)
│
├── constants/
│   ├── endpoints.ts                   (API route constants)
│   ├── roles.ts                       (ADMIN, STUDENT, VISITOR)
│   └── messages.ts                    (UI messages, i18n ready)
│
├── utils/
│   ├── dateFormat.ts
│   ├── validation.ts
│   ├── formatters.ts
│   └── errors.ts                      (Error handling utilities)
│
├── context/
│   ├── AuthContext.tsx                (Auth state + dispatch)
│   ├── ToastContext.tsx               (Global notifications)
│   └── SocketContext.tsx              (Socket.IO events)
│
└── main.tsx                           (Vite entry point)
```

### Frontend Data Flow

```
User Interaction (UI Event)
       │
       ▼
   Component
       │ (onClick, onChange, onSubmit)
       ▼
   Custom Hook (Business Logic Layer)
       ├─ Local state management (useState)
       ├─ Validation logic
       ├─ Error handling (try/catch)
       │
       ▼
   Service Layer (API Client)
       ├─ Axios instance
       ├─ Request interceptor (add auth token)
       ├─ Response interceptor (handle errors)
       │
       ▼
   HTTP Request → Backend API
       │
       ▼
   Backend Response (ApiResponse<T>)
       ├─ statusCode, success, message, data
       │
       ▼
   Response Interceptor
       ├─ Extract data from wrapper
       ├─ Handle error codes (401 → logout, 500 → retry)
       │
       ▼
   Update Component State / Context
       ├─ Set loading = false
       ├─ Store result in hook state
       ├─ Update global AuthContext if needed
       │
       ▼
   Re-render Component with New Data
       │
       ▼
   Display UI Update to User

[PARALLEL: Socket.IO Real-time Path]
   Socket Event Received
       ├─ billStatusUpdated
       ├─ maintenanceTicketUpdated
       ├─ visitorStatusUpdated
       │
       ▼
   Socket Handler in Custom Hook / Context
       │
       ▼
   Update State / Invalidate Cache
       │
       ▼
   UI Re-renders with Latest Data
```

### Custom Hooks Architecture

```typescript
// Example: useBillList.ts (Fetch bills with caching & real-time updates)

export function useBillList(filters?: BillFilter) {
  // State management
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // References
  const cacheRef = useRef<{ data: Bill[]; timestamp: number } | null>(null);

  // Effects
  useEffect(() => {
    // Cleanup on mount check
    let isMounted = true;

    const fetchBills = async () => {
      try {
        setLoading(true);
        const response = await billingService.getBills(filters);
        if (isMounted) {
          setBills(response.data);
          cacheRef.current = { data: response.data, timestamp: Date.now() };
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchBills();

    // Subscribe to real-time bill updates
    const handleBillUpdated = (updatedBill: Bill) => {
      if (isMounted) {
        setBills((prev) =>
          prev.map((b) => (b.id === updatedBill.id ? updatedBill : b))
        );
      }
    };

    socketIo.on('billStatusUpdated', handleBillUpdated);

    // Cleanup on unmount
    return () => {
      isMounted = false;
      socketIo.off('billStatusUpdated', handleBillUpdated);
    };
  }, [filters]);

  // Methods
  const refetch = async () => {
    // Manual refetch
  };

  const invalidateCache = () => {
    cacheRef.current = null;
  };

  return { bills, loading, error, refetch, invalidateCache };
}

// Usage in Component
export function BillingPage() {
  const { bills, loading, error, refetch } = useBillList();

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} onRetry={refetch} />;

  return (
    <div>
      {bills.map((bill) => (
        <BillCard key={bill.id} bill={bill} />
      ))}
    </div>
  );
}
```

### Error Handling & Loading States

```typescript
// Standardized pattern for all async operations

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ErrorInfo | null;
}

interface ErrorInfo {
  code: string; // 'NETWORK_ERROR', 'VALIDATION_ERROR', 'AUTH_REQUIRED', etc.
  message: string;
  statusCode?: number;
  timestamp: Date;
}

// In Custom Hook:
useEffect(() => {
  const controller = new AbortController();

  const executeAsync = async () => {
    try {
      setAsyncState({ data: null, loading: true, error: null });

      const response = await billingService.uploadSlip(file, billId, {
        signal: controller.signal,
      });

      setAsyncState({ data: response, loading: false, error: null });
    } catch (err) {
      if (err instanceof AxiosError) {
        const errorInfo: ErrorInfo = {
          code: err.response?.data?.code || "UNKNOWN_ERROR",
          message: err.response?.data?.message || err.message,
          statusCode: err.response?.status,
          timestamp: new Date(),
        };

        // Handle specific errors
        if (errorInfo.statusCode === 401) {
          // Logout user
          authContext.logout();
        } else if (errorInfo.statusCode === 422) {
          // Validation error - show specific field errors
          setValidationErrors(err.response?.data?.errors);
        }

        setAsyncState({ data: null, loading: false, error: errorInfo });
      }
    }
  };

  executeAsync();

  // Cleanup: cancel request if component unmounts
  return () => controller.abort();
}, [billId]);
```

### Socket.IO Real-time Integration

```typescript
// socketIo.ts - Service layer

import io from "socket.io-client";

const socket = io(import.meta.env.VITE_API_URL, {
  auth: {
    token: localStorage.getItem("authToken"),
  },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
});

// Events emitted from backend
socket.on("billStatusUpdated", (event: BillStatusEvent) => {
  // Component listens to this via custom hook
});

socket.on("maintenanceTicketUpdated", (event: MaintenanceEvent) => {
  // Update UI in real-time
});

socket.on("visitorAccessApproved", (event: VisitorAccessEvent) => {
  // Broadcast to visitor check-in component
});

export default socket;

// Usage in Custom Hook:
export function useBillStatusStream(billId: number) {
  const [billStatus, setBillStatus] = useState<BillStatus | null>(null);

  useEffect(() => {
    const handleStatusUpdate = (event: BillStatusEvent) => {
      if (event.billId === billId) {
        setBillStatus(event.status);
      }
    };

    socket.on("billStatusUpdated", handleStatusUpdate);

    return () => {
      socket.off("billStatusUpdated", handleStatusUpdate);
    };
  }, [billId]);

  return billStatus;
}
```

### File Upload with Progress Tracking

```typescript
// useSlipUpload.ts - Custom hook for bill slip upload

export function useSlipUpload(billId: number) {
  const [uploadState, setUploadState] = useState<{
    file: File | null;
    progress: number; // 0-100%
    status: "idle" | "uploading" | "verifying" | "completed" | "failed";
    message: string;
  }>({
    file: null,
    progress: 0,
    status: "idle",
    message: "",
  });

  const handleFileSelect = (file: File) => {
    setUploadState({
      file,
      progress: 0,
      status: "uploading",
      message: "Uploading file...",
    });

    // Axios with progress events
    const formData = new FormData();
    formData.append("slip", file);

    billingService
      .uploadSlip(formData, billId, {
        onUploadProgress: (event) => {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadState((prev) => ({ ...prev, progress }));
        },
      })
      .then((response) => {
        setUploadState((prev) => ({
          ...prev,
          status: "verifying",
          progress: 100,
          message: "Verifying with OCR...",
        }));

        // Subscribe to OCR job updates via Socket.IO
        socket.on(`ocrJob:${response.data.jobId}`, (jobEvent) => {
          if (jobEvent.status === "completed") {
            setUploadState((prev) => ({
              ...prev,
              status: "completed",
              message: "Upload successful! Bill approved.",
            }));
          } else if (jobEvent.status === "failed") {
            setUploadState((prev) => ({
              ...prev,
              status: "failed",
              message: "OCR verification failed. Please try again.",
            }));
          }
        });
      })
      .catch((error) => {
        setUploadState((prev) => ({
          ...prev,
          status: "failed",
          message: error.response?.data?.message || "Upload failed",
        }));
      });
  };

  return { uploadState, handleFileSelect };
}
```

### Type Safety with TypeScript

```typescript
// types/api.types.ts
export interface ApiResponse<T> {
  statusCode: number;
  success: boolean;
  message: string;
  data: T;
}

// types/billing.types.ts
export interface Bill {
  id: number;
  roomId: number;
  status: BillStatus;
  amount: number;
  dueDate: string;
  paidDate?: string;
  slipPath?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export enum BillStatus {
  UNPAID = "UNPAID",
  VERIFYING = "VERIFYING",
  PAID = "PAID",
  OVERDUE = "OVERDUE",
  FAILED = "FAILED",
}

export interface SlipUploadRequest {
  billId: number;
  slip: File;
}

export interface OcrJobResponse {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  result?: {
    amount: number;
    date: string;
    verified: boolean;
  };
}

// services/billingService.ts
export class BillingService {
  async getBills(filters?: BillFilter): Promise<ApiResponse<Bill[]>> {
    return api.get("/api/billing", { params: filters });
  }

  async uploadSlip(
    formData: FormData,
    billId: number,
    config?: AxiosRequestConfig,
  ): Promise<ApiResponse<OcrJobResponse>> {
    return api.post(`/api/billing/${billId}/upload-slip`, formData, config);
  }

  async updateBillStatus(
    billId: number,
    status: BillStatus,
  ): Promise<ApiResponse<Bill>> {
    return api.patch(`/api/billing/${billId}/status`, { status });
  }
}
```

### Integration Example: Billing Upload Flow

```
┌─────────────────────────────────────────────────────────────┐
│  User clicks "Upload Payment Slip" button                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  <SlipUploadWidget /> component renders file input          │
│  User selects file from device                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  handleFileSelect() in useSlipUpload hook                    │
│  ✓ Validate file size < 5MB                                 │
│  ✓ Validate file type (PNG, JPG, PDF)                       │
│  ✓ Set status = 'uploading'                                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Axios POST /api/billing/:id/upload-slip                    │
│  ✓ FormData with file + correlationId                       │
│  ✓ onUploadProgress callback updates progress bar           │
│  ✓ Request interceptor adds authToken header                │
└────────────────────┬────────────────────────────────────────┘
                     │ [OVER NETWORK]
                     ▼ [Backend: Express Controller]
┌─────────────────────────────────────────────────────────────┐
│  Backend Billing Controller                                  │
│  ✓ Validate auth (requireRole('ADMIN', 'STUDENT'))          │
│  ✓ Validate request DTO                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend Billing Service                                     │
│  ✓ Save file to disk (private storage)                       │
│  ✓ Hash file content                                         │
│  ✓ Update Bill.status = VERIFYING                            │
│  ✓ Enqueue OCR job to Redis queue                            │
│  ✓ Return OcrJobResponse with jobId                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Response interceptor (frontend)                             │
│  ✓ Extract data from ApiResponse<OcrJobResponse>            │
│  ✓ Set status = 'verifying'                                 │
│  ✓ Update UI: "Verifying with OCR..."                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend subscribes to Socket.IO: ocrJob:{jobId}           │
│  Listening for OCR result events in real-time                │
└────────────────────┬────────────────────────────────────────┘
                     │ [PARALLEL BACKGROUND]
                     ▼ [Backend Worker Process]
┌─────────────────────────────────────────────────────────────┐
│  ocrJobWorker.ts dequeues job                               │
│  ✓ Send slip image to OCR external API                      │
│  ✓ Parse result (amount, date, verification)                │
│  ✓ Update Bill.status = PAID (if verified)                  │
│  ✓ Emit Socket.IO event: ocrJob:{jobId} → 'completed'      │
│  ✓ Broadcast: billStatusUpdated to room 'room:{roomId}'    │
└────────────────────┬────────────────────────────────────────┘
                     │ [VIA WEBSOCKET]
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend Socket.IO handler receives ocrJob:completed       │
│  ✓ Update hook state: status = 'completed'                  │
│  ✓ Component re-renders success message                     │
│  ✓ Auto-refresh bill list via useBillList hook refetch()   │
│  ✓ Show Toast notification: "Bill approved!"                │
└─────────────────────────────────────────────────────────────┘
```

### Frontend Best Practices Checklist

- ✅ **Memory Leak Prevention**: Always cleanup Socket.IO listeners in `useEffect` return
- ✅ **Abort Controllers**: Cancel HTTP requests when component unmounts
- ✅ **Loading States**: Show spinner/skeleton while fetching
- ✅ **Error Boundaries**: Wrap components with ErrorBoundary to catch rendering errors
- ✅ **Type Safety**: All props, API responses, and hooks are typed
- ✅ **Validation**: Validate user input before sending to backend
- ✅ **Debouncing**: Debounce search/filter inputs to reduce API calls
- ✅ **Caching**: Cache frequently accessed data (bills, tickets) to reduce network requests
- ✅ **Error Messages**: User-friendly error messages from backend error codes
- ✅ **Optimistic Updates**: Update UI immediately, then sync with backend
- ✅ **Accessibility**: ARIA labels, keyboard navigation, semantic HTML
- ✅ **Performance**: Code split by route, lazy load components, memoize expensive computations

---

## Smart Dormitory Management System - Implementation Checklist

### 1. Authentication Module 🔐

#### Frontend

- [ ] Login Page (form, validation, error handling)
- [ ] Register Page (form, validation, error handling)
- [ ] Forgot Password (email verification flow)
- [ ] User Profile Page (view/edit personal info)
- [ ] Role Management UI (display roles: Admin / Resident)

#### Backend

- [x] JWT Authentication (token generation, verification)
- [x] Password Hashing (bcrypt implementation)
- [x] Login API (`POST /api/auth/login`)
- [x] Register API (`POST /api/auth/register`)
- [x] Authorization Middleware (role-based access control)
- [x] Get Profile API (`GET /api/auth/me`)

---

### 2. Dashboard Module 📊

#### Frontend

- [ ] Dashboard Main Page (layout, cards display)
- [ ] Revenue Chart (monthly revenue visualization)
- [ ] Room Status Chart (occupancy pie/bar chart)
- [ ] Maintenance Summary Widget (pending tickets count)
- [ ] Notification Summary Widget (latest alerts)

#### Backend

- [ ] Dashboard Statistics API (`GET /api/dashboard/stats`)
- [ ] Monthly Revenue Calculation (bills paid by month)
- [ ] Occupancy Calculation (occupied rooms / total rooms ratio)
- [ ] Pending Maintenance Count API
- [ ] Notification Summary API

---

### 3. Room Management 🏠

#### Frontend

- [ ] Room List Page (table/grid view with filters)
- [ ] Add Room Modal/Page (form for new room)
- [ ] Edit Room Modal/Page (update room details)
- [ ] Room Detail Page (view room info, tenants, history)

#### Backend

- [ ] CRUD Room API (`GET`, `POST`, `PUT`, `DELETE /api/rooms`)
- [ ] Room Status Logic (AVAILABLE, OCCUPIED, MAINTENANCE)
- [ ] Room Pricing Logic (base price, deposit calculation)
- [ ] Get Rooms by Status API
- [ ] Room History/Audit Log

---

### 4. Resident/Tenant Management 👤

#### Frontend

- [ ] Resident List Page (table with search/filter)
- [ ] Resident Detail Page (full profile, billing history)
- [ ] Add Resident Modal/Page (registration form)
- [ ] Edit Resident Modal/Page (update information)

#### Backend

- [x] CRUD Resident API (scaffolded in `users` module)
- [ ] Resident-Room Assignment Logic (check occupancy)
- [ ] Resident Status Management (ACTIVE, INACTIVE, MOVED_OUT)
- [ ] Resident History/Tenant Agreements Tracking
- [ ] Get Residents by Room API

---

### 5. OCR Registration System 🪪⭐

#### Frontend

- [ ] Upload ID Card Page (file upload widget)
- [ ] OCR Result Preview (display extracted data)
- [ ] Edit Extracted Data (allow manual corrections)
- [ ] Confirm Registration (final submission)

#### Backend

- [x] OCR API Wrapper (`POST /api/ocr/verify-id-card`)
- [x] Image Processing (store images, generate unique IDs)
- [x] Text Extraction Integration (call external OCR service)
- [x] OCR Log Storage (save OCR jobs to database)
- [x] Get OCR Job Status API (`GET /api/ocr/jobs/:id`)
- [x] OCR Result Retrieval (fetch extracted data)

---

### 6. QR Resident Card System 📱⭐

#### Frontend

- [ ] QR Resident Card Page (display QR code)
- [ ] QR Display Component (styled QR code render)
- [ ] QR Download Button (export as PNG/PDF)

#### Backend

- [ ] Generate QR Code API (`POST /api/qr/generate`)
- [ ] QR Verification API (`POST /api/qr/verify`)
- [ ] QR Data Storage (store mapping: QR → Resident)
- [ ] Get QR by Resident API (`GET /api/qr/resident/:id`)

---

### 7. Water & Electric Billing System 💡🚰

#### Frontend

- [ ] Billing Page (list all bills, status filter)
- [ ] Meter Input Form (water/electric meter readings)
- [ ] Billing History View (past bills, payment status)
- [ ] Receipt Page (view/download receipt)
- [ ] Billing Summary Widget (total due, paid, overdue)

#### Backend

- [x] Water Bill Calculation (water rate × consumption)
- [x] Electric Bill Calculation (electric rate × consumption)
- [x] Monthly Billing API (`POST /api/billing/generate-monthly`)
- [x] Get Bills API (`GET /api/billing`)
- [x] Upload Payment Slip API (`POST /api/billing/:id/upload-slip`)
- [x] Update Bill Status API (`PATCH /api/billing/:id/status`)
- [ ] Payment Verification Logic (verify slip amount matches bill)
- [ ] Late Payment Penalty Calculation

---

### 8. Maintenance Request System 🔧⭐

#### Frontend

- [ ] Create Maintenance Request Form (category, description, priority)
- [ ] Upload Repair Images (before/after photos)
- [ ] Maintenance Status Page (list tickets, status timeline)
- [ ] Technician Assignment View (show assigned technician)

#### Backend

- [x] Maintenance CRUD API (`POST`, `GET`, `PATCH /api/maintenance`)
- [x] Status Management (PENDING → APPROVED → IN_PROGRESS → RESOLVED → CLOSED)
- [ ] Image Storage (store ticket photos)
- [ ] Technician Assignment Logic (assign to available technician)
- [ ] Auto-Escalation (escalate if not resolved in X days)
- [ ] Maintenance Cost Tracking (labor + parts cost)

---

### 9. Visitor Registration & Access System 👥⭐

#### Frontend

- [ ] Visitor Registration Form (name, ID, contact, visit date/time)
- [ ] ID Verification (scan/upload ID card)
- [ ] Visitor Status Page (show registration status)
- [ ] Visitor Check-in/Check-out (entry/exit log)

#### Backend

- [x] Visitor Registration API (`POST /api/visitor/register`)
- [x] Get Visitors API (`GET /api/visitor`)
- [x] Update Visitor Status API (`PATCH /api/visitor/:id/status`)
- [x] Visitor State Management (REGISTERED → VERIFYING → APPROVED → CHECKED_IN → CHECKED_OUT)
- [ ] Visitor Access Log (track entry/exit times)
- [ ] Blacklist Management (deny entry for flagged visitors)

---

### 10. Notification System 🔔⭐ (NEW MODULE)

#### Frontend

- [ ] Notification Settings Page (toggle SMS/Email notifications)
- [ ] Notification History (view past notifications)
- [ ] Notification Preferences (choose notification types)
- [ ] Notification Badge (show unread count in header)

#### Backend

- [ ] Notification Service (send SMS/Email notifications)
- [ ] Scheduled Cron Job (trigger due date checks nightly)
- [ ] Due Date Checking Logic (check bills/maintenance due dates)
- [ ] Notification Log API (`GET /api/notifications`)
- [ ] SMS Gateway Integration (Twilio/similar)
- [ ] Email Template System (customizable email templates)
- [ ] Notification Preferences Storage (user opt-in/opt-out)
- [ ] Batch Processing (collect notifications, send in batches)

---

## Implementation Status Summary

### Backend Modules

| Module            | Scaffolding | Controller | Service | Routes | Database | Tests |
| ----------------- | :---------: | :--------: | :-----: | :----: | :------: | :---: |
| Auth              |     ✅      |     ✅     |   ✅    |   ✅   |    ✅    |  ⚠️   |
| Users             |     ✅      |     ✅     |   ✅    |   ✅   |    ✅    |  ⚠️   |
| Billing           |     ✅      |     ✅     |   ✅    |   ✅   |    ✅    |  ⚠️   |
| Maintenance       |     ✅      |     ✅     |   ✅    |   ✅   |    ✅    |  ⚠️   |
| Visitor           |     ✅      |     ✅     |   ✅    |   ✅   |    ✅    |  ⚠️   |
| OCR               |     ✅      |     ✅     |   ✅    |   ✅   |    ✅    |  ⚠️   |
| Face-Verification |     ✅      |     ⚠️     |   ⚠️    |   ⚠️   |    ❌    |  ❌   |
| Rooms             |     ❌      |     ❌     |   ❌    |   ❌   |    ⚠️    |  ❌   |
| QR Generation     |     ❌      |     ❌     |   ❌    |   ❌   |    ❌    |  ❌   |
| Notifications     |     ❌      |     ❌     |   ❌    |   ❌   |    ❌    |  ❌   |

### Frontend Modules

| Module            | Folder Structure | Pages | Components | Hooks | Services | Types |
| ----------------- | :--------------: | :---: | :--------: | :---: | :------: | :---: |
| Auth              |        ✅        |  ❌   |     ❌     |  ❌   |    ❌    |  ❌   |
| Admin             |        ✅        |  ❌   |     ❌     |  ❌   |    ❌    |  ❌   |
| Student           |        ✅        |  ❌   |     ❌     |  ❌   |    ❌    |  ❌   |
| Billing           |        ✅        |  ❌   |     ❌     |  ❌   |    ❌    |  ❌   |
| Maintenance       |        ✅        |  ❌   |     ❌     |  ❌   |    ❌    |  ❌   |
| Visitor           |        ✅        |  ❌   |     ❌     |  ❌   |    ❌    |  ❌   |
| OCR               |        ✅        |  ❌   |     ❌     |  ❌   |    ❌    |  ❌   |
| Face-Verification |        ✅        |  ❌   |     ❌     |  ❌   |    ❌    |  ❌   |

### Legend

- ✅ = Completed
- ⚠️ = Partially completed / In progress
- ❌ = Not started

### Priority for Next Phase

1. **High Priority** (Foundation)
   - Auth frontend (Login/Register pages) → all other screens depend on this
   - Dashboard frontend (admin/student dashboards)
   - User/Resident management screens

2. **Medium Priority** (Core Features)
   - Billing UI (view bills, upload slips, tracking)
   - Maintenance UI (create/track tickets)
   - Visitor UI (registration, approval workflow)

3. **Low Priority** (Post-MVP)
   - QR Generation system
   - Notification system (email/SMS)
   - Room management screens
   - Advanced features (escalation, batch processing)
