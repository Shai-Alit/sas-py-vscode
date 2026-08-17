// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What can go wrong at the execution seam, in the seam's own vocabulary.
 *
 * **This module must never import `vscode`.**
 *
 * ADR-0015 decides that this vocabulary is separate from `src/compute/problems.ts`
 * rather than reused from it. The reason is worth restating where someone is
 * about to add a member: `ComputeProblem` is a vocabulary about HTTP status
 * codes, ETags and Viya link relations, and every one of those terms is
 * meaningless to a backend that is not Viya. A member here must make sense to
 * *any* implementation of {@link ExecutionBackend} — if it can only be produced
 * by talking to Viya, it belongs in `src/compute/problems.ts` and 3a translates
 * it on the way out.
 *
 * That translation is where a status code becomes a sentence. `428 Precondition
 * Required` on a fileref upload is a fact about Viya's optimistic concurrency;
 * what this layer says is `transfer-failed`, and what the user reads is that the
 * program never reached the server.
 *
 * The user-facing half is rendered elsewhere, through `vscode.l10n.t()`, in the
 * slice that first shows one of these to a person (3d). The split — codes and a
 * log sentence here, translated prose in a `messages.ts` — is the arrangement
 * `src/auth/problems.ts` and `src/auth/messages.ts` already use, and it is what
 * keeps this module in the unit tier.
 */

/**
 * A failure at the execution seam.
 *
 * **A program that raises is not a member of this union.** An uncaught Python
 * exception means the backend did its job: `execute` succeeded, the handle
 * streamed the traceback, and `done` resolves `ok` with `succeeded: false`. The
 * members here are failures to *run the program at all*, or to keep running it.
 * Conflating the two is how a user's own `ZeroDivisionError` ends up presented as
 * an extension malfunction.
 *
 * As in `src/profile/problems.ts` and `src/auth/problems.ts`, adding a member
 * breaks the build in every exhaustive `switch` over it until the member is
 * handled — which is the point, because the renderer that forgets one would
 * otherwise ship an untranslated sentence.
 */
export type BackendProblem =
  /**
   * The backend has not been connected, or its connection has been closed.
   *
   * Distinct from {@link BackendProblem} `backend-gone` because this one is our
   * ordering mistake — a caller ran before `connect()` resolved — and the fix is
   * in the caller, not in the deployment.
   */
  | { code: "not-connected" }
  /**
   * A program is already running and this backend is serial.
   *
   * ADR-0015 makes this a rejection rather than a queue: the seam refuses and
   * does nothing, and whether to queue is a visible policy decision that belongs
   * to the slice with a status bar in it. `running` names what is already in
   * flight so the caller can say which one it is.
   */
  | { code: "busy"; running: string }
  /**
   * The backend cannot do what was asked, and no retry will change that.
   *
   * `feature` is the capability in seam terms — `freshNamespace`, `cancel` —
   * and `reason` is why this implementation cannot offer it. Both go in the log;
   * this is the member that keeps a degraded backend honest instead of letting
   * it silently do something adjacent. A backend that cannot clear the
   * interpreter's globals without dropping the session must report this rather
   * than reuse them.
   */
  | { code: "unsupported"; feature: string; reason: string }
  /**
   * The program's bytes never reached the runtime.
   *
   * The member ADR-0015 promises: because the seam is one `execute` call rather
   * than a `stage` then a `run`, "the upload failed" and "the run failed" have to
   * be told apart by the failure value. This is that distinction, and it is load
   * bearing — a transfer failure means nothing executed, so a retry is safe in a
   * way that almost nothing else here is.
   */
  | { code: "transfer-failed"; detail: string }
  /**
   * The runtime that executes the program is not available in this session.
   *
   * `PROC PYTHON` missing or unlicensed is the case this exists for. Stage-2
   * capability probing (3e) is what usually reports it, but a first `execute` can
   * discover it too, and the message has to be the same either way.
   */
  | { code: "runtime-unavailable"; detail: string }
  /**
   * The backend died underneath a call — the session was torn down, the process
   * exited, the deployment restarted.
   *
   * Recoverable in principle, by connecting again, which is what distinguishes it
   * from `not-connected` above and what a caller keys its retry on.
   */
  | { code: "backend-gone"; detail: string }
  /**
   * The call was cancelled — by {@link ExecutionBackend.cancel}, or by the user
   * abandoning the operation.
   *
   * A distinct member rather than a generic failure because cancellation is not
   * an error to report to anyone: it is the outcome the user asked for, and a UI
   * that shows it as a failure trains people to ignore failures.
   */
  | { code: "cancelled" }
  /**
   * The backend failed in a way it could not classify.
   *
   * The honest catch-all. `detail` is for the log and must never be a raw
   * response body — see the rule on `identity-unavailable` in
   * `src/auth/problems.ts` for what that costs.
   */
  | { code: "backend-failed"; detail: string };

/**
 * A failed seam call, named on its own.
 *
 * Same arrangement as `ComputeFailure` in `src/compute/client.ts`, and for the
 * same reason: a failure carries nothing of the value type, so it is assignable
 * to a {@link BackendResult} of any value type and can be passed outward through
 * a function whose success type is something else entirely.
 *
 * `reason` is the log sentence — {@link describeBackendProblem} of `problem`,
 * usually with the caller's context in front of it — carried alongside the code
 * so that logging a failure never requires re-deriving it.
 */
export interface BackendFailure {
  ok: false;
  reason: string;
  problem: BackendProblem;
}

export type BackendResult<T> = { ok: true; value: T } | BackendFailure;

/**
 * The English sentence for a log.
 *
 * Lower-case fragments with no trailing full stop, matching
 * `describeComputeProblem` and `describeAuthProblem`: the caller embeds these in
 * a longer line. The user-facing sentences are worded differently and live with
 * the renderer, which is deliberate — one is read by the person running the
 * program, the other by whoever reads a log a week later.
 */
export function describeBackendProblem(problem: BackendProblem): string {
  switch (problem.code) {
    case "not-connected":
      return "the backend is not connected";
    case "busy":
      return `the backend is already running ${problem.running}`;
    case "unsupported":
      return `this backend does not support ${problem.feature}: ${problem.reason}`;
    case "transfer-failed":
      return `the program could not be sent to the backend, so nothing ran: ${problem.detail}`;
    case "runtime-unavailable":
      return `no Python runtime is available in this session: ${problem.detail}`;
    case "backend-gone":
      return `the backend went away: ${problem.detail}`;
    case "cancelled":
      return "the run was cancelled";
    case "backend-failed":
      return `the backend failed: ${problem.detail}`;
  }
}

/**
 * Builds a {@link BackendFailure}, filling `reason` from the problem.
 *
 * `context` is prepended when given, so a caller can say *which* call failed
 * without composing the sentence itself — `fail(problem, "running the program")`
 * reads as `running the program: the backend went away: …`. Keeping the
 * composition here is what stops the log from acquiring three different shapes
 * for the same failure.
 */
export function fail(
  problem: BackendProblem,
  context?: string,
): BackendFailure {
  const described = describeBackendProblem(problem);
  return {
    ok: false,
    reason: context === undefined ? described : `${context}: ${described}`,
    problem,
  };
}
