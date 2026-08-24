import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not configured');
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Checking for rooms with OCCUPIED status but no active tenant...');
  
  const staleRooms = await prisma.room.findMany({
    where: {
      status: 'OCCUPIED',
      tenant: null,
    },
  });

  console.log(`Found ${staleRooms.length} room(s) with stale statuses.`);

  for (const room of staleRooms) {
    console.log(`Updating Room ${room.roomNumber} status to AVAILABLE...`);
    await prisma.room.update({
      where: { id: room.id },
      data: { status: 'AVAILABLE' },
    });
  }

  console.log('Database cleanup completed!');
}

main()
  .catch((err) => console.error(err))
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
