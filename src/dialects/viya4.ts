// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Viya 4.
 *
 * **This module must never import `vscode`.**
 *
 * Thin, and expected to stay thin for a while. Everything this project has
 * measured — the whole of `PROBE-FINDINGS.md` — was measured against Viya 4, so
 * Viya 4 is the behaviour the rest of `src/` already encodes directly. A
 * difference only becomes a method here when a *second* generation is known to
 * differ, and at that point both files gain it together.
 *
 * The seat matters even while it is empty. `eslint.config.mjs` sends anyone who
 * reaches for a version comparison to this directory, and an empty seat is a much
 * better answer than a comparison inlined at the call site.
 */

import { type Dialect, baseDialect } from "./dialect";

/**
 * The dialect for a Viya 4 deployment at a given cadence release.
 *
 * `release` is the cadence version as the deployment reports it — `2022.11`,
 * `2025.04` — or the empty string when the generation is known but the release is
 * not. That case is real: `/deploymentData` can be unreadable for a user whose
 * permissions do not extend to it, and the answer to
 * {@link Dialect.hasBuiltInClient} is then `undefined` rather than a guess, which
 * is exactly the behaviour sign-in is written for.
 */
export function createViya4Dialect(release: string): Dialect {
  return baseDialect("viya4", { kind: "viya4", release });
}
