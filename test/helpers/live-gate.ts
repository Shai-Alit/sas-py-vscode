// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The Viya generations the extension supports. SAS 9 is explicitly not one.
 *
 * Was `"viya4" | "viya35"` until
 * [ADR-0022](../../docs/adr/0022-drop-viya-35-support.md) dropped Viya 3.5.
 */
export type Generation = "viya4";

/** A deployment a live test is permitted to talk to. */
export interface LiveTarget {
  readonly generation: Generation;
  /** Origin only, no trailing slash — e.g. `https://viya.example.com`. */
  readonly baseUrl: string;
  /**
   * A bearer token. Never log this, never put it in an assertion message, and
   * never write it to a fixture. If a live test fails, the failure message may
   * name the endpoint and the status code and nothing else.
   */
  readonly token: string;
  /** Whether this run may create, modify, or delete anything. */
  readonly allowMutation: boolean;
}

/**
 * Every variable is prefixed, and the prefix is not decoration.
 *
 * These names live in the developer's shell, not in a config file scoped to
 * this repository. A bare `ALLOW_MUTATION` exported for some other project's
 * test suite would silently open the gate that lets this one write to a real
 * deployment — which is the single most expensive mistake available here.
 */
const MUTATION_VAR = "PYTHON_ON_VIYA_ALLOW_MUTATION";

const ENV_VARS: Record<Generation, { url: string; token: string }> = {
  viya4: {
    url: "PYTHON_ON_VIYA_TEST_VIYA4_URL",
    token: "PYTHON_ON_VIYA_TEST_VIYA4_TOKEN",
  },
};

/**
 * Resolves the deployment for a generation, or `undefined` when this machine
 * is not configured to talk to one at all.
 *
 * This is gate two of three. Gate one is that only `npm run test:live` points
 * Mocha at `test/live/`, so a normal `npm test` cannot reach a real server no
 * matter what is in the environment. Gate three is {@link requireMutation}.
 *
 * Returning `undefined` when **neither** variable is set is deliberate: an
 * unconfigured machine should *skip* the live tier, not fail it. A tier that
 * fails when it is not set up gets disabled, and a disabled tier never runs
 * anywhere.
 *
 * **A half-configured pair throws instead of skipping.** Found by accident
 * during RUNBOOK P40 on 2026-08-19: with the token set and the URL unset, this
 * used to return `undefined` the same as a wholly unconfigured machine, and
 * the suite reported a skip and exited 0 — indistinguishable from a machine
 * nobody had touched, on a tier whose entire value is that it talks to a real
 * deployment. One variable present is evidence somebody meant to configure
 * this generation, so the other being absent is a misconfiguration worth
 * surfacing, not one worth skipping silently past.
 */
export function liveTarget(generation: Generation): LiveTarget | undefined {
  const names = ENV_VARS[generation];
  const rawUrl = process.env[names.url]?.trim();
  const token = process.env[names.token]?.trim();

  if (!rawUrl && !token) {
    return undefined;
  }

  if (!rawUrl || !token) {
    const presentVar = rawUrl ? names.url : names.token;
    const missingVar = rawUrl ? names.token : names.url;
    throw new Error(
      `${presentVar} is set but ${missingVar} is not. Set both to run ` +
        `${generation}'s live tier, or unset ${presentVar} to skip it — a ` +
        "half-configured pair cannot be told apart from an unconfigured " +
        "machine any other way.",
    );
  }

  const baseUrl = rawUrl.replace(/\/+$/, "");

  // A bearer token over plaintext HTTP is a credential leak, and a test
  // harness is exactly where someone would reach for `http://` to get past a
  // certificate problem. Refuse rather than skip: this is a misconfiguration
  // worth surfacing, not an absent one worth ignoring.
  if (!baseUrl.startsWith("https://")) {
    throw new Error(
      `${names.url} must be an https:// URL. A bearer token must not be sent over plaintext HTTP.`,
    );
  }

  return {
    generation,
    baseUrl,
    token,
    allowMutation: process.env[MUTATION_VAR] === "1",
  };
}

/**
 * Gate three. Call at the top of any live test that writes to a deployment.
 *
 * Separate from {@link liveTarget} because read-only and mutating access are
 * different decisions: pointing the suite at a shared deployment to read from
 * it should not also grant it permission to create objects there. Mutating
 * tests additionally owe the deployment per-run unique names and cleanup in a
 * `finally` — see CONTRIBUTING.md.
 */
export function requireMutation(target: LiveTarget): void {
  if (!target.allowMutation) {
    throw new Error(
      `This test writes to a live deployment and ${MUTATION_VAR} is not set to 1. ` +
        "Set it only against a deployment you are willing to have objects created in.",
    );
  }
}
