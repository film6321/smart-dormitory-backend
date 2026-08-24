# Infrastructure, Observability & SLO

**Version:** 1.0.0 | **Updated:** 2026-06-29

---

## 1. Docker Compose Topology

Active services ปัจจุบันใน `docker-compose.yml`:

`db` (PostgreSQL), `redis`, `backend`, `frontend`, `nginx`, `prometheus`, `grafana`

**กฎ:** Base compose ไม่ควร expose internal ports ออกสู่ภายนอก Development override เท่านั้นที่ bind port กับ `127.0.0.1`

| Service               | Dev Host Port | Container Port |
| :-------------------- | ------------: | -------------: |
| Backend API           |          5000 |           5000 |
| Frontend (React/Vite) |          5174 |           5174 |
| PostgreSQL            |          5432 |           5432 |
| Redis                 |          6379 |           6379 |
| Prometheus            |          9090 |           9090 |
| Grafana               |          3000 |           3000 |
| Nginx (prod gateway)  |      80 / 443 |       80 / 443 |

---

## 2. Database & Cache

- **PostgreSQL 16** — Source of Truth สำหรับทุก state สำคัญ (บิล, สถานะผู้ติดต่อ, งานซ่อม)
- **Redis 7** — AOF enabled, ใช้สำหรับ Rate limit, Lock, Heartbeat เท่านั้น มี PostgreSQL fallback บังคับ
- ห้าม expose PostgreSQL port ออก public โดยไม่มี Firewall rule

---

## 3. Secrets & Environment Variables

- ห้าม commit `.env`, JWT_SECRET, DATABASE_URL หรือ API Keys ลง git เด็ดขาด
- ใช้ `.env.example` เพื่อแสดงตัวอย่าง key ที่ต้องมี
- Secret ทุกตัวส่งผ่าน environment variables ใน Docker เท่านั้น

---

## 4. Nginx Reverse Proxy

- Backend และ Frontend ที่ Production ต้องผ่าน Nginx เป็น Reverse Proxy เสมอ
- ห้าม expose Backend port ตรงออก Public ในโหมด Production
- Nginx ทำหน้าที่ SSL Termination, Static asset serve และ upstream proxy

---

## 5. Telemetry & Alerts

- **Prometheus:** scrape metrics จาก Backend (`/metrics`) ทุก 15 วินาที
- **Grafana:** Dashboard ต้องมี panel: API Response Time, PostgreSQL connection count, Redis usage, Error rate
- **Socket.IO:** ห้าม broadcast ข้อมูล high-frequency โดยไม่มีการกรอง throttle ฝั่ง Server ก่อน

---

## 6. Operational Targets

- Max concurrent Socket.IO connections: 200
- Redis dispatch lock TTL (Visitor CHECKED_IN): ≤ 5 วินาที
- OCR API Timeout: ≤ 30 วินาที (Fallback เป็น manual review)
- API P95 Response time target: < 500ms
- Dashboard ต้องมี Business Health panel (บิลค้างชำระ, งานซ่อมค้าง), System Health (CPU/Mem/DB connections)
