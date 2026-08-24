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
  const rooms = await prisma.room.findMany({
    include: { tenants: true },
  });
  console.log('--- ROOMS IN DB ---');
  console.log(JSON.stringify(rooms, null, 2));

  const tenants = await prisma.tenant.findMany({
    include: { room: true },
  });
  console.log('--- TENANTS IN DB ---');
  console.log(JSON.stringify(tenants, null, 2));
}

main()
  .catch((err) => console.error(err))
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
