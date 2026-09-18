process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.DISABLE_REDIS_RATE_LIMITS =
  process.env.DISABLE_REDIS_RATE_LIMITS || "true";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
process.env.TS_NODE_PROJECT = "tsconfig.test.json";

require("ts-node/register");

require("./unit/api-response.test.ts");
require("./unit/auth-jwt.test.ts");
require("./unit/date-utils.test.ts");
require("./unit/notification.test.ts");
require("./unit/setup-security.test.ts");
require("./unit/core-domain.test.ts");
require("./unit/analytics.test.ts");
require("./unit/route-aliases.test.ts");
require("./unit/route-aliases-additional.test.ts");
require("./unit/face-verification.test.ts");
require("./integration/health-route.test.ts");
require("./integration/error-response.test.ts");
