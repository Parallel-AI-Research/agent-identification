import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Keep this list explicit: a missing archive must never fall back to repacking.
export const frozenVersions = ["0.1.0", "0.5.0"];
const digest = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);

export async function loadFrozenReleases(root = ".") {
  return Promise.all(
    frozenVersions.map(async (version) => {
      const directory = join(root, "releases", `v${version}`);
      const frozen = JSON.parse(await readFile(join(directory, "frozen.json"), "utf8"));
      const filename = `parallel-research-agent-identification-${version}.tgz`;
      const names = ["agent-id.js", "agent-id.css", "integrity.json", filename, "release.json"];
      assert.equal(frozen.version, version, "Frozen release version mismatch.");
      assert.deepEqual(Object.keys(frozen.artifacts).sort(), [...names].sort());
      const files = {};
      for (const name of names) {
        files[name] = await readFile(join(directory, name));
        assert.equal(
          digest(files[name]),
          frozen.artifacts[name],
          `Frozen artifact changed: ${name}`,
        );
      }
      const release = JSON.parse(files["release.json"]);
      assert.equal(release.version, version);
      assert.equal(release.filename, filename);
      assert.equal(release.sha256, digest(files[filename]));
      assert.equal(release.integrity, `sha512-${digest(files[filename], "sha512", "base64")}`);
      const integrity = JSON.parse(files["integrity.json"]);
      assert.equal(integrity.version, version);
      for (const name of ["agent-id.js", "agent-id.css"]) {
        assert.equal(integrity.assets[name].bytes, files[name].length);
        assert.equal(
          integrity.assets[name].integrity,
          `sha384-${digest(files[name], "sha384", "base64")}`,
        );
      }
      return { version, filename, frozen, files };
    }),
  );
}

async function hashTree(root, directory) {
  const hashes = {};
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(hashes, await hashTree(root, path));
    else {
      assert(entry.isFile(), `Unexpected non-file in frozen inputs: ${path}`);
      hashes[path] = digest(await readFile(join(root, path)));
    }
  }
  return hashes;
}

export async function assertFrozenInputs(releases, pkg, root = ".", { dist = false } = {}) {
  const release = releases.find((entry) => entry.version === pkg.version);
  if (!release) return;
  const message = `Published v${pkg.version} is frozen; bump the SDK version before changing package inputs.`;
  const { scripts: _scripts, devDependencies: _devDependencies, ...metadata } = pkg;
  assert.deepEqual(metadata, release.frozen.package, message);
  const sources = await hashTree(root, "src");
  sources.LICENSE = digest(await readFile(join(root, "LICENSE")));
  assert.deepEqual(sources, release.frozen.sources, message);
  if (dist) assert.deepEqual(await hashTree(root, "dist"), release.frozen.dist, message);
}

export async function restoreFrozenSdk(releases, root = ".") {
  for (const release of releases) {
    const destination = join(root, "public", "sdk", `v${release.version}`);
    await mkdir(destination, { recursive: true });
    for (const name of ["agent-id.js", "agent-id.css", "integrity.json"]) {
      await writeFile(join(destination, name), release.files[name]);
    }
  }
}

export async function restoreFrozenDownloads(releases, currentVersion, root = ".") {
  const destination = join(root, "public", "downloads");
  await mkdir(destination, { recursive: true });
  for (const release of releases) {
    await writeFile(join(destination, release.filename), release.files[release.filename]);
    if (release.version === currentVersion) {
      await writeFile(join(destination, "release.json"), release.files["release.json"]);
    }
  }
}
