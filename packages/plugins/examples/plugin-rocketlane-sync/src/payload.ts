/**
 * Rocketlane sync plugin payload builder (shadow mode).
 * Parses work-item YAML documents and builds Rocketlane task payloads.
 */

export interface WorkItemDoc {
  account: string;
  owner_side: "cyberhaven" | "client";
  cx_role: string;
  owner_person: string;
  chaser?: string;
  due: string | null;
  source: string;
  source_link: string;
  source_quote: string;
  origin_call: string;
  notes_reviewed: boolean;
  progress_log?: string[];
  rocketlane?: {
    task_id: string | null;
    synced_at: string | null;
  };
}

export interface RocketlaneTaskPayload {
  externalReferenceId: string;
  taskName: string;
  status: 1 | 2 | 3 | 4;
  dueDate: string | null;
  assignee: string | null;
  fields: {
    Source: string;
    "Source link": string;
    "Owner side": "Cyberhaven" | "Client";
    "CX role": string;
    "Progress log": string;
  };
}

export interface HistoryLine {
  at: string;
  line: string;
}

/**
 * Simple YAML parser for the fixed work-item schema.
 * Supports: flat scalars, quoted strings, null, progress_log list, rocketlane nested map.
 */
export function parseWorkItemDoc(
  markdown: string
): WorkItemDoc | { errors: string[] } {
  const errors: string[] = [];

  // Extract first yaml fence
  const yamlMatch = markdown.match(/^```ya?ml\s*\n([\s\S]*?)\n```/m);
  if (!yamlMatch) {
    return { errors: ["no work-item yaml block"] };
  }

  const yamlContent = yamlMatch[1];
  const lines = yamlContent.split("\n");

  const doc: Partial<WorkItemDoc> = {};
  let inProgressLog = false;
  let inRocketlane = false;
  const progressLog: string[] = [];
  const rocketlane: { task_id: string | null; synced_at: string | null } = {
    task_id: null,
    synced_at: null,
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) {
      continue;
    }

    // Handle nested maps
    if (inProgressLog) {
      if (line.startsWith("  - ")) {
        progressLog.push(line.slice(4));
      } else if (!line.startsWith(" ")) {
        inProgressLog = false;
      } else {
        continue;
      }
    }

    if (inRocketlane) {
      if (line.startsWith("  ")) {
        const match = line.match(/^\s+(\w+):\s*(.*)$/);
        if (match) {
          const [, key, value] = match;
          if (key === "task_id" || key === "synced_at") {
            rocketlane[key] = parseValue(value);
          }
        }
      } else if (!line.startsWith(" ")) {
        inRocketlane = false;
      } else {
        continue;
      }
    }

    // Parse top-level keys
    if (!inProgressLog && !inRocketlane) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (!match) {
        continue;
      }

      const [, key, value] = match;

      if (key === "progress_log") {
        inProgressLog = true;
        continue;
      }

      if (key === "rocketlane") {
        inRocketlane = true;
        continue;
      }

      // Parse scalar values
      const parsedValue = parseValue(value);

      switch (key) {
        case "account":
        case "owner_side":
        case "cx_role":
        case "owner_person":
        case "chaser":
        case "due":
        case "source":
        case "source_link":
        case "source_quote":
        case "origin_call":
          (doc as any)[key] = parsedValue;
          break;
        case "notes_reviewed":
          (doc as any)[key] = parsedValue === "true" || parsedValue === true;
          break;
      }
    }
  }

  if (progressLog.length > 0) {
    doc.progress_log = progressLog;
  }

  if (inRocketlane || rocketlane.task_id !== null || rocketlane.synced_at !== null) {
    doc.rocketlane = rocketlane;
  }

  // Validate required fields
  const requiredFields: (keyof WorkItemDoc)[] = [
    "account",
    "owner_side",
    "cx_role",
    "owner_person",
    "due",
    "source",
    "source_link",
    "source_quote",
    "origin_call",
    "notes_reviewed",
  ];

  for (const field of requiredFields) {
    if (doc[field] === undefined) {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return doc as WorkItemDoc;
}

function parseValue(value: string): any {
  const trimmed = value.trim();

  // null
  if (trimmed === "null" || trimmed === "~" || trimmed === "") {
    return null;
  }

  // boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // quoted string - preserve the quotes
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed;
  }

  // unquoted string (strip inline comments, but not URL fragments)
  // Only strip # if it's preceded by whitespace (actual comment)
  const commentMatch = trimmed.match(/\s+#/);
  if (commentMatch && commentMatch.index !== undefined) {
    return trimmed.slice(0, commentMatch.index).trim();
  }

  return trimmed;
}

/**
 * Build a Rocketlane task payload from a work-item document.
 * Status mapping: backlog/todo → 1, in_progress/in_review → 2, done → 3, blocked → 4, cancelled → 3 with log entry.
 */
export function buildTaskPayload(
  issue: { identifier: string; title: string; status: string },
  doc: WorkItemDoc,
  account: { company: string },
  history: HistoryLine[]
): RocketlaneTaskPayload | { errors: string[] } {
  const errors: string[] = [];

  // Validate document has required fields
  if (!doc.source_link) {
    errors.push("source_link is required");
  }
  if (!doc.account) {
    errors.push("account is required");
  }
  if (errors.length > 0) {
    return { errors };
  }

  // Map status
  let status: 1 | 2 | 3 | 4;
  let cancelledNote: string | null = null;

  switch (issue.status) {
    case "backlog":
    case "todo":
      status = 1;
      break;
    case "in_progress":
    case "in_review":
      status = 2;
      break;
    case "done":
      status = 3;
      break;
    case "blocked":
      status = 4;
      break;
    case "cancelled":
      status = 3;
      cancelledNote = "cancelled";
      break;
    default:
      status = 1;
  }

  // Merge progress_log and history, sort by date
  const allEntries: Array<{ date: string; text: string }> = [];

  // Add doc progress_log entries
  for (const entry of doc.progress_log || []) {
    const dateMatch = entry.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
    if (dateMatch) {
      allEntries.push({ date: dateMatch[1], text: entry });
    } else {
      // Entry without date - use as-is
      allEntries.push({ date: "0000-00-00", text: entry });
    }
  }

  // Add history entries
  for (const h of history) {
    allEntries.push({ date: h.at, text: `${h.at} ${h.line}` });
  }

  // Add cancelled note if applicable
  if (cancelledNote) {
    const today = new Date().toISOString().split("T")[0];
    allEntries.push({ date: today, text: cancelledNote });
  }

  // Sort by date
  allEntries.sort(
    (a: { date: string; text: string }, b: { date: string; text: string }) =>
      a.date.localeCompare(b.date)
  );

  // Build progress log string
  const progressLog = allEntries
    .map((e: { date: string; text: string }) => e.text)
    .join("\n");

  // Map owner_side
  const ownerSide = doc.owner_side === "client" ? "Client" : "Cyberhaven";

  return {
    externalReferenceId: issue.identifier,
    taskName: issue.title,
    status,
    dueDate: doc.due,
    assignee: doc.owner_person,
    fields: {
      Source: doc.source,
      "Source link": doc.source_link,
      "Owner side": ownerSide,
      "CX role": doc.cx_role,
      "Progress log": progressLog,
    },
  };
}
