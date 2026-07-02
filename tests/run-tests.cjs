process.env.TS_NODE_PROJECT = "tsconfig.test.json";

require("ts-node/register");

require("./unit/api-response.test.ts");
require("./unit/auth-jwt.test.ts");
require("./unit/notification.test.ts");
require("./integration/error-response.test.ts");
