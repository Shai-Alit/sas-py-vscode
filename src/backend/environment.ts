// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Stage-2 capability probing (3e) — the fixed Python probe program, and
 * parsing its answer back.
 *
 * **This module must never import `vscode`.**
 *
 * `PRODUCTION_PLAN.md` §2.3 splits capability probing in two. Stage 1
 * (`src/dialects/probe.ts`) is HTTP-derived and needs no execution. Stage 2 —
 * whether `PROC PYTHON` actually works, the interpreter version and path, and
 * the installed package set — needs to run code and read the answer back,
 * which is what this module and `ProcPythonBackend.probeRuntime()` do
 * together: this one owns the fixed program text and the pure parsing of
 * what comes back; the backend owns submitting it and fetching the file.
 *
 * ## Why a file, not a `print()`
 *
 * `PRODUCTION_PLAN.md` calls the installed package set a first-class,
 * user-readable view — hundreds of entries is the expected size, not the
 * exception. A naive implementation would `print(json.dumps(info))` and read
 * the answer back off the log the way ordinary program output already works.
 * Finding 62 (`docs/phases/phase-3.md`, 2026-08-25) already rules that out for
 * exactly this shape of payload: the log wraps any single `print()` line at a
 * hard character count (`LINESIZE`, 132 by default, 256 with
 * `LINESIZE=MAX` — raised, never removed), and a wrapped line is
 * indistinguishable from a genuine one, with nothing in the wire shape saying
 * which happened. A package list long enough to matter is also long enough to
 * wrap. So this probe writes its answer to a file in the session's working
 * directory instead, fetched byte-for-byte via `compute/files.ts` — the same
 * mechanism findings 61/65/67 established for matplotlib/pandas rich output,
 * reused here rather than inventing a second transport.
 *
 * This is not the same call as `richOutput.ts`'s before/after directory diff,
 * though it shares the same underlying files API. The probe writes exactly one
 * file, under a name only this module ever produces
 * ({@link ENVIRONMENT_PROBE_FILENAME}), so the backend looks it up directly in
 * a fresh listing rather than diffing two listings against each other — there
 * is nothing to diff against, and no whitelist question to ask, because there
 * is only ever one candidate name.
 *
 * ## Why the probe is a `def`/`try`/`finally`/`del`, not a bare script
 *
 * `ExecuteOptions.freshNamespace` cannot be used here: `true` means
 * `proc python restart;`, which discards the user's own interpreter state —
 * exactly what a capability probe must never do to check whether Python
 * works. So this runs in the session's *existing* namespace, the same one the
 * user's own code shares across runs, which means anything this probe binds
 * at module scope would otherwise linger there as a side effect of merely
 * asking a question. Wrapping the whole probe in one function and deleting
 * the function's own name after calling it — `import sys, json,
 * importlib.metadata` included, since they are bound inside the function
 * body — leaves nothing behind: no `sys`, `json` or `importlib` suddenly
 * appearing in a user's own `dir()` because they happened to open the
 * environment view. The `del` runs from a `finally`, so a probe that raises
 * still cleans up its own function name rather than leaving
 * `__pyvia_probe_environment` bound in the user's namespace.
 *
 * ## `importlib.metadata`, never `pip`
 *
 * `PRODUCTION_PLAN.md` §2.3 and this phase's own plan text are explicit:
 * `pip` need not exist in a compute context at all, so nothing here shells out
 * to it. `importlib.metadata.distributions()` is the standard-library way to
 * enumerate installed distributions and needs no subprocess.
 *
 * ## A broken distribution must not sink the whole probe
 *
 * On an interpreter with hundreds of distributions it is realistic for one to
 * carry malformed `METADATA` — no `Name:`, no `Version:`, an unreadable file.
 * `distribution.metadata` can raise and `distribution.version` can be `None`
 * for exactly those, so both are read inside one `try`, and an entry is kept
 * only when name and version both come back as non-empty strings. Letting a
 * single bad entry through would either crash `sorted(set(...))` (a `None`
 * version is unorderable against a real one) — read back as
 * `runtime-unavailable`, i.e. "Python does not work" when it does — or land a
 * `null` in the JSON that {@link parseEnvironmentProbeFile} then rejects
 * whole, read back as `backend-failed`. Dropping the unnameable few is the
 * honest answer: they have nothing this view can show anyway.
 *
 * ## Import names, not only the distribution name (10b)
 *
 * `distribution.metadata['Name']` is the PyPI *distribution* name, which is
 * not always the name a Python `import` statement uses — `Pillow` installs as
 * `PIL`, `beautifulsoup4` as `bs4`, `PyYAML` as `yaml`, and many others differ
 * the same way. 10b's Pylance stub reflection needs the *import* name, so each
 * package entry also carries a best-effort, never-empty list of them, tried in
 * this order: (1) the distribution's own `top_level.txt` (the setuptools-era,
 * per-distribution, most authoritative source, when present — read via
 * `Distribution.read_text`, which works across both `dist-info` and
 * `egg-info` layouts); (2) `importlib.metadata.packages_distributions()`
 * (Python 3.10+, guarded by `hasattr` since this project does not get to
 * assume a deployment's Python version, a global reverse mapping built once
 * per probe run, not per distribution); (3) the distribution name itself with
 * `-`/`.` normalised to `_`, the closest last-resort guess to how a name
 * without either of the above was probably derived. Each of the first two
 * steps is wrapped so a failure there degrades to the next step, the same
 * "a broken distribution must not sink the whole probe" discipline above,
 * extended rather than replaced.
 */

import { type PythonPackage, type RuntimeCapabilities } from "./backend";

/**
 * The name this probe writes its answer under, in the session's working
 * directory.
 *
 * Fixed rather than generated per run (unlike `procPython.ts`'s per-run
 * fileref names) — nothing else in this codebase ever produces a file with
 * this name, so a collision would mean a second probe already in flight,
 * which `ProcPythonBackend.probeRuntime`'s own busy/serial contract already
 * rules out.
 */
export const ENVIRONMENT_PROBE_FILENAME = "__pyvia_environment_probe__.json";

/**
 * The cap `ProcPythonBackend.probeRuntime` passes when fetching
 * {@link ENVIRONMENT_PROBE_FILENAME}'s bytes back.
 *
 * The transport already refuses any response body over its own
 * `MAX_BODY_BYTES` (1 MiB, `auth/transport.ts`), so this is not the
 * difference between bounded and unbounded — it makes the intended bound
 * explicit at the call site the same way `richOutput.ts` does with
 * `MAX_CAPTURE_BYTES`, and pins it here rather than inheriting whatever the
 * transport default happens to be later. The probe writes a `version`
 * string, an `executable` path, and one `[name, version]` pair per installed
 * distribution; even an interpreter with thousands of them lands far under
 * this. A file that somehow exceeds it is a malformed probe result, surfaced
 * as `backend-failed` like any other unparseable one, not something to grow
 * the buffer for.
 *
 * 10b widens each package entry with an import-name list (this module's own
 * doc comment, "Import names, not only the distribution name"), which grows
 * the payload per package but not its order of magnitude — a name list is
 * typically one short string, rarely more than a handful. Left unchanged
 * here; Finding 10.3 is where a real deployment would be recorded if this cap
 * ever turns out to matter in practice (Probe findings, `phase-10.md`).
 */
export const MAX_ENVIRONMENT_PROBE_BYTES = 1024 * 1024;

/**
 * The fixed Python source the probe runs, as SAS statements ready to hand to
 * `createJob` — a `submit`/`endsubmit` block, exactly like `procPython.ts`'s
 * own `RESTART_STATEMENT` handling, and for the same reason: this text is
 * entirely this project's own, never user input, so ADR-0014's upload/`infile=`
 * discipline (which exists to keep a user's *own* code from ever being
 * inlined into a `SUBMIT` block) has nothing to say about it.
 *
 * **No trailing `run;`.** Matching `reset()`'s own `RESTART_STATEMENT` and
 * `runProgram`'s per-run statement, that is the caller's to append — ADR-0014
 * amendment (finding 70) ties it to the specific job the caller submits, not
 * to the statement text itself.
 */
export function environmentProbeStatements(): readonly string[] {
  return ["proc python;", "submit;", ...PROBE_SOURCE.split("\n"), "endsubmit;"];
}

/** The probe's Python source, kept as one constant so
 * {@link environmentProbeStatements} and any test asserting against it read
 * the same text. See this module's own doc comment for why it is a
 * `def`/`try`/`finally`/`del` rather than bare top-level statements, why an
 * unreadable distribution is skipped rather than allowed to fail the run, and
 * why each entry also carries an import-name list ("Import names, not only
 * the distribution name"). */
const PROBE_SOURCE = [
  "def __pyvia_probe_environment():",
  "    import sys, json, importlib.metadata",
  "    try:",
  "        if hasattr(importlib.metadata, 'packages_distributions'):",
  "            reverse_map = importlib.metadata.packages_distributions()",
  "        else:",
  "            reverse_map = {}",
  "    except Exception:",
  "        reverse_map = {}",
  "    dist_to_imports = {}",
  "    for import_name, dist_names in reverse_map.items():",
  "        for dist_name in dist_names:",
  "            dist_to_imports.setdefault(dist_name, []).append(import_name)",
  "    packages = []",
  "    for distribution in importlib.metadata.distributions():",
  "        try:",
  "            name = distribution.metadata['Name']",
  "            version = distribution.version",
  "        except Exception:",
  "            name = version = None",
  "        if isinstance(name, str) and name and isinstance(version, str) and version:",
  "            import_names = None",
  "            try:",
  "                top_level = distribution.read_text('top_level.txt')",
  "            except Exception:",
  "                top_level = None",
  "            if top_level:",
  "                import_names = sorted(set(line.strip() for line in top_level.splitlines() if line.strip()))",
  "            if not import_names:",
  "                import_names = sorted(set(dist_to_imports.get(name, [])))",
  "            if not import_names:",
  "                import_names = [name.replace('-', '_').replace('.', '_')]",
  "            packages.append((name, version, tuple(import_names)))",
  "    info = {",
  "        'version': sys.version.replace('\\n', ' '),",
  "        'executable': sys.executable,",
  "        'packages': [[n, v, list(i)] for n, v, i in sorted(set(packages))],",
  "    }",
  `    with open(${JSON.stringify(ENVIRONMENT_PROBE_FILENAME)}, 'w', encoding='utf-8') as handle:`,
  "        json.dump(info, handle)",
  "try:",
  "    __pyvia_probe_environment()",
  "finally:",
  "    del __pyvia_probe_environment",
].join("\n");

/**
 * Parses the probe's captured file content into {@link RuntimeCapabilities},
 * or says what was wrong with it.
 *
 * `undefined` means the bytes were not the shape this probe's own script
 * produces — malformed UTF-8, invalid JSON, or a JSON value missing a field
 * this parser requires. That is a defect in this seam (the probe is this
 * project's own fixed script; nothing about it should ever vary with a
 * deployment), not evidence about whether Python works, so the caller reports
 * it as `backend-failed` rather than `runtime-unavailable` — see
 * `procPython.ts`'s `probeRuntime`.
 */
export function parseEnvironmentProbeFile(
  bytes: Uint8Array,
): RuntimeCapabilities | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;

  const version = record.version;
  const executable = record.executable;
  if (typeof version !== "string" || typeof executable !== "string") {
    return undefined;
  }

  const packages = readPackages(record.packages);
  if (packages === undefined) return undefined;

  return { kind: "available", version, executable, packages };
}

/** `packages`, or `undefined` if it is not an array of `[name, version,
 * importNames]` triples — the shape {@link PROBE_SOURCE} always produces
 * (widened from a `[name, version]` pair by 10b), checked rather than assumed
 * for the same reason every other wire read in this project is. */
function readPackages(value: unknown): readonly PythonPackage[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const packages: PythonPackage[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 3) return undefined;
    const [name, version, importNames] = item as readonly unknown[];
    if (typeof name !== "string" || typeof version !== "string") {
      return undefined;
    }
    if (
      !Array.isArray(importNames) ||
      !importNames.every((entry) => typeof entry === "string")
    ) {
      return undefined;
    }
    packages.push({ name, version, importNames });
  }
  return packages;
}
