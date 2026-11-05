/**
 * Rocketlane sync plugin worker (shadow mode).
 * Processes work-item issues and builds task payloads without making network calls.
 */

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, PluginJobContext, PluginEvent } from "@paperclipai/plugin-sdk";
import {
  parseWorkItemDoc,
  buildTaskPayload,
  type HistoryLine,
  type WorkItemDoc,
} from "./payload.js";

const PLUGIN_NAME = "rocketlane-sync";
const ENTITY_TYPE = "rocketlane-task";

/**
 * Process a work-item issue and upsert a plugin entity.
 */
async function processWorkItem(ctx: PluginContext, issueId: string) {
  try {
    // Get the issue
    const issue = await ctx.issues.get(issueId);
    if (!issue) {
      ctx.logger.warn(`Issue ${issueId} not found`);
      return;
    }

    // Check if it has the work-item label
    const hasWorkItemLabel = issue.labels?.some(
      (l: any) => l.name === "work-item"
    );
    if (!hasWorkItemLabel) {
      // Not a work-item, no action needed
      return;
    }

    // Get the work-item document
    let workItemDoc;
    try {
      workItemDoc = await ctx.issues.getDocument(issueId, "work-item");
    } catch (err) {
      ctx.logger.warn(
        `No work-item document found for ${issue.identifier}: ${err}`
      );
      await ctx.entities.upsert({
        entityType: ENTITY_TYPE,
        scopeKind: "issue",
        scopeId: issueId,
        externalId: null,
        data: {
          state: "invalid",
          errors: ["no work-item document found"],
          builtAt: new Date().toISOString(),
        },
      });
      return;
    }

    // Parse the document
    const parsed = parseWorkItemDoc(workItemDoc.body);
    if ("errors" in parsed) {
      // Invalid document
      await ctx.entities.upsert({
        entityType: ENTITY_TYPE,
        scopeKind: "issue",
        scopeId: issueId,
        externalId: null,
        data: {
          state: "invalid",
          errors: parsed.errors,
          builtAt: new Date().toISOString(),
        },
      });
      return;
    }

    const doc = parsed as WorkItemDoc;

    // Get account info
    const account = { company: doc.account };

    // Build history from comments (first line of each)
    const history: HistoryLine[] = [];
    try {
      const comments = await ctx.issues.listComments(issueId);
      for (const comment of comments || []) {
        const firstLine = comment.body.split("\n")[0].trim();
        if (firstLine && comment.createdAt) {
          const date = comment.createdAt.split("T")[0];
          history.push({ at: date, line: firstLine });
        }
      }
    } catch (err) {
      ctx.logger.warn(`Failed to fetch comments for ${issueId}: ${err}`);
    }

    // Build the payload
    const payload = buildTaskPayload(
      {
        identifier: issue.identifier,
        title: issue.title,
        status: issue.status,
      },
      doc,
      account,
      history
    );

    if ("errors" in payload) {
      // Invalid payload
      await ctx.entities.upsert({
        entityType: ENTITY_TYPE,
        scopeKind: "issue",
        scopeId: issueId,
        externalId: null,
        data: {
          state: "invalid",
          errors: payload.errors,
          builtAt: new Date().toISOString(),
        },
      });
      return;
    }

    // Valid payload - store in shadow mode
    await ctx.entities.upsert({
      entityType: ENTITY_TYPE,
      scopeKind: "issue",
      scopeId: issueId,
      externalId: null,
      data: {
        state: "shadow",
        payload,
        builtAt: new Date().toISOString(),
      },
    });

    ctx.logger.info(
      `Built shadow payload for ${issue.identifier}: ${payload.taskName}`
    );
  } catch (error) {
    ctx.logger.error(`Error processing work-item ${issueId}:`, error);
  }
}

/**
 * Weekly job that creates a shadow report issue.
 */
async function runShadowReport(ctx: PluginJobContext) {
  try {
    // Get all entities
    const entities = await ctx.entities.list({
      entityType: ENTITY_TYPE,
    });

    const invalid = entities.filter((e: any) => e.data?.state === "invalid");
    const valid = entities.filter((e: any) => e.data?.state === "shadow");

    // Build report content
    let report = "# Rocketlane Shadow Report\n\n";
    report += `**Valid payloads:** ${valid.length}\n`;
    report += `**Invalid items:** ${invalid.length}\n\n`;

    if (invalid.length > 0) {
      report += "## Invalid Items\n\n";
      for (const entity of invalid) {
        const issue = await ctx.issues.get(entity.scopeId);
        if (issue) {
          report += `- **${issue.identifier}** ${issue.title}\n`;
          const errors = entity.data?.errors || [];
          for (const error of errors) {
            report += `  - ${error}\n`;
          }
        }
      }
    }

    // Create report issue
    const today = new Date().toISOString().split("T")[0];
    await ctx.issues.create({
      title: `Rocketlane shadow report ${today}`,
      description: report,
      status: "backlog",
      assigneeAgentId: null, // Will be assigned to CEO by default
    });

    ctx.logger.info(`Shadow report created: ${valid.length} valid, ${invalid.length} invalid`);
  } catch (error) {
    ctx.logger.error("Error running shadow report:", error);
  }
}

/**
 * Define the plugin with SDK.
 */
const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    // Register event handlers
    ctx.events.on("issue.created", async (event: PluginEvent) => {
      await processWorkItem(ctx, event.data.issue.id);
    });

    ctx.events.on("issue.updated", async (event: PluginEvent) => {
      await processWorkItem(ctx, event.data.issue.id);
    });

    // Register weekly shadow report job
    ctx.jobs.register("shadow-report", async (jobCtx: PluginJobContext) => {
      await runShadowReport(jobCtx);
    });

    ctx.logger.info(`${PLUGIN_NAME} plugin setup complete`);
  },

  async onHealth() {
    return {
      status: "ok" as const,
      message: "Rocketlane sync plugin running in shadow mode",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
