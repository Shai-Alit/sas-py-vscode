# ADR-0013 — Signing in opens a compute session, and only from the command

- **Status:** Accepted
- **Date:** 2026-08-15
- **Decides:** whether *Sign In* is a credential step or a "get me working" step,
  and which caller is allowed to start a SAS process
- **Executed in:** slice `2a-iii`

## Context

Slices 1c and 2a-ii between them produced two commands that a new user has to run
in order, without being told: **Python on Viya: Sign In**, and then **Python on
Viya: Connect to SAS Viya**. Signing in succeeded, said so, and left the user with
nothing they could run code against. Connect then did the visible work.

That split is an artefact of the order the slices were built in, not a design.
It was raised as a defect during the 2a-ii manual run, in these terms: *"what
other point is there of signing in if not to connect to a session?"* The question
is the right one. A credential with no session is an internal state of this
extension; it is not a thing anyone wants.

The complication is that this extension has **two** callers of "sign in" and they
want opposite things. One is the palette command: deliberate, invoked by a person
who has a profile selected and intends to work. The other is VS Code's Accounts
menu, which calls `createSession` on the provider — a menu that is **polled**,
has no profile in hand, and is opened to *read* who is signed in. A design that
puts the connect inside the provider cannot tell those two apart, and the second
one would start a SAS process on a shared deployment because somebody opened a
menu.

## Decision

**The sign-in command opens a compute session, and the connect lives in the
command rather than in the `AuthenticationProvider`.**

Concretely:

**One command reaches a working state.** `signIn` calls
`provider.createSession()` and then the same connect the *Connect* command runs,
reporting the profile it connected. *Connect* remains, and becomes the command
for reconnecting after a disconnect or a session death rather than the mandatory
second half of getting started.

**`createSession` itself is unchanged.** It acquires a credential and nothing
else. The Accounts menu, the compute path's silent refresh, and any future caller
that goes through `vscode.authentication.getSession` all reach that method, and
none of them should be starting a session as a side effect of asking who is
signed in. Keeping the provider narrow is what makes the caller distinction free:
no code has to ask *why* it was called.

**A cancelled sign-in connects nothing.** The command returns without attempting
a connect, and says only that the sign-in was cancelled — the behaviour recorded
in the same slice as the cancellation fix.

**The connect dependency is declared structurally, not imported.** `commands.ts`
takes a `ConnectAfterSignIn = () => Promise<{ profileName: string } | undefined>`.
`compute/commands.ts` satisfies it. Compute already reads the auth provider's id,
so a type import back the other way would make the pair mutually dependent in
order to describe a single string.

## Alternatives considered

**Leave the two commands separate and document the order.** The status quo, and
the cheapest option. Rejected because the documentation would be explaining an
implementation detail to the user: the reason the steps are separate is that the
credential and the session were built in different slices. Every beta user pays a
small confusion tax so that we do not have to write ten lines of glue.

**Put the connect inside `createSession`.** Superficially tidier — one place,
every caller gets it. Rejected because it is exactly the wrong place: it would
make an Accounts-menu poll start a SAS process, which contradicts the ADR-0002
posture that this extension reaches a deployment only on a deliberate action.
It would also fire on the silent refresh path, where there is a session already.

**Merge the two commands into one, dropping *Connect*.** Rejected because
reconnecting is a real, separate act. A session dies at 900 seconds (finding 18)
while the credential is still perfectly good, and the user needs a command that
says *reconnect* without implying anything about their credential. ADR-0012's
*Disconnect* would also have no counterpart.

**Have *Connect* sign in when it needs to, and leave *Sign In* alone.** This is
half-true already — Connect acquires a credential silently when one is stored.
Rejected as the *primary* answer because it solves the problem in the direction
nobody looks: a new user with no credential reads the command list, sees "Sign
In", and runs that first. The fix has to be on the door people actually walk
through.

## Consequences

**Sign In can now fail for a reason that is not about the credential.** The
credential succeeds, the connect fails — an unreachable compute service, no
Python-capable context, a cancelled context pick. The command reports the connect
failure on its own terms rather than folding it into "signing in failed", because
telling a user their sign-in failed when their credential is fine sends them to
re-authenticate against a problem authentication cannot fix.

**Sign In is slower and more visible than it was.** It now shows the context
picker on first use and the *Connecting to SAS Viya…* progress. That is the point
— the work was always going to happen — but it means the command is no longer
instantaneous, and the cancellation paths through it are worth testing rather
than assuming.

**The two entry points must stay in step.** *Sign In* and *Connect* now share the
connect implementation through one function type; if a third entry point appears
it takes the same dependency rather than growing its own copy. Two
implementations of "connect" would disagree the same way two implementations of
"sign in" did before slice 1c, and the disagreement would surface as a run
failing against a session the user believes exists.
