// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The credential-shape gate.
 *
 * GitHub's secret scanning is on for this repository and should stay on, but it
 * does not cover this repository's actual risk. It matches *partner patterns* —
 * vendor-issued formats with a recognisable prefix, which the vendor can also
 * revoke. The credential this project handles is a Viya OAuth token: a plain
 * JSON Web Token, issued by the customer's own deployment, with no vendor prefix
 * and nobody to notify. Nothing in the partner-pattern set will ever match one.
 *
 * So this scanner looks for *shapes*, and runs alongside the GitHub feature
 * rather than instead of it. It deliberately does **not** re-implement vendor
 * patterns: GitHub already does that, does it better, and can trigger
 * revocation. Duplicating them here would add noise and no coverage.
 *
 * ## What it looks at
 *
 * The tracked working tree — `git ls-files`, read from disk. Not history, and
 * not untracked files, and both exclusions are deliberate:
 *
 *   - **History is immutable.** A credential already committed is a rotation
 *     task, not a build failure, and a gate that fails forever on a commit
 *     nobody can change is a gate that gets switched off. `git log -S` on demand
 *     is the right tool for that question; see docs/dev/ci.md.
 *   - **Untracked files are where the credential is supposed to live.** This
 *     project asks contributors to keep a `creds.json` of live Viya tokens in
 *     the working tree, git-ignored, so scanning untracked files would fail on
 *     the setup the documentation prescribes. What a commit would publish is the
 *     question with an actionable answer.
 *
 * ## Why there is no entropy detector
 *
 * The obvious next rule — "flag any long high-entropy string" — was considered
 * and rejected. This tree contains a lockfile full of 88-character base64
 * integrity hashes, and every one of them is exactly as random as a token. An
 * entropy rule here starts life with hundreds of false positives, and a check
 * that is wrong the first hundred times is a check people learn to suppress
 * without reading. Every rule below can be stated in one sentence and defended;
 * that is the bar for adding another.
 *
 * ## Reporting
 *
 * A finding prints the file, the line, the rule, and a **redacted** excerpt —
 * the first three characters and a length. It must never print the match. This
 * repository is public, CI logs are public with it, and a scanner that quotes
 * the credential it found has published it more widely than the commit did.
 *
 * ## Exit codes
 *
 * **1** — the policy was violated (a finding, or a suppression marker with no
 * reason). **2** — this script or its input is wrong (git missing, tree
 * unreadable). Same split as `check-audit.mjs`, for the same reason: a 1 needs
 * the author, a 2 needs whoever maintains the tooling.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

// `git ls-files` is local, but CONTRIBUTING.md's rule that every call out of
// this process has a bound applies just as well to a repository on a network
// share that has stopped answering.
const GIT_TIMEOUT_MS = 30_000;

/**
 * Files whose contents are not text and never usefully scanned. This is a
 * shortcut, not the safety net: anything containing a NUL byte is skipped too,
 * which catches the binary formats nobody thought to list.
 */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".zip",
  ".gz",
  ".vsix",
  ".exe",
  ".dll",
  ".node",
]);

/**
 * The suppression marker.
 *
 * It only counts immediately after a comment leader, and that requirement is
 * doing real work — it is what lets this mechanism be written about. Prose that
 * names the marker inside a code span has a backtick in front of it, not a `//`
 * or a `#`, so the sentence explaining the rule is not an instance of it.
 * `check-copyright.mjs` learned the same lesson from the other direction and
 * anchored its markers to the start of a line; here the marker also has to be
 * usable at the end of a line of code, so the leader is the anchor instead.
 *
 * The consequence worth knowing: JSON has no comments, so a match in a `.json`
 * file cannot be suppressed in place. Nothing in this tree needs that today,
 * and the alternative — a side-car allow-list keyed by file and line — drifts
 * out of date the first time anybody inserts a line.
 *
 * The reason is mandatory, and a marker without one fails the run. A bare
 * suppression records that somebody wanted the red to go away; it does not
 * record a decision, and this repository's whole position is that the decision
 * is the artefact worth keeping.
 */
const MARKER =
  /(?:^|[ \t])(?:\/\/+|#+|\*|<!--|;;?|--)[ \t]*credential-scan:[ \t]*allow[ \t]+(.+?)(?:[ \t]*-->)?[ \t]*$/;

/** Alphanumeric characters a reason must have before it counts as one. */
const MIN_REASON_CHARS = 8;

/**
 * Values that look like a credential but are standing in for one.
 *
 * This list is deliberately short, because every entry is a hole. `test`,
 * `fake`, `dummy` and `sample` were all considered and left out: they are
 * ordinary English words that appear inside real strings, and each one would
 * quietly excuse a genuine token that happened to contain it. What is here is
 * either a template syntax that cannot be a literal value, or a word whose only
 * plausible use is as a stand-in.
 */
const PLACEHOLDERS = [
  /\$\{/, // ${VAR} and ${{ secrets.X }}
  /\$\(/, // $(command)
  /^\$[A-Za-z_]/, // $TOKEN
  /\{\{/, // {{ template }}
  /%[A-Za-z_][A-Za-z0-9_]*%/, // %WINDOWS_VAR%
  /<[^>]*>/, // <your-token-here>
  /process\.env|os\.environ|secrets\./i,
  /\b(?:changeme|placeholder|redacted|example|your[-_])/i,
  /x{4,}|\*{3,}|\.{3,}|…/i,
  // An ALL_CAPS identifier is the *name* of an environment variable, not a
  // value. This was the first run's only false positive, and it landed in
  // `test/helpers/live-gate.ts` — a file whose entire purpose is to keep real
  // credentials out of the repository, mapping a generation to the variable it
  // reads a token from. Requiring at least one underscore keeps the exemption
  // narrow: an uppercase hex key like `DEADBEEF0123…` has none and is still a
  // finding.
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/,
];

/**
 * The rules.
 *
 * `group` names the capture that holds the candidate value, and a rule with one
 * is placeholder-filtered on it. `why` is printed with the finding, because a
 * scanner that says only "line 40 matched rule 3" makes the reader re-derive
 * the reasoning every time.
 *
 * **Everything is redacted unless a rule opts out with `safeToPrint`**, and
 * that default is the wrong way round from how this was first written. The
 * first draft redacted only the rules that had a `group`, on the reasoning that
 * a rule without one matches a banner rather than a value — which was true of
 * `private-key` and false of `jwt`, so the very first end-to-end run printed a
 * whole token into the terminal. On a public repository that terminal is a
 * public CI log. Opting out one banner is a decision somebody makes once;
 * opting in to redaction is a decision every future rule has to remember.
 */
export const RULES = Object.freeze([
  {
    name: "jwt",
    // Three base64url segments, the first starting `eyJ` — that is base64 for
    // `{"`, so the first segment is a JSON header. This is the shape of every
    // Viya OAuth token, and the one thing GitHub's partner patterns will never
    // catch, so it is the reason this file exists.
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    why: "a JSON Web Token — the shape of a Viya OAuth token",
  },
  {
    name: "bearer-header",
    pattern: /\bBearer[ \t]+([A-Za-z0-9_\-.=+/]{20,})/g,
    group: 1,
    why: "a literal Authorization header value",
  },
  {
    name: "basic-header",
    pattern: /\bBasic[ \t]+([A-Za-z0-9+/]{16,}={0,2})\b/g,
    group: 1,
    why: "a base64 username:password pair",
  },
  {
    name: "private-key",
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
    // The match is the banner line, not the key material below it, so printing
    // it tells the reader which kind of key without disclosing any of it.
    safeToPrint: true,
    why: "a PEM private key block",
  },
  {
    name: "assigned-literal",
    // A secret-sounding name assigned a *quoted* literal. Requiring the quotes
    // is what keeps shell out of it: `TOKEN=$(…)` and `TOKEN="$TOKEN"` are how
    // the probing documentation legitimately handles a real token, and neither
    // is a literal.
    pattern:
      /\b(?:pass(?:word|wd|phrase)|secret|apikey|api[_-]key|access[_-]key|client[_-]secret|private[_-]key|credentials?|authtoken|auth[_-]token|[a-z]*token)\b[ \t]*[:=][ \t]*(['"`])([^'"`\n]{12,})\1/gi,
    group: 2,
    why: "a credential-named field assigned a literal value",
  },
  {
    name: "credential-in-url",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:([^\s/@'"]{4,})@/g,
    group: 1,
    why: "a password embedded in a URL",
  },
]);

/** First three characters and a length. Never the value. */
export function redact(value) {
  const text = String(value ?? "");
  return `${text.slice(0, 3)}… (${text.length} chars)`;
}

export function isPlaceholder(value) {
  const text = String(value ?? "");
  if (text.trim() === "") return true;
  // A run of one repeated character is padding, not a secret.
  if (/^(.)\1*$/.test(text)) return true;
  return PLACEHOLDERS.some((pattern) => pattern.test(text));
}

/**
 * Scans one file's text.
 *
 * Returns the findings that survived suppression, plus the markers that
 * suppressed nothing (`stale`) and the markers that carried no reason
 * (`unreasoned`). Exported and pure so the rules can be exercised against
 * synthetic input, which matters more here than usual: the honest test for a
 * credential scanner cannot be a fixture file full of credentials.
 *
 * A marker covers its own line and the one after it. Both are needed — a
 * same-line comment is impossible in JSON, and a preceding-line comment is the
 * only form available there — and neither reaches further, so a suppression
 * cannot silently spread down a file as it is edited.
 */
export function scanText(text, { path = "(input)" } = {}) {
  const lines = text.split(/\r?\n/);
  const markers = new Map();
  const unreasoned = [];
  const hits = [];

  lines.forEach((line, index) => {
    const marker = MARKER.exec(line);
    if (marker !== null) {
      const reason = (marker[1] ?? "").trim();
      if (reason.replace(/[^A-Za-z0-9]/g, "").length < MIN_REASON_CHARS) {
        unreasoned.push({ path, line: index + 1, reason });
      } else {
        markers.set(index, { reason, used: false });
      }
    }

    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(line)) !== null) {
        const value = rule.group === undefined ? match[0] : match[rule.group];
        if (rule.group !== undefined && isPlaceholder(value)) continue;
        hits.push({
          path,
          line: index + 1,
          column: match.index + 1,
          rule: rule.name,
          why: rule.why,
          sample: rule.safeToPrint === true ? match[0] : redact(value),
        });
      }
    }
  });

  const findings = hits.filter((hit) => {
    const own = markers.get(hit.line - 1);
    const above = markers.get(hit.line - 2);
    if (own === undefined && above === undefined) return true;
    if (own !== undefined) own.used = true;
    if (above !== undefined) above.used = true;
    return false;
  });

  const stale = [...markers.entries()]
    .filter(([, marker]) => !marker.used)
    .map(([index, marker]) => ({
      path,
      line: index + 1,
      reason: marker.reason,
    }));

  return { findings, stale, unreasoned };
}

/**
 * Lists the tracked files, as paths relative to the repository root.
 *
 * `-z` because a repository is allowed to contain a filename with a newline in
 * it, and splitting on newlines would turn one such file into two paths that do
 * not exist — which reads as "skipped, unreadable" rather than as an error.
 */
export function trackedFiles(run = defaultGit) {
  return run().split("\0").filter(Boolean);
}

function defaultGit() {
  return execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
}

/**
 * The rules check themselves, on every invocation.
 *
 * `check-audit.mjs` and `check-package.mjs` do the same thing, and here the
 * argument is at its strongest: a broken credential scanner reports zero
 * findings, and zero findings is also what a clean tree reports. There is no
 * difference visible from outside, so the difference has to be manufactured
 * from inside.
 *
 * Every sample is assembled at run time from fragments. That is not a stylistic
 * choice — a literal token in this file would be a literal token in the tracked
 * tree, and the scanner would be obliged to fail on its own source. The test
 * suite does the same.
 */
function selfCheck() {
  const jwt = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkEifQ",
    "TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ",
  ].join(".");
  const pem = ["-----BEGIN RSA PRIVATE", "KEY-----"].join(" ");
  const assigned = ["password", ": ", '"', "s0mething-real-here", '"'].join("");
  const templated = ["password", ": ", '"', "${VIYA_PASSWORD}", '"'].join("");
  // Assembled for the same reason the samples are. A literal marker written out
  // here would be a marker *in the tracked tree*, suppressing nothing, and the
  // scanner would report itself as carrying a stale one — which it did, on the
  // first run after this file became tracked.
  const allow = (reason) => `// ${"credential-scan"}: allow ${reason}`;
  const marked = `${jwt} ${allow("synthetic vector, not a real token")}`;

  const count = (text) => scanText(text).findings.length;

  const cases = [
    ["jwt found", count(jwt), 1],
    ["pem found", count(pem), 1],
    ["assigned literal found", count(assigned), 1],
    ["template value ignored", count(templated), 0],
    ["marker suppresses", count(marked), 0],
    [
      "a too-short reason is refused",
      scanText(allow("tmp")).unreasoned.length,
      1,
    ],
    [
      "a marker still suppresses from the line above",
      count(`${allow("synthetic vector, not a real token")}\n${jwt}`),
      0,
    ],
    [
      "prose is not a finding",
      count("Send the bearer token in the header."),
      0,
    ],
    ["redaction keeps nothing", redact("abcdefgh"), "abc… (8 chars)"],
  ];

  const broken = cases.filter(([, actual, expected]) => actual !== expected);
  if (broken.length > 0) {
    for (const [name, actual, expected] of broken) {
      console.error(
        `check-secrets: self-check "${name}" expected ${String(expected)}, got ${String(actual)}`,
      );
    }
    process.exit(2);
  }
}

function main() {
  selfCheck();

  let files;
  try {
    files = trackedFiles();
  } catch (error) {
    console.error(
      `check-secrets: could not list tracked files: ${error.message}`,
    );
    process.exit(2);
  }

  const findings = [];
  const stale = [];
  const unreasoned = [];
  let scanned = 0;
  let skipped = 0;

  for (const path of files) {
    if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) {
      skipped += 1;
      continue;
    }

    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      // Tracked but absent — a deleted file that is not staged yet, or a path
      // this platform cannot open. Neither is a credential.
      skipped += 1;
      continue;
    }

    if (text.includes("\u0000")) {
      skipped += 1;
      continue;
    }

    scanned += 1;
    const result = scanText(text, { path });
    findings.push(...result.findings);
    stale.push(...result.stale);
    unreasoned.push(...result.unreasoned);
  }

  if (unreasoned.length > 0) {
    console.error(
      `\ncheck-secrets: ${unreasoned.length} suppression marker(s) with no reason. Say why the match is not a credential; the reason is the point of the marker.`,
    );
    for (const marker of unreasoned) {
      console.error(`  ${marker.path}:${marker.line}`);
    }
  }

  if (findings.length > 0) {
    console.error(
      `\ncheck-secrets: ${findings.length} credential-shaped string(s) in tracked files.\n`,
    );
    for (const finding of findings) {
      console.error(
        `  ${finding.path}:${finding.line}:${finding.column}  [${finding.rule}] ${finding.why}\n    ${finding.sample}`,
      );
    }
    console.error(
      "\nIf one of these is real: rotate it first, then remove it — deleting the\n" +
        "line does not un-publish it. If it is not, mark the line with\n" +
        "`credential-scan: allow <why>` in a comment. See docs/dev/ci.md.\n",
    );
  }

  // Stale markers are reported and do not fail the run. They cannot be made
  // fatal without failing on the documentation that explains them: a marker in
  // a fenced example is, to a line-based scanner, indistinguishable from a
  // marker in code. A checker that fails on its own docs teaches people to
  // route around it, which costs more than a stale comment does.
  if (stale.length > 0) {
    console.log(
      `check-secrets: ${stale.length} allow marker(s) matched nothing — check they are still needed.`,
    );
    for (const marker of stale) {
      console.log(`  ${marker.path}:${marker.line} — ${marker.reason}`);
    }
  }

  if (findings.length > 0 || unreasoned.length > 0) process.exit(1);

  console.log(
    `check-secrets: OK — ${scanned} file(s) scanned, ${skipped} skipped as binary or unreadable.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
