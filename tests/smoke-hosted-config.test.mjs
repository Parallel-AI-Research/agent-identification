import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSmokeConfig } from "../scripts/smoke-hosted-config.mjs";

test("hosted smoke uses the explicitly supplied fixture site and every distinct origin", () => {
  assert.deepEqual(
    parseSmokeConfig([
      "https://collector.example/",
      "--site",
      "customer-fixture_42",
      "--origin",
      "https://fixture.example",
      "--origin",
      "https://alternate.example:8443",
      "--origin",
      "https://fixture.example/",
    ]),
    {
      baseUrl: "https://collector.example",
      siteId: "customer-fixture_42",
      origins: ["https://fixture.example", "https://alternate.example:8443"],
    },
  );
});

test("hosted smoke cannot fall back to a customer registration when fixture settings are missing", () => {
  for (const args of [
    [],
    ["https://collector.example"],
    ["https://collector.example", "--site", "fixture"],
    ["https://collector.example", "--origin", "https://fixture.example"],
  ]) {
    assert.throws(() => parseSmokeConfig(args), /Usage:/);
  }
});

test("hosted smoke rejects unsafe URLs and same-origin fixtures before starting requests", () => {
  const valid = [
    "https://collector.example",
    "--site",
    "fixture",
    "--origin",
    "https://fixture.example",
  ];
  for (const index of [0, 4]) {
    for (const value of [
      "not a URL",
      "http://fixture.example",
      "https://user:password@fixture.example",
      "https://fixture.example/path",
      "https://fixture.example?query=value",
      "https://fixture.example#fragment",
    ]) {
      const args = [...valid];
      args[index] = value;
      assert.throws(() => parseSmokeConfig(args), /HTTPS origin/);
    }
  }
  assert.throws(
    () => parseSmokeConfig([...valid.slice(0, 4), "https://collector.example/"]),
    /must differ from the collector/,
  );
});

test("fixture site IDs cannot inject markup into the browser installation", () => {
  assert.throws(
    () =>
      parseSmokeConfig([
        "https://collector.example",
        "--site",
        'fixture" data-api="https://unexpected.example',
        "--origin",
        "https://fixture.example",
      ]),
    /Fixture site ID/,
  );
});
