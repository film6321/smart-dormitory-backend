import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    api_ping: {
      executor: "constant-vus",
      vus: Number(__ENV.PING_VUS || 50),
      duration: __ENV.PING_DURATION || "30s",
      exec: "ping",
    },
    auth_login: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.LOGIN_RATE || 10),
      timeUnit: "1s",
      duration: __ENV.LOGIN_DURATION || "30s",
      preAllocatedVUs: Number(__ENV.LOGIN_PREALLOCATED_VUS || 20),
      exec: "login",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<500"],
  },
};

const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:3000";
const loginEmail = __ENV.LOGIN_EMAIL || "admin@example.com";
const loginPassword = __ENV.LOGIN_PASSWORD || "Password123";

export function ping() {
  const response = http.get(`${baseUrl}/api/ping`);
  check(response, {
    "ping status is 200": (res) => res.status === 200,
  });
  sleep(1);
}

export function login() {
  const response = http.post(
    `${baseUrl}/api/auth/login`,
    JSON.stringify({
      email: loginEmail,
      password: loginPassword,
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  check(response, {
    "login handled": (res) => [200, 400, 401, 429].includes(res.status),
  });
}
