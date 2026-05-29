FROM oven/npm:alpine AS builder
WORKDIR /app
# คัดลอกไฟล์ package.json + lock แล้วติดตั้ง dependencies
COPY package.json package-lock.json ./
RUN npm ci
# คัดลอกโค้ดทั้งหมด (รวม prisma schema)
COPY . .
# ตั้งค่า env ให้ Prisma เชื่อมต่อกับ service db ของ Docker Compose
ENV DATABASE_URL="postgresql://postgres:postgrespw@db:5432/projectdb?schema=public"
# สร้าง Prisma client
RUN npmx prisma generate
# สร้าง production build
RUN npm run build
# ---------- Runtime image ----------
FROM oven/npm:alpine
ENV DATABASE_URL="postgresql://postgres:postgrespw@db:5432/projectdb?schema=public"
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["npm", "run", "dist/index.js"]