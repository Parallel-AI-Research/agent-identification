import { build } from "esbuild";
import { mkdir, readFile, copyFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
const shared = {
  bundle: true,
  target: "es2022",
  legalComments: "none",
  sourcemap: false,
  logLevel: "warning",
};
await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/browser/index.ts"],
    outfile: "dist/browser/index.js",
    format: "esm",
    platform: "browser",
  }),
  build({
    ...shared,
    entryPoints: ["src/browser/script.ts"],
    outfile: "dist/agent-id.js",
    format: "iife",
    platform: "browser",
    minify: true,
  }),
  build({
    ...shared,
    entryPoints: ["src/react/index.tsx"],
    outfile: "dist/react/index.js",
    format: "esm",
    platform: "browser",
    external: ["react", "react/jsx-runtime"],
  }),
  build({
    ...shared,
    entryPoints: ["src/server/index.ts"],
    outfile: "dist/server/index.js",
    format: "esm",
    platform: "node",
  }),
]);
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
  stdio: "inherit",
});
await copyFile("src/browser/styles.css", "dist/agent-id.css");
const sdk = `public/sdk/v${pkg.version}`;
await mkdir(sdk, { recursive: true });
await Promise.all(["agent-id.js", "agent-id.css"].map((f) => copyFile(`dist/${f}`, `${sdk}/${f}`)));
await build({
  ...shared,
  entryPoints: ["examples/react/main.tsx"],
  outfile: "examples/react/app.js",
  format: "esm",
  platform: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"development"' },
});
await mkdir("public/demo-react", { recursive: true });
await copyFile("examples/react/app.js", "public/demo-react/app.js");
await copyFile("examples/styles.css", "public/demo-react/styles.css");
await writeFile(
  "public/demo-react/index.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="agent-id-api" content="/"><meta name="agent-id-site" content="public-demo"><meta name="agent-id-react-path" content="/demo-react/"><meta name="agent-id-script-path" content="/"><title>Agent Identification · React example</title><link rel="stylesheet" href="/demo-react/styles.css"><script defer src="/demo-react/app.js"></script></head><body><div id="root"></div></body></html>`,
);
const integrity = { version: pkg.version, assets: {} };
for (const f of ["agent-id.js", "agent-id.css"]) {
  const b = await readFile(`dist/${f}`);
  integrity.assets[f] = {
    bytes: b.length,
    integrity: `sha384-${createHash("sha384").update(b).digest("base64")}`,
  };
}
await writeFile(`${sdk}/integrity.json`, JSON.stringify(integrity, null, 2) + "\n");
console.log(`Built script, ESM, React and server exports for ${pkg.version}.`);
