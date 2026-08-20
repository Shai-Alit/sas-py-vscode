// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  signInWithBrowser,
  type BrowserSignInDeps,
  type BrowserSignInRequest,
} from "../../../src/auth/browserFlow";
import { isSignInCancelled } from "../../../src/auth/cancellation";
import { SessionStore } from "../../../src/auth/sessionStore";
import { sessionSecretKey } from "../../../src/auth/signIn";
import type { HttpTransport } from "../../../src/auth/transport";
import { AuthUriHandler, CALLBACK_PATH } from "../../../src/auth/uriHandler";
import { delay, memorySecrets, testLogChannel } from "../../helpers/auth-host";
import { extensionId } from "../../helpers/manifest";

/**
 * The race, driven end to end inside a real editor.
 *
 * Three of the four ports are stubbed and one is not. `openExternal` and
 * `showInputBox` have to be — a test that opens a browser or blocks on a modal is
 * a test nobody can run unattended — and the transport is stubbed because the
 * exchange itself is specified against a mock Viya in the unit tier. What is left
 * real is `vscode.env.asExternalUri`, the host's cancellation tokens, and the URI
 * handler, which between them are the whole reason this file exists.
 *
 * The assertions worth reading twice are the two that are about *not* settling: a
 * callback carrying the wrong `state` must leave a sign-in in flight, and an input
 * box closed by its own cancellation token must not be read as the user giving
 * up. The second is the regression that a shared `settled` flag used to guard, and
 * that `readFromPasteBox` now answers by asking the token.
 */

/** Not credentials: shapes that look like them, so the tests can follow them. */
const FAKE_ACCESS = "access-token-placeholder";
const FAKE_REFRESH = "refresh-token-placeholder";

const PROFILE_ID = "browser-flow-integration";

const request: BrowserSignInRequest = {
  profileId: PROFILE_ID,
  // Never contacted: the transport below answers every request.
  endpoint: "https://viya.example.com",
  clientId: "integration-client",
  clientSecret: "",
};

interface Harness {
  deps: BrowserSignInDeps;
  handler: AuthUriHandler;
  secrets: ReturnType<typeof memorySecrets>;
  /** Answers for the paste box, consumed in order. `undefined` is a dismissal. */
  answers: (string | undefined)[];
  /** Every set of options the paste box was opened with. */
  prompts: vscode.InputBoxOptions[];
  /** Every token request the flow made, as parsed form bodies. */
  exchanges: URLSearchParams[];
  /** The URL the browser was sent to, once it has been. */
  authorizeUrl(): Promise<URL>;
  /**
   * Resolves once the paste box is open — which is also the only observable
   * proof that the callback arm is listening, since `captureCode` subscribes to
   * the URI handler before it opens the box. Dispatching a callback earlier than
   * this would deliver it to nobody.
   */
  boxIsOpen(): Promise<void>;
  dispose(): void;
}

function harness(
  options: { openExternal?: boolean; refuseExchange?: boolean } = {},
): Harness {
  const log = testLogChannel("browser flow");
  const handler = new AuthUriHandler(log);
  const secrets = memorySecrets();
  const answers: (string | undefined)[] = [];
  const prompts: vscode.InputBoxOptions[] = [];
  const exchanges: URLSearchParams[] = [];
  let opened: URL | undefined = undefined;

  const transport: HttpTransport = (_url, init) => {
    // `TransportRequest.body` widened to `string | Uint8Array` in slice 3-pre
    // for the submission-fidelity corpus's fileref upload; the token endpoint
    // this harness stands in for only ever sends a form-encoded string, so the
    // `Uint8Array` arm has no path through this flow at all. `assert.equal` is
    // not an assertion signature in Node's types — this `if` is what narrows.
    if (typeof init.body !== "string") {
      throw new Error("the token exchange sent a non-string body");
    }
    exchanges.push(new URLSearchParams(init.body));
    if (options.refuseExchange === true) {
      // What a deployment that will not honour the code looks like from here.
      return Promise.resolve({
        ok: false,
        status: 400,
        headers: {},
        text: () => Promise.resolve(JSON.stringify({ error: "invalid_grant" })),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: {},
      text: () =>
        Promise.resolve(
          JSON.stringify({
            access_token: FAKE_ACCESS,
            refresh_token: FAKE_REFRESH,
            token_type: "bearer",
            expires_in: 3600,
          }),
        ),
    });
  };

  return {
    handler,
    secrets,
    answers,
    prompts,
    exchanges,
    async authorizeUrl(): Promise<URL> {
      // The flow opens the browser before it waits for anything, so this is a
      // handful of ticks at most. The loop is here because "before it waits" is
      // several awaits deep, not because it is slow.
      for (let waited = 0; waited < 200; waited += 1) {
        if (opened !== undefined) return opened;
        await delay(5);
      }
      throw new Error("the flow never opened a browser");
    },
    async boxIsOpen(): Promise<void> {
      for (let waited = 0; waited < 200; waited += 1) {
        if (prompts.length > 0) return;
        await delay(5);
      }
      throw new Error("the flow never opened the paste box");
    },
    dispose(): void {
      // The log channel is deliberately not disposed; see `testLogChannel`.
      handler.dispose();
      secrets.dispose();
    },
    deps: {
      handler,
      sessions: new SessionStore(secrets, log),
      log,
      extensionId: extensionId(),
      openExternal: (uri: vscode.Uri) => {
        opened = new URL(uri.toString(true));
        return Promise.resolve(options.openExternal ?? true);
      },
      showInputBox: async (
        boxOptions: vscode.InputBoxOptions,
        token: vscode.CancellationToken,
      ): Promise<string | undefined> => {
        prompts.push(boxOptions);
        // Holds open until the test answers or the flow closes it, which is what
        // a modal waiting on a human does.
        while (answers.length === 0) {
          if (token.isCancellationRequested) return undefined;
          await delay(5);
        }
        return answers.shift();
      },
      token: { transport },
    },
  };
}

/** A callback as the host would deliver it. */
function callback(query: string): vscode.Uri {
  return vscode.Uri.parse(
    `${vscode.env.uriScheme}://${extensionId()}${CALLBACK_PATH}?${query}`,
  );
}

describe("browser sign-in", () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  afterEach(() => {
    h.dispose();
  });

  it("finishes on the callback and stores only the refresh token", async () => {
    const signedIn = signInWithBrowser(request, h.deps);
    const authorize = await h.authorizeUrl();
    const state = authorize.searchParams.get("state");
    assert.ok(state, "the authorize URL carried no state to match on");

    await h.boxIsOpen();
    h.handler.handleUri(callback(`code=granted-code&state=${state}`));
    const tokens = await signedIn;

    assert.ok(tokens, "a valid callback did not produce tokens");
    assert.equal(tokens.accessToken, FAKE_ACCESS);

    const exchange = h.exchanges[0];
    assert.ok(exchange);
    assert.equal(exchange.get("grant_type"), "authorization_code");
    assert.equal(exchange.get("code"), "granted-code");
    assert.ok(exchange.get("code_verifier"), "the exchange sent no verifier");

    const stored = h.secrets.entries.get(sessionSecretKey(PROFILE_ID)) ?? "";
    assert.ok(stored.includes(FAKE_REFRESH));
    assert.ok(!stored.includes(FAKE_ACCESS));
  });

  it("does not mistake the input box it closed for a user who gave up", async () => {
    // The paste box is open the whole time the callback arm is waiting, and the
    // flow closes it by firing its cancellation token. `showInputBox` resolves
    // `undefined` for that exactly as it does for a dismissal, so a flow that
    // cannot tell them apart fails every sign-in that worked.
    const signedIn = signInWithBrowser(request, h.deps);
    const authorize = await h.authorizeUrl();
    const state = authorize.searchParams.get("state");
    assert.ok(state);

    await h.boxIsOpen();
    h.handler.handleUri(callback(`code=granted-code&state=${state}`));

    assert.ok(await signedIn);
    assert.equal(h.prompts.length, 1, "the paste box was never opened");
  });

  it("finishes on a pasted code when no callback ever arrives", async () => {
    // The deployment with no redirect URI registered: there is no callback to
    // wait for, and this arm is the only way in.
    h.answers.push("pasted-code");

    const tokens = await signInWithBrowser(request, h.deps);

    assert.ok(tokens);
    assert.equal(h.exchanges[0]?.get("code"), "pasted-code");
  });

  it("re-offers the box, differently worded, after an answer it cannot use", async () => {
    h.answers.push("?nothing=here", "second-code");

    const tokens = await signInWithBrowser(request, h.deps);

    assert.ok(tokens);
    assert.equal(h.exchanges[0]?.get("code"), "second-code");
    assert.equal(h.prompts.length, 2);
    assert.notEqual(
      h.prompts[0]?.prompt,
      h.prompts[1]?.prompt,
      "the second prompt did not say that the first answer was unusable",
    );
  });

  it("never masks the paste box", async () => {
    // What goes in it is a URL from the address bar, not a password. Masking it
    // would stop the user seeing that they pasted the wrong thing, which is the
    // mistake this box exists to recover from.
    h.answers.push("pasted-code");
    await signInWithBrowser(request, h.deps);

    assert.equal(h.prompts[0]?.password, false);
  });

  it("treats a dismissed box as a cancellation and says nothing", async () => {
    // Thrown rather than returned as another `undefined`, because `undefined`
    // already means "it failed and the user has been told why" — and the caller
    // has to reject either way, so the only question is whether it rejects with
    // something the command can recognise and swallow.
    h.answers.push(undefined);

    await assert.rejects(
      signInWithBrowser(request, h.deps),
      (error: unknown) => isSignInCancelled(error),
      "a dismissed box did not read as a cancellation",
    );

    assert.equal(h.exchanges.length, 0, "a cancelled sign-in exchanged a code");
    assert.equal(h.secrets.entries.size, 0);
  });

  it("does not read a refused exchange as a cancellation", async () => {
    // The other half of the same distinction, and the one that would be quiet if
    // it went wrong: a deployment that refuses the code has failed, and a failure
    // swallowed as a cancellation is a command that appears to do nothing at all.
    const refusing = harness({ refuseExchange: true });
    try {
      refusing.answers.push("pasted-code");

      const tokens = await signInWithBrowser(request, refusing.deps);

      assert.equal(tokens, undefined, "a refused exchange produced tokens");
      assert.equal(refusing.secrets.entries.size, 0);
    } finally {
      refusing.dispose();
    }
  });

  it("lets a stale or forged callback pass without ending the attempt", async () => {
    // RFC 6749 §10.12. If a wrong `state` could tear this down, anyone able to
    // send a link could break sign-in for the person who opens it.
    const signedIn = signInWithBrowser(request, h.deps);
    await h.authorizeUrl();
    await h.boxIsOpen();

    h.handler.handleUri(
      callback("code=forged-code&state=not-the-issued-state"),
    );

    // Dispatch is synchronous, so a settling callback would have started the
    // exchange by now. This asserts a negative, hence the wait.
    await delay(50);
    assert.equal(h.exchanges.length, 0, "a forged callback was acted on");

    h.answers.push("the-real-code");
    const tokens = await signedIn;

    assert.ok(tokens, "the attempt did not survive a forged callback");
    assert.equal(h.exchanges[0]?.get("code"), "the-real-code");
  });

  it("asks the host what the callback address looks like from outside", async () => {
    // `asExternalUri` is the real one here. On a desktop host it is the identity,
    // and the assertion is about what we asked it for; in a Codespace or over
    // remote SSH the host rewrites it, and building the authorize URL before this
    // resolves is the classic bug that passes every test run on a laptop.
    const signedIn = signInWithBrowser(request, h.deps);
    const authorize = await h.authorizeUrl();

    const redirect = authorize.searchParams.get("redirect_uri");
    assert.ok(redirect, "the authorize URL carried no redirect_uri");

    if (vscode.env.remoteName === undefined) {
      const parsed = vscode.Uri.parse(redirect);
      assert.equal(parsed.scheme, vscode.env.uriScheme);
      assert.equal(parsed.authority, extensionId());
      assert.equal(parsed.path, CALLBACK_PATH);
    } else {
      assert.ok(redirect.includes(CALLBACK_PATH), redirect);
    }

    // Ends the attempt so the test does not leave a flow in flight. Dismissing
    // the box is a cancellation, so this rejects — awaiting it plainly would
    // fail the test on the way out.
    h.answers.push(undefined);
    await assert.rejects(signedIn);
  });

  it("asks the host anyway on the built-in client, and sends nothing", async () => {
    // The real deployment's shape, and the one this whole arrangement failed
    // against on 2026-08-14: with no `clientId` on the profile the flow uses the
    // built-in `vscode` client, which registers `urn:ietf:wg:oauth:2.0:oob` and
    // no `vscode://` address, so sending one is rejected after the password.
    // `asExternalUri` is still called — the shell's job is to say what the editor
    // can listen on, not to decide whether the deployment will use it — and the
    // paste box is the only arm that can win.
    const builtIn: BrowserSignInRequest = {
      profileId: PROFILE_ID,
      endpoint: "https://viya.example.com",
    };
    h.answers.push("pasted-code");

    const tokens = await signInWithBrowser(builtIn, h.deps);
    const authorize = await h.authorizeUrl();

    assert.ok(tokens, "the built-in client could not finish through the box");
    assert.equal(authorize.searchParams.get("redirect_uri"), null);
    assert.equal(authorize.searchParams.get("client_id"), "vscode");
    assert.equal(h.exchanges[0]?.get("redirect_uri"), null);
  });

  it("still offers the paste box when no browser could be opened", async () => {
    // A machine with no browser handler is not a machine where sign-in has to
    // fail: the user can open the URL themselves and paste what comes back.
    const withoutBrowser = harness({ openExternal: false });
    try {
      withoutBrowser.answers.push("pasted-code");
      const tokens = await signInWithBrowser(request, withoutBrowser.deps);

      assert.ok(tokens);
      assert.equal(withoutBrowser.prompts.length, 1);
    } finally {
      withoutBrowser.dispose();
    }
  });
});
