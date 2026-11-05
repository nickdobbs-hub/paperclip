import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { TestHarness } from "@paperclipai/plugin-sdk/testing";
import plugin from "./worker.js";
import manifest from "./manifest.js";

describe("rocketlane-sync worker", () => {
  let harness: TestHarness;
  const originalFetch = globalThis.fetch;
  const fetchSpy = vi.fn();

  beforeEach(async () => {
    // Mock fetch to ensure no network calls
    globalThis.fetch = fetchSpy;
    fetchSpy.mockClear();

    // Create test harness with plugin manifest
    harness = createTestHarness({
      manifest,
      capabilities: manifest.capabilities,
    });

    // Run plugin setup
    await plugin.definition.setup(harness.ctx);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("makes zero fetch calls during setup", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates shadow entity for valid work-item issue", async () => {
    const companyId = "test-company-123";
    const issueId = "test-issue-456";

    // Seed test data
    harness.seed({
      companies: [{ id: companyId, name: "Test Company" } as any],
      issues: [
        {
          id: issueId,
          companyId,
          identifier: "TEST-100",
          title: "Send config to Acme",
          status: "todo",
          labels: [{ id: "label-1", name: "work-item" }],
        } as any,
      ],
      issueComments: [],
    });

    // Create a work-item document with minimal valid content
    const workItemBody = `
# Work Item

\`\`\`yaml
account: Acme Industries
owner_side: cyberhaven
cx_role: analyst
owner_person: nick.dobbs@cyberhaven.com
due: 2026-11-15
source: call
source_link: https://mail.google.com/test
source_quote: "Send config snippet to Acme"
origin_call: call:event-123
notes_reviewed: false
\`\`\`
`;

    // Mock the document read
    const originalGet = harness.ctx.issues.documents.get;
    harness.ctx.issues.documents.get = vi.fn(async () => ({
      id: "doc-1",
      key: "work-item",
      body: workItemBody,
      format: "markdown",
    })) as any;

    // Emit issue.updated event
    await harness.emit("issue.updated", { issueId, companyId }, {
      entityId: issueId,
      companyId,
    });

    // Restore original
    harness.ctx.issues.documents.get = originalGet;

    // Check that entity was created with state: "shadow"
    const entities = await harness.ctx.entities.list({ entityType: "rocketlane-task" });
    expect(entities).toHaveLength(1);
    expect(entities[0].scopeId).toBe(issueId);
    expect((entities[0].data as any).state).toBe("shadow");
    expect((entities[0].data as any).payload).toBeDefined();
    expect((entities[0].data as any).payload.externalReferenceId).toBe("TEST-100");

    // Verify no fetch calls
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates no entity for non-work-item issue", async () => {
    const companyId = "test-company-123";
    const issueId = "test-issue-789";

    // Seed test data with issue that has NO work-item label
    harness.seed({
      companies: [{ id: companyId, name: "Test Company" } as any],
      issues: [
        {
          id: issueId,
          companyId,
          identifier: "TEST-200",
          title: "Regular issue without work-item label",
          status: "todo",
          labels: [], // No work-item label
        } as any,
      ],
    });

    // Emit issue.updated event
    await harness.emit("issue.updated", { issueId, companyId }, {
      entityId: issueId,
      companyId,
    });

    // Check that NO entity was created
    const entities = await harness.ctx.entities.list({ entityType: "rocketlane-task" });
    expect(entities).toHaveLength(0);

    // Verify no fetch calls
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates invalid entity for issue with invalid work-item document", async () => {
    const companyId = "test-company-123";
    const issueId = "test-issue-999";

    // Seed test data
    harness.seed({
      companies: [{ id: companyId, name: "Test Company" } as any],
      issues: [
        {
          id: issueId,
          companyId,
          identifier: "TEST-300",
          title: "Issue with invalid work-item doc",
          status: "todo",
          labels: [{ id: "label-1", name: "work-item" }],
        } as any,
      ],
      issueComments: [],
    });

    // Create an INVALID work-item document (missing required fields)
    const invalidWorkItemBody = `
# Work Item

\`\`\`yaml
account: Acme Industries
owner_side: cyberhaven
\`\`\`
`;

    // Mock the document read
    const originalGet = harness.ctx.issues.documents.get;
    harness.ctx.issues.documents.get = vi.fn(async () => ({
      id: "doc-2",
      key: "work-item",
      body: invalidWorkItemBody,
      format: "markdown",
    })) as any;

    // Emit issue.updated event
    await harness.emit("issue.updated", { issueId, companyId }, {
      entityId: issueId,
      companyId,
    });

    // Restore original
    harness.ctx.issues.documents.get = originalGet;

    // Check that entity was created with state: "invalid"
    const entities = await harness.ctx.entities.list({ entityType: "rocketlane-task" });
    expect(entities).toHaveLength(1);
    expect(entities[0].scopeId).toBe(issueId);
    expect((entities[0].data as any).state).toBe("invalid");
    expect((entities[0].data as any).errors).toBeDefined();
    expect((entities[0].data as any).errors.length).toBeGreaterThan(0);

    // Verify no fetch calls
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates invalid entity when work-item document is missing", async () => {
    const companyId = "test-company-123";
    const issueId = "test-issue-111";

    // Seed test data
    harness.seed({
      companies: [{ id: companyId, name: "Test Company" } as any],
      issues: [
        {
          id: issueId,
          companyId,
          identifier: "TEST-400",
          title: "Issue with no work-item doc",
          status: "todo",
          labels: [{ id: "label-1", name: "work-item" }],
        } as any,
      ],
    });

    // Mock the document read to return null (no document)
    const originalGet = harness.ctx.issues.documents.get;
    harness.ctx.issues.documents.get = vi.fn(async () => null) as any;

    // Emit issue.updated event
    await harness.emit("issue.updated", { issueId, companyId }, {
      entityId: issueId,
      companyId,
    });

    // Restore original
    harness.ctx.issues.documents.get = originalGet;

    // Check that entity was created with state: "invalid"
    const entities = await harness.ctx.entities.list({ entityType: "rocketlane-task" });
    expect(entities).toHaveLength(1);
    expect((entities[0].data as any).state).toBe("invalid");
    expect((entities[0].data as any).errors).toContain("no work-item document found");

    // Verify no fetch calls
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates that worker never calls fetch", async () => {
    const companyId = "test-company-123";
    const issueId = "test-issue-fetch";

    harness.seed({
      companies: [{ id: companyId, name: "Test Company" } as any],
      issues: [
        {
          id: issueId,
          companyId,
          identifier: "TEST-500",
          title: "Fetch test issue",
          status: "todo",
          labels: [{ id: "label-1", name: "work-item" }],
        } as any,
      ],
      issueComments: [],
    });

    const workItemBody = `
\`\`\`yaml
account: Acme Industries
owner_side: cyberhaven
cx_role: analyst
owner_person: test@example.com
due: null
source: call
source_link: https://example.com
source_quote: "Test"
origin_call: call:test
notes_reviewed: false
\`\`\`
`;

    const originalGet = harness.ctx.issues.documents.get;
    harness.ctx.issues.documents.get = vi.fn(async () => ({
      id: "doc-3",
      key: "work-item",
      body: workItemBody,
      format: "markdown",
    })) as any;

    await harness.emit("issue.updated", { issueId, companyId }, {
      entityId: issueId,
      companyId,
    });

    harness.ctx.issues.documents.get = originalGet;

    // Assert zero fetch calls throughout the entire test suite
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates shadow report issue when job runs", async () => {
    const companyId = "test-company-123";
    const invalidIssueId = "test-issue-invalid-job";
    const validIssueId = "test-issue-valid-job";

    // Seed test data with one invalid and one valid work-item
    harness.seed({
      companies: [{ id: companyId, name: "Test Company" } as any],
      issues: [
        {
          id: invalidIssueId,
          companyId,
          identifier: "TEST-600",
          title: "Invalid work-item",
          status: "todo",
          labels: [{ id: "label-1", name: "work-item" }],
        } as any,
        {
          id: validIssueId,
          companyId,
          identifier: "TEST-601",
          title: "Valid work-item",
          status: "todo",
          labels: [{ id: "label-1", name: "work-item" }],
        } as any,
      ],
    });

    // Create invalid entity
    await harness.ctx.entities.upsert({
      entityType: "rocketlane-task",
      scopeKind: "issue",
      scopeId: invalidIssueId,
      externalId: undefined,
      data: {
        state: "invalid",
        errors: ["missing required field: cx_role"],
        builtAt: new Date().toISOString(),
        companyId,
      },
    });

    // Create valid entity
    await harness.ctx.entities.upsert({
      entityType: "rocketlane-task",
      scopeKind: "issue",
      scopeId: validIssueId,
      externalId: undefined,
      data: {
        state: "shadow",
        payload: { taskName: "Test task" },
        builtAt: new Date().toISOString(),
        companyId,
      },
    });

    // Count issues before job runs
    const issuesBefore = await harness.ctx.issues.list({ companyId });
    const countBefore = issuesBefore.length;

    // Run the shadow-report job
    await harness.runJob("shadow-report");

    // Check that exactly one new issue was created
    const issuesAfter = await harness.ctx.issues.list({ companyId });
    expect(issuesAfter.length).toBe(countBefore + 1);

    // Find the shadow report issue (should be the last one created)
    const reportIssue = issuesAfter.find(i => i.title === "Rocketlane Shadow Report");
    expect(reportIssue).toBeDefined();
    expect(reportIssue!.companyId).toBe(companyId);
    expect(reportIssue!.status).toBe("todo");
    expect(reportIssue!.description).toContain("**Valid payloads:** 1");
    expect(reportIssue!.description).toContain("**Invalid items:** 1");
    expect(reportIssue!.description).toContain("missing required field: cx_role");
  });
});
