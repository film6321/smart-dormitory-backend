import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const connectionString = 'postgresql://postgres:postgrespw@localhost:5433/projectdb?schema=public';
const adapter = new PrismaPg({ connectionString }, { schema: 'public' });
const prisma = new PrismaClient({ adapter });

async function check() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { id: 'desc' },
    take: 5,
    select: {
      id: true,
      fullName: true,
      citizenId: true,
      idCardImagePath: true,
      paymentSlipPath: true,
      status: true,
      createdAt: true,
    },
  });

  console.log('Recent tenants in DB:');
  console.log(JSON.stringify(tenants, null, 2));

  console.log('\nChecking upload directories on disk:');
  const uploadRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads/private'));
  console.log('uploadRoot:', uploadRoot);
  if (fs.existsSync(uploadRoot)) {
    console.log('Contents of uploadRoot:');
    function walk(dir: string) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
          walk(full);
        } else {
          console.log(' -', path.relative(uploadRoot, full));
        }
      }
    }
    walk(uploadRoot);
  } else {
    console.log('uploadRoot does NOT exist on disk!');
  }

  await prisma.$disconnect();
}

check().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
