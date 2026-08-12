// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Type-checks the TypeScript samples embedded in `docs/`.
 *
 * A code sample in documentation is code that nobody compiles, which is to say
 * it is code that is wrong roughly as often as you would expect. The specific
 * decay is worse than a typo: a sample keeps compiling in a reader's head long
 * after the API it demonstrates was renamed, so it teaches a thing that used to
 * be true. Everything else in this repository that is machine-checkable is
 * machine-checked; samples were the last hand-verified surface.
 *
 * The rules, which are deliberately blunt:
 *
 *   - A ```ts or ```typescript block is a complete, compilable module and is
 *     type-checked against the extension's own `tsconfig.json`.
 *   - A sample that imports from the repository must say where it lives:
 *     ```ts path=test/unit/example.test.ts. It is then written into that
 *     directory and checked with the project that owns it, so `../helpers/…`
 *     resolves and `describe`/`it` are in scope. Without this, the only
 *     checkable sample is one that imports nothing, which is not a useful class
 *     of sample — the first real sample in these docs was a mocha test.
 *   - A block that is a fragment — a few lines torn out of a function, or
 *     pseudocode — must say so: ```ts no-check. Skips are counted and printed,
 *     so an opt-out is visible rather than silent.
 *
 * Standalone samples are written to `out/docs-samples/`, inside the repository
 * rather than a system temp directory, so that `vscode` and `node` types resolve
 * through the ordinary `node_modules` lookup instead of needing a synthetic path
 * mapping. `out/` is git-ignored, excluded from the VSIX, and denied by
 * check-package. Located samples are written beside the code they describe as
 * `__docs-sample-N.ts` and removed in a `finally`, so an interrupted run cannot
 * leave one behind — and `.gitignore` covers the name in case one ever does.
 *
 * Diagnostics are reported against the markdown file and line, not the
 * generated file, because the generated file is an implementation detail and
 * telling someone to fix line 7 of a temporary file is telling them nothing.
 *
 * Usage: node scripts/check-docs-samples.mjs
 *
 * Exit codes: **1** means a sample does not compile; **2** means this script
 * could not run the check at all.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const WORK = join(ROOT, "out", "docs-samples");

const CHECKED_LANGUAGES = new Set(["ts", "typescript"]);

/** Every `.md` under `docs/`, excluding VitePress's own build artefacts. */
function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "cache" || entry === "dist" || entry === "node_modules") {
      continue;
    }
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...markdownFiles(absolute));
    } else if (entry.endsWith(".md")) {
      found.push(absolute);
    }
  }
  return found.sort();
}

/**
 * Fenced code blocks, with the line number the *content* starts on.
 *
 * Only fences at the start of a line are considered, and the closing fence must
 * be at least as long as the opening one — that is what lets a sample contain a
 * nested fence, which the docs for this very script would otherwise trip over.
 */
export function extractBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let open = null;

  for (let i = 0; i < lines.length; i++) {
    const fence = /^(`{3,})(.*)$/.exec(lines[i]);

    if (open === null) {
      if (!fence) continue;
      const info = fence[2].trim().split(/\s+/).filter(Boolean);
      open = {
        marker: fence[1],
        language: (info[0] ?? "").toLowerCase(),
        // Flags keep their original case. Lowercasing them — which the first
        // version did — silently rewrites `path=src/Dialects/x.ts` into a
        // directory that does not exist on a case-sensitive filesystem, and
        // the resulting failure names a path the author never typed. Keyword
        // matching folds case at the point of comparison instead.
        flags: info.slice(1),
        startLine: i + 2, // 1-based, first line of content
        content: [],
      };
      continue;
    }

    // Inside a block. Anything that is not the closing fence is content —
    // including blank lines, which is why this cannot be written as an
    // early-continue on "not a fence".
    if (
      fence &&
      fence[1].length >= open.marker.length &&
      fence[2].trim() === ""
    ) {
      blocks.push({ ...open, content: open.content.join("\n") });
      open = null;
      continue;
    }

    open.content.push(lines[i]);
  }

  if (open !== null) {
    // An unterminated fence is a markdown bug in its own right, and one that
    // renders as the rest of the page turning into a code block.
    throw new Error(
      `unterminated \`\`\` fence opened on line ${open.startLine - 1}`,
    );
  }

  return blocks;
}

/** Keyword flags are matched without regard to case; values are not. */
export function hasFlag(block, keyword) {
  return block.flags.some((flag) => flag.toLowerCase() === keyword);
}

function slugify(path) {
  return relative(DOCS, path)
    .replace(/\.md$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-");
}

/**
 * The tsconfig that owns a repository-relative location. Test files compile
 * with mocha globals and a wider `rootDir`; everything else does not, and the
 * separation is load-bearing (see the comment at the top of tsconfig.test.json).
 */
function projectFor(repoRelativePath) {
  return repoRelativePath.startsWith("test/")
    ? "tsconfig.test.json"
    : "tsconfig.json";
}

function runTsc(projectPath) {
  const tsc = spawnSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      "--noEmit",
      "-p",
      projectPath,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (tsc.error) {
    console.error(
      `check-docs-samples: could not run tsc — ${tsc.error.message}`,
    );
    process.exit(2);
  }
  return {
    status: tsc.status,
    output: `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`.trim(),
  };
}

/**
 * Rewrites tsc diagnostics to point at the markdown they came from.
 *
 * Without this the report names a generated file that no longer exists by the
 * time anyone reads it, which is a worse experience than no report at all.
 */
function reportDiagnostics(output, byGeneratedName) {
  const reported = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^(?:.*[/\\])?([^/\\(]+\.ts)\((\d+),(\d+)\):\s*(.*)$/.exec(
      line,
    );
    const sample = match ? byGeneratedName.get(match[1]) : undefined;
    if (!sample) {
      if (line.trim()) reported.push(`  ${line}`);
      continue;
    }
    const mdLine = sample.startLine + Number(match[2]) - 1;
    reported.push(
      `  ${relative(ROOT, sample.file)}:${mdLine}:${match[3]} — ${match[4]}`,
    );
  }
  return reported;
}

function main() {
  let files;
  try {
    files = markdownFiles(DOCS);
  } catch (error) {
    console.error(`check-docs-samples: cannot read docs/ — ${error.message}`);
    process.exit(2);
  }

  const samples = [];
  let skipped = 0;

  for (const file of files) {
    let blocks;
    try {
      blocks = extractBlocks(readFileSync(file, "utf8"));
    } catch (error) {
      console.error(
        `check-docs-samples: ${relative(ROOT, file)} — ${error.message}`,
      );
      process.exit(2);
    }

    let ordinal = 0;
    for (const block of blocks) {
      if (!CHECKED_LANGUAGES.has(block.language)) continue;
      ordinal++;
      if (hasFlag(block, "no-check")) {
        skipped++;
        continue;
      }

      let location = null;
      for (const flag of block.flags) {
        const declared = /^path=(.+)$/i.exec(flag);
        if (!declared) continue;
        location = declared[1].replace(/\\/g, "/");
        if (location.startsWith("/") || location.split("/").includes("..")) {
          console.error(
            `check-docs-samples: ${relative(ROOT, file)} line ${block.startLine - 1} declares path=${location}, which escapes the repository.`,
          );
          process.exit(2);
        }
      }

      samples.push({
        name: `${slugify(file)}-${ordinal}.ts`,
        file,
        startLine: block.startLine,
        content: block.content,
        location,
      });
    }
  }

  const skipNote = skipped > 0 ? `, ${skipped} marked no-check` : "";

  if (samples.length === 0) {
    // Not a pass to be proud of, and said plainly so that a run which checks
    // nothing cannot be mistaken for a run which checked something.
    console.log(
      `check-docs-samples: no TypeScript samples to check${skipNote}.`,
    );
    return;
  }

  const failures = [];
  const standalone = samples.filter((s) => s.location === null);
  const located = samples.filter((s) => s.location !== null);

  // Located samples are written beside the code they describe, one project at a
  // time, and removed whatever happens.
  const byProject = new Map();
  for (const sample of located) {
    const project = projectFor(sample.location);
    if (!byProject.has(project)) byProject.set(project, []);
    byProject.get(project).push(sample);
  }

  for (const [project, group] of byProject) {
    const written = [];
    try {
      const byGeneratedName = new Map();
      group.forEach((sample, index) => {
        const generated = `__docs-sample-${index + 1}.ts`;
        const target = join(ROOT, dirname(sample.location), generated);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, `${sample.content}\n`, "utf8");
        written.push(target);
        byGeneratedName.set(generated, sample);
      });

      const { status, output } = runTsc(join(ROOT, project));
      if (status !== 0) {
        failures.push(...reportDiagnostics(output, byGeneratedName));
      }
    } finally {
      for (const path of written) rmSync(path, { force: true });
    }
  }

  if (standalone.length === 0) {
    return finish(samples.length, skipNote, failures);
  }

  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  for (const sample of standalone) {
    writeFileSync(join(WORK, sample.name), `${sample.content}\n`, "utf8");
  }

  writeFileSync(
    join(WORK, "tsconfig.json"),
    `${JSON.stringify(
      {
        extends: "../../tsconfig.json",
        compilerOptions: { noEmit: true, rootDir: "." },
        include: ["*.ts"],
        // Overriding this is not optional. `extends` resolves the base config's
        // relative paths against the *base* config's directory, so
        // tsconfig.json's `exclude: ["out"]` arrives here as `../../out` — which
        // is the directory these samples live in. Inheriting it produces
        // TS18003 "No inputs were found", a message that reads like "there is
        // nothing to check" when it means "I excluded everything you gave me".
        exclude: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const { status, output } = runTsc(join(WORK, "tsconfig.json"));
  if (status !== 0) {
    failures.push(
      ...reportDiagnostics(output, new Map(standalone.map((s) => [s.name, s]))),
    );
  }

  return finish(samples.length, skipNote, failures);
}

function finish(checked, skipNote, failures) {
  if (failures.length > 0) {
    console.error(
      "check-docs-samples: a documentation sample does not compile.\n\n" +
        failures.join("\n") +
        "\n\nFix the sample, mark the block ```ts no-check if it is a deliberate\n" +
        "fragment, or add path=<repo-relative-path> if it needs to resolve imports.",
    );
    process.exit(1);
  }
  console.log(
    `check-docs-samples: ${checked} sample(s) type-check${skipNote}.`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("check-docs-samples.mjs")) {
  main();
}
