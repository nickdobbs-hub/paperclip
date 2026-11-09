import { describe, expect, it } from "vitest";
import { isClaudeOrgVerificationError } from "@paperclipai/adapter-claude-local/server";

describe("isClaudeOrgVerificationError", () => {
  it("returns true when stderr contains org verification error and no session output", () => {
    expect(
      isClaudeOrgVerificationError({
        stderr: "Unable to verify organization for the current authentication token. This may be a network error.",
        hasSessionOutput: false,
      }),
    ).toBe(true);
  });

  it("returns true for case-insensitive match", () => {
    expect(
      isClaudeOrgVerificationError({
        stderr: "unable to VERIFY ORGANIZATION for the current token",
        hasSessionOutput: false,
      }),
    ).toBe(true);
  });

  it("returns false when session output exists", () => {
    expect(
      isClaudeOrgVerificationError({
        stderr: "Unable to verify organization for the current authentication token.",
        hasSessionOutput: true,
      }),
    ).toBe(false);
  });

  it("returns false when stderr does not match the pattern", () => {
    expect(
      isClaudeOrgVerificationError({
        stderr: "Some other error message",
        hasSessionOutput: false,
      }),
    ).toBe(false);
  });

  it("returns false for empty stderr", () => {
    expect(
      isClaudeOrgVerificationError({
        stderr: "",
        hasSessionOutput: false,
      }),
    ).toBe(false);
  });
});
