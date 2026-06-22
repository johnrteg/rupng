#
# `@repo/oauth` — the OAuth-broker capability
#

Runs the **delegated-access dance** for 3rd-party providers — authorize → token → **refresh** → revoke —
so the platform can act as an account against a provider's API **without the account ever handling raw
tokens**. One interface ([`OAuthBroker`](src/OAuthBroker.ts)); operational failures are **returned**
(`Type.Result`), never thrown.

## Hybrid: Nango for the long tail, native for the few

"OAuth2" is a family, not a spec — every provider differs on scopes, PKCE, refresh-token rotation, token
TTLs, and app-review gates. So:

* **Nango (default)** — [`NangoBroker`](src/adapters/NangoBroker.ts) wraps a **self-hosted Nango** server
  over its REST API (via `@repo/endpoint`'s `RestfulService`). Self-hosted ⇒ **tokens stay in our infra**
  (consistent with the KMS-vault posture), and Nango absorbs the per-provider OAuth quirks + refresh for
  the **long tail** of integrations.
* **Native (later)** — a high-value provider can get a hand-built adapter behind the **same**
  `OAuthBroker` interface; register it with `OAuthFactory.registerNative(provider, broker)` and it wins
  over Nango for that provider. Build the few, delegate the rest.

## Usage

```ts
import { OAuthFactory, OAuth } from "@repo/oauth";
import type { OAuthBroker } from "@repo/oauth";
import type { Type } from "@repo/common";

// configure once at boot (secretKey from Secrets Manager in cloud, env locally)
OAuthFactory.configure( { host: process.env.NANGO_HOST, secretKey: nangoSecret } );

const broker : OAuthBroker = OAuthFactory.for( "hubspot" );   // → Nango (or a native adapter if registered)

// 1) start a connect flow — hand session.token to the frontend OAuth SDK
const session : Type.Result<OAuth.ConnectSession> = await broker.startConnect( "hubspot", installationId );

// 2) later, call the provider API with auth injected (no token handling here)
const contacts : Type.Result<unknown> = await broker.proxy( "hubspot", installationId, {
    method: "GET", endpoint: "/crm/v3/objects/contacts",
} );
if ( contacts.ok ) use( contacts.data );

// or get a fresh token yourself
const token : Type.Result<OAuth.Token> = await broker.getToken( "hubspot", installationId );

// uninstall → revoke + delete (idempotent)
await broker.disconnect( "hubspot", installationId );
```

* **`provider`** = the integration key (Nango "provider config key"), e.g. `"hubspot"`.
* **`connectionKey`** = our stable id for the account's connection — typically the **marketplace
  installation id** (account + integration + instance).

## Where it fits

The **marketplace** owns *which* integrations an account has + the lifecycle; this package owns *the
tokens + refresh*. Marketplace's `credentialType: oauth` installs route through here; `api_key` / `basic`
/ `webhook` credentials skip the broker (just validate + vault). See `apps/core/marketplace/SPECS.md`.

## Notes / open

* **Secret handling** — `secretKey` should come from **Secrets Manager** (cloud) / env (local), never
  hardcoded — same posture as `@repo/ai` keys.
* **Nango REST endpoints** — `NangoBroker` targets Nango's documented REST API; verify against the
  deployed Nango version when it's stood up (connect-session, connection, proxy, delete routes).
* **Sync/webhooks** — Nango can also run provider→us syncs + webhooks; if we adopt those, they surface as
  marketplace **triggers** (normalized events) — a later addition behind this package.
