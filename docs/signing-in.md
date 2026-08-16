# Signing in

Once you have a [connection profile](connection-profiles.md), run **Python on
Viya: Sign In** from the Command Palette. Your browser opens on your
deployment's own login page — the extension never asks for your Viya password.
Meanwhile an input box titled **Sign in to SAS Viya** appears at the top of the
editor.

On most deployments, what you do next is copy. After you authenticate, Viya
shows a consent page naming the access the extension is asking for; approve it,
and the page displays a short code. Paste that code into the **Sign in to SAS
Viya** box and the sign-in completes. This is the ordinary route rather than a
degraded one, for the reason explained under [OAuth clients](#oauth-clients-and-the-secret-prompt)
below: the client most deployments sign you in with is registered to display the
code, not to hand back to the editor.

If your administrator registered a client with the extension's own redirect
address, the browser returns you to the editor by itself and the box closes
without you touching it. Both routes are live at the same time, so whichever one
your deployment supports is the one that finishes.

You can change your mind. Press `Escape` on the box, or close the browser tab and
leave it, and the sign-in simply stops — no error message, nothing to dismiss.
Only the log records it, under **Python on Viya** in the Output panel. Run the
command again whenever you are ready; nothing was left behind.

Signing in also connects. There is little point proving who you are and then
stopping, so once the sign-in completes the extension opens a compute session on
the active profile and the message names both — see
[Connecting to Viya](connecting.md) for what that session is and how long it
lasts. If the session cannot be opened, the sign-in still stands and the message
says so, because the one thing worth knowing at that point is that you do not
have to sign in a second time to try again.

The two commands meet in the middle. **Connect** signs you in first if you are
not signed in, and **Sign In** connects afterwards, so from a cold start either
one gets you the whole way and which you reach for is a matter of what you were
thinking about.

## The Accounts menu

The extension registers **SAS Viya** as an authentication provider, which is the
same mechanism GitHub and Microsoft accounts use. That means your sign-in shows
up in the Accounts menu at the bottom of the Activity Bar, next to the gear, and
you can sign in and out from there instead of from the Command Palette if you
prefer.

Signing in from that menu does **not** connect, which is the one place the two
routes differ. The editor polls that menu, you open it to read rather than to
start something, and it can act on a deployment other than the one your active
profile names — so a SAS process started from it would be one you did not ask
for, on a deployment you were not looking at. Run **Python on Viya: Connect to
SAS Viya** when you want the session.

The name shown next to the account is your display name as Viya reports it. If
your identity provider does not publish one, your login name is shown instead,
and if there is no login name either, the identity service's own id for you. That
last case is unlovely and it is still better than an unlabelled row.

## More than one deployment at once

Each connection profile signs in separately and appears as its own account. A
test deployment and a production one can both be signed in at the same time, in
the same window, and signing out of one leaves the other alone.

Two profiles that point at the *same* deployment for the same person are the same
account, because an account is identified by the deployment plus the Viya user id
— not by the profile. Renaming a profile, or fixing a typo in your display name
in Viya, does not sign you out.

## Staying signed in

Sign-ins survive a window reload and an editor restart. When you come back, the
extension renews the session in the background using the refresh token it stored
at sign-in.

Opening the Accounts menu does **not** make a network request. The editor polls
that menu, and a provider that phones home each time turns a menu into a round
trip and a moment of bad Wi-Fi into a silent sign-out. A token is renewed when it
is actually spent, which the extension knows because it records the expiry at the
moment the token is issued.

If a renewal fails — the refresh token was revoked, the deployment is
unreachable, an administrator ended your session — the account quietly drops out
of the Accounts menu and the reason is written to the log. Nothing pops up,
because you did not ask for anything: opening a menu is not a request to be
interrupted. Run **Python on Viya: Show Log** to see what happened, then sign in
again.

Some deployments are configured not to issue refresh tokens at all. There is
nothing wrong when that happens — the sign-in works — but the session can only
last as long as its access token, usually about an hour, and then the account
leaves the Accounts menu on its own. The log says so when it does, so that a
sign-in which seems to have undone itself has an explanation you can find. Sign
in again to continue; there is no setting on this side that changes it.

A deployment that is switched off does not hold up the others. Profiles are
renewed side by side, and the menu is drawn with whatever has arrived within ten
seconds — so a test Viya that is down for the weekend cannot keep a production
account you are signed in to out of the list. The slow renewal is not abandoned:
when it lands it is kept, and that account appears the next time anything asks.

Connecting is the exception, on purpose. When something asks for one *particular*
account — which connecting does, because it knows which deployment it wants — it
waits for that account however long it takes. A deliberate request would rather
be slow than be told there is no session when there is.

## What is stored, and what is not

Only the refresh token is written to the editor's secret storage, which is
backed by your operating system keychain. It is keyed on the profile's generated
`id`, which is why renaming a profile does not lose it.

The access token — the credential that actually goes on every request — is held
in memory only, and is gone when the window closes. It expires within the hour
anyway, so writing it to disk would buy a few seconds of startup time in exchange
for a second long-lived copy of something worth stealing.

Signing out deletes the stored refresh token for that profile. It does not
revoke it at the deployment; if you need that, an administrator ends the session
in Viya.

## What the extension asks Viya about you

To label the account, the extension reads the current user from the identities
service. It asks for that resource's **summary** representation specifically, and
that one header is worth explaining.

The full representation of a user on a probed Viya 4 deployment contained a
street address with postal code, a work email address and two phone numbers. The
summary representation is the same URL and the same response code without those
three fields. The extension keeps three things from what comes back — the id, the
display name and the login name — and by asking for the summary, the rest never
enters the process at all, so it cannot reach a crash dump, a heap snapshot, or a
log file attached to a bug report.

If a deployment refuses the summary type, the extension retries with the full one
and discards the personal fields as it parses. That path exists because no Viya
3.5 deployment was available to check the summary type against — see
[`PROBE-FINDINGS.md`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/PROBE-FINDINGS.md),
findings 6 to 9, for what was and was not established.

The identity is read once per window and held. This resource asks not to be
cached and offers nothing to revalidate against, so asking repeatedly would cost
a request and answer the same thing.

## OAuth clients and the secret prompt

On **Viya 4 2022.11 and later**, leave the client ID empty on the profile. Those
deployments register a built-in public client called `vscode` and that is what
the extension signs in with. Nothing has to be set up for you.

That client is registered for out-of-band delivery — `urn:ietf:wg:oauth:2.0:oob`
in the specification's wording, "show the user a code" in practice — and it has
no `vscode://` address registered at all. This was confirmed against a live Viya
4 deployment on 2026-08-13, which rejected the extension's redirect address and
the SAS extension's own alike. So when no client ID is set, the extension sends
no redirect address, Viya displays a code, and the paste box is the way back. An
extension cannot change this; the registration belongs to the deployment.

To get the automatic hand-back instead, an administrator registers a client
whose redirect URI is `vscode://shai-alit.python-on-viya/auth-callback` and you
put that client's ID on the profile. This is worth doing for a team that signs
in often and is not worth doing to try one deployment once.

If your profile does name a client ID, you are asked once for that client's
secret, in a masked prompt, and the answer goes to secret storage. Leaving the
prompt empty is a real answer — plenty of registered clients are public — and it
is recorded as "this client has none" rather than thrown away, so you are not
asked again at every sign-in.

## When it does not work

**"Select a SAS Viya connection profile before signing in."** No profile is
active in this window. Run **Python on Viya: Switch Connection Profile** first.

**The browser opens and nothing comes back.** Expected on the built-in client:
copy the code the page is showing into the **Sign in to SAS Viya** box in the
editor. That box is the route, not a consolation prize.

**"Invalid redirect … did not match one of the registered values."** The
deployment's error page, after you authenticated. It means the client on your
profile is registered with a different redirect address than
`vscode://shai-alit.python-on-viya/auth-callback`. Either correct the
registration or clear the client ID from the profile to fall back to the
built-in client and the paste route. Note that this can only ever come from a
profile that names a client ID — the extension sends no redirect address at all
when it uses the built-in one.

**"Signed in, but Viya would not say who you are signed in as."** Authentication
worked and the identities service did not answer. The log has the status code.

**You are signed in but a request says you are not.** The extension distinguishes
a token the deployment actively rejected from a request that carried no
credentials at all, because both arrive as a `401` with an empty body and only
the first is fixed by signing in again. The log says which one happened.

**Nothing works in an untrusted workspace.** Signing in requires a trusted
folder, because it reads a stored credential and runs code on a remote server
under your identity — and because the folder is what names the endpoint the
credential is sent to. In an untrusted folder the Accounts menu shows no SAS Viya
session, the two sign-in commands drop out of the Command Palette — that is how
VS Code renders a command that is currently unavailable — and asking for either
through the API is refused with a message pointing at **Workspaces: Manage
Workspace Trust**.
Nothing is signed out and nothing is deleted; trust the folder and the session
comes back without a reload. Profile management still works without trust. See
[ADR-0002](adr/0002-workspace-trust-posture.md).

## What is not here yet

Viya 3.5 is unverified rather than supported: nothing here has been run against a
3.5 deployment, and the places where that matters are called out above rather
than papered over.

Deployments behind a private certificate authority are the next slice. Until it
lands, the extension trusts what your operating system trusts, which is enough
for a public certificate and not enough for an internal one.
