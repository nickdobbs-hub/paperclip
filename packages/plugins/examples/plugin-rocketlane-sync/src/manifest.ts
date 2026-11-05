/**
 * Manifest for the Rocketlane sync plugin (shadow mode).
 * Validates work-item documents and builds task payloads without making network calls.
 */

const PLUGIN_ID = "paperclip.rocketlane-sync";
const PLUGIN_VERSION = "0.1.0";

const manifest = {
  id: PLUGIN_ID,
  apiVersion: 1 as const,
  version: PLUGIN_VERSION,
  displayName: "Rocketlane Sync (Shadow)",
  description:
    "Shadow-mode plugin that validates work-item documents and builds Rocketlane task payloads",
  author: "Paperclip",
  categories: ["integration" as const],
  capabilities: [
    "issues.read" as const,
    "issue.documents.read" as const,
    "issue.comments.read" as const,
  ],
  entrypoints: {
    worker: "./dist/worker.js" as const,
  },
};

export default manifest;
