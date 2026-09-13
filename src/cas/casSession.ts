// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Holds the one {@link CasAdapter} the CAS browsing tree reads through, and
 * rebuilds it when the active deployment changes.
 *
 * **This module must never import `vscode`.**
 *
 * Mirrors `src/content/contentSession.ts` exactly — same reason: 8a needs no
 * session of its own (Finding 8.2), just an endpoint and a token, so the
 * cache is keyed on endpoint, not profile id, and there is no equivalent of
 * `src/data/adapter.ts`'s per-profile `LibraryAdapter` construction.
 *
 * See `contentSession.ts`'s own doc comment for why the cache is a `Map` of
 * every endpoint seen rather than a single held adapter, and why it is only
 * ever added to until {@link CasSession.clear} (sign-out) drops it all at
 * once — the identical reasoning applies here even though nothing in this
 * slice yet holds a CAS-deployment document open the way the `sasContent:`
 * filesystem provider holds a file.
 */

import { accountForEndpoint } from "../auth/identity";
import type { HttpTransport } from "../auth/transport";
import { CasAdapter } from "./adapter";
import {
  createCasClient,
  type CasClient,
  type CasClientConfig,
} from "./client";

/** The minimum an account needs for {@link accountForEndpoint}. */
export interface AccountLike {
  readonly id: string;
}

/** A resolved auth session, narrowed to the one field the token flow reads. */
export interface SessionLike {
  readonly accessToken: string;
}

/** Generic over the account type so the `vscode`-free unit tier can use the
 * bare {@link AccountLike} while `casExplorer.ts` threads
 * `vscode.AuthenticationSessionAccountInformation` straight through to
 * `getSession`. */
export interface CasSessionDeps<A extends AccountLike = AccountLike> {
  /** Builds the wire client. Defaults to {@link createCasClient}; a test
   * passes a spy to observe rebuilds. */
  createClient?: ((config: CasClientConfig) => CasClient) | undefined;
  /** Threaded into every client, so a deployment behind a private CA (slice
   * 5d-i) is browsable too. */
  transport?: HttpTransport | undefined;
  /** The accounts this provider has signed in, for the endpoint hint. */
  listAccounts: () => PromiseLike<readonly A[]>;
  /** A **silent** session lookup for the hinted account — never opens a
   * browser. `undefined` becomes a `not-authenticated` {@link CasProblem} at
   * the client and the tree's welcome content on screen. */
  getSession: (account: A | undefined) => PromiseLike<SessionLike | undefined>;
}

export class CasSession<A extends AccountLike = AccountLike> {
  private readonly adapters = new Map<string, CasAdapter>();

  constructor(private readonly deps: CasSessionDeps<A>) {}

  /** The adapter for `endpoint`, building one the first time an endpoint is
   * asked for and reusing it thereafter. `undefined` returns nothing without
   * touching the cache. */
  adapterFor(endpoint: string | undefined): CasAdapter | undefined {
    if (endpoint === undefined) return undefined;

    const cached = this.adapters.get(endpoint);
    if (cached !== undefined) return cached;

    const create = this.deps.createClient ?? createCasClient;
    const client = create({
      root: endpoint,
      ...(this.deps.transport === undefined
        ? {}
        : { transport: this.deps.transport }),
      token: async () => await this.tokenFor(endpoint),
    });
    const adapter = new CasAdapter(client);
    this.adapters.set(endpoint, adapter);
    return adapter;
  }

  /** Drops every held adapter — the sign-out path. */
  clear(): void {
    this.adapters.clear();
  }

  /** A bearer token for `endpoint`, silently. Throws when there is no
   * session; the client turns that into `not-authenticated` and the message
   * only ever reaches the log. */
  private async tokenFor(endpoint: string): Promise<string> {
    const account = accountForEndpoint(
      endpoint,
      await this.deps.listAccounts(),
    );
    const session = await this.deps.getSession(account);
    if (session === undefined) {
      throw new Error("no active SAS Viya session for browsing CAS");
    }
    return session.accessToken;
  }
}
