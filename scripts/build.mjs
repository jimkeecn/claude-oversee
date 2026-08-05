import { build } from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipUi = process.argv.includes("--skip-ui");

const bundles = [
  { entry: "src/hook/main.ts", out: "dist/hook.cjs", format: "cjs" },
  { entry: "src/cli/main.ts", out: "dist/cli.cjs", format: "cjs" },
  { entry: "src/server/main.ts", out: "dist/server.mjs", format: "esm" },
];

for (const { entry, out, format } of bundles) {
  await build({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(root, out),
    bundle: true,
    platform: "node",
    format,
    target: "node18",
    sourcemap: false,
    minify: false,
    logLevel: "warning",
    banner:
      format === "esm"
        ? {
            js: "import { createRequire as __claudeOverseeCreateRequire } from 'node:module'; const require = __claudeOverseeCreateRequire(import.meta.url);",
          }
        : undefined,
  });
  console.log(`built ${out}`);
}

if (!skipUi && fs.existsSync(path.join(root, "ui", "package.json"))) {
  execSync("npx vite build", {
    cwd: path.join(root, "ui"),
    stdio: "inherit",
  });
  console.log("built dist/ui");
} else if (!skipUi) {
  console.log("ui/ not present — skipped UI build");
}
