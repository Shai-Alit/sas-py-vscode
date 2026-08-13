# ADR-0007 — Connection profiles: separate storage, a versioned schema, and no secret in settings

- **Status:** Accepted
- **Date:** 2026-08-12
- **Decides:** where a Viya connection profile lives, what it contains, how it
  changes shape over time, and what happens when the SAS extension is installed
  alongside this one — open decision #5 in `PRODUCTION_PLAN.md` §6, plus the two
  in-phase items that §6 parks for 1a
- **Executed in:** slice 1a (`pythonOnViya.connectionProfiles`, the profile
  model and store, the profile commands, the status bar item)

## Context

The SAS extension already solves this problem, and this project's standing
instruction is to bootstrap off its work. So the question is not "how do we store
a connection profile" — it is "how much of theirs do we take". Their
implementation was read end to end before deciding; every claim below cites the
file it came from, in the clone at `sassoftware/vscode-sas-extension`.

Their setting is `SAS.connectionProfiles`, a single object holding both an
`activeProfile` string and a `profiles` dictionary keyed by name
(`package.json:153-459`). A profile is discriminated by `connectionType`, one of
`rest`, `ssh`, `com`, `iom`, with a four-branch JSON Schema `allOf`. Three of
those four branches are SAS 9, which this project explicitly does not support, so
the discriminator collapses to nothing here and the `if`/`then` shape the plan
originally proposed to port has no work left to do.

Four questions had to be answered before writing any of it.

## Decision

### Separate storage, plus a one-time read-only import

`pythonOnViya.connectionProfiles`, ours, with our own schema. A command —
`Python on Viya: Import Profiles from the SAS Extension` — reads
`SAS.connectionProfiles.profiles`, filters to `connectionType === "rest"`, and
offers the matches in a multi-select pick, copying the endpoint, the compute
context and the client id into our shape. It never writes their key.

Sharing their key was the friendlier-sounding option and it is rejected on
evidence:

- **It would break their extension for the user.** Their configuration listener
  runs `commands.executeCommand("SAS.close", true)` on *any* change to that key
  (`client/src/node/extension.ts:189-194`, via `triggerProfileUpdate` at
  `255-283`). Adding, editing or switching a Python profile would terminate a
  running SAS compute session. Shipping a defect into somebody else's product is
  a cost no amount of convenience covers.
- **Concurrent writes lose data.** Both sides would do a whole-object
  read-modify-write against `ConfigurationTarget.Global` with no merge and no
  optimistic concurrency (`client/src/components/profile.ts:245,301,326`). Last
  writer wins, and the loser's profile is simply gone.
- **Reading their key can rewrite the user's settings.** `validateSettings()`
  writes a default object when `profiles` is absent, and every getter calls it
  first (`profile.ts:233-250`).
- **They would migrate our profiles.** `migrateLegacyProfiles()` runs on each of
  their activations and rewrites any profile lacking `connectionType`, defaulting
  it to `"rest"` (`profile.ts:206-225`).
- **The payoff is smaller than it looks.** VS Code's `SecretStorage` is
  per-extension and cannot be shared, so tokens stay separate either way and the
  user signs in twice regardless. Sharing saves retyping an endpoint URL and a
  context name.
- **We could not contribute a schema for a key we do not own**, so our profiles
  would have no IntelliSense and no validation, and we would inherit a
  `connectionType` enum with three values we cannot honour.

The three decisions below independently rule sharing out, which is worth stating
plainly: a shared profile must carry the client secret in plaintext, because
that is where their sign-in reads it from
(`client/src/connection/rest/auth.ts:23,64`).

### The active profile lives in `workspaceState`, over a settable default

Profiles themselves are user-global and `window`-scoped. Which one is *active* is
per window — but there are two levels, not one, and the second recovers what a
pure `workspaceState` pointer would have cost.

`pythonOnViya.defaultProfile` is an ordinary string setting naming the profile a
window starts on. `workspaceState` holds that window's override, set by the switch
command. Resolution runs in falling order of how specifically the user asked:

1. **this window's choice**, from `workspaceState`;
2. **`pythonOnViya.defaultProfile`**, from settings;
3. **the only profile there is**, when exactly one exists — a state with nothing
   to decide, where prompting asks a question with one possible answer;
4. otherwise none, and the status bar says so.

A stale pointer — a name that no longer exists, because the profile was renamed or
deleted — falls through to the next source rather than resolving to nothing. That
is what makes deleting a profile behave sensibly in a window that was pointed at
it, instead of leaving the window in a state it cannot describe.

One imprecision worth stating rather than glossing: `workspaceState` is keyed to
the *workspace*, not to the window, so two windows open on the same folder do
share the override. The API offers nothing narrower. What it does buy is that two
*different* workspaces are independent, which is the case that costs money to get
wrong, and that is the whole of the improvement being claimed here.

Upstream keeps `activeProfile` inside the same global setting, so every open
window shares one answer and switching in one switches all of them. Targeting a
development deployment in one window and production in another is a thing people
do, and it is the case where getting it wrong is expensive. Putting the override
in `workspaceState` also puts it next to the compute session id, which Phase 2a
already keeps there — one workspace, one target, one session.

Keeping a settings-level default alongside it is what preserves the property that
makes upstream's arrangement attractive: a machine setup script, a dotfiles
repository or a checked-in workspace file can still say which deployment to start
on, in a file, without launching the editor. What it cannot do is silently move a
window that has already chosen. The remaining cost is that the *current* profile
of a given window is not readable from a file; the status bar item exists partly
to answer that question.

**Scope is declared explicitly.** Upstream's setting declares no `scope` at all
and therefore silently inherits `window`; every read is
`workspace.getConfiguration("SAS")` with no resource argument and every write is
hard-coded to `Global` (`profile.ts:234-236,261-265,278-280`). We say `window`
deliberately rather than by omission, so a folder-level `.vscode/settings.json`
cannot half-configure a connection in a multi-root workspace and produce a
profile list that depends on which file has focus.

### Every profile carries an explicit `version`

`version: 1` on each profile from the first release. Migrations key off it, and a
profile whose version is *higher* than this build understands is refused with a
message naming the mismatch — not silently read, not partially applied.

Upstream has no version field and migrates by sniffing for missing fields. That
works for exactly one change and becomes ambiguous the moment two of them
overlap: a profile missing `connectionType` might be old, or might be new and
malformed, and nothing in the data distinguishes them. It also rewrites the
user's settings on activation to record the migration, which means reading the
setting has a side effect.

The honest cost is a field in every profile that does nothing on the day it ships.

### The client secret goes to `SecretStorage`, never to settings

`settings.json` holds the endpoint, the context, and the client *id*. The secret
is stored in `SecretStorage` under a per-profile key, and the input box that
collects it is masked.

Upstream stores `clientSecret` as an ordinary string property
(`package.json:290`, `profile.ts:80`) and prompts for it without passing
`maskValue`, so it is neither hidden while typing nor hidden afterwards
(`client/src/commands/profile.ts` → `profile.ts:547-550,707`). A credential in
`settings.json` is a credential in a file people commit, screen-share and paste
into issues. This repository already runs `check:secrets` over its own tree
(ADR-0006) on exactly that reasoning; contributing a setting whose documented
purpose is to hold a secret would be inconsistent with it.

The cost is that a profile is no longer self-contained: exporting or scripting one
moves the metadata but not the secret, and the user is prompted once on first use.
That is the correct trade, and it is the same one VS Code's own Git and Remote
extensions make.

## Alternatives considered

**Share `SAS.connectionProfiles`.** Rejected above, on their code rather than on
principle. If upstream ever exposes a read-only, event-free profile API, this is
worth revisiting — the objection is to the write path and the session coupling,
not to interoperating.

**Fully separate, with no import command.** Genuinely tempting: it is the
smallest surface, and it is the only option that cannot break when upstream
changes their schema. Rejected because the import is about sixty lines, reads a
shape that has been stable across their releases, and removes the one piece of
friction a user would actually notice. It is written defensively — an unreadable
or unexpected profile is skipped and counted, never thrown over.

**Deferring the import to Phase 5.** Rejected because the import is the part of
this slice that most needs the schema to be settled, and writing it now is what
proves the schema can express a real profile that somebody else authored.

**Porting the `if`/`then` discriminator anyway**, against a one-member
`connectionType` enum, to leave room for a second connection type later. Rejected:
Phase 12's second execution backend is a *backend*, not a second profile shape,
and a discriminator with one value is a comment written in JSON Schema. Note also
that upstream's `if` blocks omit `"required": ["connectionType"]`, so a profile
with no `connectionType` at all satisfies all four branches vacuously — a defect
worth not inheriting.

## Consequences

This is the first slice with real `src/` code, and it sets a testing seam the rest
of the project inherits. The unit tier runs outside an extension host, so anything
importing `vscode` is invisible to it. The profile **model** — types, validation,
version handling, the import filter — therefore has no `vscode` import and is
specified by unit tests; the **store** that wraps `workspace.getConfiguration` and
`SecretStorage` is a thin shell exercised in the extension host. Logic that drifts
into the shell stops being cheaply testable, which is how a suite quietly stops
being a specification. The coverage ratchet rises in this pull request for the
first time, per open decision #6.

Deliberately not inherited from upstream, each for a reason stated above: the
plaintext client secret, the unmasked secret prompt, the vacuous `if`/`then`
branches, the undeclared setting scope, the write-on-read in `validateSettings()`,
and the startup rewrite in `migrateLegacyProfiles()`.

Two more surfaced while writing the model, and both change its shape:

- **A profile carries a stable `id`, and secrets are keyed on it rather than on
  the profile name.** Upstream keys its stored credential by name
  (`client/src/connection/rest/AuthProvider.ts:134-141`), so renaming a profile
  orphans the token and the user is asked to sign in again with nothing to
  explain why. A hand-written profile with no `id` falls back to its name, which
  makes such a profile behave exactly like a generated one right up until it is
  renamed.
- **A missing `connectionType` is inferred from the fields present, not assumed
  to be `rest`.** Upstream's migration defaults it unconditionally, which is
  wrong for the SAS 9 profiles that predate the field: an old SSH profile has
  `host` and `saspath` and no endpoint, and calling it `rest` describes a Viya
  connection to nowhere. Since the import reads a file this project does not own,
  guessing wrong must cost a skipped row and nothing more.

What this does not solve: a profile is not portable between machines as a single
object any more, two extensions still cannot share a token, and a user with an
existing SAS extension setup has to run the import once rather than finding their
profiles already there. All three are accepted.
