import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/db",
      "packages/adapters/claude-local",
      "packages/adapters/codex-local",
      "packages/adapters/opencode-local",
      "packages/plugins/examples/plugin-rocketlane-sync",
      "server",
      "ui",
      "cli",
    ],
  },
});
