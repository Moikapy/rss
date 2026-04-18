#!/usr/bin/env node

/**
 * Build script for Electron app.
 * Compiles the main process and preload scripts from TypeScript,
 * then runs electron-builder to package for the current platform.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function run(cmd: string) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

// 1. Build Next.js
console.log("📦 Building Next.js...");
run("bun run build");

// 2. Export Next.js to static HTML (for Electron production mode)
console.log("📦 Exporting Next.js static output...");
// Note: We need output: 'export' or we serve via custom protocol
// For now, in prod electron loads from the standalone server

// 3. Compile Electron TypeScript
console.log("📦 Compiling Electron main process...");
const electronTsConfig = {
  compilerOptions: {
    target: "ES2020",
    module: "commonjs",
    outDir: "./dist-electron/js",
    rootDir: "./src/electron",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
  },
  include: ["src/electron/**/*.ts"],
};

// Compile directly with bun (fast)
const srcFiles = ["src/electron/main.ts", "src/electron/preload.ts"];
for (const file of srcFiles) {
  const outPath = file
    .replace("src/electron/", "dist-electron/js/")
    .replace(".ts", ".js");
  run(`bun build ${file} --outfile ${outPath} --target=node`);
}

console.log("✅ Electron build complete!");