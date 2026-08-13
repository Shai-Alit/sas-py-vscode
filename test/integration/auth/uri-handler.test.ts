// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { AuthUriHandler, CALLBACK_PATH } from "../../../src/auth/uriHandler";
import { testLogChannel } from "../../helpers/auth-host";
import { extensionId } from "../../helpers/manifest";

/**
 * Callback dispatch, against the host's own URI parser.
 *
 * The parsing is the half that cannot be faked usefully. `vscode.Uri` is not
 * `URL` — it splits an inbound link into scheme, authority, path and query itself,
 * and the shapes it produces are the contract this handler is written against. A
 * unit test would only prove that a string I wrote matches a string I compared it
 * to.
 *
 * That the handler can actually be *registered* is proven elsewhere and for free:
 * `activate` calls `vscode.window.registerUriHandler`, so if the host refused it,
 * `extension.test.ts` would fail at activation. Registering a second handler here
 * would be testing the same call while risking a collision with the one the
 * extension already owns.
 */

describe("auth callback dispatch in a real editor", () => {
  // One channel for the suite, not one per test: see `testLogChannel`.
  const log = testLogChannel("uri handler");
  let handler: AuthUriHandler;

  beforeEach(() => {
    handler = new AuthUriHandler(log);
  });

  afterEach(() => {
    handler.dispose();
  });

  /** A callback exactly as the host would hand it to us. */
  function callback(query: string, path = CALLBACK_PATH): vscode.Uri {
    return vscode.Uri.parse(
      `${vscode.env.uriScheme}://${extensionId()}${path}?${query}`,
    );
  }

  it("hands the consumer a query the OAuth reader can parse", () => {
    // The leading "?" belongs to the URI, not to the query — that is the fact
    // `readCallback` is written around, and it is the host's to decide.
    const seen: string[] = [];
    handler.listen((query) => {
      seen.push(query);
      return true;
    });

    handler.handleUri(callback("code=abc123&state=xyz789"));

    assert.deepEqual(seen, ["code=abc123&state=xyz789"]);
    const params = new URLSearchParams(seen[0]);
    assert.equal(params.get("code"), "abc123");
    assert.equal(params.get("state"), "xyz789");
  });

  it("parses the path we match on out of a real link", () => {
    assert.equal(callback("code=abc").path, CALLBACK_PATH);
  });

  it("ignores a link on any other path", () => {
    let called = false;
    handler.listen(() => {
      called = true;
      return true;
    });

    handler.handleUri(callback("code=abc", "/something-else"));

    assert.equal(called, false, "a link we do not own reached a consumer");
  });

  it("offers a declined callback to the next consumer and stops at the first taker", () => {
    // This is the multi-window case: two attempts are outstanding and only one
    // issued the `state` in this callback. Declining must not consume it.
    const order: string[] = [];
    handler.listen(() => {
      order.push("first");
      return false;
    });
    handler.listen(() => {
      order.push("second");
      return true;
    });
    handler.listen(() => {
      order.push("third");
      return true;
    });

    handler.handleUri(callback("code=abc&state=xyz"));

    assert.deepEqual(order, ["first", "second"]);
  });

  it("survives a consumer that disposes its own registration mid-dispatch", () => {
    // Exactly what a settling sign-in does, and the reason `handleUri` iterates a
    // copy: mutating the set under its own iterator is the bug this guards.
    const order: string[] = [];
    const first: vscode.Disposable = handler.listen(() => {
      order.push("first");
      first.dispose();
      return false;
    });
    handler.listen(() => {
      order.push("second");
      return true;
    });

    handler.handleUri(callback("code=abc"));
    assert.deepEqual(order, ["first", "second"]);

    // And it really is gone for the next one.
    handler.handleUri(callback("code=def"));
    assert.deepEqual(order, ["first", "second", "second"]);
  });

  it("stops offering callbacks to a disposed registration", () => {
    let calls = 0;
    const registration = handler.listen(() => {
      calls += 1;
      return true;
    });

    handler.handleUri(callback("code=abc"));
    registration.dispose();
    handler.handleUri(callback("code=def"));

    assert.equal(calls, 1);
  });

  it("drops a callback nobody claims without throwing", () => {
    // A stale link, or one from an attempt that already timed out. It reaches a
    // localised warning in the log and stops there; a modal for this would fire
    // at people who did nothing wrong.
    handler.handleUri(callback("code=abc&state=stale"));

    handler.listen(() => false);
    handler.handleUri(callback("code=abc&state=stale"));
  });

  it("forgets every consumer when the extension shuts down", () => {
    let calls = 0;
    handler.listen(() => {
      calls += 1;
      return true;
    });

    handler.dispose();
    handler.handleUri(callback("code=abc"));

    assert.equal(calls, 0);
  });
});
