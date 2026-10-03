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
| `/api/visitor` | `POST /register`, `GET /:id/pass`, `GET /:id`, `POST /:id/cancel`, `GET /`, `PATCH /:id/status` | Registration is public with PDPA/OCR validation and Idempotency-Key; reads/cancel/list/status require ADMIN. See visitor.routes.ts. |
| `/api/ocr` | ID-card verification, jobs and admin verification records | Upload routes are rate-limited; admin reads require ADMIN |
| `/api/face-verification` | Dashboard, FaceGate.Edge, device and template routes | See `face-verification.routes.ts` for JWT/FaceGate token rules |
| `/api/notifications` | Notification list, delivery, dead letters, audit logs, provider webhook | See `notification.routes.ts` |
| `/api/notifications/preferences` | `GET /`, `PUT /` | JWT |
| `/api/audit-logs` | `GET /` | ADMIN |
| `/api/settings` | `GET /`, `PATCH /` | ADMIN |

## Authentication

`POST /api/auth/login` accepts an email and password. On success the server returns a token and a user summary containing `id`, `email`, optional `username`, `role`, `lastLogin`, and `isOnline`; it also sets the HttpOnly `access_token` cookie. The current `User` schema has no `firstName` or `lastName` fields.

## Monitor scan history

`GET /api/face-verification/scan-history` requires ADMIN and returns `scans` and
`items` (the same latest 30 persisted activities for the Bangkok calendar day),
`today_counts: { in, out, total }`, `timezone: "Asia/Bangkok"`, `day_start`,
`day_end`, and the existing `door_status`.
Counts cover the full half-open day range `[day_start, day_end)` in PostgreSQL,
including resident/admin FACE_GATE and legacy biometric VisitorLog CHECK_IN/CHECK_OUT.
MONITOR_DOOR activities remain visible but are excluded from these counts.
Reception visitor registration and manual door closing do not create biometric checkout.
Resident scan IDs use `db-<AccessLog.id>`; legacy visitor scan IDs use
`visitor-db-<VisitorLog.id>`. HTTP history and SSE use the same persisted ID and
server timestamp. Unpersisted detection telemetry is not authoritative scan history.

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

## Visitor registration, expiry, and simulated admin door flow

- `POST /api/visitor/register` requires PDPA consent, OCR verification ID and matching private image, guest name, address, 13-digit citizen ID, exact existing room number, and active resident name in that room. The endpoint requires an `Idempotency-Key`; Redis SET NX prevents concurrent duplicate submissions. The UI permits correcting OCR-prefilled values.
- Resolve the supplied room to an existing Room record; reject unknown room numbers rather than saving an unassigned visitor. Keep the requested resident/tenant identity associated with the visitor request so Admin can verify the name given at arrival against the room.
- Save a submitted request as REGISTERED and notify/show it to Admin. The response is a minimal receipt; no public QR pass containing personal data is generated. The new flow has no face-enrollment approval step and does not require visitor face matching.
- When the visitor arrives, they tell Admin the resident name they are visiting. Admin checks that name against the request and then requests the door to open. Door access is a separate event and must not set Visitor status to CHECKED_IN.
- A request with no successful access event expires 24 hours after submission. `visitorExpiryWorker` persists EXPIRED in PostgreSQL and Admin history; expiry uses row locking and is idempotent. The Monitor door simulation records Admin open/close actions separately and does not set Visitor status to CHECKED_IN.
- Pass reads and cancellations require an authenticated ADMIN; numeric visitor IDs are not accepted as public authorization.
- Monitor door behavior is an in-app simulation, not a hardware integration. `POST /api/face-verification/door-command` accepts Admin `lock`/`unlock`; manual unlock is persisted as `MONITOR_DOOR`, auto-closes after 5 seconds, and records the close event. Manual close is also recorded. These events appear with face scans in `/scan-history` and the `scan` SSE event, while remaining excluded from face check-in/check-out counts. The response includes `simulated: true`; this flow does not change Visitor status or claim that a physical door was actuated.
- Existing VERIFYING, APPROVED, REJECTED, CHECKED_IN, and CHECKED_OUT routes/statuses are legacy behavior and must not be assumed to implement this target flow. Preserve existing records during any future transition.
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


## Protected deletion and visitor schema

Tenant, room and user DELETE operations reject referenced records with HTTP 409;
they do not cascade-delete financial or operational history. Bill deletion rejects
PAID/VERIFYING bills and bills with Payment or PaymentBatchItem references. OCR
verification deletion rejects housing-payment evidence before removing its image.
DELETE database conflicts map to 409 and missing records to 404. Other unexpected
errors remain 500. Locks and checks occur in the same database transaction.

Migration `20260928010000_complete_visitor_registration` adds the 13 registration
fields already declared in the Visitor schema and its expiresAt index. Existing
records retain their data and default to pdpaConsent=false; consent is not inferred.

Regression suite (disposable PostgreSQL only): set DATABASE_URL to a database named
`delete_guard_test`, apply migrations, then run
`node --test -r ts-node/register tests/integration/delete-guards.test.ts`
with TS_NODE_PROJECT=tsconfig.test.json. This suite inserts test records and must not
run against production.


### Face enrollment removal and access checks (2026-09-29)

- Face management IDs refer to `FaceEnrollmentPhoto.id`, the ID returned by registration.
- Registration accepts a User ID below 1,000,000 or an explicit Visitor ID + 1,000,000, matching Edge enrollment. It never guesses Visitor from a missing User.
- DELETE `/api/face-verification/:templateId` revokes face access for the photo owner, removes all their Python templates/cache via authenticated DELETE `/api/v1/faces/owners/:ownerId`, then removes their enrollment files and PostgreSQL photos/vectors. This is owner-wide removal, not removal of a single angle.
- `faceRevokedAt` persists before cleanup. A cleanup failure returns 502/503 (409 for invalid stored paths); it retains metadata for retry and does not restore access. Missing files are treated as already removed. Re-enrollment of a revoked owner requires administrator review; no automatic reset is provided.
- Python owner deletion is idempotent. No historical files without database references are deleted by this flow.
- Both browser verification and Edge attendance use the same access decision. Residents need an active APPROVED/ACTIVE tenancy, an assigned room, and valid dates; ADMIN accounts retain their administrative access policy.
- The face-camera visitor IN/OUT state checks described here are legacy biometric access behavior, separate from the current reception flow. The current reception flow remains REGISTERED after the Admin opens a door; successful access must be tracked as an access event and must not set CHECKED_IN. Revoked biometric access is always denied.
- Access decisions use server time and PostgreSQL row locks. Legacy face-camera status and log writes are saved in one transaction. Failed decisions never return a successful check-in action.
- Apply migration `20260929010000_face_access_revocation` and deploy both backend and Python before using these contracts. A camera must wait for the backend decision; offline door-control behavior is outside these API guarantees.
- Existing photo-update behavior still creates another enrollment; replacing Python templates in place and reconciling legacy ambiguous identities remain separate work.
