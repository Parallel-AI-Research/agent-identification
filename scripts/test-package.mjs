import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Exercise the actual npm tarball from a consumer directory outside the repository.
const temp = await mkdtemp(join(tmpdir(), "agent-id-package-"));
try {
  const [pack] = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--cache",
        join(temp, "cache"),
        "--pack-destination",
        temp,
      ],
      {
        encoding: "utf8",
      },
    ),
  );
  const entries = pack.files.map((file) => file.path);
  assert(entries.includes("dist/agent-id.js"));
  assert(entries.includes("dist/agent-id.css"));
  assert(entries.includes("README.md"));
  assert(entries.every((path) => /^(dist\/|README\.md$|LICENSE$|package\.json$)/.test(path)));
  assert(!entries.some((path) => /\.(map|env)$/.test(path)));
  await writeFile(join(temp, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--omit=optional",
      "--legacy-peer-deps",
      "--cache",
      join(temp, "cache"),
      join(temp, pack.filename),
    ],
    { cwd: temp, stdio: "pipe" },
  );
  // React is optional; browser and server imports must work before React is installed.
  await writeFile(
    join(temp, "consumer.mjs"),
    `
import assert from 'node:assert/strict';
import { init } from '@parallel-research/agent-identification';
import { createBindingContext, verifyDeclarationOnline } from '@parallel-research/agent-identification/server';
assert.equal(typeof init, 'function');
assert.equal(typeof verifyDeclarationOnline, 'function');
assert.ok(createBindingContext({
 siteId:'demo-site',origin:'https://example.com',sessionBinding:'private-session',
 secret:'package-test-secret-000000000000000000000'
}).length>30);
`,
  );
  execFileSync(process.execPath, ["consumer.mjs"], { cwd: temp, stdio: "pipe" });
  await symlink(resolve("node_modules/react"), join(temp, "node_modules/react"));
  await symlink(resolve("node_modules/react-dom"), join(temp, "node_modules/react-dom"));
  await mkdir(join(temp, "node_modules/@types"), { recursive: true });
  for (const name of ["react", "react-dom", "node"]) {
    await symlink(
      resolve(`node_modules/@types/${name}`),
      join(temp, `node_modules/@types/${name}`),
    );
  }
  await writeFile(
    join(temp, "react-consumer.mjs"),
    `
import assert from 'node:assert/strict';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {AgentIdentification} from '@parallel-research/agent-identification/react';
const markup=renderToString(React.createElement(AgentIdentification,{
 siteId:'demo-site',apiUrl:'https://collector.example',id:'declaration'
}));
assert.ok(markup.includes('id="declaration"'));
assert.ok(!markup.includes('button'));
`,
  );
  execFileSync(process.execPath, ["react-consumer.mjs"], { cwd: temp, stdio: "pipe" });
  await writeFile(
    join(temp, "consumer.tsx"),
    `
import {init,type Widget,type RecordedDeclaration} from '@parallel-research/agent-identification';
import {AgentIdentification} from '@parallel-research/agent-identification/react';
import {verifyDeclarationOnline} from '@parallel-research/agent-identification/server';
const recorded=(value:RecordedDeclaration)=>console.log(value.evidence);
const widget:Widget=init({container:'#identification',siteId:'demo-site',apiUrl:'https://collector.example',onRecorded:recorded});
void widget; void verifyDeclarationOnline;
export const demo=<AgentIdentification siteId="demo-site" apiUrl="https://collector.example" onRecorded={recorded}/>;
`,
  );
  execFileSync(
    process.execPath,
    [
      resolve("node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--jsx",
      "react-jsx",
      "consumer.tsx",
    ],
    { cwd: temp, stdio: "pipe" },
  );
  const installed = JSON.parse(
    await readFile(
      join(temp, "node_modules/@parallel-research/agent-identification/package.json"),
      "utf8",
    ),
  );
  assert.equal(installed.version, pack.version);
  console.log(
    `Packed consumer checks passed: optional React, SSR, exports, TypeScript, ${entries.length} approved files.`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
