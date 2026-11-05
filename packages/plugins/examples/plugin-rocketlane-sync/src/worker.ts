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
async function processWorkItem(ctx: PluginContext, issueId: string, companyId: string) {
  try {
    // Get the issue
    const issue = await ctx.issues.get(issueId, companyId);
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
    const workItemDoc = await ctx.issues.documents.get(issueId, "work-item", companyId);
    if (!workItemDoc) {
      ctx.logger.warn(
        `No work-item document found for ${issue.identifier}`
      );
      await ctx.entities.upsert({
        entityType: ENTITY_TYPE,
        scopeKind: "issue",
        scopeId: issueId,
        externalId: undefined,
        data: {
          state: "invalid",
          errors: ["no work-item document found"],
          builtAt: new Date().toISOString(),
          companyId,
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
        externalId: undefined,
        data: {
          state: "invalid",
          errors: parsed.errors,
          builtAt: new Date().toISOString(),
          companyId,
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
      const comments = await ctx.issues.listComments(issueId, companyId);
      for (const comment of comments || []) {
        const firstLine = comment.body.split("\n")[0].trim();
        if (firstLine && comment.createdAt) {
          const date = comment.createdAt.toISOString().split("T")[0];
          history.push({ at: date, line: firstLine });
        }
      }
    } catch (err) {
      ctx.logger.warn(`Failed to fetch comments for ${issueId}: ${err}`);
    }

    // Build the payload
    const payload = buildTaskPayload(
      {
        identifier: issue.identifier || `issue-${issueId}`,
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
        externalId: undefined,
        data: {
          state: "invalid",
          errors: payload.errors,
          builtAt: new Date().toISOString(),
          companyId,
        },
      });
      return;
    }

    // Valid payload - store in shadow mode
    await ctx.entities.upsert({
      entityType: ENTITY_TYPE,
      scopeKind: "issue",
      scopeId: issueId,
      externalId: undefined,
      data: {
        state: "shadow",
        payload,
        builtAt: new Date().toISOString(),
        companyId,
      },
    });

    ctx.logger.info(
      `Built shadow payload for ${issue.identifier}: ${payload.taskName}`
    );
  } catch (error) {
    ctx.logger.error(`Error processing work-item ${issueId}:`, error as Record<string, unknown>);
  }
}

/**
 * Weekly job that creates a shadow report issue.
 * Note: Job handler receives PluginJobContext, but has access to outer ctx via closure.
 */
function createShadowReportHandler(ctx: PluginContext) {
  return async (job: PluginJobContext) => {
    try {
      // Get all entities
      const allEntities = await ctx.entities.list({
        entityType: ENTITY_TYPE,
      });

      const invalid: any[] = [];
      const valid: any[] = [];

      for (const entity of allEntities) {
        const state = (entity.data as any)?.state;
        if (state === "invalid") {
          invalid.push(entity);
        } else if (state === "shadow") {
          valid.push(entity);
        }
      }

      // Build report content
      let report = "# Rocketlane Shadow Report\n\n";
      report += `**Valid payloads:** ${valid.length}\n`;
      report += `**Invalid items:** ${invalid.length}\n\n`;

      if (invalid.length > 0) {
        report += "## Invalid Items\n\n";
        for (const entity of invalid) {
          const errors = (entity.data as any)?.errors || [];
          report += `- Issue ${entity.scopeId}\n`;
          for (const error of errors) {
            report += `  - ${error}\n`;
          }
        }
      }

      // Get companyId from the first entity (they should all be from the same company)
      const companyId = allEntities.length > 0 ? (allEntities[0].data as any)?.companyId : undefined;

      if (companyId) {
        // Create an issue with the shadow report
        await ctx.issues.create({
          companyId,
          title: "Rocketlane Shadow Report",
          description: report,
        });
        ctx.logger.info(`Shadow report issue created: ${valid.length} valid, ${invalid.length} invalid`);
      } else {
        ctx.logger.warn("No entities found or missing companyId, skipping report issue creation");
      }

      ctx.logger.info(`Job ${job.jobKey} run ${job.runId} completed (trigger: ${job.trigger})`);
    } catch (error) {
      ctx.logger.error("Error running shadow report:", error as Record<string, unknown>);
    }
  };
}

/**
 * Define the plugin with SDK.
 */
const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    // Register event handlers
    ctx.events.on("issue.created", async (event: PluginEvent) => {
      if (event.entityId && event.companyId) {
        await processWorkItem(ctx, event.entityId, event.companyId);
      }
    });

    ctx.events.on("issue.updated", async (event: PluginEvent) => {
      if (event.entityId && event.companyId) {
        await processWorkItem(ctx, event.entityId, event.companyId);
      }
    });

    // Register weekly shadow report job
    ctx.jobs.register("shadow-report", createShadowReportHandler(ctx));

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
