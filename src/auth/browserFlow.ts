// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The browser handoff and the race that ends it.
 *
 * Everything this file does needs an extension host: open a browser, show an
 * input box, ask the host what our callback URI looks like from the outside.
 * Everything it *decides* — whether a callback is ours, whether a rejected one
 * should end the wait, what to persist — is next door in `signIn.ts`, where the
 * unit tier can reach it. When a change here needs a new `if`, the `if` almost
 * certainly belongs in `signIn.ts`.
 *
 * Structure follows: client/src/connection/rest/auth.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied.
 *
 * ## `asExternalUri` before the authorize URL, not after
 *
 * The callback URI has to be resolved through {@link vscode.env.asExternalUri}
 * *before* it is embedded in the authorize URL, because in a Codespace or a
 * remote/SSH window the URI the browser must come back to is not the one this
 * process would construct for itself — the host tunnels it. Building the
 * authorize URL from the local form and calling `asExternalUri` afterwards
 * produces something that works on a laptop and fails everywhere else, which is
 * the classic version of this bug: it passes every test anyone runs locally.
 *
 * ## Why there are two ways in
 *
 * Not every deployment can redirect back. A client registered without our
 * redirect URI will refuse the request outright, and some sites deliberately
 * register none. Those users finish sign-in on a page showing a code, and the
 * only way to get it here is to paste it. So both arms run at once and the first
 * to produce a code wins.
 *
 * **The paste arm carries no `state`.** A code typed in by hand cannot be checked
 * against the value this process issued, because nothing carried it back — so the
 * check that closes the RFC 6749 §10.12 injection on the callback arm does not
 * exist on this one. That is not a hole so much as a different trust model: the
 * user is asserting that this code came from the browser they just used. PKCE
 * still binds it, so a code lifted from somewhere else is useless without the
 * verifier that never left this process. A pasted *URL* does get checked, because
 * it brings the `state` with it. The argument this supports is narrowing the
 * paste box later — offering it only when there is no redirect URI — not skipping
 * the check on the arm where it works.
 */

import * as vscode from "vscode";

import { SignInCancelledError } from "./cancellation";
import type { Deployment } from "./clientId";
import { localiseAuthProblem } from "./messages";
import { describeAuthProblem, type AuthProblem } from "./problems";
import type { SessionStore } from "./sessionStore";
import {
  beginSignIn,
  finishSignIn,
  readCallback,
  readPastedCode,
  settlesCapture,
  type CodeCapture,
  type PendingSignIn,
} from "./signIn";
import type { TokenEndpointDeps, Tokens } from "./tokenEndpoint";
import { CALLBACK_PATH, type AuthUriHandler } from "./uriHandler";

/**
 * How many times the paste box is re-offered after an answer it could not use.
 *
 * Re-prompting is the right response to a paste that did not parse — the user
 * still has the browser open and can try again — but an unbounded loop is a
 * window that will not go away, and a way for a stubbed input box in a test to
 * spin forever. Five is enough for a genuine mistake and short of an argument.
 */
const MAX_PASTE_ATTEMPTS = 5;

export interface BrowserSignInRequest {
  /** The profile's generated `id`. Keys the stored session; never its name. */
  profileId: string;
  endpoint: string;
  /** `clientId` from the profile, if it sets one. */
  clientId?: string | undefined;
  /** The matching client secret from `SecretStorage`, if there is one. */
  clientSecret?: string | undefined;
  /** What is known about the Viya version. Defaults to unknown. */
  deployment?: Deployment | undefined;
}

/**
 * The editor-shaped things this flow needs.
 *
 * The last three are ports with real defaults, present so an integration test can
 * drive the flow without launching a browser or blocking on a modal. They are the
 * same arrangement as the transport port in `tokenEndpoint.ts`, and for the same
 * reason: the alternative is a test that cannot run unattended.
 */
export interface BrowserSignInDeps {
  handler: AuthUriHandler;
  sessions: SessionStore;
  log: vscode.LogOutputChannel;
  /** `context.extension.id` — `<publisher>.<name>`, the authority of our URIs. */
  extensionId: string;
  /** Defaults to {@link vscode.env.asExternalUri}. */
  asExternalUri?: ((uri: vscode.Uri) => Thenable<vscode.Uri>) | undefined;
  /** Defaults to {@link vscode.env.openExternal}. */
  openExternal?: ((uri: vscode.Uri) => Thenable<boolean>) | undefined;
  /** Defaults to {@link vscode.window.showInputBox}. */
  showInputBox?:
    | ((
        options: vscode.InputBoxOptions,
        token: vscode.CancellationToken,
      ) => Thenable<string | undefined>)
    | undefined;
  /** Passed through to the token exchange. */
  token?: TokenEndpointDeps | undefined;
}

/**
 * Signs in through the browser and stores the session.
 *
 * Returns the tokens on success, and `undefined` when the sign-in failed — every
 * genuine failure is reported twice before that, the English fragment to the log
 * and the localised sentence to the user, so `undefined` means "it did not work
 * and the user has already been told why".
 *
 * Throws {@link SignInCancelledError} when the user cancelled. Two channels for
 * two facts, and the alternative was considered and rejected: a result union
 * (`{ok:false, reason:"cancelled"|"reported"}`) reads better in isolation, but
 * the fact has to reach `createSession`, which must *reject* to satisfy its
 * contract with the editor. A returned reason gets converted to an exception one
 * frame later — and a returned reason is a value an intermediate frame can drop
 * by writing `if (tokens === undefined) return`, which is exactly how this defect
 * happened the first time. A thrown one cannot be dropped by inattention.
 */
export async function signInWithBrowser(
  request: BrowserSignInRequest,
  deps: BrowserSignInDeps,
): Promise<Tokens | undefined> {
  const redirectUri = await callbackUri(deps);

  const start = beginSignIn({
    endpoint: request.endpoint,
    configuredClientId: request.clientId,
    configuredClientSecret: request.clientSecret,
    deployment: request.deployment,
    redirectUri,
  });
  if (!start.ok) {
    // Refused before the browser opens. Sending someone to a login page that can
    // only end in `invalid_client` wastes their time and teaches them nothing.
    report(start.problem, deps.log);
    return undefined;
  }
  const { pending } = start;

  const openExternal =
    deps.openExternal ?? ((uri: vscode.Uri) => vscode.env.openExternal(uri));
  const opened = await openExternal(vscode.Uri.parse(pending.authorizeUrl));
  if (!opened) {
    // The paste box still opens: the user may have a browser they can drive
    // themselves, and telling them what failed is more use than giving up.
    deps.log.warn(
      vscode.l10n.t("Could not open a browser for the sign-in page."),
    );
  }

  const capture = await captureCode(pending, deps);
  if (capture.kind !== "code") {
    if (capture.kind === "problem") {
      report(capture.problem, deps.log);
      return undefined;
    }
    // `cancelled`, or an `ignored` that reached here only because the paste arm
    // ran out of attempts. Neither is an error and neither gets a dialog — which
    // is why this is thrown rather than returned as another `undefined`. The
    // caller has to reject either way, and it can only reject with the right
    // thing if the difference reaches it.
    deps.log.info(vscode.l10n.t("Sign-in was cancelled."));
    throw new SignInCancelledError();
  }

  const result = await finishSignIn(pending, capture.code, deps.token ?? {});
  if (!result.ok) {
    report(result.problem, deps.log);
    return undefined;
  }

  await deps.sessions.write(request.profileId, result.tokens);
  deps.log.info(vscode.l10n.t("Signed in to {0}.", request.endpoint));
  return result.tokens;
}

/**
 * The callback URI as the browser will see it, or `undefined` when the host
 * cannot produce one.
 *
 * `undefined` is a working configuration, not a failure: `beginSignIn` omits
 * `redirect_uri` entirely and the deployment falls back to whatever it has
 * registered, leaving the paste box as the way back. Worth degrading to rather
 * than failing, because the alternative is an environment where sign-in is
 * impossible instead of manual.
 *
 * A URI that *is* produced is an offer rather than an instruction — `beginSignIn`
 * drops it again for the built-in client, which registers only
 * `urn:ietf:wg:oauth:2.0:oob`. This function's job is to say what the editor can
 * listen on, not whether the deployment will use it.
 */
async function callbackUri(
  deps: BrowserSignInDeps,
): Promise<string | undefined> {
  const asExternalUri =
    deps.asExternalUri ?? ((uri: vscode.Uri) => vscode.env.asExternalUri(uri));
  try {
    const local = vscode.Uri.parse(
      `${vscode.env.uriScheme}://${deps.extensionId}${CALLBACK_PATH}`,
    );
    const external = await asExternalUri(local);
    // Rebuilt from components rather than returned as `toString(true)`.
    //
    // `asExternalUri` appends a `windowId` query parameter so a callback reaches
    // the window that started the sign-in. Against a real deployment on
    // 2026-08-13 the value arrived at SASLogon as
    // `…/auth-callback%3FwindowId=2` — the `?` percent-encoded while the `=`
    // beside it was not, which is what a string already carrying a literal
    // `%3F` looks like after `URLSearchParams` escapes the `%`. So
    // `toString(true)` is not returning what its name promises here.
    //
    // Concatenating the parsed parts sidesteps the question entirely: whether
    // the editor put `windowId` in the query or spelled it into the path, this
    // produces the one URL with a single unescaped `?`, and the encoding then
    // happens exactly once, in `buildAuthorizeUrl`.
    const query = external.query === "" ? "" : `?${external.query}`;
    return `${external.scheme}://${external.authority}${external.path}${query}`;
  } catch (error) {
    deps.log.warn(
      vscode.l10n.t(
        "Could not prepare a sign-in callback address, so you will have to paste the code: {0}",
        error instanceof Error ? error.message : "unknown error",
      ),
    );
    return undefined;
  }
}

/**
 * Runs both arms and resolves with whichever settles first.
 *
 * Both, even though only one can win on a given deployment: on the built-in
 * client the browser never comes back (see {@link callbackUri}) and the paste
 * box is the only route, while on a client an administrator registered with our
 * redirect URI the callback arrives on its own and racing it against an input
 * box the user never has to touch costs nothing. Deciding between them up front
 * would mean predicting the deployment's client registration, which cannot be
 * pre-flighted — the answer only arrives after the user has typed a password.
 *
 * `Promise.race` is the whole mechanism, and the loser is torn down in a
 * `finally` rather than left dangling: the URI handler subscription is disposed
 * and the input box is closed through its cancellation token.
 *
 * That token does double duty. It is also how the paste arm tells apart the two
 * meanings of `undefined` — `showInputBox` resolves with `undefined` both when
 * the user dismisses the box and when its token fires, and the second case is the
 * one where sign-in *succeeded*. Treating it as a cancellation would fail every
 * sign-in that worked.
 *
 * Asking the token is deliberate, in preference to a `let settled` flag the two
 * arms share. The flag would be a second, parallel record of something the token
 * already knows, and it is one TypeScript cannot see through: a `let` mutated
 * from the callback arm still narrows to its initial literal inside a sibling
 * closure, so every read of it lints as a condition that can never change. The
 * token answers the same question honestly and needs no suppression.
 */
async function captureCode(
  pending: PendingSignIn,
  deps: BrowserSignInDeps,
): Promise<CodeCapture> {
  const cancellation = new vscode.CancellationTokenSource();
  const callback = listenForCallback(pending, deps);

  try {
    return await Promise.race([
      callback.capture,
      readFromPasteBox(pending, deps, cancellation.token),
    ]);
  } finally {
    callback.subscription.dispose();
    // Cancelling closes the input box if the callback arm won. If the paste arm
    // won, the box is already gone and this is a no-op.
    cancellation.cancel();
    cancellation.dispose();
  }
}

/**
 * Subscribes to the URI handler and hands back the subscription alongside a
 * promise for the first callback this attempt accepts.
 *
 * Returning both is what lets the caller dispose the subscription in a `finally`
 * without reaching into a promise executor for it.
 */
function listenForCallback(
  pending: PendingSignIn,
  deps: BrowserSignInDeps,
): { capture: Promise<CodeCapture>; subscription: vscode.Disposable } {
  let deliver: ((capture: CodeCapture) => void) | undefined = undefined;
  const capture = new Promise<CodeCapture>((resolve) => {
    deliver = resolve;
  });

  const subscription = deps.handler.listen((query) => {
    const arrived = readCallback(query, pending);
    if (!settlesCapture(arrived)) {
      // Not ours, or nothing to act on. Declining leaves this attempt waiting,
      // which is the point: a forged callback must not be able to tear down a
      // sign-in that is legitimately in flight.
      deps.log.debug("a sign-in response arrived that this attempt declined");
      return false;
    }
    // The executor above runs synchronously, so `deliver` is always set by the
    // time a callback can arrive; the optional call is for the type, not for a
    // case that happens.
    deliver?.(arrived);
    return true;
  });

  return { capture, subscription };
}

/**
 * Prompts for a pasted address or code until one settles the attempt, the user
 * gives up, or the tries run out.
 */
async function readFromPasteBox(
  pending: PendingSignIn,
  deps: BrowserSignInDeps,
  token: vscode.CancellationToken,
): Promise<CodeCapture> {
  const showInputBox =
    deps.showInputBox ??
    ((options: vscode.InputBoxOptions, cancel: vscode.CancellationToken) =>
      vscode.window.showInputBox(options, cancel));

  let last: CodeCapture = { kind: "cancelled" };
  try {
    for (let attempt = 0; attempt < MAX_PASTE_ATTEMPTS; attempt += 1) {
      const typed = await showInputBox(pasteBoxOptions(attempt > 0), token);
      if (token.isCancellationRequested) {
        // The callback arm won and closed this box, so `undefined` here means
        // sign-in succeeded elsewhere rather than the user gave up. The race is
        // already decided and this value is discarded; it says what happened
        // anyway, so that stays true if it ever stops being discarded.
        return { kind: "ignored", reason: "the callback arm settled first" };
      }

      last = readPastedCode(typed, pending);
      if (settlesCapture(last)) return last;
    }
  } catch (error) {
    // A box that cannot be shown ends the attempt rather than leaving the user
    // with a sign-in that can only finish through a callback they may never get.
    deps.log.warn(
      vscode.l10n.t(
        "The sign-in prompt could not be shown: {0}",
        error instanceof Error ? error.message : "unknown error",
      ),
    );
  }
  return last;
}

function pasteBoxOptions(retry: boolean): vscode.InputBoxOptions {
  return {
    title: vscode.l10n.t("Sign in to SAS Viya"),
    prompt: retry
      ? vscode.l10n.t(
          "That did not contain a sign-in code for this window. Paste the address the browser finished on, or the code it showed.",
        )
      : vscode.l10n.t(
          "Finish signing in through the browser, then paste the code it shows — or the address it finished on — below. Some deployments return you here automatically instead, and then this box closes on its own.",
        ),
    // Deliberately not masked, unlike the client-secret prompt next door. What
    // goes here is an authorization code: single-use, valid for about a minute,
    // and bound by PKCE to a verifier that never left this process, so someone
    // reading it over a shoulder or a shared screen gains nothing they can use.
    // A user who cannot see what they pasted, by contrast, cannot fix it — and
    // this box exists precisely for the people whose sign-in already went wrong.
    password: false,
    ignoreFocusOut: true,
  };
}

function report(problem: AuthProblem, log: vscode.LogOutputChannel): void {
  log.error(vscode.l10n.t("Sign-in failed: {0}", describeAuthProblem(problem)));
  void vscode.window.showErrorMessage(localiseAuthProblem(problem));
}
