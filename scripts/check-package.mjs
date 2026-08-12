// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Checks what the `.vsix` actually contains, by reading the `.vsix`.
 *
 * `.vscodeignore` is an allow-by-default list: everything in the working tree
 * ships unless a pattern excludes it. That default is backwards for a project
 * whose working tree is expected to contain a `creds.json` holding live Viya
 * bearer tokens (CONTRIBUTING.md tells contributors to put it there), and the
 * failure is silent — a wrong pattern does not error, it publishes.
 *
 * So this reads the packaged artefact rather than trusting the ignore file, and
 * asserts in both directions:
 *
 *   - **Nothing forbidden shipped.** Sources, tests, maps, planning documents,
 *     and anything shaped like a credential.
 *   - **Everything required shipped.** A guard that only looks for bad entries
 *     passes trivially if it fails to read the archive at all, and "found no
 *     violations" is exactly what a broken reader reports.
 *
 * The zip parsing is a few dozen lines against the central directory rather
 * than a dependency, for the reason in ADR-0003's spirit: this runs in CI and
 * on contributor machines, and a supply-chain surface added to check a
 * supply-chain property is a poor trade.
 *
 * Usage: node scripts/check-package.mjs [path-to-vsix]
 *
 * Exit codes are split so CI can tell the two failures apart: **1** means the
 * package is wrong and `.vscodeignore` needs fixing; **2** means this script or
 * its input is wrong — a missing archive, something that is not a zip, or rules
 * that no longer classify their own examples.
 */

import { readFileSync, statSync } from "node:fs";

const DEFAULT_VSIX = "dist/python-on-viya.vsix";

// A smoke alarm, not a size budget. The extension is a single bundled file and
// a few documents; anything approaching this means a directory got swept in.
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Rules are ordered, and the first match wins — the name it reports is what
 * the self-test below pins, so reordering them is a visible change rather than
 * a silent one.
 *
 * `credential` is deliberately first. Every rule here fails the build, so
 * ordering cannot change *whether* a file is caught, only what the failure is
 * called — and a `scripts/creds.json` reported as "source" tells a reader to go
 * tidy up their ignore patterns, where the same file reported as "credential"
 * tells them to rotate a token. The cheaper message to act on wrongly is the
 * one to avoid.
 */
const DENY = [
  {
    name: "credential",
    why: "this is the failure that must never happen — see SECURITY.md",
    test: (p) =>
      /(^|\/)creds\.json$/.test(p) ||
      /(^|\/)\.env(\.|$)/.test(p) ||
      /\.(pem|key|pfx|p12|jks|keystore)$/.test(p) ||
      /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/.test(p),
  },
  {
    name: "source",
    why: "TypeScript sources and the build/dependency configuration are not needed at runtime and make the package a second, drifting copy of the repository",
    test: (p) =>
      /^(src|test|scripts)\//.test(p) ||
      /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(p) ||
      (p.endsWith(".ts") && !p.endsWith(".d.ts")),
  },
  {
    name: "build output",
    why: "`out/` is the test compiler's output and `coverage/` is a report; only `dist/` ships",
    test: (p) => /^(out|coverage|node_modules|\.vscode-test)\//.test(p),
  },
  {
    name: "source map",
    why: "maps expose the original sources and are not used by the extension host in a published build",
    test: (p) => p.endsWith(".map"),
  },
  {
    name: "internal document",
    why: "planning and probe records are for maintainers; they date badly and say things about deployments that a published package should not, and the policy files describe a GitHub workflow a package consumer cannot use",
    // `site/` is the built documentation. It exists only on a machine that has
    // run `npm run docs:build` — which CI does, and which `vsce package` would
    // then happily read out of the working tree.
    test: (p) =>
      /(^|\/)(PRODUCTION_PLAN|RUNBOOK|PROBE-FINDINGS|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)\.md$/.test(
        p,
      ) ||
      /^docs\//.test(p) ||
      /^site\//.test(p),
  },
  {
    name: "repository metadata",
    why: "CI configuration and git plumbing have no meaning inside a VSIX",
    test: (p) => /^\.(github|git|vscode)\//.test(p),
  },
];

/**
 * Paths that must be present, relative to the archive root. `extension/` is the
 * prefix vsce gives everything from the repository; `extension.vsixmanifest`
 * and `[Content_Types].xml` sit beside it.
 *
 * **The names here are vsce's, not the repository's.** vsce renames the three
 * files the marketplace renders: `README.md` and `CHANGELOG.md` are lowercased,
 * and `LICENSE` gains a `.txt`. `NOTICE` means nothing to vsce and arrives
 * unchanged. This list was written with the repository's names, and the first
 * run of this script against a real package is what corrected it — which is a
 * fair argument for the script existing.
 */
const REQUIRED = [
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/package.json",
  "extension/package.nls.json",
  "extension/dist/extension.js",
  "extension/LICENSE.txt",
  "extension/NOTICE",
  "extension/readme.md",
  "extension/changelog.md",
];

/**
 * Examples with known answers, checked on every run before the real archive is
 * examined.
 *
 * This exists because the rules above are the only part of the tool with any
 * judgement in it, and a regex that stops matching does not announce itself:
 * the run goes green, which is indistinguishable from the package being clean.
 * Adding a `test/unit/*.test.ts` for this would mean importing an ESM script
 * from the CommonJS the test tier compiles to, so the examples travel with the
 * rules instead.
 */
const SELF_TEST = [
  ["dist/extension.js", null],
  ["package.json", null],
  ["package.nls.json", null],
  ["README.md", null],
  ["LICENSE", null],
  ["NOTICE", null],
  ["CHANGELOG.md", null],
  ["l10n/bundle.l10n.json", null],
  ["src/extension.ts", "source"],
  ["test/unit/harness.test.ts", "source"],
  ["scripts/check-copyright.mjs", "source"],
  // Under a `source`-first ordering this came out "source", which is true but
  // buries the lede. Pinned here so the ordering cannot drift back.
  ["scripts/creds.json", "credential"],
  ["dist/extension.js.map", "source map"],
  ["out/src/extension.js", "build output"],
  ["node_modules/left-pad/index.js", "build output"],
  ["creds.json", "credential"],
  ["config/creds.json", "credential"],
  [".env", "credential"],
  [".env.local", "credential"],
  ["certs/viya.pem", "credential"],
  ["RUNBOOK.md", "internal document"],
  ["SECURITY.md", "internal document"],
  ["docs/dev/ci.md", "internal document"],
  ["site/index.html", "internal document"],
  ["docs/reference/settings.md", "internal document"],
  // vsce's own defaultIgnore drops the lockfile, so this never reaches these
  // rules in practice. Pinned anyway: "something else already handles it" is
  // exactly the assumption that stops being true after a tooling upgrade.
  ["package-lock.json", "source"],
  [".github/workflows/ci.yml", "repository metadata"],
];

/** The first rule that matches `path`, or `null` if none does. */
function classify(path) {
  return DENY.find((rule) => rule.test(path)) ?? null;
}

function runSelfTest() {
  const wrong = [];
  for (const [path, expected] of SELF_TEST) {
    const actual = classify(path)?.name ?? null;
    if (actual !== expected) {
      wrong.push(
        `  ${path}\n    expected ${expected ?? "to be allowed"}, got ${actual ?? "allowed"}`,
      );
    }
  }
  if (wrong.length > 0) {
    console.error(
      "check-package: the packaging rules no longer classify their own examples correctly.\n" +
        "This is a bug in the rules, not in the package.\n\n" +
        wrong.join("\n"),
    );
    process.exit(2);
  }
}

/**
 * File names from a zip's central directory.
 *
 * Only the names are read — the entries themselves stay compressed, which is
 * why no inflate step is needed. Format: APPNOTE.TXT sections 4.3.12 (central
 * directory header) and 4.3.16 (end of central directory record).
 */
function readZipEntryNames(buffer) {
  const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
  const CENTRAL_FILE_HEADER = 0x02014b50;

  // The record is 22 bytes plus a comment of up to 0xffff, so it can only be
  // in the last 64 KiB. Scan backwards: a comment could otherwise contain a
  // byte sequence that looks like the signature.
  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  let end = -1;
  for (let i = buffer.length - 22; i >= earliest; i--) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Error("no end-of-central-directory record — not a zip archive");
  }

  const count = buffer.readUInt16LE(end + 10);
  const start = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || start === 0xffffffff) {
    throw new Error(
      "zip64 archive. A VSIX this large is itself the problem — investigate before teaching this script to read zip64.",
    );
  }

  const names = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== CENTRAL_FILE_HEADER) {
      throw new Error(
        `central directory entry ${i} has the wrong signature — the archive is truncated or not a zip`,
      );
    }
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    names.push(buffer.toString("utf8", at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function main() {
  runSelfTest();

  const vsix = process.argv[2] ?? DEFAULT_VSIX;

  let size;
  try {
    size = statSync(vsix).size;
  } catch {
    console.error(
      `check-package: ${vsix} does not exist. Run \`npm run package\` first.`,
    );
    process.exit(2);
  }

  let names;
  try {
    names = readZipEntryNames(readFileSync(vsix));
  } catch (error) {
    // Deliberately not re-thrown. A stack trace here would read as a crash in
    // the checker, when what it means is that the thing being checked is not
    // the archive we were promised — a different problem with a different fix.
    console.error(
      `check-package: could not read ${vsix} as a VSIX — ${error.message}`,
    );
    process.exit(2);
  }

  const failures = [];

  for (const missing of REQUIRED.filter((r) => !names.includes(r))) {
    failures.push(`missing from the package: ${missing}`);
  }

  for (const name of names) {
    // Directory entries carry a trailing slash and no content.
    if (name.endsWith("/")) continue;
    const relative = name.startsWith("extension/")
      ? name.slice("extension/".length)
      : name;
    const rule = classify(relative);
    if (rule) {
      failures.push(`${name} — ${rule.name}: ${rule.why}`);
    }
  }

  if (size > MAX_BYTES) {
    failures.push(
      `the package is ${(size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_BYTES / 1024 / 1024} MB alarm threshold. Nothing here should be large; check the file list above before raising the limit.`,
    );
  }

  if (failures.length > 0) {
    console.error(
      `check-package: ${vsix} would ship things it should not.\n\n` +
        failures.map((f) => `  ${f}`).join("\n") +
        "\n\nFix `.vscodeignore` rather than this list, unless the rule itself is wrong.",
    );
    process.exit(1);
  }

  console.log(
    `check-package: ${vsix} OK — ${names.length} entries, ${(size / 1024).toFixed(0)} KiB.`,
  );
  for (const name of names.filter((n) => !n.endsWith("/")).sort()) {
    console.log(`  ${name}`);
  }
}

main();
