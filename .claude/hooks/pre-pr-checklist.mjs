// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

// PreToolUse hook (Bash|PowerShell): before any `git push` or `gh pr create`,
// show CLAUDE.md's pre-PR checklist to both the developer and Claude, and
// require the developer's confirmation. Added 2026-09-24 after 12j's PR #217
// was opened with its manual-test items unrun — see CLAUDE.md, "Adversarial
// self-review before the PR exists", step 5.

import { readFileSync } from "node:fs";

const PUSH_OR_PR = /\bgit\s+push\b|\bgh\s+pr\s+create\b/;

const CHECKLIST = [
  "Pre-PR checklist (CLAUDE.md, 'Adversarial self-review before the PR exists'):",
  "  1. Checks green locally (npm run verify / check:docs as the change warrants).",
  "  2. Adversarial review handed over AND answered; real findings folded in.",
  "  3. Manual-test items this slice added were handed over AND passed.",
  "  4. STATUS.md and the phase file's punch list/Runbook updated in this push.",
  "  5. Once a PR is open: all review findings collected and fixed in ONE push.",
].join("\n");

let command = "";
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  command = String(input?.tool_input?.command ?? "");
} catch {
  process.exit(0);
}

if (!PUSH_OR_PR.test(command)) process.exit(0);

process.stdout.write(
  JSON.stringify({
    systemMessage: CHECKLIST,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: `${CHECKLIST}\nConfirm only if every item above is done.`,
      additionalContext: `${CHECKLIST}\nIf any item is not done, stop and tell the developer which one instead of pushing.`,
    },
  }),
);
