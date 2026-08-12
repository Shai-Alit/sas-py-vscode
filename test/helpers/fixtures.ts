// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
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
