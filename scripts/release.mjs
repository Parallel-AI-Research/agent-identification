import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  assertFrozenInputs,
  loadFrozenReleases,
  restoreFrozenDownloads,
} from "./frozen-releases.mjs";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const frozenReleases = await loadFrozenReleases();
await assertFrozenInputs(frozenReleases, pkg, ".", { dist: true });
await restoreFrozenDownloads(frozenReleases, pkg.version);
if (frozenReleases.some((release) => release.version === pkg.version)) {
  console.log(`Restored the unchanged published v${pkg.version} package and release manifest.`);
} else {
  await mkdir("public/downloads", { recursive: true });
  const [result] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", "public/downloads"],
      {
        encoding: "utf8",
      },
    ),
  );
  const bytes = await readFile(`public/downloads/${result.filename}`);
  await writeFile(
    "public/downloads/release.json",
    JSON.stringify(
      {
        name: result.name,
        version: result.version,
        filename: result.filename,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        integrity: result.integrity,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Packed ${result.filename} (${bytes.length} bytes).`);
}
