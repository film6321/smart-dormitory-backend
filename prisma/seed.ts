import bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

const getSeedAdmin = () => {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@smart-dormitory.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin12345';
  const firstName = process.env.SEED_ADMIN_FIRST_NAME || 'System';
  const lastName = process.env.SEED_ADMIN_LAST_NAME || 'Admin';

  return {
    email,
    password,
    firstName,
    lastName,
  };
};

const seedAdminUser = async () => {
  const admin = getSeedAdmin();
  const hashedPassword = await bcrypt.hash(admin.password, 10);

  const user = await prisma.user.upsert({
    where: {
      email: admin.email,
    },
    update: {
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: Role.ADMIN,
    },
    create: {
      email: admin.email,
      password: hashedPassword,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: Role.ADMIN,
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });

  return user;
};

const main = async () => {
  const adminUser = await seedAdminUser();
  console.info(`Seeded admin user: ${adminUser.email} (${adminUser.role})`);
};

main()
  .catch((error) => {
    console.error('Database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
