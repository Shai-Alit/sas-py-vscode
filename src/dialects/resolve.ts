// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Choosing a dialect, and being able to say why.
 *
 * **This module must never import `vscode`.**
 *
 * Two jobs, kept apart on purpose. {@link deploymentFromSignal} turns what
 * stage-1 probing *observed* into what we claim to *know*; {@link resolveDialect}
 * turns what we know into which dialect speaks for it. Splitting them means the
 * probe (2b-ii) can be rewritten without touching the choice, and the choice can
 * be unit-tested without a probe.
 *
 * Both are deliberately **fail-soft** (§2.3): an inconclusive answer picks Viya 4
 * and says so, rather than blocking a user who is very probably on Viya 4. The
 * reason string is what keeps that from being silent — it is the difference
 * between degrading and guessing.
 */

import {
  type Deployment,
  type Dialect,
  type DialectId,
  baseDialect,
} from "./dialect";
import { createViya35Dialect } from "./viya35";
import { createViya4Dialect } from "./viya4";

/** A dialect, and the sentence explaining why it was chosen. */
export interface DialectResolution {
  readonly dialect: Dialect;
  /**
   * Why this dialect, in a form fit for the output channel.
   *
   * Lower-case, no trailing full stop, matching the `describe*Problem` functions
   * elsewhere. Never omitted: a resolution that cannot say why it chose is the
   * failure mode this field exists to prevent, because the wrong dialect chosen
   * silently presents as a dozen unrelated bugs.
   */
  readonly reason: string;
  /**
   * Whether the deployment's generation was actually determined.
   *
   * `false` means Viya 4 was assumed. Callers that must not act on a guess — a
   * contract check, a bug report — read this; callers that just need to talk to
   * the deployment ignore it and get the sane default.
   */
  readonly certain: boolean;
}

/**
 * What stage-1 probing found at `/deploymentData/cadenceVersion`.
 *
 * Three outcomes, and the third is why this is a union rather than
 * `string | undefined`. "The deployment answered, and it has no cadence version"
 * means Viya 3.5. "We could not ask" means we know nothing, and it has to stay a
 * separate answer, because collapsing the two is how a network problem turns
 * into a confident, wrong claim of Viya 3.5.
 *
 * **What "could not ask" is, concretely.** An earlier draft of this comment said
 * the signed-in user might lack permission to read the endpoint. Finding 41
 * measured that and it is not so: on the deployment probed, the cadence resource
 * answers `200` with **no `Authorization` header at all**, and with a deliberately
 * malformed one. There is no permission there to lack. The real hazard is finding
 * 42 — a request that never reaches Viya is answered by whatever *is* in the path,
 * and an ingress answering for an absent service returns a bodyless `404` with no
 * media type. A corporate proxy, a VPN portal or a mistyped host produces
 * something in the same family. Read as "the endpoint is not there", any of them
 * would name the generation on the deployment's behalf.
 *
 * One deployment does not prove every Viya 4 leaves the endpoint open, so
 * `probeCadence` in `./probe` sends the token regardless; a deployment that *did*
 * gate it would otherwise answer `401` and be read as Viya 3.5.
 */
export type CadenceSignal =
  | {
      kind: "cadence";
      version: string;
      /**
       * `cadenceDisplayName`, when the deployment sent one.
       *
       * "Long-Term Support 2026.03" — the release *and* the support track, where
       * {@link CadenceSignal.version} alone is half of it (finding 40). It exists
       * for the output channel and for nothing else: {@link deploymentFromSignal}
       * drops it, because a support track is not a thing to branch on and putting
       * it on `Deployment` would invite exactly that.
       */
      display?: string | undefined;
    }
  | { kind: "absent" }
  | { kind: "unreadable"; detail: string };

/**
 * Classifies a stage-1 signal into what we are willing to claim.
 *
 * The provenance of the signal — which endpoint answered, with what status — is
 * the probe's to log. This function only decides what the answer means.
 */
export function deploymentFromSignal(signal: CadenceSignal): Deployment {
  switch (signal.kind) {
    case "cadence":
      return { kind: "viya4", release: signal.version.trim() };
    case "absent":
      // §2.3: a deployment with no cadence version is Viya 3.5. The endpoint is
      // a Viya 4 addition, so its considered absence is itself the version
      // signal — which is as close to a version number as 3.5 offers.
      return { kind: "viya35" };
    case "unreadable":
      return { kind: "unknown" };
  }
}

/**
 * Picks the dialect for a deployment.
 *
 * The `unknown` arm returns the **Viya 4 dialect bound to an `unknown`
 * deployment**, and that pairing is intentional rather than an inconsistency to
 * be tidied away. It says the two true things at once: we will speak Viya 4 to
 * this deployment, and we do not know what it is. Anything downstream that turns
 * on the version — `hasBuiltInClient` most of all — then keeps answering
 * "unknown" instead of inheriting a confidence nobody earned.
 */
export function resolveDialect(deployment: Deployment): DialectResolution {
  switch (deployment.kind) {
    case "viya4":
      return {
        dialect: createViya4Dialect(deployment.release),
        reason:
          deployment.release === ""
            ? "the deployment is Viya 4 but did not report a cadence release"
            : `the deployment reports Viya 4 ${deployment.release}`,
        certain: true,
      };
    case "viya35":
      return {
        dialect: createViya35Dialect(),
        reason: "the deployment is Viya 3.5",
        certain: true,
      };
    case "unknown":
      return {
        dialect: baseDialect("viya4", deployment),
        reason:
          "the deployment version could not be determined, so the Viya 4 dialect was assumed",
        certain: false,
      };
  }
}

/**
 * The one table that turns a written generation into a {@link DialectId}.
 *
 * Several things name a generation in text and none of them agree on spelling: a
 * profile setting a user typed, the `generation` field of a contract file, a
 * fixture directory, a probe's answer. Every one of those would otherwise be a
 * small string comparison somewhere in `src/` — which is precisely what
 * `eslint.config.mjs` forbids outside this directory, and forbids because those
 * comparisons are individually reasonable and collectively unmaintainable.
 *
 * Keys are already normalised by {@link normaliseAlias}, so the table holds no
 * case or punctuation variants.
 */
const ALIASES: ReadonlyMap<string, DialectId> = new Map<string, DialectId>([
  ["viya4", "viya4"],
  ["v4", "viya4"],
  ["4", "viya4"],
  ["viya35", "viya35"],
  ["viya3.5", "viya35"],
  ["v3.5", "viya35"],
  ["3.5", "viya35"],
  ["35", "viya35"],
]);

/**
 * A cadence release, as Viya 4 writes it: `2022.11`, `2025.04`.
 *
 * Anchored, because a substring match would accept a date. Viya 3.5 has no
 * cadence versioning at all, so a string of this shape is by itself a statement
 * of generation.
 */
const CADENCE = /^\d{4}\.\d{2}$/;

/**
 * Lower-cases and strips the separators people vary on.
 *
 * `Viya 4`, `viya-4` and `VIYA_4` all become `viya4`. Dots survive, because
 * `3.5` needs one and a cadence version is nothing without them.
 */
export function normaliseAlias(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/**
 * Resolves a written generation, or `undefined` if it names nothing we know.
 *
 * `undefined` is the honest answer for an unrecognised string and callers are
 * expected to fall back through {@link resolveDialect} with an `unknown`
 * deployment — guessing here would put the guess in the one place that cannot
 * log a reason for it.
 */
export function resolveDialectId(alias: string): DialectId | undefined {
  const normalised = normaliseAlias(alias);
  const known = ALIASES.get(normalised);
  if (known !== undefined) return known;
  // A cadence release names Viya 4 without saying so, and it is what
  // `/deploymentData` actually returns — so the table would have to grow a row
  // per quarter, forever, to cover what one anchored pattern covers.
  return CADENCE.test(normalised) ? "viya4" : undefined;
}
