import { describe, expect, it } from "vitest";
import { isClaudeOrgVerificationError } from "./parse.js";

describe("isClaudeOrgVerificationError", () => {
  it("detects org verification error when no session output and matching stderr", () => {
    const result = isClaudeOrgVerificationError({
      stderr: "Unable to verify organization for the current authentication token. This may be a network error.",
      hasSessionOutput: false,
    });
    expect(result).toBe(true);
  });

  it("returns false when there is session output", () => {
    const result = isClaudeOrgVerificationError({
      stderr: "Unable to verify organization for the current authentication token.",
      hasSessionOutput: true,
    });
    expect(result).toBe(false);
  });

  it("returns false when stderr does not match", () => {
    const result = isClaudeOrgVerificationError({
      stderr: "Some other error message",
      hasSessionOutput: false,
    });
    expect(result).toBe(false);
  });

  it("is case-insensitive for error detection", () => {
    const result = isClaudeOrgVerificationError({
      stderr: "UNABLE TO VERIFY ORGANIZATION for the current authentication token",
      hasSessionOutput: false,
    });
    expect(result).toBe(true);
  });

  it("returns false for empty stderr", () => {
    const result = isClaudeOrgVerificationError({
      stderr: "",
      hasSessionOutput: false,
    });
    expect(result).toBe(false);
  });
});
