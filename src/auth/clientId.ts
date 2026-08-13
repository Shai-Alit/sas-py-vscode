// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Which OAuth client the extension signs in as — open decision 9, settled.
 *
 * **This module must never import `vscode`.**
 *
 * The rule: an empty `clientId` on the profile falls back to the built-in
 * `vscode` client, which Viya 4 2022.11 and later register themselves. Viya 3.5
 * and Viya 4 2022.10 and earlier have no such client, and on those a user with no
 * `clientId` has to be told, in those words, to ask an administrator for a client
 * id and secret — because what they would otherwise see is a generic OAuth
 * rejection that names nothing they can act on.
 *
 * See `PRODUCTION_PLAN.md` §6 decision 9 and
 * docs/adr/0008-auth-core-transport-and-security-deltas.md.
 *
 * ## The Viya 3.5 path here has never been run against Viya 3.5
 *
 * Read that literally. That 3.5 lacks a built-in `vscode` client is SAS's
 * documented behaviour for their own extension, not something this project has
 * observed: there is no Viya 3.5 deployment available to it, so the check is not
 * outstanding, it is not possible. The plan used to call it a pre-release
 * verification, which was a blocker nobody could clear.
 *
 * The exposure is bounded, and knowing its shape is what makes it acceptable: if
 * the documentation is wrong and 3.5 *does* have a built-in client, a 3.5 user is
 * told to obtain a client id they did not need. An unnecessary errand, not a
 * broken flow and not a weakened one. If a 3.5 deployment ever becomes reachable,
 * this is the first thing to point at it.
 */

import type { AuthProblem } from "./problems";

/**
 * The client id every Viya 4 2022.11+ deployment registers for itself.
 *
 * It is not SAS's to grant or withhold per-extension: it is a public client
 * created by the deployment, it carries no secret, and using it does not take
 * anything away from the SAS extension. The alternative — making every
 * administrator register a `python-on-viya` client before anyone could try this —
 * puts an IT ticket between install and first connection.
 */
export const BUILT_IN_CLIENT_ID = "vscode";

/** The first Viya 4 release that registers {@link BUILT_IN_CLIENT_ID}. */
const BUILT_IN_CLIENT_SINCE = { year: 2022, month: 11 } as const;

/**
 * What we know about the deployment's version.
 *
 * `unknown` is a first-class member rather than an omission, because version
 * detection is a Phase 2 concern and this module has to behave sensibly before it
 * exists — and has to keep behaving sensibly when it fails.
 */
export type Deployment =
  { kind: "viya4"; release: string } | { kind: "viya35" } | { kind: "unknown" };

/** The client the flow should present, once resolved. */
export interface ClientCredentials {
  clientId: string;
  /**
   * Empty for a public client. PKCE, not a secret, is what protects the
   * authorization code in that case.
   */
  clientSecret: string;
  /** True when this came from {@link BUILT_IN_CLIENT_ID} rather than the profile. */
  builtIn: boolean;
}

export type ClientResolution =
  | { ok: true; client: ClientCredentials }
  | { ok: false; reason: string; problem: AuthProblem };

/**
 * Reads a Viya 4 release stamp as a year and month.
 *
 * Viya 4 releases are `YYYY.MM` and reach us through several spellings —
 * `2022.11`, `Stable 2022.11`, `v4-stable-2022.11`, sometimes with a patch
 * suffix. Pulling the first `YYYY.MM` out of the string covers all of them, and
 * anything it cannot read is reported as unreadable rather than guessed at.
 */
function parseRelease(
  release: string,
): { year: number; month: number } | undefined {
  const match = /(\d{4})\.(\d{1,2})/.exec(release);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return undefined;
  }
  return { year, month };
}

/**
 * Does this deployment register the built-in `vscode` client?
 *
 * **`undefined` means "we cannot tell", and the caller treats that as yes.** That
 * is the deliberate choice and it is worth defending, because the conservative
 * reading points the other way.
 *
 * Refusing to try whenever the version is unreadable would mean that any failure
 * of version detection — an old build, a proxy rewriting a response, a release
 * string in a spelling nobody anticipated — demands a client id from a user whose
 * deployment would have signed them in perfectly well. That is a self-inflicted
 * outage on the common path to avoid a poor error message on the rare one.
 *
 * Attempting it and failing is cheap and, since ADR-0008 has us parsing the OAuth
 * error envelope, no longer opaque: {@link explainsMissingClient} turns the
 * deployment's own `invalid_client` into the same "ask your administrator"
 * message the version check would have produced. So the guess costs one failed
 * request, and being wrong the other way costs a user who cannot sign in at all.
 */
export function hasBuiltInClient(deployment: Deployment): boolean | undefined {
  switch (deployment.kind) {
    case "viya35":
      return false;
    case "unknown":
      return undefined;
    case "viya4": {
      const parsed = parseRelease(deployment.release);
      if (!parsed) {
        return undefined;
      }
      return (
        parsed.year > BUILT_IN_CLIENT_SINCE.year ||
        (parsed.year === BUILT_IN_CLIENT_SINCE.year &&
          parsed.month >= BUILT_IN_CLIENT_SINCE.month)
      );
    }
  }
}

/** Human-readable version, for the log line on a refusal. */
function describeDeployment(deployment: Deployment): string {
  switch (deployment.kind) {
    case "viya35":
      return "Viya 3.5";
    case "viya4":
      return `Viya 4 ${deployment.release}`;
    case "unknown":
      return "an unrecognised version";
  }
}

export interface ClientResolutionInput {
  /** `clientId` from the profile. Blank and absent mean the same thing. */
  configuredClientId?: string | undefined;
  /** The matching secret from `SecretStorage`, if the profile has one. */
  configuredClientSecret?: string | undefined;
  /** Defaults to `{ kind: "unknown" }` — see {@link hasBuiltInClient}. */
  deployment?: Deployment | undefined;
}

/**
 * Decides which client to sign in as.
 *
 * A configured id always wins, including on deployments that have a built-in
 * client: an administrator who registered a client for this extension did it for
 * a reason — a scope, an audience, an audit trail — and silently preferring the
 * built-in one would override a deliberate act of configuration.
 */
export function resolveClient(input: ClientResolutionInput): ClientResolution {
  const configured = input.configuredClientId?.trim() ?? "";
  if (configured !== "") {
    return {
      ok: true,
      client: {
        clientId: configured,
        clientSecret: input.configuredClientSecret ?? "",
        builtIn: false,
      },
    };
  }

  const deployment = input.deployment ?? { kind: "unknown" };
  if (hasBuiltInClient(deployment) === false) {
    const where = describeDeployment(deployment);
    return {
      ok: false,
      reason: `cannot sign in to ${where} without a client id`,
      problem: { code: "client-id-required", deployment: where },
    };
  }

  return {
    ok: true,
    client: { clientId: BUILT_IN_CLIENT_ID, clientSecret: "", builtIn: true },
  };
}

/**
 * Was this rejection the deployment telling us the built-in client is not there?
 *
 * The other half of the optimistic guess in {@link hasBuiltInClient}. When we fell
 * back to the built-in client without knowing the version and the deployment
 * rejected the client itself, the useful thing to say is not "invalid_client" —
 * it is the same sentence a version check would have produced up front.
 *
 * Both codes are from RFC 6749 §5.2: `invalid_client` is an unknown or
 * unauthenticated client, `unauthorized_client` a known one not permitted this
 * grant. A 3.5 deployment that has never heard of `vscode` answers with the
 * former. Deliberately narrow — a wrong password or an expired code must keep its
 * own message rather than being rewritten into advice about client registration.
 */
export function explainsMissingClient(
  problem: AuthProblem,
  client: ClientCredentials,
): boolean {
  return (
    client.builtIn &&
    problem.code === "oauth-rejected" &&
    (problem.error === "invalid_client" ||
      problem.error === "unauthorized_client")
  );
}
