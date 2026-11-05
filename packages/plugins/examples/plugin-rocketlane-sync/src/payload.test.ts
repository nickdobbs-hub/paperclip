import { describe, it, expect } from "vitest";
import {
  parseWorkItemDoc,
  buildTaskPayload,
  type WorkItemDoc,
  type HistoryLine,
} from "./payload.js";

describe("parseWorkItemDoc", () => {
  it("parses a complete work-item yaml block", () => {
    const markdown = `
# Work Item

\`\`\`yaml
account: Acme Industries
owner_side: cyberhaven
cx_role: analyst
owner_person: nick.dobbs@cyberhaven.com
due: 2026-11-13
source: call
source_link: https://mail.google.com/mail/u/0/#inbox/abc123
source_quote: "Nicholas Dobbs to provide list of active Cyberhaven agents"
origin_call: call:event-12345
notes_reviewed: false
progress_log:
  - 2026-11-02 created from Acme DDR Sync
  - 2026-11-03 updated with timeline
rocketlane:
  task_id: null
  synced_at: null
\`\`\`

Some other content.
`;

    const result = parseWorkItemDoc(markdown);
    expect(result).not.toHaveProperty("errors");

    const doc = result as WorkItemDoc;
    expect(doc.account).toBe("Acme Industries");
    expect(doc.owner_side).toBe("cyberhaven");
    expect(doc.cx_role).toBe("analyst");
    expect(doc.owner_person).toBe("nick.dobbs@cyberhaven.com");
    expect(doc.due).toBe("2026-11-13");
    expect(doc.source).toBe("call");
    expect(doc.source_link).toBe(
      "https://mail.google.com/mail/u/0/#inbox/abc123"
    );
    expect(doc.source_quote).toBe(
      '"Nicholas Dobbs to provide list of active Cyberhaven agents"'
    );
    expect(doc.origin_call).toBe("call:event-12345");
    expect(doc.notes_reviewed).toBe(false);
    expect(doc.progress_log).toEqual([
      "2026-11-02 created from Acme DDR Sync",
      "2026-11-03 updated with timeline",
    ]);
    expect(doc.rocketlane).toEqual({
      task_id: null,
      synced_at: null,
    });
  });

  it("returns error when no yaml block is found", () => {
    const markdown = "# Just some markdown\n\nNo yaml here.";
    const result = parseWorkItemDoc(markdown);

    expect(result).toHaveProperty("errors");
    expect((result as any).errors).toContain("no work-item yaml block");
  });

  it("returns errors for missing required fields", () => {
    const markdown = `
\`\`\`yaml
account: Acme Industries
owner_side: cyberhaven
\`\`\`
`;

    const result = parseWorkItemDoc(markdown);
    expect(result).toHaveProperty("errors");

    const errors = (result as any).errors as string[];
    expect(errors).toContain("missing required field: cx_role");
    expect(errors).toContain("missing required field: owner_person");
    expect(errors).toContain("missing required field: source_link");
  });

  it("parses null values correctly", () => {
    const markdown = `
\`\`\`yaml
account: Globex Corp
owner_side: client
cx_role: tam
owner_person: pat.client@globex.com
due: null
source: email
source_link: https://mail.google.com/xyz
source_quote: "Client will send config"
origin_call: call:event-67890
notes_reviewed: true
\`\`\`
`;

    const result = parseWorkItemDoc(markdown);
    expect(result).not.toHaveProperty("errors");

    const doc = result as WorkItemDoc;
    expect(doc.due).toBe(null);
    expect(doc.notes_reviewed).toBe(true);
  });

  it("handles yml file extension", () => {
    const markdown = `
\`\`\`yml
account: Acme Industries
owner_side: cyberhaven
cx_role: analyst
owner_person: nick.dobbs@cyberhaven.com
due: null
source: call
source_link: https://example.com
source_quote: "Test quote"
origin_call: call:test
notes_reviewed: false
\`\`\`
`;

    const result = parseWorkItemDoc(markdown);
    expect(result).not.toHaveProperty("errors");
  });

  it("strips inline comments from values", () => {
    const markdown = `
\`\`\`yaml
account: Acme Industries  # customer name
owner_side: cyberhaven
cx_role: analyst
owner_person: nick.dobbs@cyberhaven.com
due: null
source: call
source_link: https://example.com
source_quote: "Test"
origin_call: call:test
notes_reviewed: false
\`\`\`
`;

    const result = parseWorkItemDoc(markdown);
    expect(result).not.toHaveProperty("errors");

    const doc = result as WorkItemDoc;
    expect(doc.account).toBe("Acme Industries");
  });
});

describe("buildTaskPayload", () => {
  const baseDoc: WorkItemDoc = {
    account: "Acme Industries",
    owner_side: "cyberhaven",
    cx_role: "analyst",
    owner_person: "nick.dobbs@cyberhaven.com",
    due: "2026-11-13",
    source: "call",
    source_link: "https://mail.google.com/test",
    source_quote: "Test quote",
    origin_call: "call:event-123",
    notes_reviewed: false,
    progress_log: ["2026-11-02 created from Acme DDR Sync"],
  };

  const baseIssue = {
    identifier: "CYBAA-100",
    title: "Send config snippet to Acme",
    status: "todo",
  };

  const baseAccount = {
    company: "Acme Industries",
  };

  it("builds payload with correct status mapping for todo", () => {
    const payload = buildTaskPayload(baseIssue, baseDoc, baseAccount, []);
    expect(payload).not.toHaveProperty("errors");

    const p = payload as any;
    expect(p.status).toBe(1);
    expect(p.externalReferenceId).toBe("CYBAA-100");
    expect(p.taskName).toBe("Send config snippet to Acme");
  });

  it("maps status backlog to 1", () => {
    const issue = { ...baseIssue, status: "backlog" };
    const payload = buildTaskPayload(issue, baseDoc, baseAccount, []);
    expect((payload as any).status).toBe(1);
  });

  it("maps status in_progress to 2", () => {
    const issue = { ...baseIssue, status: "in_progress" };
    const payload = buildTaskPayload(issue, baseDoc, baseAccount, []);
    expect((payload as any).status).toBe(2);
  });

  it("maps status in_review to 2", () => {
    const issue = { ...baseIssue, status: "in_review" };
    const payload = buildTaskPayload(issue, baseDoc, baseAccount, []);
    expect((payload as any).status).toBe(2);
  });

  it("maps status done to 3", () => {
    const issue = { ...baseIssue, status: "done" };
    const payload = buildTaskPayload(issue, baseDoc, baseAccount, []);
    expect((payload as any).status).toBe(3);
  });

  it("maps status blocked to 4", () => {
    const issue = { ...baseIssue, status: "blocked" };
    const payload = buildTaskPayload(issue, baseDoc, baseAccount, []);
    expect((payload as any).status).toBe(4);
  });

  it("maps status cancelled to 3 with cancelled in progress log", () => {
    const issue = { ...baseIssue, status: "cancelled" };
    const payload = buildTaskPayload(issue, baseDoc, baseAccount, []);

    expect((payload as any).status).toBe(3);
    expect((payload as any).fields["Progress log"]).toContain("cancelled");
  });

  it("returns errors when source_link is missing", () => {
    const doc = { ...baseDoc, source_link: "" };
    const payload = buildTaskPayload(baseIssue, doc as any, baseAccount, []);

    expect(payload).toHaveProperty("errors");
    expect((payload as any).errors).toContain("source_link is required");
  });

  it("merges progress_log and history in date order", () => {
    const doc: WorkItemDoc = {
      ...baseDoc,
      progress_log: [
        "2026-11-02 created from Acme DDR Sync",
        "2026-11-05 updated scope",
      ],
    };

    const history: HistoryLine[] = [
      { at: "2026-11-03", line: "status changed to in_progress" },
      { at: "2026-11-04", line: "assigned to analyst" },
    ];

    const payload = buildTaskPayload(baseIssue, doc, baseAccount, history);
    expect(payload).not.toHaveProperty("errors");

    const p = payload as any;
    const progressLog = p.fields["Progress log"];

    expect(progressLog).toContain("2026-11-02 created from Acme DDR Sync");
    expect(progressLog).toContain("2026-11-03 status changed to in_progress");
    expect(progressLog).toContain("2026-11-04 assigned to analyst");
    expect(progressLog).toContain("2026-11-05 updated scope");

    // Check order
    const lines = progressLog.split("\n");
    expect(lines[0]).toBe("2026-11-02 created from Acme DDR Sync");
    expect(lines[1]).toBe("2026-11-03 status changed to in_progress");
    expect(lines[2]).toBe("2026-11-04 assigned to analyst");
    expect(lines[3]).toBe("2026-11-05 updated scope");
  });

  it("maps owner_side client to Client", () => {
    const doc: WorkItemDoc = {
      ...baseDoc,
      owner_side: "client",
    };

    const payload = buildTaskPayload(baseIssue, doc, baseAccount, []);
    expect((payload as any).fields["Owner side"]).toBe("Client");
  });

  it("maps owner_side cyberhaven to Cyberhaven", () => {
    const payload = buildTaskPayload(baseIssue, baseDoc, baseAccount, []);
    expect((payload as any).fields["Owner side"]).toBe("Cyberhaven");
  });

  it("includes all required fields", () => {
    const payload = buildTaskPayload(baseIssue, baseDoc, baseAccount, []);
    const p = payload as any;

    expect(p.externalReferenceId).toBe("CYBAA-100");
    expect(p.taskName).toBe("Send config snippet to Acme");
    expect(p.dueDate).toBe("2026-11-13");
    expect(p.assignee).toBe("nick.dobbs@cyberhaven.com");
    expect(p.fields.Source).toBe("call");
    expect(p.fields["Source link"]).toBe("https://mail.google.com/test");
    expect(p.fields["CX role"]).toBe("analyst");
  });

  it("handles null due date", () => {
    const doc = { ...baseDoc, due: null };
    const payload = buildTaskPayload(baseIssue, doc, baseAccount, []);

    expect((payload as any).dueDate).toBe(null);
  });
});
