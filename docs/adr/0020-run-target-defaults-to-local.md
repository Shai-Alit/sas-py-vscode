# ADR-0020 — The run target defaults to Local, not Viya

- **Status:** Accepted
- **Supersedes:** [ADR-0011](0011-choosing-where-python-runs.md)'s "Default: Viya"
  paragraph only — nothing else in that ADR (the status-bar switch, the
  `workspaceState` store, the context-key gating, "commands mean what their
  titles say") is affected or reconsidered here.
- **Date:** 2026-08-26
- **Decides:** what run target a workspace starts at before anyone has made an
  explicit choice
- **Executed in:** slice `3d-i`, as a correction found and fixed before PR #63
  merged, not a new phase

## Context

ADR-0011 decided the run target — Local, or a specific Viya profile — would
default to Viya, and named the manual check that would confirm or refute the
assumption underneath its whole design: "Exactly how VS Code presents multiple
`editor/title/run` contributions — which becomes the primary button, and
whether the last used is remembered — is asserted here from the contribution
point's documented shape, not from observation. If it turns out that our
entry can become the primary click by accident, that is the 'claim the play
button' alternative arriving through the back door and this ADR needs
revisiting, not working around."

That check was run on 2026-08-26, in a real Extension Development Host with
`ms-python.python` installed, on a folder where `pythonOnViya.runFile` had
never once been invoked. The result was the one ADR-0011 said would mean
revisiting it: this extension's own **Run File** came up as the *primary*
`editor/title/run` button, ahead of `ms-python.python`'s own **Run Python
file**, from the very first observation — not "last used remembered" (there
was nothing to remember), something else in how VS Code orders same-group
contributions favoured this extension's entry by default. Full procedure and
findings are in `docs/phases/phase-3.md`'s 3d-i entry.

The practical shape of the problem is worse than "the wrong icon is on top."
`pythonOnViya.runTarget` defaulted to `"viya"` even with zero profiles
configured, so the button was not just visible but *primary* for every Python
user who installs this extension, before they have configured anything at
all. This is a brand-new extension; the overwhelming majority of its early
users already have a working local Python workflow through
`ms-python.python`, installed and in daily use long before this one. Clicking
play on an ordinary local `.py` file — the single most common, least
deliberate gesture a Python user makes — could silently mean "run on Viya"
instead of "run on my laptop," with no action of theirs that expressed that
intent. This is exactly the harm ADR-0011's own "Why getting this wrong is
expensive" section named ("Running on the wrong target is not a cosmetic
mistake in either direction") — now traced to the *default*, not to a user's
own mistake or a deployment they knowingly connected to.

ADR-0011's own reasoning for defaulting to Viya was: "Installing this
extension is the statement of intent, and local execution already has a
button. With no profile configured the status bar already reads 'No
profile', and the first run routes into profile creation, which is the
onboarding we want." Installing an extension and choosing it as this specific
workspace's execution target are not the same act, and the "first run routes
into profile creation" claim was never more than `reportNotReady`'s own
pointer message ("Switch the run target to a SAS Viya profile…") — there is
no actual navigation to profile creation on either path, so nothing about
onboarding is lost by this reversal that was actually there to begin with.

## Decision

**The run target defaults to `"local"`, not `"viya"`, when nothing has been
stored for a workspace yet.** `src/run/target.ts`'s `resolveRunTargetKind`
returns `"local"` for `undefined`, `null`, or any unrecognised value, exactly
where it returned `"viya"` before.

Because `package.json`'s `editor/title/run` and `editor/context` entries are
already gated on `pythonOnViya.runTarget == viya`, this one change means the
extension contributes **nothing** to the editor until a user has explicitly
run `Select Run Target` and chosen a Viya profile. At that point, this
extension's entry becoming primary is no longer an accident — it is the thing
the user just asked for, which is precisely the behaviour ADR-0011 already
intended for a deliberate choice. Nothing about the mechanism changes: the
status bar is still the switch, the target is still stored in
`workspaceState` and never a setting, commands still mean what their titles
say from anywhere, and the Command Palette route is still always available
and always explicit regardless of target. Only the value nobody has chosen
yet changes.

The status bar (already reading "No profile" or "Local Python" with nothing
configured) remains the discovery path into Viya — a visible, always-present
invitation to switch, rather than a silent default a user has to notice and
correct.

## Alternatives considered

**Keep defaulting to Viya, but track "explicitly chosen" separately from
"defaulted," and gate the editor contribution on the former.** Considered
first, in the same conversation this ADR came out of. Rejected as needless
complexity once it was clear that reversing the default achieves the
identical practical effect — no editor entry until a deliberate pick — without
adding a second piece of state to `RunTargetStore` to distinguish two shapes
of `"viya"` that would otherwise need to be told apart everywhere the target
is read.

**Force this extension's contribution to render as secondary via menu
ordering, against `ms-python.python`'s.** Rejected: it assumes a stable,
predictable ordering rule for `editor/title/run` that is not documented API,
does not explain *why* our entry won primary in the first place, and is
exactly the "working around" ADR-0011 said this situation would call for
revisiting rather than patching.

**Leave the default at Viya and rely on the output channel naming the target
after the fact.** Already shipped, and worth keeping regardless of this
decision, but insufficient alone — ADR-0011's own "why getting this wrong is
expensive" section already made this argument once; a name in the output
channel does not stop the surprise of the first click.

## Consequences

**A user who has configured nothing sees no editor entry from this extension
at all.** `ms-python.python`'s own run button, if installed, is the only one
in the toolbar; if it is not installed, VS Code's ordinary behaviour for a
`.py` file applies. This is "Local means the absence of us," exactly as
ADR-0011 already described — reached now by the default rather than by an
explicit switch to Local.

**The Command Palette's behaviour is unchanged.** `Python on Viya: Run File`
still means what its title says regardless of target; with the target at its
new default of Local, it reports the same `reportNotReady("local")` message
it always has, telling the user how to switch — nothing about that path
changes, only which target a fresh workspace starts at.

**Every place that asserted or depended on "defaults to Viya" needed
correcting in the same change**, so the record does not carry a value a
later reader could act on: `src/run/target.ts`'s doc comments and
`resolveRunTargetKind`'s return value, `src/run/targetStore.ts`'s one-line
doc comment, `test/unit/run-target.test.ts`'s and
`test/integration/run/target-store.test.ts`'s default-asserting tests,
`CHANGELOG.md`'s Unreleased entry, and `docs/phases/phase-3.md`'s manual-test
write-up (which now records the fix alongside the finding, rather than the
finding alone).
