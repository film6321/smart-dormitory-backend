import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured');
}

const schema = new URL(connectionString).searchParams.get('schema') ?? 'public';
const adapter = new PrismaPg({ connectionString }, { schema });

export const prisma = new PrismaClient({ adapter });
