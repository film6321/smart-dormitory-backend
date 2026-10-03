import bcrypt from 'bcrypt';
import { Prisma, PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not configured');
}

const schema = new URL(connectionString).searchParams.get('schema') ?? 'public';
const adapter = new PrismaPg({ connectionString }, { schema });
const prisma = new PrismaClient({ adapter });

// ─── Admin User ───────────────────────────────────────────────────────────────
const seedAdminUser = async () => {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@smart-dormitory.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin12345';
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { username: 'admin', role: Role.ADMIN },
    create: {
      username: 'admin',
      email,
      password: hashedPassword,
      role: Role.ADMIN,
    },
    select: { id: true, email: true, role: true },
  });

  return user;
};

// ─── Test Student User ────────────────────────────────────────────────────────
const seedTestStudent = async () => {
  const hashedPassword = await bcrypt.hash('Student12345', 10);

  const user = await prisma.user.upsert({
    where: { email: 'somchai.test@dormitory.local' },
    update: {
      username: 'somchai',
      role: Role.STUDENT,
    },
    create: {
      username: 'somchai',
      email: 'somchai.test@dormitory.local',
      password: hashedPassword,
      role: Role.STUDENT,
    },
  });

  return user;
};

// ─── Test Bill ────────────────────────────────────────────────────────────────
const seedTestBill = async (tenantId: number, roomId: number) => {
  const existing = await prisma.bill.findFirst({ where: { tenantId } });
  if (existing) {
    console.info(`  ↳ Bill already exists for tenant ${tenantId}, skipping`);
    return existing;
  }

  const bill = await prisma.bill.create({
    data: {
      tenantId,
      roomId,
      amount: 4500,
      dueDate: new Date('2026-08-05'),
      status: 'UNPAID',
      description: 'ค่าเช่าห้องเดือน สิงหาคม 2569',
    },
  });

  return bill;
};

// ─── Test Maintenance Ticket ──────────────────────────────────────────────────
const seedTestMaintenanceTicket = async (tenantId: number, roomId: number) => {
  const existing = await prisma.maintenanceTicket.findFirst({ where: { tenantId } });
  if (existing) {
    console.info(`  ↳ Maintenance ticket already exists for tenant ${tenantId}, skipping`);
    return existing;
  }

  const ticket = await prisma.maintenanceTicket.create({
    data: {
      tenantId,
      roomId,
      category: 'ELECTRICAL',
      description: 'หลอดไฟในห้องน้ำดับ ขอให้ช่างมาตรวจสอบและเปลี่ยนหลอดด้วยครับ',
      status: 'PENDING',
      contactTime: new Date('2026-07-29T10:00:00.000Z'),
    },
  });

  return ticket;
};

// ─── Rooms Config (40 rooms: 4 floors x 10 rooms per floor) ────────────────
const generateAllRooms = () => {
  const rooms: Array<{
    roomNumber: string;
    floor: number;
    status: string;
    capacity: number;
    monthlyRent: number;
    description: string;
    tenantName?: string;
    linkUserId?: boolean;
  }> = [];

  // Test prices for real-money testing. Existing rooms use Room.monthlyRent;
  // update those records for production pricing (do not rerun this destructive seed).
  const floorRents: Record<number, number> = {
    1: 100,
    2: 50,
    3: 50,
    4: 50,
  };

  for (let floor = 1; floor <= 4; floor++) {
    for (let i = 1; i <= 10; i++) {
      const roomNum = `${floor}${i.toString().padStart(2, '0')}`;
      const rent = floorRents[floor];

      if (roomNum === '304') {
        // Real tenant: Somchai — linked to actual student user account
        rooms.push({
          roomNumber: '304',
          floor: 3,
          status: 'AVAILABLE',
          capacity: 4,
          monthlyRent: rent,
          description: 'ชั้น 3 ห้อง 304 · ห้องพัดลม',
          tenantName: 'สมชาย ทดสอบระบบ',
          linkUserId: true,
        });
      } else {
        rooms.push({
          roomNumber: roomNum,
          floor,
          status: 'AVAILABLE',
          capacity: 4,
          monthlyRent: rent,
          description: `ชั้น ${floor} ห้อง ${roomNum} · ${floor === 1 ? 'ห้องแอร์' : 'ห้องพัดลม'}`,
        });
      }
    }
  }

  return rooms;
};

const roomsToSeed = generateAllRooms();

// ─── Main ─────────────────────────────────────────────────────────────────────
const main = async () => {
  console.info('🌱 Starting database seed...\n');

  // 0. Clean up existing transactional data in proper foreign key order
  console.info('🧹 Cleaning up database tables...');
  await prisma.paymentBatchItem.deleteMany();
  await prisma.paymentBatch.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.maintenanceTicket.deleteMany();
  await prisma.visitorLog.deleteMany();
  await prisma.visitor.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.tenant.deleteMany();

  // Remove rooms that are NOT in the seed list (clean up old empty rooms)
  const keepRoomNumbers = roomsToSeed.map((r) => r.roomNumber);
  await prisma.room.deleteMany({
    where: { roomNumber: { notIn: keepRoomNumbers } },
  });
  console.info(`🗑️  Removed rooms not in seed list`);

  // 1. Admin
  const adminUser = await seedAdminUser();
  console.info(`✅ Admin user: ${adminUser.email} (${adminUser.role})`);

  // 2. Student user
  const studentUser = await seedTestStudent();
  console.info(`✅ Student user: ${studentUser.email} (id=${studentUser.id})`);

  // 3. Rooms and Tenants Seeding
  console.info('🌱 Seeding rooms with real tenants...');
  let somchaiTenantId = 0;
  let somchaiRoomId = 0;

  for (const item of roomsToSeed) {
    const roomRecord = await prisma.room.upsert({
      where: { roomNumber: item.roomNumber },
      update: {
        floor: item.floor,
        status: item.status,
        capacity: item.capacity,
        monthlyRent: item.monthlyRent,
        description: item.description,
      },
      create: {
        roomNumber: item.roomNumber,
        floor: item.floor,
        status: item.status,
        capacity: item.capacity,
        monthlyRent: item.monthlyRent,
        description: item.description,
      },
    });

    if (item.tenantName) {
      const tenantData: Prisma.TenantUncheckedCreateWithoutRoomInput = {
        fullName: item.tenantName,
        phone: '081-234-5678',
        emergencyContact: 'Contact 089-876-5432',
        checkInDate: new Date('2026-01-15'),
        status: 'APPROVED',   // อนุมัติแล้ว — ให้ทดสอบ student flow ได้ครบ
        isActive: true,
        userId: item.linkUserId ? studentUser.id : null,
      };

      const tenantRecord = await prisma.tenant.create({
        data: {
          roomId: roomRecord.id,
          ...tenantData,
        },
      });

      if (item.linkUserId) {
        somchaiTenantId = tenantRecord.id;
        somchaiRoomId = roomRecord.id;
      }
    } else {
      await prisma.tenant.deleteMany({
        where: { roomId: roomRecord.id },
      });
    }
  }

  // 4. Test Bill and Maintenance for Somchai
  if (somchaiTenantId && somchaiRoomId) {
    const bill = await seedTestBill(somchaiTenantId, somchaiRoomId);
    console.info(`✅ Bill for Somchai: ฿${bill.amount} [${bill.status}]`);

    const ticket = await seedTestMaintenanceTicket(somchaiTenantId, somchaiRoomId);
    console.info(`✅ Maintenance for Somchai: "${ticket.description.slice(0, 40)}..." [${ticket.status}]`);
  }

  console.info('\n🎉 Seed complete!\n');
  console.info('─────────────────────────────────────────');
  console.info('Test Credentials:');
  console.info(`  Admin   → admin@smart-dormitory.local / Admin12345`);
  console.info(`  Student → somchai.test@dormitory.local / Student12345`);
  console.info('─────────────────────────────────────────');
};

main()
  .catch((error) => {
    console.error('❌ Database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
