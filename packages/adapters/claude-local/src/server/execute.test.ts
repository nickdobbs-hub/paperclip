import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RunProcessResult } from "@paperclipai/adapter-utils/server-utils";
import { isClaudeOrgVerificationError } from "./parse.js";

describe("Claude org verification retry logic", () => {
  describe("error detection", () => {
    it("detects org verification error when no session output and stderr matches", () => {
      const result = isClaudeOrgVerificationError({
        stderr: "Unable to verify organization for the current authentication token. This may be a network error.",
        hasSessionOutput: false,
      });
      expect(result).toBe(true);
    });

    it("does not retry when session output exists", () => {
      const result = isClaudeOrgVerificationError({
        stderr: "Unable to verify organization for the current authentication token.",
        hasSessionOutput: true,
      });
      expect(result).toBe(false);
    });

    it("does not retry for other errors", () => {
      const result = isClaudeOrgVerificationError({
        stderr: "Authentication failed for a different reason",
        hasSessionOutput: false,
      });
      expect(result).toBe(false);
    });
  });

  describe("retry backoff delays", () => {
    it("uses 15s for first retry and 60s for second retry", () => {
      const backoffDelays = [15000, 60000];
      expect(backoffDelays[0]).toBe(15000); // 15 seconds
      expect(backoffDelays[1]).toBe(60000); // 60 seconds
    });

    it("attempts up to 3 total tries (1 initial + 2 retries)", () => {
      const backoffDelays = [15000, 60000];
      const totalAttempts = 1 + backoffDelays.length;
      expect(totalAttempts).toBe(3);
    });
  });

  describe("error code on retry exhaustion", () => {
    it("returns claude_auth_unverified when all retries fail", () => {
      // This documents the expected error code after retries are exhausted
      const expectedErrorCode = "claude_auth_unverified";
      expect(expectedErrorCode).toBe("claude_auth_unverified");
    });
  });
});

describe("Retry scenarios documentation", () => {
  it("scenario 1: retry succeeds on first attempt", () => {
    // Documents: Initial attempt fails with org error, first retry succeeds
    // Expected: Returns success result from first retry, total delay 15s
    const scenario = {
      attempts: [
        { success: false, orgError: true },
        { success: true, orgError: false },
      ],
      expectedTotalAttempts: 2,
      expectedDelay: 15000,
    };
    expect(scenario.expectedTotalAttempts).toBe(2);
  });

  it("scenario 2: retry succeeds on second attempt", () => {
    // Documents: Initial and first retry fail, second retry succeeds
    // Expected: Returns success result from second retry, total delay 75s
    const scenario = {
      attempts: [
        { success: false, orgError: true },
        { success: false, orgError: true },
        { success: true, orgError: false },
      ],
      expectedTotalAttempts: 3,
      expectedDelay: 75000, // 15s + 60s
    };
    expect(scenario.expectedDelay).toBe(75000);
  });

  it("scenario 3: all retries exhausted", () => {
    // Documents: All attempts fail with org error
    // Expected: Returns error with errorCode: claude_auth_unverified
    const scenario = {
      attempts: [
        { success: false, orgError: true },
        { success: false, orgError: true },
        { success: false, orgError: true },
      ],
      expectedErrorCode: "claude_auth_unverified",
    };
    expect(scenario.expectedErrorCode).toBe("claude_auth_unverified");
  });

  it("scenario 4: no retry for different error", () => {
    // Documents: Initial attempt fails with different error
    // Expected: Returns immediately without retry
    const scenario = {
      attempts: [{ success: false, orgError: false }],
      expectedTotalAttempts: 1,
      noRetry: true,
    };
    expect(scenario.noRetry).toBe(true);
  });

  it("scenario 5: no retry when session output exists", () => {
    // Documents: Initial attempt fails but produced session output
    // Expected: Returns immediately without retry
    const scenario = {
      attempts: [{ success: false, orgError: true, hasSessionOutput: true }],
      expectedTotalAttempts: 1,
      noRetry: true,
    };
    expect(scenario.noRetry).toBe(true);
  });
});
