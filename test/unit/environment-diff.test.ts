// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { diffEnvironments } from "../../src/run/environmentDiff";

describe("environmentDiff.ts — comparing remote and local package sets", () => {
  it("reports local-unknown when the local side was never read", () => {
    const diff = diffEnvironments(
      [{ name: "numpy", version: "2.0.0" }],
      undefined,
    );

    assert.deepEqual(diff, { kind: "local-unknown" });
  });

  it("treats a successfully-read empty local environment as everything remote-only", () => {
    const diff = diffEnvironments([{ name: "numpy", version: "2.0.0" }], []);

    assert.deepEqual(diff, {
      kind: "compared",
      remoteOnly: [{ name: "numpy", version: "2.0.0" }],
      localOnly: [],
      versionMismatched: [],
    });
  });

  it("buckets a package installed only on Viya as remote-only", () => {
    const diff = diffEnvironments(
      [{ name: "sas-kernel", version: "1.0.0" }],
      [{ name: "pandas", version: "3.0.0" }],
    );

    assert.deepEqual(diff, {
      kind: "compared",
      remoteOnly: [{ name: "sas-kernel", version: "1.0.0" }],
      localOnly: [{ name: "pandas", version: "3.0.0" }],
      versionMismatched: [],
    });
  });

  it("buckets a package present on both sides at the same version as neither", () => {
    const diff = diffEnvironments(
      [{ name: "numpy", version: "2.0.0" }],
      [{ name: "numpy", version: "2.0.0" }],
    );

    assert.deepEqual(diff, {
      kind: "compared",
      remoteOnly: [],
      localOnly: [],
      versionMismatched: [],
    });
  });

  it("buckets a package present on both sides at different versions as version-mismatched", () => {
    const diff = diffEnvironments(
      [{ name: "pandas", version: "3.0.0" }],
      [{ name: "pandas", version: "2.1.0" }],
    );

    assert.deepEqual(diff, {
      kind: "compared",
      remoteOnly: [],
      localOnly: [],
      versionMismatched: [
        { name: "pandas", remoteVersion: "3.0.0", localVersion: "2.1.0" },
      ],
    });
  });

  it("matches names normalised per PEP 503, not byte-for-byte", () => {
    const diff = diffEnvironments(
      [{ name: "My-Package", version: "1.0" }],
      [{ name: "my_package", version: "1.0" }],
    );

    assert.deepEqual(diff, {
      kind: "compared",
      remoteOnly: [],
      localOnly: [],
      versionMismatched: [],
    });
  });

  it("displays the remote side's own name spelling for a version mismatch, not the normalised key", () => {
    const diff = diffEnvironments(
      [{ name: "My.Package", version: "2.0" }],
      [{ name: "my-package", version: "1.0" }],
    );

    assert.equal(diff.kind, "compared");
    assert.deepEqual(diff.versionMismatched, [
      { name: "My.Package", remoteVersion: "2.0", localVersion: "1.0" },
    ]);
  });

  it("sorts each bucket by name", () => {
    const diff = diffEnvironments(
      [
        { name: "zeta", version: "1.0" },
        { name: "alpha", version: "1.0" },
      ],
      [],
    );

    assert.equal(diff.kind, "compared");
    assert.deepEqual(
      diff.remoteOnly.map((p) => p.name),
      ["alpha", "zeta"],
    );
  });
});
