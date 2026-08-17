// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  deploymentFromSignal,
  normaliseAlias,
  resolveDialect,
  resolveDialectId,
} from "../../src/dialects/resolve";

/**
 * Choosing the wrong dialect does not fail; it presents as a dozen unrelated
 * bugs somewhere else. So the tests that matter here are about the three
 * outcomes being kept apart — a determined version, a determined *absence* of
 * one, and not being able to ask — and about every resolution carrying a reason
 * that says which of those happened.
 */

describe("deploymentFromSignal", () => {
  it("reads a cadence version as Viya 4", () => {
    assert.deepEqual(
      deploymentFromSignal({ kind: "cadence", version: "2025.04" }),
      {
        kind: "viya4",
        release: "2025.04",
      },
    );
  });

  it("trims what the deployment sent", () => {
    assert.deepEqual(
      deploymentFromSignal({ kind: "cadence", version: " 2022.11\n" }),
      { kind: "viya4", release: "2022.11" },
    );
  });

  it("reads a considered absence as Viya 3.5", () => {
    // The endpoint is a Viya 4 addition, so its absence is the version signal —
    // which is as close to a version number as 3.5 offers (§2.3).
    assert.deepEqual(deploymentFromSignal({ kind: "absent" }), {
      kind: "viya35",
    });
  });

  it("keeps 'could not ask' apart from 'answered, and there is none'", () => {
    // The reason this input is a union rather than `string | undefined`. A user
    // without permission to read `/deploymentData` must not be reported as being
    // on Viya 3.5 — that claim would then be used to tell them their deployment
    // has no built-in OAuth client, which is a specific, wrong instruction.
    assert.deepEqual(
      deploymentFromSignal({ kind: "unreadable", detail: "403" }),
      { kind: "unknown" },
    );
  });
});

describe("resolveDialect", () => {
  it("chooses Viya 4 for a Viya 4 deployment, and says the release", () => {
    const { dialect, reason, certain } = resolveDialect({
      kind: "viya4",
      release: "2025.04",
    });
    assert.equal(dialect.id, "viya4");
    assert.ok(certain);
    assert.match(reason, /2025\.04/);
  });

  it("chooses Viya 3.5 for a Viya 3.5 deployment", () => {
    const { dialect, certain } = resolveDialect({ kind: "viya35" });
    assert.equal(dialect.id, "viya35");
    assert.ok(certain);
  });

  it("assumes Viya 4 when the version is unknown, and says it assumed", () => {
    // Fail-soft, per §2.3: an inconclusive probe must not stand between a user
    // and a deployment that is very probably Viya 4. The reason string is what
    // separates degrading from guessing.
    const { dialect, reason, certain } = resolveDialect({ kind: "unknown" });
    assert.equal(dialect.id, "viya4");
    assert.ok(!certain);
    assert.match(reason, /assumed/);
  });

  it("does not let the assumption become a claim about the version", () => {
    // The deliberate mismatch: the Viya 4 dialect, bound to an `unknown`
    // deployment. Anything downstream that turns on the version keeps answering
    // "unknown" instead of inheriting a confidence nobody earned.
    const { dialect } = resolveDialect({ kind: "unknown" });
    assert.equal(dialect.deployment.kind, "unknown");
    assert.equal(dialect.hasBuiltInClient(), undefined);
    assert.equal(dialect.describe(), "an unrecognised version");
  });

  it("says so when the generation is known but the release is not", () => {
    const { reason, certain } = resolveDialect({ kind: "viya4", release: "" });
    assert.ok(certain);
    assert.match(reason, /did not report/);
  });

  it("always gives a reason, in the house form", () => {
    const resolutions = [
      resolveDialect({ kind: "viya4", release: "2025.04" }),
      resolveDialect({ kind: "viya4", release: "" }),
      resolveDialect({ kind: "viya35" }),
      resolveDialect({ kind: "unknown" }),
    ];
    for (const { reason } of resolutions) {
      assert.ok(reason.length > 0);
      assert.ok(!reason.endsWith("."), `"${reason}" ends with a full stop`);
      assert.ok(!/^[A-Z]/.test(reason), `"${reason}" starts with a capital`);
    }
  });
});

describe("normaliseAlias", () => {
  it("absorbs the separators people vary on", () => {
    for (const written of ["Viya 4", "viya-4", "VIYA_4", "  viya4  "]) {
      assert.equal(normaliseAlias(written), "viya4");
    }
  });

  it("keeps the dot, because 3.5 needs it", () => {
    assert.equal(normaliseAlias("Viya 3.5"), "viya3.5");
    assert.equal(normaliseAlias("2025.04"), "2025.04");
  });
});

describe("resolveDialectId", () => {
  it("resolves the ways a generation gets written down", () => {
    for (const written of ["viya4", "Viya 4", "v4", "4"]) {
      assert.equal(resolveDialectId(written), "viya4");
    }
    for (const written of ["viya35", "Viya 3.5", "viya-3.5", "3.5", "v3.5"]) {
      assert.equal(resolveDialectId(written), "viya35");
    }
  });

  it("reads a cadence release as Viya 4 without a table row per quarter", () => {
    assert.equal(resolveDialectId("2022.11"), "viya4");
    assert.equal(resolveDialectId("2025.04"), "viya4");
  });

  it("anchors the cadence pattern", () => {
    // A substring match here would accept anything with a date in it — a
    // timestamp, a build tag, a path — and quietly call it Viya 4.
    assert.equal(resolveDialectId("v2025.04"), undefined);
    assert.equal(resolveDialectId("2025.04.1"), undefined);
    assert.equal(resolveDialectId("2025.4"), undefined);
  });

  it("answers undefined for a string it does not know", () => {
    // The honest answer. Guessing here would put the guess in the one place
    // that has nowhere to log a reason for it.
    assert.equal(resolveDialectId("viya5"), undefined);
    assert.equal(resolveDialectId(""), undefined);
    assert.equal(resolveDialectId("sas 9"), undefined);
  });

  it("round-trips the ids the dialects report", () => {
    // The ids name fixture directories and contract files, so a rename that
    // missed this table would fail later and somewhere else.
    for (const id of ["viya4", "viya35"] as const) {
      assert.equal(resolveDialectId(id), id);
    }
  });
});
