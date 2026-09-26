# REST API Contract Index

**Base path:** `/api`

**Implementation source:** `src/app.ts` and the corresponding `src/modules/*/*.routes.ts` files.
**Updated:** 2026-09-12

This index records routes mounted by the current backend. DTO details and validation must be taken from the route/controller and its DTO file; do not infer a payload from an older document.

## Response rule

REST endpoints return the shared `ApiResponse<T>` envelope unless they intentionally stream a file or are a health/metrics endpoint. The HTTP status must match `statusCode` in the response body.

```json
{ "statusCode": 200, "success": true, "message": "Success", "data": {} }
```

## Route index

| Prefix | Registered routes | Access summary |
|---|---|---|
| `/health`, `/api/health` | `GET /` | Health check |
| `/api/auth` | `POST /login`, `POST /register`, `POST /heartbeat`, `POST /logout`, `GET /me`, `GET /admin-only` | Login/register have rate limits; protected routes use JWT; `admin-only` requires ADMIN |
| `/api/users` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` | ADMIN |
| `/api/tenants` | `GET /`, `GET /me`, document reads, `POST /upload-documents`, `POST /apply`, `POST /`, `PATCH /:id`, `DELETE /:id` | JWT; admin restrictions are declared in `tenants.routes.ts` |
| `/api/rooms` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` | Reads: ADMIN/STUDENT; writes: ADMIN |
| `/api/billing` | Bill list/report, QR, room info, room-bill generation, single-bill slip upload, status update, delete | See `billing.routes.ts` |
| `/api/payment-batches` | `POST /`, `GET /:id`, `GET /:id/payment-qr`, `GET /:id/status`, `POST /:id/upload-slip`, admin bill payment/slip reads | JWT; admin routes require ADMIN |
| `/api/maintenance` | Ticket create/list/status/delete and image upload/read | See `maintenance.routes.ts` |
| `/api/visitor` | `POST /register`, `GET /`, `PATCH /:id/status` | JWT; list/status require ADMIN |
| `/api/ocr` | ID-card verification, jobs and admin verification records | Upload routes are rate-limited; admin reads require ADMIN |
| `/api/face-verification` | Dashboard, FaceGate.Edge, device and template routes | See `face-verification.routes.ts` for JWT/FaceGate token rules |
| `/api/notifications` | Notification list, delivery, dead letters, audit logs, provider webhook | See `notification.routes.ts` |
| `/api/notifications/preferences` | `GET /`, `PUT /` | JWT |
| `/api/audit-logs` | `GET /` | ADMIN |
| `/api/settings` | `GET /`, `PATCH /` | ADMIN |

## Authentication

`POST /api/auth/login` accepts an email and password. On success the server returns a token and a user summary containing `id`, `email`, optional `username`, `role`, `lastLogin`, and `isOnline`; it also sets the HttpOnly `access_token` cookie. The current `User` schema has no `firstName` or `lastName` fields.

## Billing and payment

Two payment paths are registered and must remain distinguishable in clients and tests:

```text
Single bill:   POST /api/billing/:id/upload-slip
Payment batch: POST /api/payment-batches
               GET  /api/payment-batches/:id/payment-qr
               POST /api/payment-batches/:id/upload-slip
```

The payment-batch creation request requires an idempotency key. Its slip files are private; internal provider response, slip path, slip hash, and idempotency values are not public API response fields.

For valid bill, visitor, and maintenance state changes, use `state-machine.md`. Before changing a route, reconcile this index with its route file and automated tests.

## Housing document payment verification

`GET /api/tenants/payment-qr/:roomNumber` requires authentication. The server checks
availability and capacity, reads `Room.monthlyRent`, and uses the same Payment API
QR generator as billing. Response data: `{ roomNumber, amount, qrImage }`, where
`qrImage` is a PNG data URL. This endpoint does not create a payment or reserve a room.
The client must discard stale QR responses after room changes and refuse an amount
that differs from its displayed room price. Upload the bank slip in the next step.


`POST /api/tenants/upload-documents` requires authenticated multipart fields `idCard`,
`paymentSlip` (JPG/PNG/WebP), and `roomNumber`. A successful response includes
`paymentVerification: { id, status: "PAID", amount }` alongside document paths and OCR data.
The server obtains the expected one-month deposit from `Room.monthlyRent`, verifies the
slip through the existing Payment API, and persists the result in `Payment` with
`housingRoomId` and `housingVerificationId` (no bill yet).

`POST /api/tenants/apply` additionally requires `paymentId`. The server checks PAID status,
owner, room, verified ID card, slip path, and contract amounts inside a transaction;
then binds `housingTenantId`. Repeating an accepted application returns the same tenant.
Failed verification cannot be replaced by a client-supplied file path or success flag.
Provider outages enter MANUAL_REVIEW and must not trigger another transfer.

Payment and PaymentBatch reserve slip hashes and provider references using shared
PostgreSQL transaction locks. This prevents reuse across housing and billing flows.
A successful retry of the same unconsumed housing slip reuses the stored verification.
Deploy migration `20260925010000_housing_payment_verification` before the updated backend
and frontend; legacy housing uploads without verified payment must be reverified.
Thunder response contract: https://document.thunder.in.th/th/v2/verify/bank/image
