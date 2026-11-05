#!/usr/bin/env node

/**
 * Build script for Paperclip plugins.
 * Bundles manifest.ts and worker.ts using esbuild.
 */

import { build } from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const cwd = process.cwd();
const packageJson = JSON.parse(
  fs.readFileSync(path.join(cwd, "package.json"), "utf-8")
);

if (!packageJson.paperclipPlugin) {
  console.error("No paperclipPlugin field in package.json");
  process.exit(1);
}

const distDir = path.join(cwd, "dist");

// Clean dist
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Build manifest
console.log("Building manifest...");
await build({
  entryPoints: [path.join(cwd, "src/manifest.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(distDir, "manifest.js"),
  external: [],
});

// Build worker
console.log("Building worker...");
await build({
  entryPoints: [path.join(cwd, "src/worker.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(distDir, "worker.js"),
  external: [],
});

console.log("Build complete!");
