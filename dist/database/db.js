"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("@prisma/client");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
}
const schema = new URL(connectionString).searchParams.get('schema') ?? 'public';
const adapter = new adapter_pg_1.PrismaPg({ connectionString }, { schema });
exports.prisma = new client_1.PrismaClient({ adapter });
