// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  BUILT_IN_CLIENT_ID,
  type Deployment,
  explainsMissingClient,
  hasBuiltInClient,
  resolveClient,
} from "../../src/auth/clientId";

/**
 * Decision 9, as a table.
 *
 * The interesting behaviour is not the happy path — it is the two edges. A
 * deployment we *know* is too old must refuse with an actionable problem rather
 * than attempt a sign-in that cannot work; a deployment whose version we cannot
 * read must attempt it anyway, because refusing on unreadable input would break
 * the common case to protect the rare one.
 *
 * The Viya 3.5 rows encode SAS's documented behaviour. No Viya 3.5 deployment is
 * available to this project, so they are not evidence that 3.5 behaves this way —
 * see the module comment on `src/auth/clientId.ts`.
 */

const viya4 = (release: string): Deployment => ({ kind: "viya4", release });

/**
 * A stand-in for a client secret. Not a credential — it never left this file and
 * no deployment has ever accepted it.
 */
const SECRET = "secret-placeholder-not-real";

describe("hasBuiltInClient", () => {
  it("is true from Viya 4 2022.11 onward", () => {
    assert.equal(hasBuiltInClient(viya4("2022.11")), true);
    assert.equal(hasBuiltInClient(viya4("2022.12")), true);
    assert.equal(hasBuiltInClient(viya4("2023.03")), true);
    assert.equal(hasBuiltInClient(viya4("2025.02")), true);
  });

  it("is false before it", () => {
    assert.equal(hasBuiltInClient(viya4("2022.10")), false);
    assert.equal(hasBuiltInClient(viya4("2022.09")), false);
    assert.equal(hasBuiltInClient(viya4("2021.12")), false);
  });

  it("compares month within year, not as a decimal", () => {
    // 2022.9 > 2022.11 numerically, and .9 sorts after .11 as text. Both of
    // those readings put a September release on the wrong side of the line.
    assert.equal(hasBuiltInClient(viya4("2022.9")), false);
    assert.equal(hasBuiltInClient(viya4("2023.01")), true);
  });

  it("is false for Viya 3.5", () => {
    assert.equal(hasBuiltInClient({ kind: "viya35" }), false);
  });

  it("is undefined — not false — when the version cannot be read", () => {
    // The distinction the caller depends on: "known to lack it" refuses,
    // "cannot tell" tries anyway.
    assert.equal(hasBuiltInClient({ kind: "unknown" }), undefined);
    assert.equal(hasBuiltInClient(viya4("")), undefined);
    assert.equal(hasBuiltInClient(viya4("who knows")), undefined);
    assert.equal(hasBuiltInClient(viya4("2022.13")), undefined);
    assert.equal(hasBuiltInClient(viya4("2022.00")), undefined);
  });

  it("reads the spellings a release stamp actually arrives in", () => {
    assert.equal(hasBuiltInClient(viya4("Stable 2023.03")), true);
    assert.equal(hasBuiltInClient(viya4("v4-stable-2022.11")), true);
    assert.equal(hasBuiltInClient(viya4("2022.10.1")), false);
  });
});

describe("resolveClient", () => {
  it("falls back to the built-in client on a modern Viya 4", () => {
    const result = resolveClient({ deployment: viya4("2023.03") });
    assert.ok(result.ok);
    assert.deepEqual(result.client, {
      clientId: BUILT_IN_CLIENT_ID,
      clientSecret: "",
      builtIn: true,
    });
  });

  it("falls back optimistically when the version is unknown", () => {
    const result = resolveClient({});
    assert.ok(result.ok);
    assert.equal(result.client.clientId, BUILT_IN_CLIENT_ID);
    assert.equal(result.client.builtIn, true);
  });

  it("prefers a configured client id even where a built-in one exists", () => {
    // An administrator who registered a client did it for a reason — a scope, an
    // audience, an audit trail. Quietly preferring the built-in one would
    // override a deliberate act of configuration.
    const result = resolveClient({
      configuredClientId: "our-client",
      configuredClientSecret: SECRET,
      deployment: viya4("2023.03"),
    });
    assert.ok(result.ok);
    assert.deepEqual(result.client, {
      clientId: "our-client",
      clientSecret: SECRET,
      builtIn: false,
    });
  });

  it("accepts a configured id with no secret, for a public client", () => {
    const result = resolveClient({ configuredClientId: "public-client" });
    assert.ok(result.ok);
    assert.equal(result.client.clientSecret, "");
    assert.equal(result.client.builtIn, false);
  });

  it("treats a blank or whitespace client id as absent", () => {
    for (const configuredClientId of ["", "   ", "\t"]) {
      const result = resolveClient({ configuredClientId });
      assert.ok(result.ok);
      assert.equal(result.client.clientId, BUILT_IN_CLIENT_ID);
    }
  });

  it("trims a configured id rather than sending the padding", () => {
    const result = resolveClient({ configuredClientId: "  padded  " });
    assert.ok(result.ok);
    assert.equal(result.client.clientId, "padded");
  });

  it("refuses on Viya 3.5 with a problem that names the deployment", () => {
    const result = resolveClient({ deployment: { kind: "viya35" } });
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "client-id-required",
      deployment: "Viya 3.5",
    });
    assert.match(result.reason, /client id/);
  });

  it("refuses on Viya 4 2022.10 and earlier", () => {
    const result = resolveClient({ deployment: viya4("2022.10") });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "client-id-required");
    assert.deepEqual(result.problem, {
      code: "client-id-required",
      deployment: "Viya 4 2022.10",
    });
  });

  it("does not refuse an old deployment that supplied its own client id", () => {
    // The refusal is about a *missing* id, not about the version. A 3.5 user who
    // has done what we asked must not be blocked by the same check.
    const result = resolveClient({
      configuredClientId: "registered-by-admin",
      deployment: { kind: "viya35" },
    });
    assert.ok(result.ok);
    assert.equal(result.client.clientId, "registered-by-admin");
  });
});

describe("explainsMissingClient", () => {
  const builtIn = {
    clientId: BUILT_IN_CLIENT_ID,
    clientSecret: "",
    builtIn: true,
  };
  const configured = {
    clientId: "ours",
    clientSecret: "",
    builtIn: false,
  };

  it("recognises the deployment rejecting the client we guessed at", () => {
    assert.equal(
      explainsMissingClient(
        { code: "oauth-rejected", error: "invalid_client" },
        builtIn,
      ),
      true,
    );
    assert.equal(
      explainsMissingClient(
        { code: "oauth-rejected", error: "unauthorized_client" },
        builtIn,
      ),
      true,
    );
  });

  it("stays silent when the client id came from the profile", () => {
    // Rewriting this into "ask an administrator for a client id" would be wrong
    // advice: they have one, and it is the one being rejected.
    assert.equal(
      explainsMissingClient(
        { code: "oauth-rejected", error: "invalid_client" },
        configured,
      ),
      false,
    );
  });

  it("does not swallow unrelated OAuth failures", () => {
    // An expired code and a bad redirect URI have their own messages, and
    // rewriting them into client-registration advice sends the user somewhere
    // that cannot help.
    for (const error of ["invalid_grant", "invalid_request", "invalid_scope"]) {
      assert.equal(
        explainsMissingClient({ code: "oauth-rejected", error }, builtIn),
        false,
      );
    }
  });

  it("does not fire on problems that are not OAuth rejections", () => {
    assert.equal(
      explainsMissingClient(
        { code: "token-endpoint-unreachable", detail: "ECONNREFUSED" },
        builtIn,
      ),
      false,
    );
    assert.equal(
      explainsMissingClient({ code: "state-mismatch" }, builtIn),
      false,
    );
  });
});
