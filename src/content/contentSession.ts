// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Holds the one {@link ContentAdapter} the SAS Content tree reads through, and
 * rebuilds it when the active deployment changes.
 *
 * **This module must never import `vscode`.**
 *
 * `src/content/contentExplorer.ts` is the `vscode` shell that feeds this class
 * the active profile's endpoint and the auth events; everything with a branch
 * in it — the endpoint cache, the sign-out clear, the silent token flow — lives
 * here so the unit tier can exercise it. The same split
 * `src/run/environmentPanel.ts` and its store make, and the discipline
 * [ADR-0021](../../docs/adr/0021-result-panel-webview.md) states for
 * `src/webview/`: keep the shell branch-free, put the logic somewhere a fake
 * can reach it.
 *
 * ## Why the adapter is cached on the endpoint, not the profile
 *
 * Two profiles pointing at the same deployment are the same thing to the
 * Folders service, and {@link accountForEndpoint} (which the token flow uses)
 * is keyed on the endpoint alone — so switching between them changes nothing
 * this class would build differently. Rebuilding only when the endpoint
 * actually changes avoids discarding a working adapter, and its in-flight tree,
 * on a profile switch that does not move the deployment.
 */

import { accountForEndpoint } from "../auth/identity";
import type { HttpTransport } from "../auth/transport";
import { ContentAdapter } from "./adapter";
import {
  createContentClient,
  type ContentClient,
  type ContentClientConfig,
} from "./client";

/** The minimum an account needs for {@link accountForEndpoint}. */
export interface AccountLike {
  readonly id: string;
}

/** A resolved auth session, narrowed to the one field the token flow reads. */
export interface SessionLike {
  readonly accessToken: string;
}

/**
 * Generic over the account type so the `vscode`-free unit tier can use the
 * bare {@link AccountLike} while `contentExplorer.ts` threads
 * `vscode.AuthenticationSessionAccountInformation` straight through to
 * `getSession`.
 */
export interface ContentSessionDeps<A extends AccountLike = AccountLike> {
  /** Builds the wire client. Defaults to {@link createContentClient}; a test
   * passes a spy to observe rebuilds. */
  createClient?: ((config: ContentClientConfig) => ContentClient) | undefined;
  /** Threaded into every client, so a deployment behind a private CA (slice
   * 5d-i) is browsable. */
  transport?: HttpTransport | undefined;
  /** The accounts this provider has signed in, for the endpoint hint. */
  listAccounts: () => PromiseLike<readonly A[]>;
  /**
   * A **silent** session lookup for the hinted account — never opens a browser.
   * `undefined` means there is no session, which becomes a
   * `not-authenticated` {@link ContentProblem} at the client and the tree's
   * welcome content on screen.
   */
  getSession: (account: A | undefined) => PromiseLike<SessionLike | undefined>;
}

export class ContentSession<A extends AccountLike = AccountLike> {
  private adapter: ContentAdapter | undefined;
  private endpoint: string | undefined;

  constructor(private readonly deps: ContentSessionDeps<A>) {}

  /**
   * The adapter for `endpoint`, building one if the endpoint has changed since
   * the last call. `undefined` clears the held adapter and returns nothing —
   * the state for "no profile is active".
   */
  adapterFor(endpoint: string | undefined): ContentAdapter | undefined {
    if (endpoint === undefined) {
      this.clear();
      return undefined;
    }
    if (endpoint === this.endpoint && this.adapter !== undefined) {
      return this.adapter;
    }

    const create = this.deps.createClient ?? createContentClient;
    const client = create({
      root: endpoint,
      ...(this.deps.transport === undefined
        ? {}
        : { transport: this.deps.transport }),
      token: async () => await this.tokenFor(endpoint),
    });
    this.adapter = new ContentAdapter(client);
    this.endpoint = endpoint;
    return this.adapter;
  }

  /** Drops the held adapter — the sign-out path. */
  clear(): void {
    this.adapter = undefined;
    this.endpoint = undefined;
  }

  /**
   * A bearer token for `endpoint`, silently. Throws when there is no session;
   * the client turns that into `not-authenticated` and the message only ever
   * reaches the log.
   */
  private async tokenFor(endpoint: string): Promise<string> {
    const account = accountForEndpoint(
      endpoint,
      await this.deps.listAccounts(),
    );
    const session = await this.deps.getSession(account);
    if (session === undefined) {
      throw new Error("no active SAS Viya session for browsing SAS Content");
    }
    return session.accessToken;
  }
}
