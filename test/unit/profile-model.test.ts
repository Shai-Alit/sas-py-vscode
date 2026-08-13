// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  CURRENT_PROFILE_VERSION,
  MAX_PROFILE_NAME_LENGTH,
  createProfile,
  describeProblem,
  normaliseEndpoint,
  readProfiles,
  resolveActiveProfile,
  secretKey,
  validateProfileName,
  type ValidationProblem,
} from "../../src/profile/model";

/**
 * This file is the specification of what a connection profile is. That is the
 * whole reason `src/profile/model.ts` has no `vscode` import: the rules are
 * reachable from a plain Node process, so they can be stated here in full rather
 * than sampled through an extension host.
 *
 * The cases that matter most are the refusals. A validator that accepts
 * everything valid is easy; the tests below are mostly about the inputs that
 * must *not* get through, because each one of those is either a credential
 * leaving the machine in the clear or a setting that silently means something
 * other than what it says.
 */

/** Unwraps a `Result`, failing the test with the reason if it is not `ok`. */
function value<T>(
  result: { ok: true; value: T } | { ok: false; reason: string },
): T {
  assert.ok(
    result.ok,
    `expected success, got: ${result.ok ? "" : result.reason}`,
  );
  return result.value;
}

/** Asserts a `Result` failed, and hands back the reason for further assertions. */
function reason(result: { ok: boolean; reason?: string }): string {
  assert.equal(result.ok, false, "expected a rejection, got success");
  return result.reason ?? "";
}

/**
 * Asserts a `Validated` failed, and hands back the structured problem.
 *
 * The success arm is `unknown` rather than a type parameter on purpose. Only the
 * failure arm is ever returned, so a parameter would appear once in the
 * signature and constrain nothing — which is what
 * `@typescript-eslint/no-unnecessary-type-parameters` objects to, and it is
 * right to. Contrast {@link value} above, where `T` genuinely links the argument
 * to the return type.
 */
function problem(
  result:
    | { ok: true; value: unknown }
    | { ok: false; reason: string; problem: ValidationProblem },
): ValidationProblem {
  assert.equal(result.ok, false, "expected a rejection, got success");
  assert.ok(!result.ok);
  return result.problem;
}

describe("normaliseEndpoint", () => {
  it("accepts an https URL unchanged", () => {
    assert.equal(
      value(normaliseEndpoint("https://viya.example.com")),
      "https://viya.example.com",
    );
  });

  it("adds https to a bare host, because that is what people type", () => {
    assert.equal(
      value(normaliseEndpoint("viya.example.com")),
      "https://viya.example.com",
    );
  });

  it("keeps a port and a base path", () => {
    assert.equal(
      value(normaliseEndpoint("https://viya.example.com:8443/gateway")),
      "https://viya.example.com:8443/gateway",
    );
  });

  it("strips trailing slashes so paths do not double up", () => {
    // `${endpoint}/compute` against a stored trailing slash produces `//compute`,
    // which some reverse proxies answer differently from `/compute`.
    assert.equal(
      value(normaliseEndpoint("https://viya.example.com///")),
      "https://viya.example.com",
    );
  });

  it("trims surrounding whitespace from a pasted value", () => {
    assert.equal(
      value(normaliseEndpoint("  https://viya.example.com  ")),
      "https://viya.example.com",
    );
  });

  it("refuses http to a remote host, naming the token as the reason", () => {
    const message = reason(normaliseEndpoint("http://viya.example.com"));
    assert.match(message, /https/);
    assert.match(message, /token/i);
  });

  it("allows http to loopback, where there is no network to listen on", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      assert.equal(
        value(normaliseEndpoint(`http://${host}:8080`)),
        `http://${host}:8080`,
      );
    }
  });

  it("refuses credentials in the URL", () => {
    // This is the case `check:secrets` flags in our own tree. Accepting it in a
    // setting would be putting a password in settings.json by another route.
    const message = reason(
      // credential-scan: allow synthetic URL under test, no such account exists
      normaliseEndpoint("https://user:hunter2@viya.example.com"),
    );
    assert.match(message, /username or password/);
  });

  it("refuses a username with no password just as firmly", () => {
    reason(normaliseEndpoint("https://user@viya.example.com"));
  });

  it("refuses a query string or fragment", () => {
    reason(normaliseEndpoint("https://viya.example.com/?tab=1"));
    reason(normaliseEndpoint("https://viya.example.com/#/home"));
  });

  it("refuses a non-web scheme", () => {
    assert.match(reason(normaliseEndpoint("ftp://viya.example.com")), /https/);
    reason(normaliseEndpoint("file:///etc/passwd"));
  });

  it("refuses empty, blank, and non-string input", () => {
    reason(normaliseEndpoint(""));
    reason(normaliseEndpoint("   "));
    reason(normaliseEndpoint(undefined));
    reason(normaliseEndpoint(42));
    reason(normaliseEndpoint({ endpoint: "https://viya.example.com" }));
  });
});

describe("validateProfileName", () => {
  it("accepts a plain name and trims it", () => {
    assert.equal(value(validateProfileName("  Production  ")), "Production");
  });

  it("refuses an empty or whitespace-only name", () => {
    reason(validateProfileName(""));
    reason(validateProfileName("   "));
  });

  it("refuses a name longer than the limit", () => {
    value(validateProfileName("a".repeat(MAX_PROFILE_NAME_LENGTH)));
    reason(validateProfileName("a".repeat(MAX_PROFILE_NAME_LENGTH + 1)));
  });

  it("refuses control characters, which the status bar cannot render", () => {
    reason(validateProfileName("Prod\u0000uction"));
    reason(validateProfileName("Prod\nuction"));
  });

  it("refuses a duplicate regardless of case", () => {
    // Two profiles called `Prod` and `prod` is a mistake waiting to be made at
    // the worst possible moment, even though JSON would hold both happily.
    const message = reason(validateProfileName("prod", ["Prod"]));
    assert.match(message, /already exists/);
  });

  it("allows a profile to keep its own name while being edited", () => {
    assert.equal(
      value(validateProfileName("Prod", ["Prod", "Dev"], { allow: "Prod" })),
      "Prod",
    );
  });

  it("still refuses colliding with a *different* profile while editing", () => {
    reason(validateProfileName("Dev", ["Prod", "Dev"], { allow: "Prod" }));
  });
});

describe("readProfiles", () => {
  const good = { endpoint: "https://viya.example.com" };

  it("returns nothing for an absent setting", () => {
    assert.deepEqual(readProfiles(undefined), { profiles: {}, rejected: [] });
    assert.deepEqual(readProfiles(null), { profiles: {}, rejected: [] });
  });

  it("rejects the whole container when it is not an object", () => {
    for (const raw of ["nonsense", 7, ["a"]]) {
      const result = readProfiles(raw);
      assert.deepEqual(result.profiles, {});
      assert.equal(result.rejected.length, 1);
      assert.equal(result.rejected[0]?.name, "");
    }
  });

  it("fills in the version when a hand-written profile omits it", () => {
    const { profiles } = readProfiles({ Prod: good });
    assert.equal(profiles.Prod?.version, CURRENT_PROFILE_VERSION);
  });

  it("falls back to the profile name when there is no id", () => {
    // Which is what makes a hand-written profile behave exactly like a generated
    // one, right up until somebody renames it.
    const { profiles } = readProfiles({ Prod: good });
    assert.equal(profiles.Prod?.id, "Prod");
  });

  it("keeps an explicit id, so a rename does not orphan the secret", () => {
    const { profiles } = readProfiles({ Prod: { ...good, id: "abc-123" } });
    assert.equal(profiles.Prod?.id, "abc-123");
  });

  it("normalises the endpoint on the way in", () => {
    const { profiles } = readProfiles({
      Prod: { endpoint: "viya.example.com/" },
    });
    assert.equal(profiles.Prod?.endpoint, "https://viya.example.com");
  });

  it("drops unknown properties rather than carrying a typo back to disk", () => {
    const { profiles } = readProfiles({
      Prod: { ...good, contxt: "typo", clientSecret: "should-never-live-here" },
    });
    assert.deepEqual(Object.keys(profiles.Prod ?? {}).sort(), [
      "endpoint",
      "id",
      "version",
    ]);
  });

  it("refuses a profile from a newer build, naming both versions", () => {
    const { profiles, rejected } = readProfiles({
      Prod: { ...good, version: CURRENT_PROFILE_VERSION + 1 },
    });
    assert.deepEqual(profiles, {});
    assert.match(rejected[0]?.reason ?? "", /newer version/);
    assert.match(rejected[0]?.reason ?? "", /update the extension/i);
  });

  it("refuses a version that is not a whole number of at least one", () => {
    for (const version of [0, -1, 1.5, "1", null]) {
      const { rejected } = readProfiles({ Prod: { ...good, version } });
      assert.equal(rejected.length, 1, `accepted version ${String(version)}`);
    }
  });

  it("rejects one bad profile without hiding the good ones beside it", () => {
    // The behaviour that makes a hand-edited settings file debuggable: a typo in
    // one entry must not take the other four down with it.
    const { profiles, rejected } = readProfiles({
      Prod: good,
      Broken: { endpoint: "http://remote.example.com" },
      Dev: { endpoint: "https://dev.example.com" },
      NotEvenAnObject: "https://oops.example.com",
    });
    assert.deepEqual(Object.keys(profiles), ["Prod", "Dev"]);
    assert.deepEqual(
      rejected.map((problem) => problem.name),
      ["Broken", "NotEvenAnObject"],
    );
  });

  it("keeps optional fields only when they say something", () => {
    const { profiles } = readProfiles({
      Full: { ...good, context: " ctx ", clientId: " id " },
      Blank: { ...good, context: "   ", clientId: "" },
    });
    assert.deepEqual(profiles.Full, {
      version: CURRENT_PROFILE_VERSION,
      id: "Full",
      endpoint: "https://viya.example.com",
      context: "ctx",
      clientId: "id",
    });
    // Absent, not present-and-empty: an empty string in a profile would show up
    // in the status bar tooltip and in any request built from it.
    assert.deepEqual(profiles.Blank, {
      version: CURRENT_PROFILE_VERSION,
      id: "Blank",
      endpoint: "https://viya.example.com",
    });
  });
});

describe("resolveActiveProfile", () => {
  const names = ["Prod", "Dev"];

  it("prefers this window's choice", () => {
    assert.equal(
      resolveActiveProfile({
        profileNames: names,
        windowChoice: "Dev",
        defaultProfile: "Prod",
      }),
      "Dev",
    );
  });

  it("falls back to the default setting", () => {
    assert.equal(
      resolveActiveProfile({ profileNames: names, defaultProfile: "Prod" }),
      "Prod",
    );
  });

  it("falls through a stale window choice instead of resolving to nothing", () => {
    // This is what makes deleting a profile behave sensibly in a window that was
    // pointed at it.
    assert.equal(
      resolveActiveProfile({
        profileNames: names,
        windowChoice: "Deleted",
        defaultProfile: "Prod",
      }),
      "Prod",
    );
  });

  it("ignores a default that names a profile which does not exist", () => {
    assert.equal(
      resolveActiveProfile({ profileNames: names, defaultProfile: "Gone" }),
      undefined,
    );
  });

  it("uses the only profile there is, rather than asking a question with one answer", () => {
    assert.equal(resolveActiveProfile({ profileNames: ["Only"] }), "Only");
  });

  it("resolves to nothing when there is a real choice and nobody has made it", () => {
    assert.equal(resolveActiveProfile({ profileNames: names }), undefined);
    assert.equal(resolveActiveProfile({ profileNames: [] }), undefined);
  });
});

describe("createProfile and secretKey", () => {
  it("stamps the current version and omits empty optional fields", () => {
    assert.deepEqual(
      createProfile({
        id: "id-1",
        endpoint: "https://viya.example.com",
        context: "  ",
        clientId: undefined,
      }),
      {
        version: CURRENT_PROFILE_VERSION,
        id: "id-1",
        endpoint: "https://viya.example.com",
      },
    );
  });

  it("never produces a clientSecret field", () => {
    // The absence is the design, not an oversight: a secret in the profile is a
    // secret in settings.json, which is a file people commit and screen-share.
    const profile = createProfile({
      id: "id-1",
      endpoint: "https://viya.example.com",
      clientId: "client",
    });
    assert.ok(!("clientSecret" in profile));
  });

  it("keys the secret on the id, so a rename keeps it", () => {
    const profile = createProfile({
      id: "stable-id",
      endpoint: "https://viya.example.com",
    });
    assert.equal(secretKey(profile), "pythonOnViya.profile.stable-id");
    assert.equal(
      secretKey({ ...profile, id: "stable-id" }),
      secretKey(profile),
    );
  });
});

/**
 * These exist because the reasons above are shown under an input box, and
 * CONTRIBUTING.md requires user-facing text to be localisable. This module
 * cannot call `l10n.t()`, so it emits a code and `src/profile/problems.ts`
 * translates it — which only works if the code is the thing that varies and the
 * English is derived from it, never the other way round.
 */
describe("validation problems", () => {
  const rejections: [string, ValidationProblem, () => unknown][] = [
    [
      "endpoint: not a string",
      { code: "endpoint-not-text" },
      () => normaliseEndpoint(42),
    ],
    [
      "endpoint: empty",
      { code: "endpoint-required" },
      () => normaliseEndpoint("   "),
    ],
    [
      "endpoint: unparseable",
      { code: "endpoint-not-a-url", value: "https://" },
      () => normaliseEndpoint("https://"),
    ],
    [
      "endpoint: credentials in the URL",
      { code: "endpoint-has-credentials" },
      // Assembled at run time so this file holds no string check:secrets must be told to ignore.
      () =>
        normaliseEndpoint(["https://user", "pw@viya.example.com"].join(":")),
    ],
    [
      "endpoint: a scheme that is neither http nor https",
      { code: "endpoint-unsupported-scheme", scheme: "ftp" },
      () => normaliseEndpoint("ftp://viya.example.com"),
    ],
    [
      "endpoint: cleartext to a non-loopback host",
      { code: "endpoint-cleartext" },
      () => normaliseEndpoint("http://viya.example.com"),
    ],
    [
      "endpoint: a query string",
      { code: "endpoint-has-query-or-fragment" },
      () => normaliseEndpoint("https://viya.example.com?tab=1"),
    ],
    [
      "name: not a string",
      { code: "name-not-text" },
      () => validateProfileName(42),
    ],
    ["name: empty", { code: "name-required" }, () => validateProfileName("  ")],
    [
      "name: too long",
      { code: "name-too-long", max: MAX_PROFILE_NAME_LENGTH },
      () => validateProfileName("a".repeat(MAX_PROFILE_NAME_LENGTH + 1)),
    ],
    [
      "name: control characters",
      { code: "name-has-control-characters" },
      () => validateProfileName(`Prod${String.fromCharCode(9)}uction`),
    ],
    [
      "name: already taken",
      { code: "name-duplicate", existing: "Production" },
      () => validateProfileName("production", ["Production"]),
    ],
  ];

  for (const [label, expected, run] of rejections) {
    it(`reports a structured problem for ${label}`, () => {
      const result = run() as ReturnType<typeof normaliseEndpoint>;
      assert.deepEqual(problem(result), expected);
    });
  }

  it("derives the logged reason from the problem, so the two cannot drift", () => {
    for (const [label, expected, run] of rejections) {
      const result = run() as ReturnType<typeof normaliseEndpoint>;
      assert.equal(
        reason(result),
        describeProblem(expected),
        `reason and problem disagree for ${label}`,
      );
    }
  });

  it("covers every code the union declares", () => {
    // A code with no test above is a code src/profile/problems.ts could be
    // translating into a message nobody has ever seen.
    const declared = new Set<string>([
      "endpoint-not-text",
      "endpoint-required",
      "endpoint-not-a-url",
      "endpoint-has-credentials",
      "endpoint-unsupported-scheme",
      "endpoint-cleartext",
      "endpoint-has-query-or-fragment",
      "name-not-text",
      "name-required",
      "name-too-long",
      "name-has-control-characters",
      "name-duplicate",
    ]);
    const exercised = new Set(rejections.map(([, expected]) => expected.code));
    assert.deepEqual([...exercised].sort(), [...declared].sort());
  });
});
