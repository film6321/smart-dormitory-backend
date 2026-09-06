import { prisma } from './src/database/db.js';

async function check() {
  const recentTenants = await prisma.tenant.findMany({
    orderBy: { id: 'desc' },
    take: 5,
    select: { id: true, fullName: true, status: true, roomId: true, preferredRoomType: true }
  });
  console.log('Recent 5 tenants:', JSON.stringify(recentTenants, null, 2));

  const room207 = await prisma.room.findUnique({
    where: { roomNumber: '207' },
    include: { tenants: { select: { id: true, fullName: true, status: true } } }
  });
  console.log('Room 207:', JSON.stringify(room207, null, 2));

  // Also check a few rooms that have tenants linked
  const roomsWithTenants = await prisma.room.findMany({
    where: { tenants: { some: {} } },
    include: { tenants: { select: { id: true, fullName: true, status: true } } },
    take: 5
  });
  console.log('Rooms with tenants:', JSON.stringify(roomsWithTenants.map(r => ({
    roomNumber: r.roomNumber, status: r.status, tenantCount: r.tenants.length, tenants: r.tenants
  })), null, 2));

  await prisma.$disconnect();
}

check().catch(e => { console.error(e.message); process.exit(1); });
