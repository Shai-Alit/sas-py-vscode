// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { baseDialect } from "../../src/dialects/dialect";
import { createViya35Dialect } from "../../src/dialects/viya35";
import { createViya4Dialect } from "../../src/dialects/viya4";

/**
 * The dialect layer is thin on purpose — ADR-0015's restraint clause — so most of
 * what is worth testing is that it delegates rather than re-deciding.
 *
 * The `hasBuiltInClient` cases matter more than they look. A wrong `false` there
 * tells a user to go and ask an administrator for an OAuth client they do not
 * need; a wrong `true` sends them into a sign-in that fails with an OAuth error
 * naming nothing they can act on. `undefined` is the third answer, and it is the
 * one that makes sign-in try optimistically.
 */

describe("baseDialect", () => {
  it("names its contract after its generation", () => {
    // 2b-ii resolves this against `contracts/`. It is a field rather than a
    // derivation so that the day two generations share a contract, the change is
    // here and not in the checker.
    assert.equal(createViya4Dialect("2025.04").contract, "viya4");
    assert.equal(createViya35Dialect().contract, "viya35");
  });

  it("delegates the built-in client question to the auth layer", () => {
    assert.equal(createViya4Dialect("2022.11").hasBuiltInClient(), true);
    assert.equal(createViya4Dialect("2022.10").hasBuiltInClient(), false);
    assert.equal(createViya4Dialect("2025.04").hasBuiltInClient(), true);
    assert.equal(createViya35Dialect().hasBuiltInClient(), false);
  });

  it("answers unknown rather than guessing when the release is missing", () => {
    // Real case: `/deploymentData` is readable by the deployment but not by
    // every user, so "Viya 4, release unreported" happens. Sign-in treats
    // `undefined` as permission to try the built-in client, which is the right
    // behaviour and the wrong one to reach by way of a `false`.
    assert.equal(createViya4Dialect("").hasBuiltInClient(), undefined);
    assert.equal(
      baseDialect("viya4", { kind: "unknown" }).hasBuiltInClient(),
      undefined,
    );
  });

  it("describes itself the same way the log already does", () => {
    assert.equal(createViya4Dialect("2025.04").describe(), "Viya 4 2025.04");
    assert.equal(createViya35Dialect().describe(), "Viya 3.5");
    assert.equal(
      baseDialect("viya4", { kind: "unknown" }).describe(),
      "an unrecognised version",
    );
  });

  it("keeps the deployment it was built for", () => {
    const dialect = createViya4Dialect("2025.04");
    assert.deepEqual(dialect.deployment, {
      kind: "viya4",
      release: "2025.04",
    });
  });
});
