# ADR-0011 — Where Python runs is a visible per-workspace target, not a reinterpretation of the run button

- **Status:** Accepted
- **Date:** 2026-08-14
- **Decides:** how a user chooses to run a `.py` file on Viya rather than on the
  local interpreter, and how this extension sits beside `ms-python.python`
- **Executed in:** slice `3d-i`

## Context

The repository has been clear about the *posture* since it was written and silent
about the *mechanism*. `README.md` says editing intelligence is delegated —
"completion, hover, and refactoring come from `ms-python.python` and Pylance.
This extension owns execution, not language services" — and
`PRODUCTION_PLAN.md` puts "local Python execution" and "replacing
`ms-python.python` / Pylance" explicitly out of scope, with the parity table
recording that syntax highlighting and completion reach parity by our *not*
building them.

None of that answers the question a user asks on their first day: I have a `.py`
file open, there is a play button in the corner, and I want this to run on Viya —
what do I press? Slice 3d-i owns `Run file`, `Run selection`, `Cancel` and `Reset
Python state`, but nothing in the plan or the runbook mentions a menu, a
keybinding, or the run button, and `package.json` contributes no `menus`,
`keybindings` or `languages` at all today. The implicit assumption everywhere has
been the Command Palette. That is enough to demonstrate the extension and not
enough to use it.

### The collision

On a local `.py` file the editor title bar already has a run button, and it
belongs to `ms-python.python`. Ours would appear next to it, in the same
`editor/title/run` group. Two run affordances on the same file, one of which
silently uses the laptop's interpreter, is the whole problem in one toolbar.

**Upstream's answer does not transfer.** The SAS extension does claim Python
files — `editorLangId =~ /^(python|r|sql)$/` appears nine times in its
`package.json`, in its keybindings (885, 890), its one `editor/title/run` entry
(1116), its `editor/context` entries (1122, 1127, 1132) and its `commandPalette`
entries (1151, 1155, 1159) — but every one of those nine clauses is qualified
with `resourceScheme =~ /^sas(Content|Server).*/`. It claims a Python file only
when that file was opened *from* Viya. A `.py` on local disk is left entirely
alone, which is exactly the file this extension exists to run. (Its
`SAS.hideRunMenuItem` context key is not a user setting either: the only place
anything sets it is `client/src/browser/extension.ts:11`, which sets it true in
the web build.) So the precedent tells us what SAS does about remote files, and
says nothing about ours. Line numbers are from the upstream clone at commit
`009bc9a`, 2026-08-10.

### Why getting this wrong is expensive

Running on the wrong target is not a cosmetic mistake in either direction.
Locally, the plan's 3e note is the sharp end: "the local environment lies
convincingly, because Pylance is happily resolving `import polars` against the
packages on the *laptop*." Code that was written for Viya can run locally and
appear to work. In the other direction, a run sends code to a shared, possibly
production deployment, which is why ADR-0002 gates execution on workspace trust
at all and why `statusBar.ts` already exists to make "which deployment is this?"
answerable by looking rather than by opening a menu.

### What the platform already trains people to expect

VS Code has taught Python users that the execution target is a persistent thing
you set once and can see: the interpreter indicator in the status bar, and the
kernel picker in a notebook. Neither is a per-invocation choice, and neither is
inferred from state the user cannot see. A target this extension owns, displayed
where users already look for exactly this fact, is the idiom rather than an
invention.

## Decision

**Each workspace has a run target — a specific Viya profile, or Local — which the
user sets from the status bar of a window open on it, and which decides whether
this extension puts a run affordance in the editor at all.**

Concretely:

**The status bar item is the switch.** The existing
`pythonOnViya.activeProfile` item gains the job: its text names the target
(`$(server) verde` for a deployment, `$(vm-outline) Local Python` for local), its
tooltip states both the target and the connected profile, and its command becomes
`pythonOnViya.selectRunTarget`. The picker lists **Local Python** and every
configured profile in one list, because choosing a profile *is* choosing Viya —
the two questions collapse into a single gesture. `pythonOnViya.switchProfile`
remains in the palette and keeps working.

**The target is a context key, and it gates our editor entries.**
`pythonOnViya.runTarget` is published as a context key. Our `editor/title/run`
and `editor/context` entries are contributed with
`editorLangId == python && pythonOnViya.runTarget == viya && isWorkspaceTrusted`.

**When the target is Local, this extension contributes nothing to the editor.**
Our entries disappear and Microsoft's run button is the whole story. We do not
delegate to it, wrap it, or launch an interpreter ourselves — Local means the
absence of us, not a feature we implement. That keeps the "no local Python"
constraint literally true rather than nearly true.

**Commands mean what their titles say, from anywhere.** `Python on Viya: Run
File` runs on Viya whether it was invoked from the palette or from the editor
gesture. The target governs *placement*, never meaning, so no gesture changes
what it does under the user's hands; the palette route is always available and
always explicit.

**The target is stored in `workspaceState`,** beside the active-profile pointer
ADR-0007 put there, and it inherits that decision's imprecision rather than
glossing it. `workspaceState` is keyed to the *workspace*, not to the window, so
two windows open on the same folder share one target; the API offers nothing
narrower, and this ADR claims nothing narrower. What the store does buy is that
two *different* workspaces are independent — a folder of production ETL and a
scratch folder can sit at different targets — which is the case that costs money
to get wrong. The alternative, a target committed into `.vscode/settings.json`,
would let a repository decide where a reader's code runs, precisely the shape
ADR-0002 restricts for the profile settings already.

**The extension never changes the target.** Not on sign-out, not on a failed
run, and above all never as a fallback. A run requested against Viya with no
profile, no session, or a dead token fails with an actionable message offering
*Sign in* or *Switch to Local*; it does not quietly run somewhere else.

**Every run names its target in the output channel** as its first line, so the
record of where code ran outlives the status bar's current state.

**Default: Viya.** Installing this extension is the statement of intent, and
local execution already has a button. With no profile configured the status bar
already reads "No profile", and the first run routes into profile creation, which
is the onboarding we want.

> **Superseded 2026-08-26 — see [ADR-0020](0020-run-target-defaults-to-local.md).**
> The run target now defaults to Local. This paragraph is left as written,
> unedited, as the record of what was decided and why at the time it was
> decided; it no longer describes this extension's actual behaviour.

**Files opened from Viya always run on Viya,** regardless of the switch, once
Phase 6 introduces a non-`file` scheme. This is the one place upstream's
`resourceScheme` qualifier applies to us directly.

**No keybinding in 3d-i,** and none chosen before the beta reports. Every
plausible default collides: `F8` is "go to next problem in files", `F5` is debug,
`ctrl+enter` is Jupyter's for `.py` cells, and mirroring the SAS extension's
`F8`/`F3` would override "next problem" for every Python file the user opens,
including on days they are not using Viya at all. Document how to bind one by
hand; let the beta say what people reach for. The open item is carried in
`RUNBOOK.md` under 3d-i.

**Notebooks are out of scope here.** Phase 9 gets its target from VS Code's
kernel picker, which is the platform's own mechanism for the same question; this
switch must not compete with it.

**No `extensionDependencies` on `ms-python.python`.** Recommended in the README,
never forced — nothing we do requires it to be installed.

## Alternatives considered

**A per-invocation command with no persistent target.** Contribute "Run on Viya"
to the palette, the context menu and the run dropdown, and stop; the command you
pick is where it runs. This is the safest possible design, because there is no
state to be wrong about. Rejected as the *whole* answer because it leaves the
question "where will this run" answerable only by reading command titles at the
moment of running, and it puts two run entries in the editor permanently, one of
which is the wrong one for a user who has decided. It survives *inside* this
decision: the palette command is exactly that, and it is why the target can be
kept to placement rather than routing.

**Make our run action the default play button whenever a profile is signed in.**
One click, no mode. Rejected because it makes the play button's meaning a
function of authentication state — a habitual click sends code to production
because a token happened to be live. It also fails the reverse test: signing out
would silently hand the same button back to the local interpreter.

**One "Run" command that routes by target, delegating local runs to
`python.execInTerminal`.** The strongest form of the mode, and the one most
people would expect from a switch. Rejected on three counts. It makes one gesture
mean two things depending on state set minutes ago, which is the classic mode
error and is unrecoverable once someone has muscle memory. It takes a hard
dependency on another extension's command id, which is not API and is not
versioned. And it puts us in the business of launching local interpreters, which
the plan forbids without written justification.

**Register as an interpreter through the Python extension's environment API.**
The most elegant story if it worked: Viya appears in the interpreter picker
alongside the local virtualenvs and everything downstream just works. Rejected
because that API describes an environment by the path to an executable on the
local machine, and there is no such path here; a shim would be a local Python
dependency by another name. It would also inherit expectations we cannot honour —
debugging, test discovery, the REPL — each of which would fail in a way the user
would reasonably read as our bug.

**A `pythonOnViya.runTarget` setting rather than `workspaceState`.** Visible,
diffable, syncable. Rejected for the reason above: a setting is committable, and a
committed run target is a repository telling a stranger's editor to run code on
their production deployment. The status bar makes it visible without making it
portable.

## Consequences

**A user who sets the target to Local loses our editor entries, and may not know
why.** This is the accepted cost of the switch. Three things mitigate it: the
status bar always names the target, the tooltip says what it implies, and the
palette command never disappears. Worth a line in the docs and worth watching in
the beta.

**The status bar item's command changes between releases.** It is
`pythonOnViya.switchProfile` today and becomes `pythonOnViya.selectRunTarget` in
3d-i. That is a visible change to a shipped affordance, so it belongs in the
changelog rather than in a diff.

**The decision logic stays inside the coverage denominator.** Target parsing,
validation, labelling and the "what does this target imply" rules go in a pure
module with no `vscode` import; only the memento read/write and the status bar
render live in the shell. ADR-0009's rule does the rest.

**One behaviour is assumed and must be confirmed by hand in 3d-i.** Exactly how
VS Code presents multiple `editor/title/run` contributions — which becomes the
primary button, and whether the last used is remembered — is asserted here from
the contribution point's documented shape, not from observation. If it turns out
that our entry can become the primary click by accident, that is the "claim the
play button" alternative arriving through the back door and this ADR needs
revisiting, not working around.

> **Confirmed 2026-08-26 — this is what happened.** The manual check found
> this extension's entry became the primary click ahead of `ms-python.python`'s
> own, on a workspace where it had never been invoked before. See
> `docs/phases/phase-3.md`'s 3d-i entry for the procedure and findings, and
> [ADR-0020](0020-run-target-defaults-to-local.md) for the revision this led
> to — the default, not the mechanism described elsewhere in this ADR, is what
> was revisited.

**If the two-gesture story confuses beta users, routing is still available.** The
reversal is the third alternative above, and nothing here forecloses it: the
target already exists, the context key already exists, and only the command
wiring would change. Reverse it with a new ADR rather than by growing this one.
