// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Which OAuth client the extension signs in as — open decision 9, settled.
 *
 * **This module must never import `vscode`.**
 *
 * The rule: an empty `clientId` on the profile falls back to the built-in
 * `vscode` client, which Viya 4 2022.11 and later register themselves. Viya 4
 * 2022.10 and earlier has no such client, and on that a user with no `clientId`
 * has to be told, in those words, to ask an administrator for a client id and
 * secret — because what they would otherwise see is a generic OAuth rejection
 * that names nothing they can act on.
 *
 * See `PRODUCTION_PLAN.md` §6 decision 9 and
 * docs/adr/0008-auth-core-transport-and-security-deltas.md.
 *
 * ## Confirmed on Viya 4, 2026-08-13, with one thing attached
 *
 * The built-in client is now observed rather than documented. An unauthenticated
 * `GET /SASLogon/oauth/authorize` with `client_id=vscode` redirects to the login
 * page; the same request with an invented client id answers **500**. So the
 * client exists — and note the shape of that failure, because it is the reason
 * {@link explainsMissingClient} parses the *token* leg: the authorize leg
 * produces a server error, not a readable OAuth envelope, and nothing should be
 * written that expects one from it.
 *
 * What came with it: this client registers `urn:ietf:wg:oauth:2.0:oob` and **no
 * custom-scheme redirect at all**, so a sign-in that uses it can only come back
 * through the paste box. `builtIn` on {@link ClientCredentials} is what carries
 * that; `beginSignIn` reads it to decide whether a `redirect_uri` is sent. The
 * flag was already here to explain an `invalid_client`, and it now answers a
 * second question — which is why it is a fact about the client rather than a
 * detail of one error path.
 *
 * ## Viya 3.5 removed, 2026-09-03
 *
 * This module used to carry a `viya35` arm on {@link Deployment}, answering
 * `false` unconditionally — SAS's documented behaviour for their own extension,
 * never observed here, because no Viya 3.5 deployment was ever reachable to check
 * it against. [ADR-0022](../../docs/adr/0022-drop-viya-35-support.md) drops
 * architectural 3.5 support for exactly that reason; `Deployment` is now
 * `viya4 | unknown`.
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
  { kind: "viya4"; release: string } | { kind: "unknown" };

/** The client the flow should present, once resolved. */
export interface ClientCredentials {
  clientId: string;
  /**
   * Empty for a public client. PKCE, not a secret, is what protects the
   * authorization code in that case.
   */
  clientSecret: string;
  /**
   * True when this came from {@link BUILT_IN_CLIENT_ID} rather than the profile.
   *
   * Two callers read it: `explainsMissingClient` here, and `beginSignIn`, which
   * sends no `redirect_uri` when it is set because the built-in client is
   * registered for out-of-band code display only.
   */
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

/**
 * Human-readable version, for the log line on a refusal.
 *
 * Exported since slice 1b-ii, and the reason is worth recording because it
 * reverses a note that used to sit here. That note said the `unknown` arm was
 * unreachable — `resolveClient` only calls this after `hasBuiltInClient` returned
 * an explicit `false`, which `unknown` never does — and would stay uncovered
 * forever. That was true of the only caller at the time. It is not true now:
 * `finishSignIn` calls this on precisely the opposite path, where the version was
 * unknown, the built-in client was the optimistic guess, and the deployment
 * rejected it. The arm exists for that case, and now something reaches it.
 */
export function describeDeployment(deployment: Deployment): string {
  switch (deployment.kind) {
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
 * grant. A Viya 4 release before 2022.11, with no registered `vscode` client,
 * answers with the former. Deliberately narrow — a wrong password or an expired
 * code must keep its own message rather than being rewritten into advice about
 * client registration.
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
