import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const version = "0.1.0";
const archive = `releases/v${version}`;
const frozen = JSON.parse(await readFile(join(repository, archive, "frozen.json"), "utf8"));

function destination(name) {
  return ["agent-id.js", "agent-id.css", "integrity.json"].includes(name)
    ? `public/sdk/v${version}/${name}`
    : `public/downloads/${name}`;
}

/** A checkout as it was when this version was published: its archived source, package and build. */
async function fixture(t, { build = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "agent-id-frozen-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(repository, archive, "src"), join(root, "src"), { recursive: true });
  for (const path of ["releases", "LICENSE", "README.md"]) {
    await cp(join(repository, path), join(root, path), { recursive: true });
  }
  const unpacked = join(root, "unpacked");
  await mkdir(unpacked);
  const tarball = join(
    repository,
    archive,
    `parallel-research-agent-identification-${version}.tgz`,
  );
  const tar = spawnSync("tar", ["-xzf", tarball, "-C", unpacked], { encoding: "utf8" });
  assert.equal(tar.status, 0, tar.stderr);
  await cp(join(unpacked, "package", "dist"), join(root, "dist"), { recursive: true });
  await cp(join(unpacked, "package", "package.json"), join(root, "package.json"));
  await rm(unpacked, { recursive: true });
  await mkdir(join(root, "scripts"));
  for (const file of ["release.mjs", "frozen-releases.mjs", ...(build ? ["build.mjs"] : [])]) {
    await cp(join(repository, "scripts", file), join(root, "scripts", file));
  }
  if (build) {
    for (const path of ["examples", "tsconfig.json", "tsconfig.build.json"]) {
      await cp(join(repository, path), join(root, path), { recursive: true });
    }
    await symlink(join(repository, "node_modules"), join(root, "node_modules"));
  }
  return root;
}

function run(root, script) {
  return spawnSync(process.execPath, [`scripts/${script}.mjs`], {
    cwd: root,
    encoding: "utf8",
    // Only guards against a hung build; a loaded machine can take well over 15 seconds.
    timeout: 60_000,
  });
}

async function modify(root, file) {
  await writeFile(join(root, file), `${await readFile(join(root, file), "utf8")}\n// changed\n`);
}

async function seedDestinations(root) {
  for (const name of Object.keys(frozen.artifacts)) {
    const path = join(root, destination(name));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "existing public artifact");
  }
}

async function assertDestinationsUntouched(root) {
  for (const name of Object.keys(frozen.artifacts)) {
    assert.equal(await readFile(join(root, destination(name)), "utf8"), "existing public artifact");
  }
}

test("documentation and test-script edits build and release the exact published bytes", async (t) => {
  const root = await fixture(t, { build: true });
  await writeFile(join(root, "README.md"), "Updated installation instructions.\n");
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  pkg.scripts.test = "node --test new-tests/*.mjs";
  await writeFile(join(root, "package.json"), JSON.stringify(pkg));
  for (const script of ["build", "release"]) {
    const result = run(root, script);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
  for (const [name, hash] of Object.entries(frozen.artifacts)) {
    const bytes = await readFile(join(root, destination(name)));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, name);
  }
});

test("standalone release rejects source and dist drift even when a prior build exists", async (t) => {
  const mutations = {
    "edited source": (root) => modify(root, "src/browser/index.ts"),
    "added source": (root) => writeFile(join(root, "src/new.ts"), "export const added = true;"),
    "removed source": (root) => rm(join(root, "src/server/online.ts")),
    "edited dist": (root) => modify(root, "dist/server/index.js"),
    "added dist": (root) => writeFile(join(root, "dist/new.js"), "export const added = true;"),
    "removed dist": (root) => rm(join(root, "dist/types/server/index.d.ts")),
    "runtime metadata": async (root) => {
      const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      pkg.optionalDependencies = { "new-runtime-dependency": "1.0.0" };
      await writeFile(join(root, "package.json"), JSON.stringify(pkg));
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async (t) => {
      const root = await fixture(t);
      await seedDestinations(root);
      await mutate(root);
      const result = run(root, "release");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /bump the SDK version/);
      await assertDestinationsUntouched(root);
    });
  }
});

test("missing or corrupt frozen archives fail without repacking or replacing public artifacts", async (t) => {
  for (const mutation of ["missing", "corrupt"]) {
    await t.test(mutation, async (t) => {
      const root = await fixture(t);
      await seedDestinations(root);
      const path = join(root, archive, "parallel-research-agent-identification-0.1.0.tgz");
      if (mutation === "missing") await rm(path);
      else await writeFile(path, "corrupt archive");
      const result = run(root, "release");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, mutation === "missing" ? /ENOENT/ : /Frozen artifact changed/);
      await assertDestinationsUntouched(root);
    });
  }
});
