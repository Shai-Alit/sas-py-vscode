// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { loadScript } from "../helpers/load-script";

interface LockPackage {
  name: string;
  license: string;
  paths: string[];
}

interface Exception {
  package: string;
  license: string;
  why: string;
}

interface Policy {
  allowed: Set<string>;
  exceptions: Exception[];
}

// Property signatures rather than methods, as in audit-gate.test.ts: these are
// plain functions read off a module namespace.
interface CheckLicenses {
  licenseSatisfied: (expression: unknown, allowed: Set<string>) => boolean;
  collectPackages: (lockfile: unknown) => LockPackage[];
  parsePolicy: (text: string) => Policy;
  classify: (
    packages: LockPackage[],
    policy: Policy,
  ) => { unreviewed: LockPackage[]; stale: Exception[] };
}

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function pkg(name: string, license: string): LockPackage {
  return { name, license, paths: [`node_modules/${name}`] };
}

function policy(allowed: string[], exceptions: Exception[] = []): Policy {
  return { allowed: new Set(allowed), exceptions };
}

function exception(name: string, license: string): Exception {
  return { package: name, license, why: "reviewed" };
}

/**
 * The expression evaluator behind the licence gate (12q, ADR-0005's
 * 2026-09-29 amendment). A wrong `true` here lets a copyleft package ship
 * unreviewed, so every shape that must not pass has a case of its own.
 */
describe("licence expression evaluation", () => {
  let licenseSatisfied: CheckLicenses["licenseSatisfied"];
  const allowed = new Set(["MIT", "Apache-2.0", "Zlib", "0BSD"]);

  before(async () => {
    ({ licenseSatisfied } =
      await loadScript<CheckLicenses>("check-licenses.mjs"));
  });

  it("passes a bare identifier on the list, including one starting with a digit", () => {
    assert.equal(licenseSatisfied("MIT", allowed), true);
    assert.equal(licenseSatisfied("0BSD", allowed), true);
  });

  it("fails a bare identifier not on the list", () => {
    assert.equal(licenseSatisfied("EPL-2.0", allowed), false);
  });

  it("is case-sensitive about identifiers, as the list is written", () => {
    assert.equal(licenseSatisfied("mit", allowed), false);
  });

  it("passes OR when either side is allowed", () => {
    assert.equal(licenseSatisfied("(MIT OR GPL-3.0-or-later)", allowed), true);
    assert.equal(licenseSatisfied("(GPL-3.0-or-later OR MIT)", allowed), true);
  });

  it("fails OR when neither side is allowed", () => {
    assert.equal(licenseSatisfied("(WTFPL OR GPL-3.0-only)", allowed), false);
  });

  it("passes AND only when both sides are allowed", () => {
    assert.equal(licenseSatisfied("(MIT AND Zlib)", allowed), true);
    assert.equal(licenseSatisfied("(MIT AND GPL-3.0-only)", allowed), false);
  });

  // `GPL OR MIT AND Zlib` is `GPL OR (MIT AND Zlib)` under SPDX precedence,
  // and passes; read left to right as `(GPL OR MIT) AND Zlib` it would also
  // pass, so the precedence case that tells them apart is the second one.
  it("binds AND tighter than OR", () => {
    assert.equal(
      licenseSatisfied("GPL-3.0-only OR MIT AND Zlib", allowed),
      true,
    );
    assert.equal(
      licenseSatisfied("MIT OR GPL-3.0-only AND WTFPL", allowed),
      true,
    );
    assert.equal(
      licenseSatisfied("GPL-3.0-only AND MIT OR WTFPL", allowed),
      false,
    );
  });

  it("evaluates nested parentheses", () => {
    assert.equal(
      licenseSatisfied("((GPL-3.0-only OR MIT) AND (Zlib OR WTFPL))", allowed),
      true,
    );
  });

  it("never passes a WITH clause on the list alone", () => {
    assert.equal(
      licenseSatisfied("Apache-2.0 WITH LLVM-exception", allowed),
      false,
    );
  });

  it("never passes text that is not an SPDX expression", () => {
    assert.equal(
      licenseSatisfied("SEE LICENSE IN LICENSE.txt", allowed),
      false,
    );
    // The first token alone would be a valid identifier if it were allowed;
    // the trailing tokens must still fail the whole string.
    assert.equal(
      licenseSatisfied("MIT LICENSE", new Set(["MIT", "LICENSE"])),
      false,
    );
  });

  it("fails malformed expressions rather than guessing", () => {
    for (const bad of [
      "(MIT OR Zlib",
      "MIT OR Zlib)",
      "MIT OR",
      "OR MIT",
      "MIT AND AND Zlib",
      "()",
      "",
      "   ",
    ]) {
      assert.equal(licenseSatisfied(bad, allowed), false, bad);
    }
  });

  it("fails a missing or non-string licence", () => {
    assert.equal(licenseSatisfied(undefined, allowed), false);
    assert.equal(licenseSatisfied({ type: "MIT" }, allowed), false);
  });
});

describe("lockfile package collection", () => {
  let collectPackages: CheckLicenses["collectPackages"];

  before(async () => {
    ({ collectPackages } =
      await loadScript<CheckLicenses>("check-licenses.mjs"));
  });

  it("skips the project itself and linked workspaces", () => {
    const found = collectPackages({
      packages: {
        "": { name: "python-on-viya", license: "Apache-2.0" },
        "node_modules/local": { link: true, resolved: "packages/local" },
        "node_modules/a": { license: "MIT" },
      },
    });
    assert.deepEqual(
      found.map((p) => p.name),
      ["a"],
    );
  });

  it("names a package from its innermost node_modules path, scope included", () => {
    const found = collectPackages({
      packages: {
        "node_modules/glob/node_modules/@scope/inner": { license: "MIT" },
      },
    });
    assert.equal(found[0]?.name, "@scope/inner");
  });

  it("prefers the lockfile's own name field over the path (aliases)", () => {
    const found = collectPackages({
      packages: { "node_modules/alias": { name: "real-name", license: "MIT" } },
    });
    assert.equal(found[0]?.name, "real-name");
  });

  it("folds one package installed at several paths under one licence into one entry", () => {
    const found = collectPackages({
      packages: {
        "node_modules/type-fest": { license: "(MIT OR CC0-1.0)" },
        "node_modules/msw/node_modules/type-fest": {
          license: "(MIT OR CC0-1.0)",
        },
      },
    });
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.paths, [
      "node_modules/type-fest",
      "node_modules/msw/node_modules/type-fest",
    ]);
  });

  it("keeps one package under two licences as two entries, one decision each", () => {
    const found = collectPackages({
      packages: {
        "node_modules/x": { license: "MIT" },
        "node_modules/y/node_modules/x": { license: "GPL-3.0-only" },
      },
    });
    assert.deepEqual(
      found.map((p) => p.license),
      ["MIT", "GPL-3.0-only"],
    );
  });

  it("records a missing licence field so it fails rather than disappearing", () => {
    const found = collectPackages({ packages: { "node_modules/bare": {} } });
    assert.equal(found[0]?.license, "(no licence field)");
  });

  it("keeps a path with no node_modules segment whole rather than garbling it", () => {
    const found = collectPackages({
      packages: { "packages/tool": { license: "MIT" } },
    });
    assert.equal(found[0]?.name, "packages/tool");
  });

  it("refuses a lockfile with no packages map", () => {
    assert.throws(
      () => collectPackages({ lockfileVersion: 1, dependencies: {} }),
      /no `packages` map/,
    );
    assert.throws(() => collectPackages(undefined), /no `packages` map/);
  });
});

describe("licence policy file", () => {
  let parsePolicy: CheckLicenses["parsePolicy"];

  before(async () => {
    ({ parsePolicy } = await loadScript<CheckLicenses>("check-licenses.mjs"));
  });

  it("accepts the policy this repository actually commits", () => {
    const text = readFileSync(
      path.join(REPO_ROOT, "scripts", "license-allowlist.json"),
      "utf8",
    );
    const parsed = parsePolicy(text);
    assert.ok(parsed.allowed.has("MIT"));
  });

  it("rejects text that is not JSON", () => {
    assert.throws(() => parsePolicy("{"), /not valid JSON/);
  });

  it("requires a non-empty allowed list of strings", () => {
    for (const allowed of [undefined, [], [""], [42]]) {
      assert.throws(
        () => parsePolicy(JSON.stringify({ allowed, exceptions: [] })),
        /non-empty `allowed`/,
      );
    }
  });

  it("requires an exceptions array, even an empty one", () => {
    assert.throws(
      () => parsePolicy(JSON.stringify({ allowed: ["MIT"] })),
      /`exceptions` array/,
    );
  });

  it("requires every exception to name its package, licence and reason", () => {
    for (const field of ["package", "license", "why"]) {
      const entry: Record<string, string> = {
        package: "p",
        license: "EPL-2.0",
        why: "w",
      };
      entry[field] = " ";
      assert.throws(
        () =>
          parsePolicy(
            JSON.stringify({ allowed: ["MIT"], exceptions: [entry] }),
          ),
        new RegExp(`exceptions\\[0\\]\\.${field}`),
      );
    }
  });

  it("rejects the same package and licence listed twice", () => {
    const entry = { package: "p", license: "EPL-2.0", why: "w" };
    assert.throws(
      () =>
        parsePolicy(
          JSON.stringify({ allowed: ["MIT"], exceptions: [entry, entry] }),
        ),
      /repeats p/,
    );
  });
});

describe("licence gate decisions", () => {
  let classify: CheckLicenses["classify"];

  before(async () => {
    ({ classify } = await loadScript<CheckLicenses>("check-licenses.mjs"));
  });

  it("accepts a package the list satisfies", () => {
    const result = classify([pkg("a", "MIT")], policy(["MIT"]));
    assert.deepEqual(result, { unreviewed: [], stale: [] });
  });

  it("accepts a package named in an exception, with its licence", () => {
    const result = classify(
      [pkg("ovsx", "EPL-2.0")],
      policy(["MIT"], [exception("ovsx", "EPL-2.0")]),
    );
    assert.deepEqual(result, { unreviewed: [], stale: [] });
  });

  it("fails a package nobody has reviewed", () => {
    const { unreviewed } = classify(
      [pkg("x", "GPL-3.0-only")],
      policy(["MIT"]),
    );
    assert.deepEqual(
      unreviewed.map((p) => p.name),
      ["x"],
    );
  });

  it("does not let one package's exception cover another under the same licence", () => {
    const { unreviewed } = classify(
      [pkg("ovsx", "EPL-2.0"), pkg("other", "EPL-2.0")],
      policy(["MIT"], [exception("ovsx", "EPL-2.0")]),
    );
    assert.deepEqual(
      unreviewed.map((p) => p.name),
      ["other"],
    );
  });

  // A relicensed package must be looked at again: its old exception no longer
  // matches, so the package fails as unreviewed and the entry as stale.
  it("fails both sides when an excepted package changes licence", () => {
    const { unreviewed, stale } = classify(
      [pkg("ovsx", "GPL-3.0-only")],
      policy(["MIT"], [exception("ovsx", "EPL-2.0")]),
    );
    assert.deepEqual(
      unreviewed.map((p) => p.name),
      ["ovsx"],
    );
    assert.deepEqual(
      stale.map((e) => e.package),
      ["ovsx"],
    );
  });

  it("reports an exception that matches no package as stale", () => {
    const { stale } = classify(
      [],
      policy(["MIT"], [exception("gone", "WTFPL")]),
    );
    assert.deepEqual(
      stale.map((e) => e.package),
      ["gone"],
    );
  });

  it("reports an exception the allow-list has made unnecessary as stale", () => {
    const { unreviewed, stale } = classify(
      [pkg("now-mit", "MIT")],
      policy(["MIT"], [exception("now-mit", "MIT")]),
    );
    assert.deepEqual(unreviewed, []);
    assert.deepEqual(
      stale.map((e) => e.package),
      ["now-mit"],
    );
  });
});
