import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, ".env") });
import { defineConfig, env } from "@prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "npx ts-node -P tsconfig.seed.json prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
