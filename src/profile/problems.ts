// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The other half of the localisation seam.
 *
 * `model.ts` decides what is wrong with a value and says so as a
 * {@link ValidationProblem}; this file says it in the user's language. The split
 * exists because the model must not import `vscode` — it has to load in the unit
 * tier, outside an extension host — and `l10n.t()` lives on the `vscode` module.
 *
 * Adding a member to `ValidationProblem` breaks the build here until it is
 * handled: with an explicit `string` return type and no `default` branch, a
 * missing case makes the function implicitly return `undefined`, which does not
 * type-check. That is deliberate, and it is why there is no fallback message —
 * a fallback would turn a compile error into an English string shipped to a
 * translated user.
 */

import * as vscode from "vscode";

import type { ValidationProblem } from "./model";

/**
 * The message to show under an input box for a rejected value.
 *
 * Wording note: these are sentences shown in the UI, so they are capitalised and
 * punctuated, unlike the lower-case fragments {@link describeProblem} writes to
 * the log. The two are allowed to differ — one is read by the person typing, the
 * other by whoever is reading a log a week later.
 */
export function localiseProblem(problem: ValidationProblem): string {
  switch (problem.code) {
    case "endpoint-not-text":
      return vscode.l10n.t("The endpoint must be text.");
    case "endpoint-required":
      return vscode.l10n.t("Enter the address of your Viya deployment.");
    case "endpoint-not-a-url":
      return vscode.l10n.t('"{0}" is not a URL.', problem.value);
    case "endpoint-has-credentials":
      return vscode.l10n.t(
        "The endpoint must not contain a username or password. Credentials belong in the sign-in prompt, not in a setting.",
      );
    case "endpoint-unsupported-scheme":
      return vscode.l10n.t(
        "The endpoint must use https, not {0}.",
        problem.scheme,
      );
    case "endpoint-cleartext":
      return vscode.l10n.t(
        "The endpoint must use https. An access token sent over http can be read by anything between here and the server.",
      );
    case "endpoint-has-query-or-fragment":
      return vscode.l10n.t(
        "The endpoint must not contain a query string or fragment. Use just the address of the deployment.",
      );
    case "name-not-text":
      return vscode.l10n.t("The profile name must be text.");
    case "name-required":
      return vscode.l10n.t("Enter a name for this profile.");
    case "name-too-long":
      return vscode.l10n.t(
        "The profile name must be {0} characters or fewer.",
        problem.max,
      );
    case "name-has-control-characters":
      return vscode.l10n.t(
        "The profile name must not contain control characters.",
      );
    case "name-duplicate":
      return vscode.l10n.t(
        'A profile named "{0}" already exists.',
        problem.existing,
      );
  }
}
