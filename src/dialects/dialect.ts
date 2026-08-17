// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Where Viya differences live, and nowhere else.
 *
 * **This module must never import `vscode`.**
 *
 * `PRODUCTION_PLAN.md` §2.1: *never branch on version inline*. The rule is
 * enforced structurally — `eslint.config.mjs` bans comparing a `version`,
 * `viyaVersion` or `generation` field, and comparing against the literal `"3.5"`,
 * everywhere in `src/` **except this directory**. That exemption is the whole
 * reason the directory exists, and it is also the reason to be careful about what
 * goes in it.
 *
 * ## The restraint clause
 *
 * A dialect owns the deployment kind, whether the built-in `vscode` OAuth client
 * exists, and the name of its contract file. **It owns nothing else, and methods
 * arrive one at a time as a probe or a defect proves a difference.**
 *
 * That is a decision, recorded in ADR-0015, not an unfinished state. A dialect
 * method with no measured difference behind it is a guess with an interface
 * around it, and it is worse than no method at all: the lint rule above only
 * helps if what it redirects people toward is a directory of real differences. A
 * layer full of speculative hooks teaches the next person that the hooks are
 * decoration.
 *
 * It is also worth knowing that this project has *never run anything against
 * Viya 3.5* — there is no 3.5 deployment available to it. Every 3.5 behaviour
 * here is documented behaviour, not observed behaviour, and
 * `src/auth/clientId.ts` carries the long-form version of that caveat.
 */

import { describeDeployment, hasBuiltInClient } from "../auth/clientId";
import type { Deployment } from "../auth/clientId";

/**
 * What we know about the deployment's version.
 *
 * Re-exported rather than redeclared. It is declared in `src/auth/clientId.ts`
 * because auth needed it first and needed it before this layer existed, and
 * moving it now would churn a module full of settled security decisions to no
 * benefit. This is its conceptual home; that is its declaration site.
 */
export type { Deployment };

/**
 * The generation a dialect speaks for.
 *
 * These strings are load-bearing beyond the type: they name the fixture
 * directories under `test/fixtures/`, and — from 2b-ii — the contract files under
 * `contracts/`.
 */
export type DialectId = "viya4" | "viya35";

/**
 * One Viya generation, bound to a particular deployment.
 *
 * Bound rather than a singleton, because "Viya 4" is not enough to answer the
 * questions asked of it — {@link Dialect.hasBuiltInClient} turns on the cadence
 * release, not merely on the generation.
 */
export interface Dialect {
  readonly id: DialectId;
  /** The deployment this instance was resolved for. */
  readonly deployment: Deployment;
  /**
   * The contract file describing the REST footprint this dialect depends on.
   *
   * A bare stem — `viya4` — resolved against `contracts/` by the checker that
   * lands in 2b-ii. Named here rather than derived from {@link id} so that the
   * day a generation needs two contracts, or two generations share one, the
   * change is in this layer and not in the checker.
   */
  readonly contract: DialectId;

  /**
   * Whether the deployment registers the built-in `vscode` OAuth client.
   *
   * `undefined` means *unknown*, which is a third answer rather than a missing
   * one: sign-in optimistically tries the built-in client when the version is
   * unknown, and only a definite `false` justifies telling a user to go and ask
   * an administrator for a client id.
   *
   * Delegates to `hasBuiltInClient` in `src/auth/clientId.ts` rather than
   * restating the comparison. The rule that produces the answer — the first
   * release to register the client — is a fact about the deployment's OAuth
   * configuration and belongs with the rest of the sign-in reasoning; what this
   * layer adds is the seat it is asked from.
   */
  hasBuiltInClient(): boolean | undefined;

  /** Human-readable, for a log line. */
  describe(): string;
}

/**
 * Builds the parts of a {@link Dialect} that are identical for every generation.
 *
 * Shared by `./viya4` and `./viya35` so that the two files contain their
 * differences and nothing else — which is what makes it obvious, when a third
 * generation arrives, exactly what a new dialect has to decide.
 */
export function baseDialect(id: DialectId, deployment: Deployment): Dialect {
  return {
    id,
    deployment,
    contract: id,
    hasBuiltInClient: () => hasBuiltInClient(deployment),
    describe: () => describeDeployment(deployment),
  };
}
