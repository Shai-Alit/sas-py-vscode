// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Enforces the licensing obligations recorded in ADR-0000.
 *
 * Three requirements, and the later ones are the ones that are easy to forget:
 *
 *   1. Every source file carries a copyright line and an SPDX identifier.
 *   2. Any file carrying the SAS copyright header **also states that it has
 *      been modified.** Apache-2.0 §4(b) requires the modification notice;
 *      preserving the header alone does not satisfy it. This is a licence
 *      obligation, not a courtesy.
 *   3. Any file that names the upstream repository **declares which kind of
 *      relationship it has to it** — `Ported from:` or `Structure follows:`.
 *
 * Requirement 3 closes a hole that requirements 1 and 2 cannot see. They key off
 * the presence of the SAS header, so a genuinely ported file that simply dropped
 * that header passed silently — the check could only catch the careful mistake,
 * not the careless one. Forcing an explicit declaration inverts that: the file
 * has to say what it is, and `Ported from:` then drags requirement 2 back in.
 *
 * It cannot verify that the declaration is *true*; nothing mechanical can. What
 * it buys is that the claim is present, specific, and reviewable, instead of
 * absent and inferred differently by every reader.
 *
 * Structure follows: tools/check-copyright.mjs in
 * sassoftware/vscode-sas-extension (Apache-2.0) — same idea, no copied code,
 * extended with requirements 2 and 3. That file carries no copyright header of
 * its own, so there is none to retain here.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

const SCAN = [
  { dir: "src", extensions: [".ts"] },
  { dir: "scripts", extensions: [".mjs"] },
  { dir: "test", extensions: [".ts"], skip: ["scratch"] },
];
const ROOT_FILES = ["esbuild.mjs", "eslint.config.mjs"];

// Safety bound on how far we will look for the leading comment block.
const MAX_HEADER_LINES = 60;

const SPDX = /SPDX-License-Identifier:\s*Apache-2\.0/;
const COPYRIGHT = /Copyright\s*(?:©|\(c\)|\(C\))/;
const UPSTREAM = /SAS Institute/i;
const MODIFIED = /Modified\s+(?:from\s+the\s+original|by)\b/i;

// The repository slug, not the company name: a file may mention SAS Institute
// in passing, but naming the repo means it stands in some relationship to that
// code, and requirement 3 wants that relationship spelled out.
const UPSTREAM_REPO = /sassoftware\/vscode-sas-extension/i;

// A declaration is a header line that *starts* with the marker, not any mention
// of it. This file is the proof that the distinction is needed: the doc comment
// above names both markers while explaining them, and an unanchored match read
// that prose as a claim of authorship and failed the checker against itself.
// The same trap is one paragraph up in `extractHeader` — a file that discusses
// a rule is not a file that is subject to it.
const PORTED = /^[ \t]*(?:\/\/|\*|#)?[ \t]*Ported from:/im;
const STRUCTURE = /^[ \t]*(?:\/\/|\*|#)?[ \t]*Structure follows:/im;

/**
 * Returns the leading comment block of a file — everything from the top down to
 * the first line of actual code.
 *
 * Defining the header this way rather than as "the first N lines" matters: a
 * file that merely *discusses* SAS Institute in its body (this script does) is
 * not a ported file, and should not be asked for a modification notice.
 */
function extractHeader(source) {
  const lines = source.split(/\r?\n/, MAX_HEADER_LINES);
  const header = [];
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlockComment) {
      header.push(line);
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("//")) {
      header.push(line);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      header.push(line);
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }
    break; // first line of code — the header is over.
  }

  return header.join("\n");
}

function walk(dir, extensions, skip = []) {
  const absolute = join(ROOT, dir);
  let entries;
  try {
    entries = readdirSync(absolute);
  } catch {
    // A scanned directory need not exist yet — slices add them over time.
    // Deliberately fail-soft: a missing directory is not a licence violation.
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (skip.includes(entry)) continue;
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(join(dir, entry), extensions, skip));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

const files = [
  ...SCAN.flatMap(({ dir, extensions, skip }) => walk(dir, extensions, skip)),
  ...ROOT_FILES.map((f) => join(ROOT, f)),
];

const failures = [];

for (const file of files) {
  let header;
  try {
    header = extractHeader(readFileSync(file, "utf8"));
  } catch {
    continue;
  }

  const name = relative(ROOT, file).split(sep).join("/");

  if (!COPYRIGHT.test(header)) {
    failures.push([
      name,
      "missing a copyright line in its leading comment block",
    ]);
  }
  if (!SPDX.test(header)) {
    failures.push([name, "missing 'SPDX-License-Identifier: Apache-2.0'"]);
  }
  if (UPSTREAM.test(header) && !MODIFIED.test(header)) {
    failures.push([
      name,
      "carries the SAS Institute copyright but no modification notice — Apache-2.0 §4(b) requires ported files to state that they have been changed. Add: 'Modified from the original by the Python on Viya contributors.'",
    ]);
  }

  if (
    UPSTREAM_REPO.test(header) &&
    !PORTED.test(header) &&
    !STRUCTURE.test(header)
  ) {
    failures.push([
      name,
      "names sassoftware/vscode-sas-extension without declaring the relationship. Add either 'Ported from: <upstream path>' (code was copied — also keep the SAS copyright header, where the upstream file has one, and a modification notice) or 'Structure follows: <upstream path>' (written here, upstream consulted for shape). See CONTRIBUTING.md.",
    ]);
  }

  if (PORTED.test(header) && !MODIFIED.test(header)) {
    failures.push([
      name,
      "declares 'Ported from:' but carries no modification notice — Apache-2.0 §4(b) requires one. Add: 'Modified from the original by the Python on Viya contributors.'",
    ]);
  }
}

if (failures.length > 0) {
  console.error(`\ncheck-copyright: ${failures.length} problem(s) found.\n`);
  for (const [name, reason] of failures) {
    console.error(`  ${name}\n    ${reason}\n`);
  }
  console.error("See docs/adr/0000-repository-licence.md and NOTICE.\n");
  process.exit(1);
}

console.log(`check-copyright: ${files.length} file(s) OK.`);
