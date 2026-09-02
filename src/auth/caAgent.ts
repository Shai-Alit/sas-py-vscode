// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Builds a dedicated HTTPS agent that trusts a user-supplied list of CA
 * certificates, for a deployment behind a private certificate authority or one
 * that serves an incomplete chain.
 *
 * **This module must never import `vscode`.** The setting read and the file read
 * are the caller's (`src/extension.ts`); everything here is pure given an
 * injected reader, so the behaviour that matters — which certificates end up
 * trusted, and that the process-global agent is left alone — is unit-testable
 * with no editor and no filesystem.
 *
 * ## Why a dedicated agent and not `https.globalAgent`
 *
 * Upstream `vscode-sas-extension`'s `CAHelper.ts` does
 * `https.globalAgent.options.ca = tls.rootCertificates.concat(userCertificates)`.
 * That is process-global state in a host shared with every other installed
 * extension: it silently changes what *they* trust, and nothing in the
 * extension's own tests could ever catch it. ADR-0008 and slice 1c-ii's punch
 * list (`docs/phases/phase-1.md`) both call for the scoped version instead — a
 * fresh {@link https.Agent} passed only to this extension's own requests,
 * through the `agent` seam `src/auth/transport.ts` deliberately left free.
 *
 * ## What this agent trusts
 *
 * Node's `ca` option *replaces* the default trust store rather than adding to
 * it, so the agent is built from `tls.rootCertificates` (Node's bundled Mozilla
 * roots) **plus** the user's certificates. One consequence: VS Code's own
 * operating-system certificate injection (`http.systemCertificates`, which
 * augments the *default* agent) does not reach this one. That is acceptable
 * because this extension makes requests to exactly one origin — the user's Viya
 * deployment — and a user who has set this has named the chain that origin
 * needs. The default path, when the setting is empty, is untouched: no agent is
 * returned and every request keeps using Node's default with VS Code's
 * injection intact.
 *
 * ## What is deliberately not validated
 *
 * A path that cannot be read is reported (see {@link CaAgentResult.failures}) —
 * upstream `console.log`s it inside a `catch`, which fails two of the plan's §5
 * gates on arrival. A path that reads but is not valid PEM is passed to the
 * agent as-is: `tls` ignores an unparseable entry rather than throwing, and a
 * genuine trust failure then surfaces at the handshake as the
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE` family, which `transport.ts` already
 * prefixes onto its error. Parsing PEM to pre-empt that is out of scope here.
 */

import { Agent } from "node:https";
import { rootCertificates } from "node:tls";

/** One configured path that could not be read. */
export interface CaCertificateFailure {
  /** The path exactly as it appeared in the setting. */
  readonly path: string;
  /** The reason it could not be read — Node's own error message, e.g. an
   * `ENOENT` string that already names the path. Not localised: it is a
   * diagnostic quoted verbatim, the same treatment `transport.ts` gives a
   * transport error's `code`. */
  readonly reason: string;
}

export interface CaAgentResult {
  /**
   * The agent to hand to {@link createNodeHttpTransport}, or `undefined` when
   * no certificate was successfully read — either because the setting is empty
   * or because every path in it failed. `undefined` means "change nothing":
   * the caller keeps the default transport.
   */
  readonly agent: Agent | undefined;
  /** Every path that was configured but could not be read. The caller logs
   * these; a run still proceeds on whatever did load. */
  readonly failures: readonly CaCertificateFailure[];
}

/**
 * Reads each configured certificate path and, if any could be read, returns a
 * dedicated {@link https.Agent} that trusts them alongside Node's bundled
 * roots.
 *
 * @param certificatePaths - `pythonOnViya.userProvidedCertificates`, verbatim.
 *   Blank and whitespace-only entries are skipped without being reported as
 *   failures; a repeated path is read once.
 * @param readCertificate - Reads a path to bytes, or throws. `src/extension.ts`
 *   passes `readFileSync`; a test passes a fake. A throw is caught and recorded
 *   in {@link CaAgentResult.failures}, and the remaining paths are still tried.
 */
export function buildCaAgent(
  certificatePaths: readonly string[],
  readCertificate: (path: string) => Buffer,
): CaAgentResult {
  const failures: CaCertificateFailure[] = [];
  const certificates: Buffer[] = [];
  const seen = new Set<string>();

  for (const rawPath of certificatePaths) {
    const path = rawPath.trim();
    if (path === "" || seen.has(path)) continue;
    seen.add(path);
    try {
      certificates.push(readCertificate(path));
    } catch (error) {
      failures.push({ path, reason: reasonFor(error) });
    }
  }

  if (certificates.length === 0) {
    return { agent: undefined, failures };
  }

  // `ca` replaces the default trust store, so the bundled roots have to be
  // carried across explicitly or ordinary TLS would stop verifying. See this
  // module's doc comment.
  const agent = new Agent({ ca: [...rootCertificates, ...certificates] });
  return { agent, failures };
}

/** Node puts the useful part of a read failure in `message` (an `ENOENT`
 * string already names the path). A non-`Error` throw is not expected from a
 * file read but is handled rather than left to surface as `[object Object]`. */
function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
