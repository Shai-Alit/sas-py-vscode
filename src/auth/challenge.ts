// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Reading the `WWW-Authenticate` challenge on a 401.
 *
 * **This module must never import `vscode`.**
 *
 * ## Why this exists at all
 *
 * Probe finding 9 in `PROBE-FINDINGS.md`, against a live Viya 4: a request
 * carrying a dead token comes back as **401 with a zero-byte body**. Not an error
 * envelope, not a JSON `{error}` like the token endpoint sends — nothing. The
 * whole diagnosis is in one response header:
 *
 * ```
 * www-authenticate: Bearer error="invalid_token",
 *   error_description="Provided token isn't active",
 *   error_uri="https://tools.ietf.org/html/rfc6750#section-3.1"
 * ```
 *
 * With no credentials at all it degrades to a bare `www-authenticate: Bearer`.
 * That difference is worth reading precisely: one means the session expired and
 * the user should sign in again, the other means nothing was sent, which is a
 * bug on our side rather than something to ask the user to fix. A caller reading
 * only the status code cannot tell them apart and has to write one message
 * covering both, which is how "request failed" ends up in front of a user whose
 * session simply timed out.
 *
 * ## What is deliberately not implemented
 *
 * RFC 7235 §4.1 permits several challenges in one header, and its grammar is
 * genuinely ambiguous — a bare `token68` credential and an unquoted `auth-param`
 * are not distinguishable without knowing the scheme. This parser handles the
 * shape that grammar actually produces in practice: comma-separated segments,
 * a scheme name introducing the parameters that follow it. It reads the `Bearer`
 * challenge and ignores any other, which is all this project authenticates with.
 *
 * Nothing here is a security decision. A forged `WWW-Authenticate` can change
 * which message a user reads; it cannot make an unauthenticated response look
 * authenticated, because the caller has already seen the status code.
 */

/** The parsed `Bearer` challenge from a `WWW-Authenticate` header. */
export interface BearerChallenge {
  /**
   * The challenge parameters, names lower-cased, quotes removed.
   *
   * Empty for a bare `Bearer`, which RFC 6750 §3 says is what a server sends
   * when the request carried no credentials at all. Empty and absent therefore
   * mean different things and {@link parseBearerChallenge} keeps them apart:
   * `undefined` is "no Bearer challenge here", `{}` is "a challenge with nothing
   * to say".
   */
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Characters RFC 9110 §5.6.2 allows in a `token`, which is what both a scheme
 * name and a parameter name are. The hyphen is last so it is a literal rather
 * than a range.
 */
const TOKEN_CHARS = "A-Za-z0-9!#$%&'*+.^_`|~-";
const SCHEME_ONLY = new RegExp(`^[${TOKEN_CHARS}]+$`);
const SCHEME_THEN_PARAM = new RegExp(`^([${TOKEN_CHARS}]+)[ \\t]+(.+)$`);

/**
 * The `Bearer` challenge in a `WWW-Authenticate` header, or `undefined` when
 * there is not one.
 *
 * Case-insensitive on the scheme name, because RFC 9110 §11.1 says the scheme is
 * case-insensitive and servers have sent every casing of it.
 */
export function parseBearerChallenge(
  header: string | undefined,
): BearerChallenge | undefined {
  if (header === undefined || header.trim() === "") {
    return undefined;
  }

  const params: Record<string, string> = {};
  let inBearer = false;
  let found = false;

  for (const segment of splitOutsideQuotes(header)) {
    const text = segment.trim();
    if (text === "") continue;

    // A segment that is nothing but a token is a scheme with no parameters —
    // the bare `Bearer` case, and also how another scheme ends its own list.
    if (SCHEME_ONLY.test(text)) {
      inBearer = isBearer(text);
      found ||= inBearer;
      continue;
    }

    // `Bearer error="invalid_token"` — a scheme and its first parameter arrive
    // in the same comma-separated segment, separated by whitespace.
    const introduced = SCHEME_THEN_PARAM.exec(text);
    const scheme = introduced?.[1];
    const firstParam = introduced?.[2];
    if (scheme !== undefined && firstParam !== undefined) {
      inBearer = isBearer(scheme);
      found ||= inBearer;
      if (inBearer) {
        // A no-op when what follows the scheme is not a `name=value` pair. That
        // is the point: `Bearer <junk>` is still a Bearer challenge, and
        // reporting "no challenge" for it would tell the user nothing was sent
        // when something was and the server garbled its reply.
        addParam(params, firstParam);
      }
      continue;
    }

    // Anything else is a continuation parameter belonging to whichever scheme
    // was named last.
    if (inBearer) {
      addParam(params, text);
    }
  }

  return found ? { params } : undefined;
}

function isBearer(scheme: string): boolean {
  return scheme.toLowerCase() === "bearer";
}

/**
 * Splits on commas that are not inside a quoted string.
 *
 * A naive `split(",")` would tear `error_description="Not active, sign in again"`
 * in half, and the resulting fragment would then parse as a parameter with no
 * name. Server-authored description text containing a comma is ordinary.
 */
function splitOutsideQuotes(header: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const char of header) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quoted && char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === "," && !quoted) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

/** Records one `name=value` pair, if that is what this is. */
function addParam(params: Record<string, string>, text: string): void {
  const split = text.indexOf("=");
  if (split <= 0) return;

  const name = text.slice(0, split).trim().toLowerCase();
  if (name === "" || !SCHEME_ONLY.test(name)) return;

  // First value wins. A repeated parameter is malformed per RFC 9110 §11.2, and
  // preferring the first keeps the reading stable rather than letting whatever
  // came last decide.
  if (name in params) return;

  params[name] = unquote(text.slice(split + 1).trim());
}

/** Removes the surrounding quotes and resolves `\"` style escapes. */
function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }
  return value.slice(1, -1).replace(/\\(.)/g, "$1");
}
