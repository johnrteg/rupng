#
# Web — TODO
#

Tracked TODOs for the web app. (Design/discussion lives in [SPECS.md](SPECS.md).)

* Add password policy settings from server init config API call and update PasswordPolicy state

## Connect auth (token) — WebSocket `$connect`

> **Not yet implemented.** The client currently connects to `/account/ws?accountId=<accountId>` passing **only
> the account id, no auth token**. A browser WS handshake can't set headers, so auth must come via either
> (a) the **same-origin session cookie** (sent automatically on the handshake) that the gateway/`$connect`
> authorizer validates, or (b) a short-lived **ticket/token in the query string** minted by an
> authenticated HTTP call just before connecting. **Either way the server must (1) authenticate the user
> and (2) verify they have a grant on `accountId`** — never trust `accountId` alone (it would let anyone
> subscribe to any account's stream). Wire this with the auth/JWT work. See
> `packages/services/src/aws/SPECS.md` → WebSocket (the server-side `$connect` auth + connection-registry
> convention).

# eof
