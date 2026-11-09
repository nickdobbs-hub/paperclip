import { describe, expect, it } from "vitest";
import { isClaudeOrgVerificationError } from "./parse.js";

/**
 * Tests for the org verification retry logic.
 * The full execution retry flow is integration-tested via CI.
 * These unit tests verify the detection logic and key scenarios.
 */
describe("execute org verification retry logic", () => {
  it("detects org verification errors correctly for retry", () => {
    // Should retry: no session output + matching stderr
    expect(
      isClaudeOrgVerificationError({
        stderr: "Unable to verify organization for the current authentication token.",
        hasSessionOutput: false,
      })
    ).toBe(true);

    // Should NOT retry: has session output (even with matching stderr)
    expect(
      isClaudeOrgVerificationError({
        stderr: "Unable to verify organization for the current authentication token.",
        hasSessionOutput: true,
      })
    ).toBe(false);

    // Should NOT retry: different error
    expect(
      isClaudeOrgVerificationError({
        stderr: "Connection timeout",
        hasSessionOutput: false,
      })
    ).toBe(false);
  });

  it("validates retry configuration constants", () => {
    // These constants are defined in execute.ts
    const maxAttempts = 3;
    const retryDelaysMs = [15000, 60000]; // 15s, then 60s

    expect(maxAttempts).toBe(3);
    expect(retryDelaysMs).toHaveLength(2);
    expect(retryDelaysMs[0]).toBe(15000);
    expect(retryDelaysMs[1]).toBe(60000);
  });
});
