// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Viya 3.5.
 *
 * **This module must never import `vscode`.**
 *
 * Read this before adding anything: **nothing in this project has ever run
 * against a Viya 3.5 deployment.** There is not one available to it. Every claim
 * about 3.5 anywhere in this repository is documented behaviour — SAS's, or their
 * extension's — and not observed behaviour, and `src/auth/clientId.ts` carries
 * the long-form version of what that costs and why it is nevertheless acceptable.
 *
 * The practical consequence for this file: a method added here on the strength of
 * documentation is a guess, and it will look exactly like a measured fact to
 * whoever reads it next. If one has to be added before a 3.5 deployment is
 * reachable, say so in its doc comment, in those words.
 */

import { type Dialect, baseDialect } from "./dialect";

/**
 * The dialect for a Viya 3.5 deployment.
 *
 * Takes no release: 3.5 has no cadence versioning, which is itself the signal
 * `./resolve` keys on — a deployment with no `/deploymentData/cadenceVersion` is
 * likely 3.5 (§2.3).
 */
export function createViya35Dialect(): Dialect {
  return baseDialect("viya35", { kind: "viya35" });
}
