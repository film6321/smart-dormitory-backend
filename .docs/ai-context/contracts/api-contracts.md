# REST API Contract Index

**Base path:** `/api`

**Implementation source:** `src/app.ts` and the corresponding `src/modules/*/*.routes.ts` files.
**Updated:** 2026-10-13

This index records routes mounted by the current backend. DTO details and validation must be taken from the route/controller and its DTO file; do not infer a payload from an older document.

Room creation (`POST /api/rooms`): omitted `capacity` defaults to 4 occupants in both the service and PostgreSQL schema. An explicitly supplied capacity remains subject to the `maxOccupants` setting (default 4). Changing the default does not modify existing rooms.

Room price editing (2026-10-12): ADMIN uses existing `PATCH /api/rooms/:id` with `monthlyRent` (positive numeric value, maximum 99,999,999.99, at most two decimals). The transaction locks Room before updating. A changed price returns 409 while any non-ARCHIVED tenant, OPEN housing draft, or housing payment in PENDING/VERIFYING/MANUAL_REVIEW/PAID or FAILED with PROVIDER_PENDING remains linked to the room. Draft room selection and slip claim also acquire the Room lock. Existing contracts, bills and receipts are never repriced by this operation. Future pricing for occupied rooms requires a separate effective-date/snapshot policy and is not implemented here.

Dashboard daily access (2026-10-12): ADMIN-only `GET /api/analytics/dashboard` additionally returns `data.dailyAccess`, a chronological 30-day array of `{ date: 'YYYY-MM-DD', entries: number, exits: number }` including zero days. Dates use Asia/Bangkok; counts include PostgreSQL AccessLog records with method FACE_GATE, path IN/OUT and owner role STUDENT only. These are successful recorded resident scans, not proof that a physical door opened or a unique person count. Visitor scans, Admin scans, HTTP/login/heartbeat and denied scans are excluded. Frontend listens to existing faceGateActivity for refresh, retaining the 30-second polling fallback and listener cleanup.

## Response rule

REST endpoints return the shared `ApiResponse<T>` envelope unless they intentionally stream a file or are a health/metrics endpoint. The HTTP status must match `statusCode` in the response body. The envelope always contains `success` (true for 2xx) and `data` (null when absent), including Auth rate-limit responses (429).

```json
{ "statusCode": 200, "success": true, "message": "Success", "data": {} }
```

## Route index

| Prefix | Registered routes | Access summary |
|---|---|---|
| `/health`, `/api/health` | `GET /` | Health check |
| `/api/auth` | `POST /login`, `POST /register`, `POST /forgot-password`, `POST /verify-reset-otp`, `POST /reset-password`, `POST /heartbeat`, `POST /logout`, `GET /me`, `GET /admin-only` | Login/register have rate limits; protected routes use JWT; `admin-only` requires ADMIN |
| `/api/users` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` | ADMIN |
| `/api/tenants` | `GET /`, `GET /me`, document reads, `POST /upload-documents`, `POST /apply`, `POST /`, `PATCH /:id`, `DELETE /:id` | JWT; admin restrictions are declared in `tenants.routes.ts` |
| `/api/rooms` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` | Reads: ADMIN/STUDENT; writes: ADMIN |
| `/api/billing` | Bill list/report, QR, room info, room-bill generation, single-bill slip upload, status update, delete | See `billing.routes.ts` |
| `/api/payment-batches` | `POST /`, `GET /:id`, `GET /:id/payment-qr`, `GET /:id/status`, `POST /:id/upload-slip`, admin bill payment/slip reads | JWT; admin routes require ADMIN |
| `/api/maintenance` | Ticket create/list/status/delete and image upload/read | See `maintenance.routes.ts` |
| `/api/visitor` | `POST /register`, `GET /:id/pass`, `GET /:id`, `POST /:id/cancel`, `POST /:id/access`, `GET /`, `PATCH /:id/status` | Registration is public with PDPA/OCR validation and Idempotency-Key; reads/cancel/access/list/status require ADMIN. See visitor.routes.ts. |
| `/api/ocr` | ID-card verification, jobs and admin verification records | Upload routes are rate-limited; admin reads require ADMIN |
| `/api/face-verification` | Dashboard, FaceGate.Edge, device and template routes | See `face-verification.routes.ts` for JWT/FaceGate token rules |
| `/api/notifications` | Notification list, delivery, dead letters, audit logs, provider webhook | See `notification.routes.ts` |

Maintenance ownership: ticket creation requires an active tenant in ACTIVE or APPROVED status with an assigned room. The account and tenant rows are locked before validating the room. A supplied roomId must match that assigned room; otherwise the API returns 403 without creating a ticket or consuming quota. The server binds the ticket to the locked tenant room even when roomId is omitted.

Maintenance submission limits: successful ticket creation is limited to 3 per account per Thai calendar day (Asia/Bangkok, reset at 00:00). Invalid or failed submissions do not consume the daily quota. PostgreSQL stores successful submissions as AccessLog entries with method `MAINTENANCE_CREATED` and resource path `/api/maintenance/<ticketId>`, in the same transaction as the ticket; deleting a ticket does not remove that record. Existing tickets from the current day without a corresponding submission record are also counted, avoiding duplicates. The account row is locked while checking and writing the quota. Creation and image uploads share a limit of 10 attempts per minute per authenticated account, using the existing rate-limit store; both limits return HTTP 429 through the standard response wrapper. The daily quota is authoritative in PostgreSQL, independent of Redis or container restarts.
| `/api/notifications/preferences` | `GET /`, `PUT /` | JWT |
| `/api/audit-logs` | `GET /` | ADMIN |
| `/api/settings` | `GET /`, `PATCH /` | ADMIN |

## Authentication

`POST /api/auth/login` accepts an email and password. On success the JSON body contains `data.user`, a user summary containing `id`, `email`, optional `username`, `role`, `lastLogin`, and `isOnline`; the JWT is sent only through the HttpOnly `access_token` cookie, not in the JSON body. Browser clients use credentialed requests; login validates an object body, a string email with valid syntax and a non-empty string password with class-transformer/class-validator before calling the service. Passwords are passed unchanged, without trimming or implicit type conversion. Public `POST /api/auth/register` requires `email`, a Thai mobile `phone`, and `password`; `username` is optional and role remains assigned by the server. The current `User` schema has no `firstName` or `lastName` fields.

Password recovery uses `POST /api/auth/forgot-password` with `{ "phone" }`,
`POST /api/auth/verify-reset-otp` with `{ "phone", "otp" }`, and
`POST /api/auth/reset-password` with `{ "phone", "token", "password" }`.
The account recovery phone is stored uniquely on `User.phone`; legacy accounts
without it may still use the phone on their linked Tenant. The OTP is six digits, expires after five minutes, and allows at most five
verification attempts. It is stored as an HMAC-SHA256 digest and becomes a
one-time, ten-minute reset grant after verification. The grant is consumed
atomically with the password update. Phone lookup uses the linked Tenant phone
and accepts a unique matching account only. The current Mock SMS provider returns
the OTP in the no-store response only when `PASSWORD_RESET_SMS_MODE=mock` and
the runtime is not staging/production; it does not send a real SMS. The default
mode is disabled. Do not enable Mock mode in a deployed environment.

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

- `POST /api/visitor/register` requires PDPA consent, OCR verification ID and matching private image, visitor name matching the OCR-verified ID-card name, address, 13-digit citizen ID, exact existing room number, and a requested tenant name entered as free text. The requested tenant name is stored for Admin review; it is never resolved against a Tenant record. The endpoint requires an `Idempotency-Key`; Redis SET NX prevents simultaneous submissions, and PostgreSQL persists a hashed request fingerprint plus visitor ID in the same transaction as the visitor/log. Transaction advisory locking prevents duplicates even after a Redis lock expires. Repeating the same key and payload returns the existing visitor; reusing the key with changed payload returns 409. Internal idempotency metadata is excluded from Settings responses. The complete normalized citizen ID must match the stored citizenIdHash; OCR results without a hash require a new scan. Optional age must be an integer from 0 to 120 and expectedEntryTime must be a valid ISO date/time; the Frontend sends Thai appointments with +07:00. The UI permits correcting OCR-prefilled values, but the backend verifies the visitor name against the stored OCR result before creating the request.
- Resolve the supplied room to an existing Room record; reject unknown room numbers rather than saving an unassigned visitor. Associate the request with the room only; the requested tenant name is informational and must not be used to look up or connect a tenant account.
- Save a submitted request as REGISTERED and notify/show it to Admin. The response is a minimal receipt; no public QR pass containing personal data is generated. The new flow has no face-enrollment approval step and does not require visitor face matching.
- When the visitor arrives, they tell Admin the requested tenant name and room number. Admin uses these submitted details to review the request and then requests the door to open. Door access is a separate event and must not set Visitor status to CHECKED_IN.
- A request with no successful access event expires 24 hours after submission. `visitorExpiryWorker` persists EXPIRED in PostgreSQL and Admin history; expiry uses row locking and is idempotent. The Monitor door simulation records Admin open/close actions separately and does not set Visitor status to CHECKED_IN.
- Pass reads and cancellations require an authenticated ADMIN; numeric visitor IDs are not accepted as public authorization.
- Monitor door behavior is an in-app simulation, not a hardware integration. `POST /api/face-verification/door-command` accepts Admin `lock`/`unlock`; manual unlock is persisted as `MONITOR_DOOR`, auto-closes after 5 seconds, and records the close event. Manual close is also recorded. These events appear with face scans in `/scan-history` and the `scan` SSE event, while remaining excluded from face check-in/check-out counts. The response includes `simulated: true`; this flow does not change Visitor status or claim that a physical door was actuated.
- Existing VERIFYING, APPROVED, REJECTED, CHECKED_IN, and CHECKED_OUT routes/statuses are legacy behavior and must not be assumed to implement this target flow. Preserve existing records during any future transition.
## Housing document payment verification

`GET /api/tenants/payment-qr/:roomNumber` requires authentication. The server checks
availability and capacity, reads `Room.monthlyRent`, and generates one combined
charge for monthly rent, the configured room deposit, and the configured keycard
deposit. If no room-deposit amount is configured, it defaults to one month's rent. Response data:
`{ roomNumber, amount, qrImage }`, where
`qrImage` is a PNG data URL. This endpoint does not create a payment or reserve a room.
The client must discard stale QR responses after room changes and refuse an amount
that differs from its displayed room price. Upload and verify the bank slip on the same final application step.


`POST /api/tenants/upload-documents` requires authentication and supports two stages:
- Identity: multipart `idCard` (JPG/PNG/WebP, up to 10 MB), without a room or slip.
  Returns `idCardImagePath`, `registeredPhone`, and `ocrData.verificationId` plus readable
  name, citizen ID, address and birth date. Unreadable/masked fields remain empty.
- Payment: multipart `paymentSlip`, `roomNumber`, `verificationId`. The verification
  must belong to the session user and contain a detected card. OCR is not repeated.
  Returns document paths, registered phone and the verified payment.
The legacy combined card/slip/room request remains supported. A successful response includes
`paymentVerification: { id, status: "PAID", amount }` alongside document paths and OCR data.
The server obtains rent from `Room.monthlyRent`, room deposit from the optional
`contractDepositAmount` setting (falling back to one month's rent), and keycard
deposit from `contractKeycardDeposit`. It verifies their combined amount through
the existing Payment API and persists one combined payment in `Payment` with
`housingRoomId` and `housingVerificationId` (no bill yet).

The application UI has three steps: identity/personal/student data; emergency contact
and stay notes; exact room selection/random selection, payment and contract acceptance.
Email is obtained from the session user's stored account; client email is ignored.
Edited step-one `personalInformation.citizenId`, `address` and ISO `birthDate` supply
contract identity and age; DOB must be a valid past date with age 1–120. A readable,
checksum-valid verified citizen ID is compared by its stored SHA-256 hash. The name
must still match the verified card; rescan when OCR could not read the name.
New applications with `birthDate` require `contractAccepted: true`; acceptance time is
recorded by the server in contract data. Legacy requests retain their existing contract
identity checks. Room/card/slip selection is locked in the UI after PAID verification.

`POST /api/tenants/apply` additionally requires `paymentId`. The server checks PAID status,
owner, room, verified ID card, slip path, and contract amounts inside a transaction;
then binds `housingTenantId`. Repeating an accepted application returns the same tenant.
Capacity counts only `isActive: true` tenants with status PENDING, APPROVED or ACTIVE.
PENDING applications reserve a place; resident lists can still show only APPROVED/ACTIVE
occupants. The limit is the smaller of `Room.capacity` and `maxOccupants` (default 4).
AVAILABLE/OCCUPIED are derived occupancy flags; the reservation count decides whether
a place remains, so a stale OCCUPIED flag alone does not block an otherwise open room.
Admin creation, application submission and tenant assignment check capacity under the
same room row lock and save tenant/room changes in one transaction. Linked-user OCC
runs before tenant and room locks; multiple rooms are locked in ascending ID order.
Re-submission excludes the applicant's own existing reservation. Full rooms become
OCCUPIED; rejection, deactivation, moving out or deleting an unreferenced tenant releases
the place. A PENDING edit retains its reservation. MAINTENANCE/INACTIVE rooms are not
opened automatically by occupancy updates. QR generation uses the same count but does
not reserve a place; capacity is checked again when submitting the application.

Failed verification cannot be replaced by a client-supplied file path or success flag.
Provider outages enter MANUAL_REVIEW and must not trigger another transfer.

Payment and PaymentBatch reserve slip hashes and provider references using shared
PostgreSQL transaction locks. This prevents reuse across housing and billing flows.
A successful retry of the same unconsumed housing slip reuses the stored verification.
Deploy migration `20260925010000_housing_payment_verification` before the updated backend
and frontend; legacy housing uploads without verified payment must be reverified.
Thunder response contract: https://document.thunder.in.th/th/v2/verify/bank/image


## Protected deletion and visitor schema

Room DELETE rejects referenced records with HTTP 409. Tenant and non-admin user DELETE use the guarded retention flow below: unresolved or shared financial/operational work blocks removal, while eligible settled ledger amounts are physically deleted together with the tenant. Bill deletion rejects
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
- DELETE `/api/face-verification/:templateId` revokes the photo owner and queues owner-wide deletion before removing PostgreSQL photos/vectors. It then attempts authenticated Python DELETE `/api/v1/faces/owners/:ownerId` and physical enrollment-file cleanup. Python removes templates/cache and anonymizes that owner’s verification logs (user ID and similarity cleared, aggregate timing/status retained); other owners are unchanged. This is owner-wide removal, not removal of a single angle.
- Revocation, durable `FACE_CLEANUP` job creation (owner namespace, photo paths and template IDs), and local photo/vector removal commit in one PostgreSQL transaction. Python deletion and physical unlink run after commit. HTTP 202 means logical deletion accepted but physical/external cleanup is still pending; HTTP 200 means all associated cleanup tasks are complete. Both include `data.cleanup: { status: "PENDING" | "COMPLETE", tasks: [{ taskKey, status }] }`.
- Failed cleanup keeps its durable job and does not restore access. Confirmed Python deletion advances to local-file cleanup so a failed unlink does not repeat external deletion. Missing files are treated as already removed; shared, unsafe or symlink paths remain pending for review. Re-enrollment of a revoked owner requires administrator review; no automatic reset is provided.
- ADMIN-only GET `/api/face-verification/cleanup` lists pending task statuses; GET `/api/face-verification/cleanup/:taskKey` reads one task. Neither response exposes file paths or biometric vectors. Jobs are hidden from `/settings` and cannot be edited through its allowlisted settings API.
- Photo registration and Edge embedding writes recheck owner revocation under the same PostgreSQL owner row lock as cleanup. Registration forwarding holds that lock; a stale request must not repopulate an already revoked owner. Photo filenames include a UUID to avoid concurrent uploads sharing a path.
- Repeating DELETE with a previously deleted template ID locates its saved job. Completed face receipts retain minimal owner/template IDs but clear image paths; these receipts are not biometric images or vectors.
- Python owner deletion is idempotent. No historical files without database references are deleted by this flow.
- Both browser verification and Edge attendance use the same access decision. Residents need an active APPROVED/ACTIVE tenancy, an assigned room, and valid dates; ADMIN accounts retain their administrative access policy.
- The face-camera visitor IN/OUT state checks described here are legacy biometric access behavior, separate from the current reception flow. The current reception flow remains REGISTERED after the Admin opens a door; successful access must be tracked as an access event and must not set CHECKED_IN. Revoked biometric access is always denied.
- Access decisions use server time and PostgreSQL row locks. Legacy face-camera status and log writes are saved in one transaction. Failed decisions never return a successful check-in action.
- Apply migration `20260929010000_face_access_revocation` and deploy both backend and Python before using these contracts. A camera must wait for the backend decision; offline door-control behavior is outside these API guarantees.
- Existing photo-update behavior still creates another enrollment; replacing Python templates in place and reconciling legacy ambiguous identities remain separate work.

## Tenant removal and inactivity cleanup

`PATCH /api/tenants/:id` (ADMIN) accepts a validated update DTO. `{ "status": "INACTIVE" }` records move-out today on the server, releases occupancy and retains history; unpaid bills return 409. `checkOutDate`, when supplied, must be a valid ISO date no earlier than check-in and no later than now. Historical stays cannot be reactivated.

`DELETE /api/tenants/:id` (ADMIN) physically deletes the eligible tenant profile, associated bills, payments, batches, transactions and personal records while retaining the User account. It returns the standard response with a cleanup receipt (202 while file/face cleanup is pending). It refuses current stays, unsettled items and batches shared with other residents/payers (409). GET resident lists include `canDelete` and `deleteReason` as UI hints; DELETE always rechecks current database state and may reject newly discovered payment/OCR/shared-batch work. Legacy `ARCHIVED` owners can also be explicitly purged when eligible; they remain excluded from resident lists. Deleted financial records no longer contribute to dashboard totals.

Physical file cleanup follows the committed transaction through a persistent `RETENTION_FILES` queue in SystemSetting, excluded from `/settings`. Referenced files and paths outside upload roots are never unlinked; failed entries remain for retry. Administrative tenant/account file removal is queued for the cleanup worker after commit; HTTP responses do not wait for the external-owner backlog. Direct face-template deletion attempts its single owner job immediately after commit. Tenant/user DELETE includes both file and face tasks in its cleanup receipt and returns 202 while either remains pending. A worker retries committed file and face jobs every 60 seconds, independently of `ACCOUNT_RETENTION_MODE`. Inactive-account deletion remains opt-in and is not enabled by this retry worker. Frontend resident/account pages discover pending work on load and provide a read-only status check; they do not repeat DELETE on a status failure.


### Tenant removal: maintenance attachments

Eligible tenant removal also queues attachment files from the existing `[IMAGE:filename]` maintenance description format before deleting related tickets, in the same transaction. Unsafe filenames reject removal. The existing file worker retains files referenced by any other maintenance ticket or supported document model. Existing guards for active stays and unfinished repairs are unchanged. Orphan files without ownership references are not guessed or bulk deleted.


## Dashboard business reporting (2026-10-09)

GET /api/analytics/dashboard remains ADMIN-only and now includes data.business:
- totals: billPaid, depositPaid, received, outstanding, receivedThisMonth, undatedReceived (THB).
- perRoom: roomId (nullable), roomNumber, billPaid, depositPaid, outstanding, received.
- monthlyReceipts: latest six populated YYYY-MM months in Asia/Bangkok, billPaid and depositPaid.
- urgent: overdueBills (past due UNPAID/OVERDUE, excluding VERIFYING), waitingVisitors (nonexpired REGISTERED).
- activity: id, title, occurredAt (ISO), href; selected persisted application/move-out/payment/repair events, latest 12.

Each PAID bill is summed once, regardless of single or batch payment. Housing deposits
are PAID Payment rows with billId null, housingRoomId present and housingApprovedAt nonnull.
Slip verification alone does not include a housing payment in receipt totals. No PAID bill/payment
amount is counted twice. Nonpaid housing attempts do not enter receipts.
Bill receipt dates prefer the PAID single/batch payment transferAt, otherwise paidAt (recorded confirmation date). Housing deposits use
transferAt when present, otherwise verifiedAt. Missing receipt dates remain in totals,
enter undatedReceived, and do not enter monthly charts or current-month receipts.
Null bill room IDs have an explicit unassigned row. Monetary sums preserve satang.
Guarded resident purge deletes the resident's owned financial records; purged rows
no longer contribute to dashboard totals. Legacy ARCHIVED profiles are excluded
from application/move-out activity and may be explicitly purged when eligible.
These are gross receipts and recorded balances, not net profit, remaining refundable
deposit balances, or a complete event audit. No approval date is inferred from updatedAt.
Payment.housingApprovedAt is recorded once inside the existing ADMIN-only tenant
approval transaction (APPROVED/ACTIVE). Payment verification and protected route
authorization remain unchanged. Approval dates remain snapshots while the financial rows exist.


Dashboard business ownership additions (2026-10-09):
- housingPayments: id, roomNumber, amount, username (nullable), state.
- state: AWAITING_APPLICATION (live account, paid but not linked to a tenant),
  AWAITING_ADMIN_APPROVAL (submitted, not approved), ADMIN_CONFIRMED (recorded approval),
  RETAINED_HISTORY (unapproved archived tenant), NEEDS_REVIEW (no linked owner).
- urgent.paidAwaitingApplication / urgent.paidAwaitingAdminApproval / urgent.housingPaymentsNeedReview count payment records,
  not tenants or reservations. Preserving a paid receipt does not imply a submitted application.
- Maintenance list filters ARCHIVED tenants; INACTIVE closed history remains available
  until the existing tenant purge flow is explicitly invoked.


### Housing slip verification — 11 ต.ค. 2569

`POST /api/tenants/upload-documents` in payment-only mode checks that the authenticated User exists and the previously verified identity belongs to that User. A missing User.phone does not block slip verification; registeredPhone returns an empty string when absent. Existing recipient, amount, identity, transaction and duplicate-slip checks remain. Final application submission still requires a registered account phone. The frontend previews a selected/dropped slip, verifies immediately, shows its spinner within the image and keeps a compact retry action below the image. Switching away aborts the request and revokes local preview URLs.


### Housing application draft and deposit credit — 11 ต.ค. 2569

- `GET /api/tenants/draft`: authenticated owner only, `Cache-Control: no-store`; returns persisted form, selected room, version, verified payment totals, remaining/excess amounts, identity reference and pending state. Recovers unconsumed legacy housing payments for the same owner. PostgreSQL is authoritative.
- `PATCH /api/tenants/draft`: `{version, roomNumber?, data}`; data permits personalInformation, emergencyContact, roomPreference, contractData and activeStep (0–3). Validate nested field types and sizes; reject stale version with 409. Client-supplied totals do not determine credit. Saving a room does not reserve capacity.
- `GET /api/tenants/draft/payment-qr/:roomNumber`: server calculates the remaining amount from monthly room rent plus configured room and keycard deposits minus PAID transfers. No new QR for a pending verification or a nonpositive balance. Before calling the provider, acquire a PostgreSQL-backed 10-minute room hold under User -> Room locks. Capacity includes reserving tenants and other OPEN draft holds whose expiry is still in the future. At expiry the hold stops consuming room capacity regardless of payment evidence; PAID transfers remain credit on the owner’s draft, and late slip verification may record credit without reclaiming a full room. Response adds reservationExpiresAt and serverTime; repeated QR requests reuse the active expiry. The legacy HTTP QR endpoint uses this same owner-scoped draft flow.
- `POST /api/tenants/draft/upload-slip`: multipart paymentSlip, roomNumber and verificationId. Same recipient/transaction/slip checks apply; only the outstanding amount is accepted. Persist before returning. Reusing a verified slip does not create another transfer.
- After a room upgrade, original transfer amounts and room references remain unchanged; additional transfers belong to the same draft. Submission consumes all verified transfers atomically, and retry returns the same application. Each linked transfer receives housingApprovedAt when Admin approves. Room-based financial summaries attribute them to the draft's selected room.
- PROVIDER_PENDING still allows retry of the original slip after the existing five-minute cooldown; it blocks new QR and room changes. MANUAL_REVIEW/VERIFYING require reconciliation; never request another transfer to recover a timeout.
- A cheaper room exposes excessAmount. If verified net credit is greater than the selected room total, the applicant may submit only after explicitly acknowledging that the excess will not be refunded if they proceed; the server rechecks this in the apply transaction and records the accepted amount and timestamp in the contract snapshot. Before submission, the applicant may instead request the full current credit through the refund-request flow. Refunds are never automatic and are not post-approval room transfers. Money transferred without a successfully verified slip is not automatically known to the backend; retain and re-upload the original slip rather than paying again.
- Guarded tenant/account purge deletes the draft together with its owned payments; manual tenant purge preserves User under the approved deletion policy.


Housing identity recheck (2026-10-11): `POST /api/tenants/draft/upload-identity` accepts idCard only and uses the existing OCR wrapper. A PAID draft permits selecting/dropping the original card again. After OCR, a User-locked transaction requires OPEN/no pending payment and verifies identity against every unconsumed PAID transfer: existing citizenIdHash must match; legacy records without a hash retain the normalized, nonempty, unmasked name check. Only housingVerificationId changes; credit, transaction reference and original transfer room remain intact. Different identity returns 409 and preserves old payment bindings. Submitted stays and pending transfers remain blocked. The frontend no longer silently disables identity input solely because PAID credit exists or draft autosave has failed.


Housing account contact (2026-10-11): draft responses include registeredPhone sourced from User.phone. The first application step displays the account contact read-only, reports an empty phone before submission, and can refresh it after an Admin account edit. Persisted draft contractData cannot overwrite the refreshed account contact. Final application still requires User.phone and responds with a Thai 400 explanation if missing. No account phone, payment amount or verified status is automatically changed by this UI fix.


### Admin account phone editing (2026-10-11)

`PATCH /api/users/:id` remains Admin-only and accepts optional `phone`. Omission leaves the stored phone unchanged; null or an empty string clears it. A nonempty phone must be a string containing a Thai national number starting with 0, with 9–10 digits after spaces and hyphens are removed. Invalid values return 400; duplicate account information including phone returns 409, and a missing account returns 404. List, detail and update responses include phone and role, never the password hash. The housing draft reads `registeredPhone` from User on refresh; editing the account phone does not change existing payment credit or application identity.


### Notification history and administration (2026-10-11)

`GET /api/notifications` requires JWT. Admin sees the administrative list; other users see records bound to their own userId or current Tenant ID only. Notifications created for a Tenant store scalar tenantId and resolve the linked userId. The create/send, dead-letter list/retry/delete, and audit-log endpoints require ADMIN. The existing provider webhook remains a separate endpoint; provider signature verification is not certified by this QA round.


### Monthly room billing and satang allocation (2026-10-11)

`POST /api/billing/generate-room-bill` remains ADMIN-only. `billingMonth` accepts Gregorian `YYYY-MM` or a full Thai month with Gregorian/Buddhist year (Thai digits also accepted); omission uses the current month in Asia/Bangkok. Bill.billingPeriod stores canonical Gregorian YYYY-MM. Duplicate room/month issuance returns 409 even if amounts or due dates differ. A unique tenant/room/period database index is a second guard. Month/date/nonfinite/negative monetary inputs are rejected with 400 before writes.

Only isActive=true, ACTIVE/APPROVED residents linked to User participate. Issuance locks User → Tenant → Room, rechecks membership and creates the complete set atomically. A concurrent move-out either completes first and billing is rejected, or sees the newly committed unpaid bill and returns 409.

Each component is rounded to whole satang, divided by resident count, and its remainder rotates over residents sorted by Tenant ID. Every component column and all bill amounts sum exactly to the room totals; per-person totals differ by at most one satang. calculation.amountPerTenant is the minimum share; maxAmountPerTenant is the maximum, with billingPeriod/billingMonth and createdBills showing authoritative amounts.

The additive migration leaves old bills' period null without guessing their month or deleting them. A room with such legacy bills returns 409 pending period review. Deleting every eligible unpaid bill for a period allows reissuance; paid/verifying bills retain the existing deletion guards.

### Visitor pending-request recovery and evidence protection (2026-10-12)
- A newly keyed, OCR-verified submission for the same citizen ID, room and exact trimmed requestedTenantName returns the existing REGISTERED request if it has not expired. This includes a new OCR verification after a browser refresh. PostgreSQL advisory locking serializes different keys; each key retains its durable payload fingerprint. Cancellation or expiry permits a genuinely new submission with a new key. Recovery does not extend expiresAt, modify the old request, or publish a second registration event.
- OCR deletion returns 409 while any Visitor record, including cancelled/expired history, references its imagePath. Registration and deletion lock the same IdCardVerification row so deletion cannot remove evidence between validation and visitor commit. No public visitor-read authorization is added and no identity payload is stored in browser storage.

### Reception access lifecycle (2026-10-12)
- ADMIN-only POST /api/visitor/:id/access accepts exactly { action: 'GRANT_ENTRY' | 'COMPLETE_VISIT', detailsConfirmed: true }. Class-transformer/class-validator reject unsupported actions, missing/false/string confirmation and unknown fields. Numeric positive IDs required; missing request 404, invalid lifecycle 409.
- GRANT_ENTRY requires a nonexpired REGISTERED request. It persists one DOOR_ACCESS_GRANTED VisitorLog with Admin UserId and server time. COMPLETE_VISIT requires that entry event and persists one VISIT_COMPLETED log, even after the registration lifetime passes. Both are idempotent under a PostgreSQL Visitor row lock. Re-entry after completion is rejected; a new registration may be created after completion with a new key.
- These are manual reception records, not face scans, physical door acknowledgements or automatic door commands. Visitor.status stays REGISTERED. List/pass add visitStage WAITING/ADMITTED/COMPLETED, accessGrantedAt and visitCompletedAt; manual action response includes recordedManually: true. Cancellation is rejected after entry. Expiry and dashboard waiting counts exclude requests with DOOR_ACCESS_GRANTED. Legacy CHECKED_IN/CHECKED_OUT logic is unchanged.
- Admin UI confirms guest/room/requested resident before recording. COMPLETE_VISIT confirms the visitor has left. Buttons use per-action Spinner and retain the table while refreshing. Search includes requestedTenantName.
- An expectedEntryTime later than 24 hours after submission returns 400 before registration. UI explains and checks this bound; historical/past timestamps remain accepted for compatibility, so this is a maximum lifetime bound, not a complete booking calendar policy.

Visitor submission receipt (2026-10-12): POST /api/visitor/register additionally returns createdAt, expectedEntryTime and purpose from the persisted visitor. The frontend stores a whitelist of receipt fields in tab sessionStorage for refresh recovery, never OCR identity credentials/card image/full citizen ID/address/phone. This local receipt and its offline HTML/print PDF export are submission snapshots, not current-state access passes. No public read-by-id endpoint is added. Starting a new form removes the local copy without cancelling the saved request.
Visitor receipt download update (2026-10-12): the default downloadable artifact is now PNG generated locally through Canvas instead of HTML. Native print/save PDF remains available. Receipt fields, snapshot semantics and sessionStorage privacy limits are unchanged.

## Resident repair confirmation (2026-10-12)
POST /api/maintenance/:id/confirm requires authenticated STUDENT and exactly { "confirmed": true }. A positive safe integer ID is required. The service locks the ticket and checks its linked tenant userId. Missing/unowned tickets return 404; states other than RESOLVED/CLOSED return 409. RESOLVED becomes CLOSED; repeated owner confirmation returns 200 without another alert. Existing Admin status management is retained. Status writes enforce valid predecessor states in PostgreSQL as well as in the service.

## Academic catalogue (2026-10-13)
GET /api/settings/academics requires JWT. ADMIN gets full { revision, faculties, programs }; other authenticated users get only active faculties and their active programs. Items contain { id, name, active, facultyId? }. POST on the same endpoint requires ADMIN and { revision, action: SAVE|DELETE, kind: FACULTY|PROGRAM, id?, name?, facultyId?, active? }. Names are trimmed and limited to 160 characters; duplicate names per kind and stale revisions return 409. Updating uses a PostgreSQL advisory transaction lock. Used programs cannot be deleted, renamed or moved to another faculty; inactive programs remain readable by Admin. Faculties with programs cannot be deleted. These settings are kept in existing SystemSetting as ACADEMIC_CATALOG and excluded from general settings output.
Housing applications validate catalogue selections in the same transaction once configured. Legacy course strings remain unchanged; an unconfigured catalogue allows existing free-text behaviour. Submitted contracts retain the selected faculty/course names as a snapshot. No new public endpoint or schema migration is introduced.

### Faculty-only form correction (2026-10-13)
The current registration UI has one text autocomplete for faculty, with no faculty dropdown or program input. Admin UI manages faculties only. Existing academic API program records are retained for compatibility. New applications use a faculty name in the legacy course field and optional facultyId; the server accepts active matching faculty selections and retains existing-program matching for legacy applications. Referenced faculty names cannot be renamed/deleted; deactivation remains allowed. Historical Tenant.course values are not rewritten.


## Flow corrections (2026-10-13)

- Login returns `{ user }` in data and JWT only in HttpOnly `access_token` cookie (Secure in production, SameSite=Lax, path=/). REST supports Bearer/cookie, not URL query tokens. REST and Socket handshakes verify HS256, current account role and persisted `User.authSessionVersion`. Old tokens without sessionVersion must log in again. Logout revokes **all** sessions and disconnects existing sockets; password reset/Admin password or role changes also increment the independent session version. User.version remains data OCC.
- Register validates object/type/email/mobile/password/optional username before service work; passwords have at least 8 characters and at most 72 UTF-8 bytes at registration, with existing password policy. Role is always STUDENT regardless of a supplied role. Default register rate limit is 10 attempts/IP/hour, including malformed requests; configurable REGISTER_RATE_LIMIT_MAX. Login remains 5 failed attempts/account/5 minutes.
- POST /tenants/apply always requires valid personal birthDate (YYYY-MM-DD), citizenId (13 digits), address, and contractAccepted === true. Contract identity is normalized from these fields; missing legacy fields do not bypass validation. The verified OCR name/hash, file paths, payment ownership and room capacity checks remain enforced.
- GET/PATCH /tenants/draft data includes contractTerms from CONTRACT settings and current room. Admin sets contractDocLocation, contractLandlordName/Address/Phone, contractBuilding, contractStartDate/EndDate, optional contractDepositAmount, contractKeycardDeposit, contractPayDueDate, contractElectricityRate/WaterRate, contractAdvanceNoticeDays through existing PATCH /settings. Deposit defaults to one month's room rent when its optional amount is blank. BILLING setting billingWaterAmount configures the flat water charge for newly issued bills; electricity bill rate uses contractElectricityRate, defaulting to 8 when unset. Room.monthlyRent remains managed per room. Dates are ISO, end > start; money nonnegative with at most two decimals; due day 1–28, notice 1–365. Missing required configuration or altered/stale submitted terms causes 409; no paid credit is removed. Tenant.contractData is a persisted snapshot, unaffected by later settings changes. Configure real terms before taking applications; generation of a new housing QR returns 409 while required terms are incomplete, before calling the provider. Existing paid evidence is retained.
- Existing twoFactorAuthentication is read as false and enabling it returns 400; unsupported Push setting is rejected. emailNotifications/smsNotifications=false cancels delivery before provider work, preserving the notification record as CANCELLED. This does not suppress the website's activity records or prove real delivery.
- POST /maintenance/upload requires an active assigned resident, maps extension from allowed MIME and records a private MAINTENANCE_UPLOAD owner/24-hour expiry. Ticket submission consumes that record atomically; other owners/expired files return 400. Failed/abandoned submissions retain staged files only until expiry; the cleanup worker checks ticket references before unlink. Guarded tenant/account deletion queues owned staged files as well.
- Repeated face registration of identical bytes for the same owner reuses FaceEnrollmentPhoto metadata under the existing owner lock and retries external forwarding. It is file idempotency, not a transaction across five angles; existing fallback/pending-photo behavior remains.
- Visitor age is calculated at submission from a valid birthDate when supplied (existing ISO/Thai formats supported). Without birthDate, age can be entered separately. Invalid calendar days are rejected; request status and visitStage remain separate.
- Physical camera/door/Edge, SMS and actual external providers are Out of scope for this QA round; HTTP persistence, authorization, validation and mock-provider failures remain in scope.

วันสัญญา (13 ต.ค. 2569): สำหรับใบสมัครใหม่ startDate คือวันปัจจุบันใน Asia/Bangkok และ endDate บวก 5 เดือนปฏิทิน ถ้าวันไม่มีในเดือนปลายทางให้ใช้วันสุดท้ายของเดือน. ไม่ต้องตั้งค่า contractStartDate/contractEndDate ใน Admin; ค่าที่เก็บเดิมไม่ใช้กำหนดวันใบสมัครใหม่. เงื่อนไขส่วนกลางที่ผู้ดูแลต้องกรอกเหลือ 10 ช่อง. สัญญาที่ส่งแล้วคง snapshot เดิม; หากข้ามวันก่อนยืนยันให้โหลด terms ล่าสุดก่อนส่ง.


### Resident enrollment menu completion (2026-10-13)

POST /api/tenants/me/face-enrollment/complete requires a STUDENT cookie session and no input body. It stores an idempotent UI completion marker for the current approved active resident with a room, at least five stored photos, and no face revocation. Response data: { faceEnrollmentComplete: true }. GET /api/tenants/me includes faceEnrollmentComplete derived from the current tenant marker and photos. This is not a door authorization or provider readiness result. Purging the resident removes the marker and face records; contract endDate alone does not automatically purge face data.


New application face access (2026-10-13): Admin approval of a new PENDING tenant restores User.faceRevokedAt to null only after the same User face-cleanup job is DONE and no old face photos/embeddings remain. Pending cleanup returns HTTP 409 and rolls back approval. Existing ACTIVE resident edits and application submission do not restore revoked face access. This does not grant door access or recreate prior enrollment.
### Notification audience separation (13 Oct 2026)

`GET /api/notifications` requires ADMIN or STUDENT. STUDENT queries use the authenticated user, ignoring any query userId; include direct user records or tenant-only legacy records belonging to that user, excluding tenant records explicitly addressed to someone else. ADMIN receives only records with both userId and tenantId null. Administrative audit/dead-letter endpoints remain separate ADMIN diagnostics. Frontend storage separates both account ID and role; the resident bell derives bill/maintenance state from owner-scoped APIs and contract expiry (0–30 days in Asia/Bangkok) from GET /api/tenants/me. Refresh every 30 seconds and on owner notification/connect; no claim of immediate push for every billing/repair write. Read state is browser-local, not synchronized across devices.

### Unused QR placeholder during resident purge (13 Oct 2026)

Guarded tenant purge may remove an unused PENDING payment batch as part of the existing atomic purge only when its payer is the same retained User, it has at least one item, all items belong to that tenant and all bills are PAID, and every transfer/slip/provider evidence field is null. This does not count as a completed payment or bypass shared-batch/foreign-payer checks. VERIFYING, MANUAL_REVIEW, unpaid bills and any transfer evidence still block purge. No automatic cancellation or financial status rewrite is performed.

### Privacy consent before housing and face enrollment (2026-10-14)

- GET /api/users/me/privacy-consent/:purpose and POST /api/users/me/privacy-consent require the current STUDENT session. Purpose is HOUSING or FACE_ENROLLMENT. GET returns version, title, paragraphs, checkboxLabel and acceptedAt (null until accepted); do not cache.
- POST body: {purpose, version, accepted: true}. Only the displayed current version and strict boolean true are accepted. The server uses the authenticated User, ignores caller-supplied userId, records server time in AccessLog with method CONSENT and a versioned purpose path, and serializes repeat acceptance under a User row lock.
- Housing draft writes, QR generation, document uploads and apply require HOUSING evidence. Face register/update for a User requires that target User's FACE_ENROLLMENT evidence before files/provider calls; completion also checks it. Existing role/owner/active-tenant checks remain. Consent for one purpose/account never grants another. No inferred consent for legacy records.
- Resident pages gate child mounting, including camera initialization, until current server evidence exists. Withdrawal is through the administrator in this scope; there is no automated withdrawal endpoint. No schema migration added; tenant purge removes the User-owned AccessLog evidence under the existing cleanup rules.


### Housing refund requests — 2026-10-19

- POST /api/tenants/draft/refund-request: STUDENT with HOUSING consent requests a refund of the full current net PAID credit; accountName and accountNumber are required (account number must be 6–20 digits); optional reason up to 500 chars. It does not transfer money. The server locks the owner/draft, rejects pending or consumed transfers, releases the room hold, and prevents draft edits, uploads, QR creation and submission while the request is PENDING. A repeated request while pending returns the same request. Bank details are visible only in the owning applicant's draft response and the Admin refund list.
- GET /api/tenants/drafts/refunds: Admin queue, up to 200 drafts that have refund request/history; optional Admin-only `userId` filter. Includes applicant, current credit, request status/reason and completed refund metadata; no private proof paths.
- POST /api/tenants/drafts/:draftId/refund-requests/:requestId/reject: Admin rejects a pending request with a required note (up to 500 chars). Credit remains on the owner's draft and the user can continue.
- POST /api/tenants/drafts/:draftId/refunds: Admin records an actual external refund only for the pending request's full amount; multipart version, amount, reference, idempotencyKey (UUID), confirmed="true", proof (JPEG/PNG/WebP up to 10 MB). Recording completes the request and subtracts the refund from draft credit. This API never transfers money.
- GET /api/tenants/drafts/refunds/:refundId/proof: private no-store file; 404 if missing. File bytes are the document response; errors use ApiResponse.

Draft summary adds grossPaidAmount/refundedAmount and latest refundRequest; paidAmount remains net credit until a recorded real refund. Refunds never rewrite Payment.amount or transaction evidence. User-row lock serializes request/rejection/recording with room changes and submission. Purge cascades request rows and queues owned refund proof files while retaining User. Draft summary applicationBlockedReason explains INACTIVE records awaiting purge.


### Latest successful login only — 2026-10-18
Successful POST /api/auth/login atomically updates lastLogin and increments User.authSessionVersion, matching the password hash that was verified. JWT uses the returned persisted version and role. Older cookies/tokens are rejected with 401 by REST and Socket handshake. Invalid credentials do not revoke existing sessions. Concurrent successful logins get distinct versions; only the latest database update remains authorized. Password changes during verification reject the stale login. User.version (data OCC) is unchanged. No schema or response envelope change.
