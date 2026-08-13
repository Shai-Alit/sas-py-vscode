// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { loadScript } from "../helpers/load-script";

interface Finding {
  path: string;
  line: number;
  column: number;
  rule: string;
  why: string;
  sample: string;
}

interface Marker {
  path: string;
  line: number;
  reason: string;
}

interface ScanResult {
  findings: Finding[];
  stale: Marker[];
  unreasoned: Marker[];
}

// Property signatures rather than methods, as in audit-gate.test.ts: these are
// plain functions read off a module namespace.
interface CheckSecrets {
  scanText: (text: string, options?: { path?: string }) => ScanResult;
  redact: (value: unknown) => string;
  isPlaceholder: (value: unknown) => boolean;
  trackedFiles: (run?: () => string) => string[];
  RULES: readonly { name: string; why: string }[];
}

/**
 * Every credential-shaped sample in this file is assembled at run time, never
 * written as a literal.
 *
 * That is not fastidiousness. This file is part of the tracked tree, the
 * scanner runs over the tracked tree, and a literal token here would be a
 * finding the scanner is obliged to report — so the test suite for a credential
 * scanner cannot be a file full of credentials. The same constraint applies to
 * the suppression marker, which is why `allow()` exists: a marker written out
 * in full would be a real marker on a real line, suppressing nothing, and the
 * scanner would report this file as carrying a stale one.
 *
 * It is worth noticing that this constraint is itself evidence the scanner
 * works. A tool that could be tested with literals would be a tool that does
 * not see its own test data.
 */
const JWT = [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkEifQ",
  "TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ",
].join(".");

const OPAQUE = "c9f1a2b3d4e5f60718293a4b5c6d7e8f90a1b2c3";

const PEM = ["-----BEGIN RSA PRIVATE", "KEY-----"].join(" ");

/**
 * The two strings that have to stay broken up, joined the same way `PEM` is.
 *
 * The seam is what matters, not the style: neither the marker word nor the
 * password may appear as a single literal in a tracked file, or the scanner
 * would have something to say about its own test suite. Joining also keeps the
 * lint rules happy in both directions — a fragment-joined value has type
 * `string` rather than a string *literal* type, so interpolating it into a
 * template is not "unnecessary", and there is no annotation for
 * `no-inferrable-types` to object to. An earlier draft used
 * `const MARKER_WORD: string = "…"` and satisfied one rule by breaking the
 * other.
 */
const MARKER_WORD = ["credential", "scan"].join("-");
const URL_PASSWORD = ["h2nter", "t0", "the", "m00n"].join("-");

/** `name: "value"`, built so that this line is not itself an assignment. */
function assign(name: string, value: string): string {
  return `${name}: ${JSON.stringify(value)}`;
}

/** A suppression marker, assembled so that this line is not one. */
function allow(reason: string): string {
  return `// ${MARKER_WORD}: allow ${reason}`;
}

let checkSecrets: CheckSecrets;
let scanText: CheckSecrets["scanText"];

before(async () => {
  checkSecrets = await loadScript<CheckSecrets>("check-secrets.mjs");
  scanText = checkSecrets.scanText;
});

/**
 * The rules, one at a time.
 *
 * The `jwt` rule is the reason this checker exists at all — a Viya OAuth token
 * is an ordinary JWT with no vendor prefix, so GitHub's partner-pattern
 * scanning will never match one — and it is therefore the rule that must not
 * quietly stop working.
 */
describe("credential shapes", () => {
  it("finds a JSON Web Token", () => {
    const { findings } = scanText(`const t = ${JSON.stringify(JWT)};`);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.rule, "jwt");
  });

  it("finds a JWT wherever it sits, not only in an assignment", () => {
    assert.equal(scanText(`# ${JWT}`).findings.length, 1);
    assert.equal(scanText(`{"access": "${JWT}"}`).findings.length, 1);
  });

  it("finds a literal Authorization header value", () => {
    const { findings } = scanText(`Authorization: Bearer ${OPAQUE}`);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.rule, "bearer-header");
  });

  it("finds a base64 Basic credential", () => {
    const { findings } = scanText(
      `Authorization: ${["Basic", "dXNlcjpwYXNzd29yZDEyMzQ1"].join(" ")}`,
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.rule, "basic-header");
  });

  it("finds a PEM private key banner", () => {
    const { findings } = scanText(PEM);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.rule, "private-key");
  });

  it("finds a credential-named field assigned a literal", () => {
    for (const name of [
      "password",
      "passphrase",
      "secret",
      "api_key",
      "apiKey",
      "client_secret",
      "accessToken",
      "credentials",
    ]) {
      const { findings } = scanText(assign(name, "s0mething-real-here"));
      assert.equal(findings.length, 1, `expected a finding for ${name}`);
      assert.equal(findings[0]?.rule, "assigned-literal");
    }
  });

  it("finds a password embedded in a URL", () => {
    const url = `https://svc:${URL_PASSWORD}@viya.internal/`;
    const { findings } = scanText(url);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.rule, "credential-in-url");
  });

  it("reports the line and column, so the finding can be opened", () => {
    const { findings } = scanText(`first\nsecond\nvalue = "x" ${JWT}`);
    const [first] = findings;
    assert.ok(first);
    assert.equal(first.line, 3);
    assert.ok(first.column > 1);
  });

  it("carries the reason the rule exists into the finding", () => {
    const { findings } = scanText(JWT);
    assert.match(findings[0]?.why ?? "", /Viya/);
  });
});

/**
 * What must *not* be a finding.
 *
 * A credential scanner earns its place by being quiet. The first version of
 * this one ran against the repository and produced exactly one false positive —
 * `token: "PYTHON_ON_VIYA_TEST_VIYA4_TOKEN"` in `test/helpers/live-gate.ts`,
 * where the value is the *name* of an environment variable — and that finding
 * is the reason the ALL_CAPS rule below exists. Left in, it would have taught
 * the first reader to reach for a suppression marker instead of reading the
 * output, which is how a check stops being read at all.
 */
describe("what is not a credential", () => {
  it("ignores a shell or template reference", () => {
    for (const value of [
      "$VIYA_TOKEN",
      "${VIYA_TOKEN}",
      "${{ secrets.VIYA_TOKEN }}",
      "$(cat /run/secret)",
      "%VIYA_TOKEN%",
      "{{ viya_token }}",
      "process.env.VIYA_TOKEN",
    ]) {
      assert.equal(
        scanText(assign("token", value)).findings.length,
        0,
        `expected no finding for ${value}`,
      );
    }
  });

  it("ignores the name of an environment variable", () => {
    const line = assign("token", "PYTHON_ON_VIYA_TEST_VIYA4_TOKEN");
    assert.equal(scanText(line).findings.length, 0);
  });

  it("still flags an uppercase value with no underscore", () => {
    // The ALL_CAPS exemption is for identifiers, and an identifier has parts.
    // A hex key in capitals must not slip through it.
    const line = assign("secret", "DEADBEEF0123456789ABCDEF");
    assert.equal(scanText(line).findings.length, 1);
  });

  it("ignores documentation placeholders", () => {
    for (const value of [
      "<your-token-here>",
      "changeme-changeme",
      "REDACTED-REDACTED",
      "xxxxxxxxxxxxxxxx",
      "****************",
      "aaaaaaaaaaaaaaaa",
    ]) {
      assert.equal(
        scanText(assign("password", value)).findings.length,
        0,
        `expected no finding for ${value}`,
      );
    }
  });

  it("ignores prose about credentials", () => {
    const prose = [
      "Load the bearer token into a shell variable and never echo it.",
      "The password field is read from the OS keychain, not from settings.",
      "Send it as an Authorization header.",
    ].join("\n");
    assert.equal(scanText(prose).findings.length, 0);
  });

  it("ignores the shell forms the probing documentation actually uses", () => {
    // These lines are lifted in shape from docs/dev — a checker that fails on
    // its own repository's documented workflow is a checker that gets removed.
    const shell = [
      'TOKEN=$(jq -r ".${SECTION}.token" "$CREDS")',
      'AUTH=(-H "Authorization: Bearer $TOKEN")',
      'echo "host=$HOST token_len=${#TOKEN}"',
    ].join("\n");
    assert.equal(scanText(shell).findings.length, 0);
  });

  it("ignores a short value, which cannot be much of a secret", () => {
    assert.equal(scanText(assign("password", "abc")).findings.length, 0);
  });
});

/**
 * The report must not become the leak.
 *
 * This repository is public and its CI logs are public with it, so a scanner
 * that quotes what it found has republished the credential more widely than the
 * commit did. The first end-to-end run of this scanner did exactly that: the
 * `jwt` rule had no capture group, redaction was applied only to rules that had
 * one, and a whole token went to the terminal. Redaction is now the default and
 * `private-key` opts out of it explicitly.
 */
describe("redaction", () => {
  it("keeps three characters and a length, and nothing else", () => {
    assert.equal(checkSecrets.redact("abcdefgh"), "abc… (8 chars)");
  });

  it("never puts the matched value in the finding", () => {
    for (const text of [
      JWT,
      `Authorization: Bearer ${OPAQUE}`,
      assign("password", "s0mething-real-here"),
    ]) {
      const { findings } = scanText(text);
      assert.equal(findings.length, 1);
      const sample = findings[0]?.sample ?? "";
      assert.ok(
        !text.includes(sample),
        `the sample ${sample} is a substring of the input`,
      );
      assert.match(sample, /… \(\d+ chars\)$/);
    }
  });

  it("prints the PEM banner, which discloses nothing", () => {
    // The exception, and the only one: the match is the header line, not the
    // key material under it, so printing it says which kind of key was found.
    assert.equal(scanText(PEM).findings[0]?.sample, PEM);
  });
});

/**
 * Suppression.
 *
 * The escape hatch is an inline marker carrying a reason rather than a
 * side-car allow-list, so the justification sits next to the string, travels
 * with it when the file moves, and cannot drift out of sync with a list keyed
 * by line number.
 */
describe("suppression markers", () => {
  it("suppresses a finding on its own line", () => {
    const { findings } = scanText(`${JWT} ${allow("synthetic test vector")}`);
    assert.equal(findings.length, 0);
  });

  it("suppresses a finding on the line below", () => {
    const { findings } = scanText(`${allow("synthetic test vector")}\n${JWT}`);
    assert.equal(findings.length, 0);
  });

  it("does not reach two lines down", () => {
    // A suppression that spreads as a file is edited is a suppression nobody
    // notices going stale.
    const { findings } = scanText(
      `${allow("synthetic test vector")}\n\n${JWT}`,
    );
    assert.equal(findings.length, 1);
  });

  it("requires a reason, and refuses a token gesture at one", () => {
    const { unreasoned, findings } = scanText(`${allow("tmp")}\n${JWT}`);
    assert.equal(unreasoned.length, 1);
    // And it does not suppress: a marker that fails the rule buys nothing.
    assert.equal(findings.length, 1);
  });

  it("does not count prose that merely names the marker", () => {
    // The trap check-copyright.mjs fell into first: a marker that matches
    // anywhere on a line cannot be documented without documenting itself into a
    // suppression. Requiring a comment leader is what makes this sentence safe.
    const prose = "Mark it with `credential-scan: allow <why>` in a comment.";
    const { findings, stale } = scanText(`${prose}\n${JWT}`);
    assert.equal(findings.length, 1);
    assert.equal(stale.length, 0);
  });

  it("reports a marker that suppressed nothing", () => {
    const { stale, findings } = scanText(
      `${allow("this one no longer matches anything")}\nconst x = 1;`,
    );
    assert.equal(findings.length, 0);
    assert.equal(stale.length, 1);
    assert.match(stale[0]?.reason ?? "", /no longer matches/);
  });

  it("accepts the comment leader of every file type in the tree", () => {
    const reason = "synthetic test vector";
    for (const marked of [
      `// ${MARKER_WORD}: allow ${reason}`,
      ` * ${MARKER_WORD}: allow ${reason}`,
      `# ${MARKER_WORD}: allow ${reason}`,
      `<!-- ${MARKER_WORD}: allow ${reason} -->`,
    ]) {
      assert.equal(
        scanText(`${marked}\n${JWT}`).findings.length,
        0,
        `expected suppression from ${marked}`,
      );
    }
  });

  it("carries the file path onto both findings and markers", () => {
    const result = scanText(`${JWT}\n${allow("suppresses nothing at all")}`, {
      path: "docs/example.md",
    });
    assert.equal(result.findings[0]?.path, "docs/example.md");
    assert.equal(result.stale[0]?.path, "docs/example.md");
  });
});

describe("the file list", () => {
  it("splits on NUL, so a newline in a filename stays one path", () => {
    // `git ls-files -z` exists for this case, and splitting on newlines would
    // turn one such file into two paths that do not exist — which reads as
    // "skipped, unreadable" rather than as an error.
    const files = checkSecrets.trackedFiles(
      () => "src/extension.ts\0docs/a\nb.md\0",
    );
    assert.deepEqual(files, ["src/extension.ts", "docs/a\nb.md"]);
  });

  it("drops the trailing empty entry", () => {
    assert.deepEqual(
      checkSecrets.trackedFiles(() => "a\0b\0"),
      ["a", "b"],
    );
  });
});

describe("the rule set", () => {
  it("gives every rule a name and a stated reason", () => {
    // A rule nobody can explain in one sentence is a rule that will be
    // suppressed rather than understood.
    for (const rule of checkSecrets.RULES) {
      assert.ok(rule.name.length > 0);
      assert.ok(rule.why.length > 10, `${rule.name} has no useful reason`);
    }
  });

  it("still covers the JWT shape", () => {
    // The one rule whose removal would be invisible: GitHub's secret scanning
    // does not match a generic JWT, so nothing else in the pipeline is looking.
    assert.ok(checkSecrets.RULES.some((rule) => rule.name === "jwt"));
  });
});
