import { build } from "esbuild";
import { access, mkdir, readFile, copyFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { assertFrozenInputs, loadFrozenReleases, restoreFrozenSdk } from "./frozen-releases.mjs";
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const frozenReleases = await loadFrozenReleases();
await assertFrozenInputs(frozenReleases, pkg);
// The page script arrived in 0.6.0, so older frozen releases rebuild without it.
const pageScript = await access("src/browser/track-script.ts").then(
  () => true,
  () => false,
);
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
  pageScript &&
    build({
      ...shared,
      entryPoints: ["src/browser/track-script.ts"],
      outfile: "dist/agent-id-track.js",
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
await assertFrozenInputs(frozenReleases, pkg, ".", { dist: true });
const sdk = `public/sdk/v${pkg.version}`;
await mkdir(sdk, { recursive: true });
const assets = ["agent-id.js", ...(pageScript ? ["agent-id-track.js"] : []), "agent-id.css"];
await Promise.all(assets.map((f) => copyFile(`dist/${f}`, `${sdk}/${f}`)));
await build({
  ...shared,
  entryPoints: ["examples/react/main.tsx"],
  outfile: "examples/react/app.js",
  format: "esm",
  platform: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"development"' },
});
const integrity = { version: pkg.version, assets: {} };
for (const f of assets) {
  const b = await readFile(`dist/${f}`);
  integrity.assets[f] = {
    bytes: b.length,
    integrity: `sha384-${createHash("sha384").update(b).digest("base64")}`,
  };
}
await writeFile(`${sdk}/integrity.json`, JSON.stringify(integrity, null, 2) + "\n");
await restoreFrozenSdk(frozenReleases);
console.log(`Built scripts, ESM, React and server exports for ${pkg.version}.`);
