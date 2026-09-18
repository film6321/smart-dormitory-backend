import { prisma } from '../src/database/db';

async function main() {
  const deletedAccessLogs = await prisma.accessLog.deleteMany({
    where: {
      method: { in: ['FACE_GATE', 'FACE_VERIFY'] }
    }
  });
  console.log(`Deleted ${deletedAccessLogs.count} face access logs.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
