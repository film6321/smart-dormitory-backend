import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Server } from "node:http";
import express from "express";
import { setupSecurity } from "../../src/setup/setupSecurity";

describe("setupSecurity cors policy", () => {
  let server: Server;
  let baseUrl: string;
  const previousEnv = {
    FRONTEND_URL: process.env.FRONTEND_URL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    NGINX_HOST_PORT: process.env.NGINX_HOST_PORT,
  };

  before(async () => {
    process.env.FRONTEND_URL = "";
    process.env.CORS_ORIGIN = "";
    process.env.NGINX_HOST_PORT = "3000";
    process.env.NODE_ENV = "test";
    process.env.DISABLE_REDIS_RATE_LIMITS = "true";

    const app = express();
    setupSecurity(app);

    app.get("/probe", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        assert.ok(address && typeof address === "object");
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    process.env.FRONTEND_URL = previousEnv.FRONTEND_URL;
    process.env.CORS_ORIGIN = previousEnv.CORS_ORIGIN;
    process.env.NGINX_HOST_PORT = previousEnv.NGINX_HOST_PORT;
  });

  it("allows the nginx gateway origin used by the dashboard", async () => {
    const origin = `http://localhost:${process.env.NGINX_HOST_PORT}`;
    const response = await fetch(`${baseUrl}/probe`, {
      headers: {
        Origin: origin,
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual(body, { ok: true });
  });

  it("allows the 127.0.0.1 nginx gateway origin for local development", async () => {
    const origin = `http://127.0.0.1:${process.env.NGINX_HOST_PORT}`;
    const response = await fetch(`${baseUrl}/probe`, {
      headers: {
        Origin: origin,
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual(body, { ok: true });
  });

  it("allows origins configured via NGROK_DOMAIN", async () => {
    process.env.NGROK_DOMAIN = "test-tunnel.ngrok-free.dev";
    const app = express();
    setupSecurity(app);
    app.get("/probe-ngrok", (_req, res) => res.status(200).json({ ok: true }));

    const testServer = app.listen(0);
    const addr = testServer.address() as { port: number };
    const ngrokOrigin = "https://test-tunnel.ngrok-free.dev";

    try {
      const response = await fetch(`http://127.0.0.1:${addr.port}/probe-ngrok`, {
        headers: { Origin: ngrokOrigin },
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), ngrokOrigin);
      assert.deepEqual(body, { ok: true });
    } finally {
      delete process.env.NGROK_DOMAIN;
      testServer.close();
    }
  });

  it("allows comma-separated origins in CORS_ORIGIN", async () => {
    process.env.CORS_ORIGIN = "https://sub1.example.com, https://sub2.example.com";
    const app = express();
    setupSecurity(app);
    app.get("/probe-multi", (_req, res) => res.status(200).json({ ok: true }));

    const testServer = app.listen(0);
    const addr = testServer.address() as { port: number };
    const targetOrigin = "https://sub2.example.com";

    try {
      const response = await fetch(`http://127.0.0.1:${addr.port}/probe-multi`, {
        headers: { Origin: targetOrigin },
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), targetOrigin);
      assert.deepEqual(body, { ok: true });
    } finally {
      delete process.env.CORS_ORIGIN;
      testServer.close();
    }
  });
});
