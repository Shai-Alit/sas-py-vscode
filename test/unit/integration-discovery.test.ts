// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverTestFiles } from "../integration/index";

/**
 * The integration runner's file discovery, tested from the unit tier.
 *
 * This exists because a reviewer read `readdirSync(..., { recursive: true })`
 * as a no-op that enumerates only the top level, and concluded that a suite in
 * a subdirectory would be silently skipped. That would be a serious defect —
 * silently skipped tests are indistinguishable from passing ones — and the
 * option genuinely did not exist before Node 20.1. An assertion against real
 * nested directories settles it permanently, and keeps settling it if the
 * implementation is ever swapped for a hand-rolled walk or a glob.
 */
describe("integration test discovery", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "pov-discovery-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(relative: string): void {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "");
  }

  it("finds suites nested at any depth, not just the top level", () => {
    write("extension.test.js");
    write("auth/profiles.test.js");
    write("auth/oauth/loopback.test.js");

    assert.deepEqual(discoverTestFiles(root), [
      path.join("auth", "oauth", "loopback.test.js"),
      path.join("auth", "profiles.test.js"),
      "extension.test.js",
    ]);
  });

  it("ignores everything that is not a compiled test", () => {
    write("extension.test.js");
    write("extension.test.js.map");
    write("index.js");
    write("helpers/fixture.json");

    assert.deepEqual(discoverTestFiles(root), ["extension.test.js"]);
  });

  it("returns nothing for an empty tree, so the runner can fail loudly", () => {
    mkdirSync(path.join(root, "auth"), { recursive: true });

    assert.deepEqual(discoverTestFiles(root), []);
  });

  it("orders results so a run is reproducible", () => {
    write("z.test.js");
    write("a.test.js");
    write("m/b.test.js");

    const files = discoverTestFiles(root);
    assert.deepEqual(files, [...files].sort());
  });
});
