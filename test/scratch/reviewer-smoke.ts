// Throwaway fixture. Never merged. See RUNBOOK.md Section E.
//
// Seven deliberate defects, one per rule the reviewer prompts were retailored
// around. A reviewer that flags none of these is misconfigured, not merely quiet.

import * as vscode from "vscode";

export interface ComputeSession {
  id: string;
  version: string;
}

/**
 * Defect 1: no timeout and no abort path on a network call.
 * Defect 4: bearer token written to console.log.
 */
export async function startSession(
  baseUrl: string,
  token: string,
): Promise<ComputeSession> {
  console.log("starting session with token " + token);

  const response = await fetch(`${baseUrl}/compute/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  // Defect 6: `as any` laundering an unvalidated response across an API boundary.
  const body = (await response.json()) as any;
  return { id: body.id, version: body.serverVersion };
}

/**
 * Defect 7: version branching outside src/dialects/.
 */
export function logEndpoint(session: ComputeSession): string {
  if (session.version === "3.5") {
    return `/compute/sessions/${session.id}/log`;
  }
  return `/compute/sessions/${session.id}/listing`;
}

/**
 * Defect 3: PKCE verifier built from Math.random(), which is not
 * cryptographically secure. This is the exact defect present upstream.
 */
export function createCodeVerifier(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let verifier = "";
  for (let i = 0; i < 64; i++) {
    verifier += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return verifier;
}

/**
 * Defect 2: empty catch, silently swallowing the failure, with no comment
 * marking it as sanctioned fail-soft capability probing.
 * Defect 5: user-facing string not routed through l10n.t().
 */
export async function deleteSession(
  baseUrl: string,
  session: ComputeSession,
): Promise<void> {
  try {
    await fetch(`${baseUrl}/compute/sessions/${session.id}`, {
      method: "DELETE",
    });
  } catch (e) {}

  vscode.window.showInformationMessage("Session closed.");
}
