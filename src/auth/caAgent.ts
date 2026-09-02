// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Builds a dedicated HTTPS agent that trusts a user-supplied list of CA
 * certificates, for a deployment behind a private certificate authority or one
 * that serves an incomplete chain.
 *
 * **This module must never import `vscode`.** `src/extension.ts` reads the
 * setting as `unknown` and passes it to {@link certificatePathsFrom}, then the
 * paths to {@link buildCaAgent}; the file read defaults to `node:fs` here but
 * is an injectable parameter, so the behaviour that matters — coercing a
 * malformed setting, which certificates end up trusted, and that the
 * process-global agent is left alone — is unit-testable with no editor and no
 * filesystem.
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
 * roots) **plus** the user's certificates. Two consequences follow, and both
 * are documented for the user in `docs/signing-in.md` and the setting
 * description:
 *
 * 1. VS Code stops adding the operating-system certificate store to this
 *    extension's Viya requests. `@vscode/proxy-agent`'s `createHttpPatch` gates
 *    that injection on `!originalCa` — the moment a request carries a `ca`, from
 *    an agent or otherwise, the OS store is no longer merged in. So the array
 *    has to name **every** CA the chain needs, including any corporate proxy or
 *    inspection root the deployment currently works through by way of the OS
 *    store.
 * 2. The `Agent` instance itself may not survive to open the socket. Under the
 *    default `http.proxySupport: "override"`, for a non-localhost host,
 *    `createHttpPatch` swaps in its own `PacProxyAgent` with
 *    `originalAgent: undefined` and hoists only this agent's `ca` onto the
 *    request options (`options.ca = originalCa`). `ca` is therefore always
 *    honoured; any *other* option set here — `keepAlive` below, a future proxy
 *    or socket cap — takes effect only when no patch runs (`proxySupport:
 *    "off"`, or a loopback target). Source: `microsoft/vscode-proxy-agent`
 *    `src/index.ts`.
 *
 * The default path, when the setting is empty, is untouched: no agent is
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
 *
 * ## Node built-ins
 *
 * This is the "certificate module" ADR-0003's hedge always named and its
 * 2026-08-18 amendment noted did not yet exist — `node:fs`, `node:https` and
 * `node:tls`, the same three upstream's `CAHelper.ts` used. It is the fourth
 * entry on `eslint.config.mjs`'s allow-list; see ADR-0003's 2026-09-02
 * amendment. `src/extension.ts` stays built-in-free by calling
 * {@link buildCaAgent} with no reader.
 */

import { readFileSync } from "node:fs";
import { Agent } from "node:https";
import { rootCertificates } from "node:tls";

/**
 * Coerces the raw `pythonOnViya.userProvidedCertificates` value — whatever sits
 * in `settings.json` — to a list of path strings.
 *
 * `WorkspaceConfiguration.get` does not enforce the contributed JSON schema:
 * `"type": "array"` drives the settings *editor*, not the read, and does not
 * check element types at all. A `machine`-scoped line a setup script mistyped
 * (`3`, `{}`, `"/etc/ca.pem"`, `[1, 2]`) reaches the code verbatim, and
 * `for..of` / `.trim()` on it throws. `src/extension.ts` reads this as
 * `unknown` and routes it through here — the discipline `src/profile/store.ts`
 * already follows for `connectionProfiles` — so a bad value degrades to "no
 * extra certificates" instead of throwing out of `activate()` and taking the
 * whole extension down with it.
 *
 * A non-array (a bare string included — the schema says array) yields `[]`. A
 * mixed array keeps its string elements and drops the rest. A wrong value is
 * not logged from here: an unreadable *path* is (that is the common typo), and
 * the settings editor already flags a schema mismatch on the value itself.
 */
export function certificatePathsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

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
 * @param readCertificate - Reads a path to bytes, or throws. Defaults to a
 *   synchronous `node:fs` read; a test passes a fake so it never touches the
 *   real filesystem. A throw is caught and recorded in
 *   {@link CaAgentResult.failures}, and the remaining paths are still tried.
 */
export function buildCaAgent(
  certificatePaths: readonly string[],
  readCertificate: (path: string) => Buffer = (path) => readFileSync(path),
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
  //
  // `keepAlive: true` matches Node 19+'s own `https.globalAgent` default, which
  // this agent otherwise displaces when no proxy patch runs (`proxySupport:
  // "off"`, or a loopback target) — without it the poll-heavy compute tier
  // would pay a fresh TLS handshake per request. Under the default
  // `proxySupport` this option is inert (only `ca` is carried across); see the
  // "What this agent trusts" section above.
  const agent = new Agent({
    ca: [...rootCertificates, ...certificates],
    keepAlive: true,
  });
  return { agent, failures };
}

/** Node puts the useful part of a read failure in `message` (an `ENOENT`
 * string already names the path). A non-`Error` throw is not expected from a
 * file read but is handled rather than left to surface as `[object Object]`. */
function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
