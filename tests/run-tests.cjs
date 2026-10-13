const { spawnSync } = require("node:child_process");
const path = require("node:path");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.DISABLE_REDIS_RATE_LIMITS =
  process.env.DISABLE_REDIS_RATE_LIMITS || "true";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
process.env.TS_NODE_PROJECT = "tsconfig.test.json";
process.env.TS_NODE_FILES = process.env.TS_NODE_FILES || "true";

// Each file gets its own process so HTTP and Prisma mocks cannot leak across suites.
const files = [
  "unit/api-response.test.ts",
  "unit/auth-jwt.test.ts",
  "unit/auth-contract.test.ts",
  "unit/date-utils.test.ts",
  "unit/notification.test.ts",
  "unit/setup-security.test.ts",
  "unit/core-domain.test.ts",
  "unit/account-retention.test.ts",
  "unit/face-cleanup.test.ts",
  "unit/state-transitions.test.ts",
  "unit/maintenance.test.ts",
  "unit/analytics.test.ts",
  "unit/route-aliases.test.ts",
  "unit/route-aliases-additional.test.ts",
  "unit/face-verification.test.ts",
  "unit/realtime-presence.test.ts",
  "unit/visitor-flow.test.ts",
  "integration/door-command-route.test.ts",
  "unit/housing-ocr-flow.test.ts",
  "unit/housing-application-steps.test.ts",
  "integration/health-route.test.ts",
  "integration/error-response.test.ts",
  "unit/payment-provider.test.ts",
];
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const result = spawnSync(process.execPath, [
  "--require", "ts-node/register", "--test", "--test-concurrency=2",
  ...files.map(file => path.join(__dirname, file)),
], { env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
