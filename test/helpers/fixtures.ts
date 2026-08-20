// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * Fixtures are read from the source tree, never copied into `out/`.
 *
 * A copy step is one more thing to forget, and a stale copy is worse than a
 * missing one: the suite goes green against a payload the server stopped
 * sending months ago. `__dirname` here is `<repo>/out/test/helpers`.
 */
const FIXTURE_ROOT = path.resolve(__dirname, "../../../test/fixtures");

/** Reads a fixture as text. Segments are joined under `test/fixtures/`. */
export function readFixture(...segments: string[]): string {
  const file = path.join(FIXTURE_ROOT, ...segments);
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      `Fixture not found: ${segments.join("/")} (looked under ${FIXTURE_ROOT}). ` +
        "Fixtures are read from the source tree rather than from out/, so if that " +
        "root looks wrong, the compiled helper has moved relative to the repository root.",
      { cause: error },
    );
  }
}

/**
 * Reads a fixture as raw bytes, with no encoding applied in either direction.
 *
 * The submission-fidelity corpus (`test/fixtures/submission-corpus/`) is the
 * one set of fixtures where `readFixture`'s `utf8` decode is the wrong tool: a
 * test asserting byte-for-byte fidelity must start from the same bytes the
 * upload path will send, not from a string a decode step has already round-
 * tripped through. `empty.py` returns a zero-length array rather than throwing,
 * which matches `readFileSync`'s own behaviour on a real empty file.
 */
export function readFixtureBytes(...segments: string[]): Uint8Array {
  const file = path.join(FIXTURE_ROOT, ...segments);
  try {
    return readFileSync(file);
  } catch (error) {
    throw new Error(
      `Fixture not found: ${segments.join("/")} (looked under ${FIXTURE_ROOT}).`,
      { cause: error },
    );
  }
}

/**
 * The file names directly under a fixture directory, sorted.
 *
 * Sorted so a test's iteration order — and therefore Mocha's reported order —
 * does not depend on the filesystem's own directory-entry order, which differs
 * between the three operating systems CI runs on.
 */
export function listFixtureFiles(...segments: string[]): readonly string[] {
  const dir = path.join(FIXTURE_ROOT, ...segments);
  return [...readdirSync(dir)].sort();
}

/**
 * Reads a JSON fixture. The result is `unknown` on purpose: a fixture is
 * untrusted input standing in for a server response, and the code under test
 * should be the thing that proves it has the shape it claims. Casting here
 * would hand every test a lie the parser never checked.
 */
export function readJsonFixture(...segments: string[]): unknown {
  const text = readFixture(...segments);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Fixture ${segments.join("/")} is not valid JSON.`, {
      cause: error,
    });
  }
}
