import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute, setClaudeRetryDelaysForTests } from "@paperclipai/adapter-claude-local/server";

async function writeFakeClaudeCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
const payload = {
  argv: process.argv.slice(2),
  prompt: fs.readFileSync(0, "utf8"),
  claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || null,
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-1", model: "claude-sonnet" }));
console.log(JSON.stringify({ type: "assistant", session_id: "claude-session-1", message: { content: [{ type: "text", text: "hello" }] } }));
console.log(JSON.stringify({ type: "result", session_id: "claude-session-1", result: "hello", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

describe("claude execute", () => {
  it("logs HOME, CLAUDE_CONFIG_DIR, and the resolved executable path in invocation metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-execute-meta-"));
    const workspace = path.join(root, "workspace");
    const binDir = path.join(root, "bin");
    const commandPath = path.join(binDir, "claude");
    const capturePath = path.join(root, "capture.json");
    const claudeConfigDir = path.join(root, "claude-config");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(claudeConfigDir, { recursive: true });
    await writeFakeClaudeCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousPath = process.env.PATH;
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = root;
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

    let loggedCommand: string | null = null;
    let loggedEnv: Record<string, string> = {};
    try {
      const result = await execute({
        runId: "run-meta",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Claude Coder",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: "claude",
          cwd: workspace,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          loggedCommand = meta.command;
          loggedEnv = meta.env ?? {};
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();
      expect(loggedCommand).toBe(commandPath);
      expect(loggedEnv.HOME).toBe(root);
      expect(loggedEnv.CLAUDE_CONFIG_DIR).toBe(claudeConfigDir);
      expect(loggedEnv.PAPERCLIP_RESOLVED_COMMAND).toBe(commandPath);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

async function writeFakeClaudeWithRetryCounter(
  commandPath: string,
  counterPath: string,
  failuresBeforeSuccess: number,
): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const counterPath = "${counterPath.replace(/\\/g, "\\\\")}";
let count = 0;
try {
  const existing = fs.readFileSync(counterPath, "utf8");
  count = parseInt(existing, 10) || 0;
} catch (err) {
  // Counter file doesn't exist yet
}
count++;
fs.writeFileSync(counterPath, String(count), "utf8");

const failCount = ${failuresBeforeSuccess};
if (count <= failCount) {
  // Simulate org verification failure
  console.error("Unable to verify organization for the current authentication token. This may be a network error.");
  process.exit(1);
} else {
  // Success - output normal session JSON
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-retry", model: "claude-sonnet" }));
  console.log(JSON.stringify({ type: "assistant", session_id: "claude-session-retry", message: { content: [{ type: "text", text: "success after retry" }] } }));
  console.log(JSON.stringify({ type: "result", session_id: "claude-session-retry", result: "success after retry", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }));
  process.exit(0);
}
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

async function writeFakeClaudeWithOtherError(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
console.error("Some other error occurred");
process.exit(1);
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

describe("claude org verification retry", () => {
  beforeEach(() => {
    // Use zero delays for tests to avoid waiting
    setClaudeRetryDelaysForTests([0, 0]);
  });

  afterEach(() => {
    // Reset to production delays
    setClaudeRetryDelaysForTests(null);
  });

  it("retries once and succeeds when org verification fails transiently (N=1)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-retry-1-"));
    const workspace = path.join(root, "workspace");
    const binDir = path.join(root, "bin");
    const commandPath = path.join(binDir, "claude");
    const counterPath = path.join(root, "counter.txt");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await writeFakeClaudeWithRetryCounter(commandPath, counterPath, 1); // Fail once

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;

    const logs: string[] = [];
    try {
      const result = await execute({
        runId: "run-retry-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Test Agent",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: "claude",
          cwd: workspace,
          env: {},
          promptTemplate: "test prompt",
        },
        context: {},
        authToken: "test-token",
        onLog: async (stream, chunk) => {
          if (stream === "stdout") logs.push(chunk);
        },
        onMeta: async () => {},
      });

      // Should succeed after retry
      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();
      expect(result.errorCode).toBeNull();

      // Should have called the CLI exactly 2 times (initial + 1 retry)
      const counter = await fs.readFile(counterPath, "utf8");
      expect(parseInt(counter, 10)).toBe(2);

      // Should have one retry log line
      const retryLogs = logs.filter(log => log.includes("retrying"));
      expect(retryLogs.length).toBe(1);
      expect(retryLogs[0]).toContain("attempt 2/3");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("exhausts retries and returns claude_auth_unverified when org verification fails persistently (N=3)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-retry-3-"));
    const workspace = path.join(root, "workspace");
    const binDir = path.join(root, "bin");
    const commandPath = path.join(binDir, "claude");
    const counterPath = path.join(root, "counter.txt");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await writeFakeClaudeWithRetryCounter(commandPath, counterPath, 999); // Never succeed

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;

    const logs: string[] = [];
    try {
      const result = await execute({
        runId: "run-retry-3",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Test Agent",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: "claude",
          cwd: workspace,
          env: {},
          promptTemplate: "test prompt",
        },
        context: {},
        authToken: "test-token",
        onLog: async (stream, chunk) => {
          if (stream === "stdout") logs.push(chunk);
        },
        onMeta: async () => {},
      });

      // Should fail with specific error code after exhausting retries
      expect(result.exitCode).not.toBe(0);
      expect(result.errorCode).toBe("claude_auth_unverified");

      // Should have called the CLI exactly 3 times (initial + 2 retries)
      const counter = await fs.readFile(counterPath, "utf8");
      expect(parseInt(counter, 10)).toBe(3);

      // Should have two retry log lines
      const retryLogs = logs.filter(log => log.includes("retrying"));
      expect(retryLogs.length).toBe(2);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not retry for other errors (non-matching stderr)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-no-retry-"));
    const workspace = path.join(root, "workspace");
    const binDir = path.join(root, "bin");
    const commandPath = path.join(binDir, "claude");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await writeFakeClaudeWithOtherError(commandPath);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;

    const logs: string[] = [];
    try {
      const result = await execute({
        runId: "run-no-retry",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Test Agent",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: "claude",
          cwd: workspace,
          env: {},
          promptTemplate: "test prompt",
        },
        context: {},
        authToken: "test-token",
        onLog: async (stream, chunk) => {
          if (stream === "stdout") logs.push(chunk);
        },
        onMeta: async () => {},
      });

      // Should fail immediately without retry
      expect(result.exitCode).not.toBe(0);
      expect(result.errorCode).not.toBe("claude_auth_unverified");

      // Should have no retry log lines
      const retryLogs = logs.filter(log => log.includes("retrying"));
      expect(retryLogs.length).toBe(0);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
