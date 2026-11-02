import { afterEach, describe, expect, it } from "vitest";
import { runChildProcess } from "@paperclipai/adapter-utils/server-utils";

const SERVER_SECRETS = {
  BETTER_AUTH_SECRET: "test-auth-secret",
  PAPERCLIP_SECRETS_MASTER_KEY: "test-master-key",
  PAPERCLIP_AGENT_JWT_SECRET: "test-jwt-secret",
  DATABASE_URL: "postgres://user:pass@localhost/db",
};

async function childEnv(env: Record<string, string> = {}) {
  let stdout = "";
  await runChildProcess(
    "test-run",
    process.execPath,
    ["-e", "process.stdout.write(JSON.stringify(process.env))"],
    {
      cwd: process.cwd(),
      env,
      timeoutSec: 10,
      graceSec: 1,
      onLog: async (stream, chunk) => {
        if (stream === "stdout") stdout += chunk;
      },
    },
  );
  return JSON.parse(stdout) as Record<string, string>;
}

describe("runChildProcess env", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("does not pass the server's own secrets to agent processes", async () => {
    for (const [key, value] of Object.entries(SERVER_SECRETS)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }

    const env = await childEnv({ PAPERCLIP_API_KEY: "run-scoped-token" });

    for (const key of Object.keys(SERVER_SECRETS)) {
      expect(env[key]).toBeUndefined();
    }
    expect(env.PAPERCLIP_API_KEY).toBe("run-scoped-token");
  });
});
