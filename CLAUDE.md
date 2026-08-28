# Engineering conventions (rupng)

Rules for working in this monorepo. Follow them by default; call out when a deviation is intentional.
These are **guidance** — for hard enforcement of the type rules, see *Enforcement* at the bottom.

## TypeScript style

- **These conventions apply to ALL code in the repo, no exceptions** — including the tooling in `tools/*`
  (the Electron **Console**, scripts) and both the Electron **main** and **renderer** processes. Console code
  is held to the same bar as service/web code: explicit variable types, meaningful (never single-char) names,
  a comment on every function + inline step comments on non-trivial bodies, `Array<T>`, Results over throws,
  etc. Don't write terser "it's just a tool" code.
- **Explicitly type everything** — variables, parameters, return types, and **EVERY `await` result. No
  exceptions.** Do not rely on inference for locals. This is non-negotiable: if you write `await`, the result
  goes into a variable with an explicit type annotation — **even when the result is discarded/ignored**
  (`const wrote : Type.Result<void> = await this.dynamo.put( TABLE, row );`, never `const wrote = await …`).
  Applies to **every** facade call — `dynamo.put/get/query/remove`, `s3.put/get/remove/presignGet`, `sqs.send`,
  `kafka.publishEvent`, `secrets.get`, an AI client call, `appmodel.server.fetch`, everything.
  - ✓ `const got : Type.Result<Row | undefined> = await this.dynamo.get<Row>( TABLE, key );`
  - ✗ `const got = await this.dynamo.get<Row>( TABLE, key );`
  - ✓ `const wrote : Type.Result<void> = await this.dynamo.put( TABLE, { ...row } );`
  - ✗ `const wrote = await this.dynamo.put( TABLE, { ...row } );`   ← the flagged mistake — still needs a type
  - This includes **every `appmodel.server.fetch(...)` call** — **declare** the reply type, never `as`-assert it:
    - ✓ `const reply : RestfulService.Reply<Foo.Response> = await appmodel.server.fetch( new Foo() );`
    - ✗ `const reply = await appmodel.server.fetch( new Foo() ) as RestfulService.Reply<Foo.Response>;`
- **No `any`.** Use `unknown` when the type is genuinely unknown, then narrow.
- **Array types use the generic form `Array<T>`, not `T[]`.**
  - ✓ `const rows : Array<string> = [];` · `Array<Account.Member>`
  - ✗ `const rows : string[] = [];` · `Account.Member[]`
- **Type EVERY parameter — including inline/arrow/callback params, especially in JSX handlers.** A bare
  lambda param is never acceptable; annotate it. This applies to **every** param, including ignored/`_`-prefixed
  event args and `.map`/`.filter`/`.forEach` callbacks.
  - ✓ `onChange={ ( value : string ) : void => setCount( Number( value ) ) }`
  - ✗ `onChange={ ( v ) => setCount( Number( v ) ) }`   ← untyped param **and** single-char name
  - ✓ `onChange={ ( _event : React.SyntheticEvent, index : number ) : void => selectTab( index ) }`
  - ✗ `onChange={ ( _e, index ) => selectTab( index ) }`   ← both args must be typed, even the ignored event
  - ✓ `TABS.map( ( tab : TabDef ) : JSX.Element => … )` · ✗ `TABS.map( ( t ) => … )`
- **Inline functions are one short expression only.** An inline/arrow function (a JSX prop handler, a
  `.map`/`.filter` callback, a `setState` updater, …) that runs **more than one line / statement** must be a
  **named function** (declared inside the component per the Web UI rules), passed by reference — not an inline
  block. Keep inline lambdas to a single expression.
  - ✓ `onSaved={ onEdited }` · `onClick={ () => setOpen( true ) }`
  - ✗ `onSaved={ ( ok : boolean ) => { setSnack( … ); setEditAsset( null ); void load(); return ok; } }`
- **One function call per line.** Never put **more than one function call on the same line** — whether nested,
  chained, or just two separate statements. Each call goes on its own line, indented one level in from its
  enclosing bracket, with the closing bracket back at the opener's indent. This applies to nested calls, fluent
  chains, argument lists that are themselves calls, AND multiple statements crammed onto one line with `;`. A
  single standalone call (no nesting) stays on one line.
  - ✗ two calls on one line (even a one-line `if`/block) — `if( ok ) { setHtml( body ); setMode( DESKTOP ); }`
  - ✓ split — each statement + call on its own line:
    ```
    if( ok )
    {
        setHtml( body );
        setMode( PreviewViewport.DESKTOP );
    }
    ```
  - **Exception:** a single `.map`/`.filter`/`.forEach` (etc.) whose callback body is **just one function
    call** stays on one line — that's one collection method + one call, not nesting.
    - ✓ `const providers : Array<string> = data.providers.map( ( info : ProviderInfo ) : string => info.provider );`
    - ✓ `rows.forEach( ( row : Row ) : void => remove( row ) );`
    - ✗ still not OK once it chains — `data.filter( ( row : Row ) => keep( row ) ).map( ( row : Row ) => toView( row ) )`
  - ✓ single call — `const wrote : Type.Result<void> = await this.dynamo.put( TABLE, row );`
  - ✗ nested/chained on one line — `setRows( data.filter( ( row : Row ) => keep( row ) ).map( ( row : Row ) => toView( row ) ) );`
  - ✓ each call on its own line, indented from the brackets:
    ```
    const views : Array<View> = data
        .filter( ( row : Row ) : boolean => keep( row ) )
        .map( ( row : Row ) : View => toView( row ) );
    ```
  - ✗ call-as-argument on one line — `publish( Events.envelope( { object, verb, data: toWire( row ) } ) );`
  - ✓ break the inner call out first:
    ```
    const envelope : Events.Envelope = Events.envelope( {
        object, verb, data: toWire( row ),
    } );
    const sent : Type.Result<void> = await this.kafka.publishEvent( envelope );
    ```
- Prefer `readonly`/`const`; don't mutate inputs.
- **A declared function's opening brace + body go on their OWN lines (Allman braces) — NEVER collapse the body
  onto the declaration line.** This holds even for a one-statement body and applies to every function/method
  declaration (module-scope, class methods, functions declared inside a component). The `{` starts the next
  line, the body is indented, the `}` closes on its own line. (Inline arrow callbacks that are one short
  expression stay inline per the inline-function rule — this rule is about *declared* functions, not lambdas.)
  - ✓
    ```
    function socialBaseUrl( network : string ) : string
    {
        return SOCIAL_BASE_URL[ network ] ?? "https://";
    }
    ```
  - ✗ one-liner — `function socialBaseUrl( network : string ) : string { return SOCIAL_BASE_URL[ network ] ?? "https://"; }`
- **Don't NEST declared functions inside other functions.** Declare helpers at the top level of their scope —
  module scope, a class method, or (for a component) the component body per the Web-UI rule — not inside another
  function/handler/render-helper. A render helper that needs sub-helpers (e.g. an inspector panel with
  `renameKey`/`addAttr`) declares them as sibling functions in the component body and passes what they need as
  args, rather than nesting them. By and large: no nested `function` declarations. **Few exceptions** — a tiny
  closure that must capture a loop/local variable, or a one-off passed straight to `map`/`filter` (an inline
  lambda, not a `function` declaration) — but default to NOT nesting.

## Naming

- **Descriptive, verbose names — never single-character** (`firstInitial`, not `a`; `value`, not `v`).
- camelCase members/functions · PascalCase types/classes · UPPER_SNAKE_CASE consts/enums-values-as-consts.
- Boolean names read as predicates (`isOwner`, `hasChildren`).

## Comments

- **A comment on every function** — what it does + why (the "why", not a restatement of the code).
- **Comment the steps inside a function that does a lot.** Any multi-step / non-trivial body (a worker, a
  pipeline stage, a fan-out, a retry/branch, an S3+DDB+queue sequence) gets a short `//` lead-in on each
  logical step explaining the *intent* of that block — so a reader follows the flow without reverse-engineering
  it. A long function with only a header doc-block is under-commented; the denser the logic, the more the
  inline steps must be narrated (e.g. `runArchive`: mark the record, zip each source, store, flip status).
- Keep the codebase's `////…` section separators between methods.
- Exported contracts/types get a short doc block.

## Error handling — return Results, don't throw

- **Service/data-layer methods NEVER throw.** Return `Type.Result<T>` (`{ ok:true, data } | { ok:false, error, cause? }`).
  Callers branch on `.ok`. This matches `dynamo.*`, `Sqs.*`, `RestfulService` (which returns a `Reply`, never throws).
  - Wrap fallible bodies in `ResultUtils.from( async () => … )` (captures throws), or return `ResultUtils.ok/err(...)`.
- Endpoint impls translate a failed Result into an HTTP status (`{ status, data:{ message } }`) — they don't rethrow.
- Throw only for truly unrecoverable programmer errors, never for expected failure paths.
- **`appmodel.server.fetch(...)` / `RestfulService` NEVER throws — it returns a `Reply` (a Result).** Branch on
  `reply.ok` (then read `reply.data` / `RestfulService.error( reply, … )`). **Do NOT wrap a `fetch` call in
  `try/catch`** (nor `try/finally` "to reset a spinner") — the catch is dead code. A statement after the
  `await` (e.g. `setBusy( false )`) always runs. Same for the data-layer facades (`dynamo.*`, `s3.*`, `sqs.*`,
  …): they return `Type.Result<T>`, so branch on `.ok`, don't `try/catch`.

## Models & closed sets

- **Closed sets are enums, not strings** (`ContactMethod`, `InviteStatus`, `Access.Role`). No stringly-typed flags.
  **Any value from a known, categorizable set is a defined enum — never an arbitrary `string`.** This holds
  everywhere the value appears: interface fields, `Array<Enum>` (not `Array<string>`), `Record`/map **keys**
  (`Partial<Record<Enum, …>>`), function params, and the JSON-Schema `enum` (`enum: Object.values( TheEnum )`).
  If you're typing `string` (or `Array<string>`) and the allowed values are finite and nameable, define or reuse
  the enum instead. A free-form value (user text, an opaque id, a prompt) stays `string`.
- **Define the model once in `@repo/api`** (the wire contract) and import it everywhere — service, web, and
  other packages. Never re-declare a parallel enum/interface at a call site (single source of truth; that's
  why the model lives outside its usage).
- **Config models and long-lived mutable entities export a `DEFAULT`** — a concrete instance of the model's
  safe baseline / initial state, co-located with `SCHEMA`/`validate`. Fill missing fields on read with
  `ObjectUtils.withDefaults( row, Model.DEFAULT )` so an older/partial datastore row tolerates schema drift.
  **Omit identity/required fields** (`id`, `createdAt`, keys, …) from `DEFAULT` — a row missing those is an
  anomaly to surface, not fabricate. Immutable/ledger models (invoices, payments, audit) generally get **no**
  `DEFAULT`. (`DEFAULT` is also what seeds AppConfig via `ensureSeeded`.)
- **THE JSON EDITOR AND THE SMART EDITOR ARE TWO VIEWS OF ONE CONTRACT — A CHANGE TO A CONFIG MODEL IS NOT
  DONE UNTIL BOTH ARE UPDATED, IN THE SAME CHANGE.** This applies to `MediaConfig`, `EmailConfig`,
  `AccountConfig`, `AuthConfig`, `GetBootstrap` (the `app` service's PUBLIC `web` profile), and
  `AppServiceConfig` (`app`'s INTERNAL `settings` profile) TODAY, and to every config model registered in
  `ConfigSchema.ts` from now on. Each has a hand-built Console form editor — `MediaConfig` →
  `tools/console/src/renderer/components/mediaConfig/`, `EmailConfig` → `.../emailConfig/`, `AccountConfig`
  → `.../accountConfig/`, `AuthConfig` → `.../authConfig/`, `GetBootstrap` → `.../appConfig/`,
  `AppServiceConfig` → `.../appServiceConfig/` — registered per (service, PROFILE) pair in `ConfigPanel.tsx`'s
  `SMART_EDITORS` map and toggled against the raw JSON editor (which lints against the SAME model's
  `SCHEMA`, registered the same way in `ConfigSchema.ts`). Most services have exactly one editable profile
  (`"settings"`); `app` is the one exception with TWO — `"web"` (public bootstrap) and `"settings"` (ops,
  e.g. `logLevel`) — each with its own model and its own smart editor, which is why both `ConfigSchema.ts`'s
  registry and `SMART_EDITORS` are keyed by `service → profile → …`, not just `service`. **Three THINGS
  update together whenever a config model's shape changes — treat a PR that touches only one as incomplete:**
    1. The model itself (`Config` interface + `SCHEMA` + `DEFAULT`, in its `@repo/api` file).
    2. `ConfigSchema.ts` (`packages/api/src/model/ConfigSchema.ts`) — register/update the schema + validator
       under `REGISTRY[ service ][ profile ]` / `VALIDATORS[ service ][ profile ]` (default profile key is
       `"settings"`; add a NEW profile key only if the model genuinely lives on a different AppConfig
       profile, as `GetBootstrap` does on `"web"`).
    3. The smart editor's section component(s), registered at `SMART_EDITORS[ service ][ profile ]` in
       `ConfigPanel.tsx` — a select for a new enum, a range-checked numeric input for a new number, a
       new/updated section for a new sub-object, a repeating-row editor for a new named collection.
  Skipping #2 means the JSON editor stops linting the field at all (silently). Skipping #3 means the field
  is invisible/unreachable in the smart editor, silently pushing operators back to hand-editing JSON —
  defeating the entire point of having one. Neither failure mode throws or fails a build, so this is easy to
  miss without deliberately checking both. Generic, non-model-specific pieces (the section card, a
  range-clamped number field, the log-level picker) live in the shared
  `tools/console/src/renderer/components/configEditor/` — reuse those rather than re-implementing per
  service; a new service's smart editor gets its own sibling folder (e.g. `.../authConfig/`) for its
  model-specific sections and registers itself in `SMART_EDITORS`.

## Web UI (apps/core/web)

- **UI strings are `{"..."}` literals** (localization-ready) — not localized yet; don't wire the label lookup.
- **Reuse house widgets**, don't hand-roll: `TableInput`, `SaveBar`, `DialogWindow`, `SnackAlert`,
  `TextInput`/`EmailInput`/`PasswordInput`/`SelectInput`/`CountryInput`/`ZipInput`/`TimezoneInput`/`UrlInput`,
  `AddressInput`, `OrganizationInput`, `CoordinateInput`.
- **Never use MUI `IconButton` directly — use the house `ButtonIcon`** (`id` + `icon` + `label` + `onClick`,
  optional `size`/`disabled`). It carries the tooltip + a11y label + consistent sizing. The only place raw
  `IconButton` is allowed is INSIDE the primitive icon-button widgets themselves (`ButtonIcon`, `ButtonIconDropdown`,
  …) and as an input adornment inside a core field widget (e.g. `PasswordInput`'s show/hide toggle).
- **A flex spacer is `<Pusher/>`, never `<Box sx={{ flexGrow: 1 }} />`.** Use the house `Pusher` to push
  siblings apart in a row.
- **Any action that changes state goes through a confirm `DialogWindow`** (remove, suspend, cancel, role change…).
- **`Stack` spacing: `1` for a `direction="row"` Stack, `2` for a column (default/vertical) Stack.** Text/theme
  come from the MUI theme (`CssBaseline` is mounted) — inherited text must flip with dark mode.
- **Never hard-code colors — only theme palette tokens.** Use `primary.main`, `primary.contrastText`,
  `text.secondary`, `background.paper`, `divider`, `action.selected`, etc. (or `alpha( theme.palette.…, n )`
  for a tint). **No** hex / `rgb()` / named CSS colors (`#fff`, `rgba(...)`, `"white"`) anywhere in a component.
  Every colored surface must flip correctly in light/dark mode; if a color is reused, add it to the theme
  (a palette entry / variant) rather than repeating a literal at call sites.
- Dates/numbers/**money**/**bytes** via `appmodel.ui.locale.*` (never `toLocaleString`, `Intl.*`, `ByteUtils`,
  or hand-built strings directly). **Currency:** `appmodel.ui.locale.currency( value, digits )` — never a
  manual `` `${ (amount/100).toFixed(2) } ${ currency }` `` (amounts are minor units/cents, so pass
  `amount / 100`). **Byte sizes:** `appmodel.ui.locale.bytes( value )` — never a hand-rolled KB/MB helper.
- Renderer/helper functions used by a component live **inside** that component, not at module scope.
- **`useEffect` (and other hook) callbacks are NAMED functions passed by reference, never inline multi-statement
  lambdas.** The component-mount effect calls a `componentLoaded()` function; other effects call an intent-named
  function (`onSelectionChanged`, …). Declare it inside the component and pass it by reference.
  - ✓ `function componentLoaded() : void { void load(); … }` then `React.useEffect( componentLoaded, [] );`
  - ✗ `React.useEffect( () => { void load(); const open = …; if( open ) setEditingId( open ); }, [] );`
  - (A one-line effect body may stay inline — same rule as any inline function.) The named function may return a
    cleanup function like any effect callback.
- **All functions live inside the component.** Event handlers, data-loading, formatting, and render helpers
  are declared in the component function body (closing over its props/state) — never at module scope. Only
  pure, stateless constants/types that don't depend on the component may sit at module scope.
- **One component per `.tsx` file.** Don't declare multiple components in a file. The *only* exception is a
  **small, presentation-only internal** component used solely by that file's main component (e.g. a row/panel
  with no data fetching and no significant state) — anything larger (its own fetching, effects, or meaningful
  state) gets its own file.
- **Every dialog gets its own `.tsx` file** — a `DialogWindow` (or any modal) and its content is a standalone
  component, never inlined in a page/parent. The parent owns open/close state and passes it in
  (`open`/`onClose` + typed callbacks); the dialog owns its own inner form state. Name it `<Thing>Dialog`
  (e.g. `BalanceTopupDialog`) and colocate it with its page (`pages/<area>/dialogs/`) or under `widgets/` if shared.
- **Prefer breaking a big component into smaller components over one giant file that does everything.** When a
  component grows large (many render helpers, distinct panels/sections, a toolbar, an inspector, repeated rows),
  extract cohesive pieces into their OWN component files (e.g. `<Thing>Toolbar`, `<Thing>Inspector`,
  `<Thing>SectionRow`) and compose them — passing state down + typed callbacks up. A single multi-hundred-line
  `.tsx` doing the whole feature is a smell; decompose it. (This refines "one component per file": a large
  presentation-only helper that would otherwise bloat the file should become its own file, not stay inline.)
- **STRICTLY one component per file — no exceptions for size.** A big feature component lives as a FAMILY of
  files in its OWN sub-directory (e.g. `widgets/email/editor/` → `EmailTemplateEditor.tsx` (the composer),
  `EmailBlockInspector.tsx`, `EmailDocumentSettings.tsx`, `SortableSection.tsx`, `SortableColumn.tsx`, …), with
  shared constants + pure helpers in a sibling non-component module (`<Thing>Model.ts(x)`). Each `.tsx` exports
  exactly ONE React component. If a `.tsx` grows past a few hundred lines or holds more than one component,
  split it into a sub-directory before adding more. A single render helper that renders a distinct panel/row is
  a component → its own file, not an inline function.

## Architecture & boundaries

- **No cross-service DB reads.** A service reads/writes only its own tables. Cross-service data flows via
  **APIs (S2S), events (Kafka), or work queues (SQS)** — or a shared authz read (the `Authorizer`), never a
  peer's table.
- Decoupled/async work uses **SQS** (queue → consumer); broadcast facts use **Kafka** events.
- **Anything that can take more than ~500ms MUST be a job, never inline in a request handler.** Media
  transforms (transcode, image resize/density, transcription, generation, zip/archive), multi-step fan-outs,
  or any external heavy call → **enqueue to SQS** and return `202` immediately; a consumer does the work and
  the client polls status (or a Kafka/websocket event lands). Endpoint `execute()` stays fast (validate →
  enqueue → return). Only genuinely trivial, bounded work runs inline.
- Denormalize for display where it avoids a cross-service read; keep it self-healing (backfill on next load).
- **Every service publishes CRUD events for its entities to Kafka.** On create/update/delete of a persisted
  entity, emit an `Events.Envelope` (`@repo/system`) via `kafka.publishEvent( Events.envelope({ object, verb,
  target, accountId, data, actorUserId }) )` — best-effort (log a miss, never fail the request). The topic is
  the `Events.Object` (`<service>.<noun>`); `data` is the entity's `@repo/api` wire model; register a consume
  floor in the `ACCESS` map (fail-closed to ROOT otherwise). This is the single source other services, outbound
  webhooks, and the **UI (over websockets, later)** consume — so it's not optional. **Document each event** in
  [packages/system/EVENTS.md](packages/system/EVENTS.md) (service → `action` id → `data` model → emitting site).
  See `MediaService.publishAsset` / `AccountService.emit` / `AuthService.emit` for the pattern.
- **Every service is Kafka-connected — it both PUBLISHES its own entity events AND CONSUMES the events it
  reacts to.** Assume the bus is always available to a service. A cross-service reaction is a **consumer**, not
  a peer API/DB call: subscribe with `kafka.subscribeEvents( "<consumer-group>", Events.Object.X, handler )` in
  the MAIN role's startup (best-effort — a bus outage must not block boot; log + carry on), switch on the
  envelope's `verb`, and keep the handler **idempotent** (redelivery is at-least-once). The handler updates only
  its OWN tables (never a peer's). Correlation is automatic: `publishEvent` stamps the ambient
  `RequestContext.transactionId()` onto `envelope.source.transactionId` + a Kafka header. Example: auth's
  `auth-avatar` consumer reacts to `media.asset` (USER scope) to link a processed avatar to its user.
- **Log level is dynamic — never redeploy just to change it.** `LOG_LEVEL` (CloudManifest `environment`) only
  seeds the level at cold start. Every `Application` (so every Service/Consumer/Job, no per-service code)
  ALSO polls its own `config/settings` AppConfig profile's optional `logLevel` field
  (`Application.refreshLogLevel`, `packages/services/src/Application.ts`) and applies it to the shared
  `Trace` instance via `Trace.setLevel`: once at boot (covers one-shot Jobs — each invocation is already
  fresh) and on a `Daemon`-owned interval (`~30s`, covers long-running Service/Consumer processes picking up
  a change without a restart). A Config model that formally declares `logLevel : LogLevel` (`@repo/api`'s
  shared `LogLevel` enum — trace/info/warn/error) gets it schema-linted + Console-editable
  (`MediaConfig`/`AuthConfig`/`AccountConfig` already do); one that hasn't still gets the live override for
  free (the read is loose — one optional field, not the full typed Config).

## Auth & security

- JWT is **identity-only**; roles/permissions resolve **per request** from DynamoDB (the `Authorizer`).
  The client sends the acting account via the **`X-Account`** header (→ `auth.accountId`).
- **Dev API keys are the PUBLIC-API credential ONLY.** A `Authorization: Bearer rup_<keyId>.<secret>` key
  (verified by `Authorizer.verifyApiKey`) authenticates **only `audience: PUBLIC` endpoints**. Presented to
  an `APP` (first-party) or `INTERNAL` (S2S) endpoint it's rejected with **403** ("API keys can only be used
  with the public API") — even when the key is valid. Session JWTs work across audiences as normal; only the
  dev-key path is audience-gated (enforced in `Service.processEndpoint`). So a key can reach an endpoint iff
  the endpoint is **PUBLIC** *and* the key's role meets `access`.
- **Enumeration-neutral** on registration / login / password reset. Reveal "already exists" only after a
  passed bot check (fail-closed). `GetUserExists` is authenticated-admin only.
- Secrets live in **Secrets Manager**, not AppConfig. Token signature is **decode-only in dev**; prod verifies.

## Services & endpoints

- Endpoint **contracts** (`RestfulEndpoint`) live in `@repo/api`; the service **impl** extends the contract.
- `access` uses the `Access` ladder (`MINIMUM < SENDER < USER < BILLING < ACCOUNT`); `audience` is
  `APP` / `PUBLIC` (edge) or `INTERNAL` (VPC-only S2S).
- **Request-body schemas: no `format: "email"`** — the client's body validator is a strict, formatless Ajv
  (unknown formats throw). Validate loosely in the schema; normalize in the impl.
- Local API routing: the dev webproxy builds its route table by parsing each service's role file for
  `new <X>Impl(` — so a MAIN-role endpoint must be registered in the MAIN role file. The **account** service
  serves its local API from the **read** role (`LOCAL_API_ROLE`).

## Local dev / build

- Turborepo + npm workspaces; `@repo/*` resolves to **source** via tsconfig paths.
- Services build with `rup-bundle` (esbuild) and run with `tsx watch`. **`tsx watch` reloads a service's own
  `src` but NOT rebuilt `@repo/*` deps — restart the service after a shared-package change.**
- New DynamoDB tables / SQS queues (or buckets) need a **LocalStack redeploy** of that service's stack before use.
- Typecheck a package with `npx tsc --noEmit` (ignore cross-package `TS6059 rootDir` noise from bare `tsc`).
- **New endpoint contracts stay parameterless-constructible** — the CDK gateway generator (`cloud/src/app.ts`
  → `apiEndpoints([ new Foo() ])`) instantiates each with no args, so every constructor arg must be optional.
- **A new provider secret (`Providers.ts` entry, e.g. `email-mailgun`, `ai-anthropic`) needs THREE things wired,
  not just the CDK secret.** (1) The `Providers.ts` registry entry + CDK provisioning
  (`ServiceStack.makeSecret`/`PlatformStack.makeSecret`) creates the physical secret — but with **no value**;
  CDK defaults to a random 32-char placeholder. (2) The real key must be pushed into it — locally, add an entry
  to **`cloud/local/put-secrets.mjs`**'s `secrets` map sourced from `.env.local` (e.g.
  `"local-email-secret-email-mailgun": env.MAILGUN_API_KEY`) and rerun the script; in deployed envs it's set
  out-of-band (console/CLI/CI). (3) There is **no in-app UI/endpoint to write secret values** — provider config
  endpoints (`PutEmailConfig`, …) only persist which secretRef/provider to use, never the key itself; `Secrets`
  is read-only (`get`/`getJson`). **A secret sitting in `.env.local` but missing from `put-secrets.mjs` is a
  silent trap** — the service resolves an unrelated auto-generated placeholder and every call fails
  authentication (e.g. a `401` from the provider) with no hint that the key was never actually seeded. When
  adding a new provider/secret, always add its `put-secrets.mjs` line in the same change.

## Adding a NEW service (checklist — each step fails a *different* build if skipped)

1. **Model + contracts** in `@repo/api` (exported from its index); **impls** in `apps/core/<svc>/src/endpoints`.
2. **App package** — `package.json` (`@repo/*` deps + `"./manifest": "./src/CloudManifest.ts"` export), `tsconfig.json`,
   `src/index.ts` (role factory), `src/services/<Svc>Service.ts` base + `<Svc>MainService.ts`, `src/CloudManifest.ts`.
3. **`npm install` at the repo root** — a new workspace (or new dep) MUST land in `package-lock.json`, or the
   Docker build's `turbo prune <svc> --docker` fails with **"No lockfile entry found for apps/core/<svc>"**.
4. **Register in the CDK app** (`cloud/src/app.ts`): import `manifest as <svc>Manifest` from `<svc>/manifest`,
   add it to the `manifests[]` array (→ the `<svc>-<env>` stack), and append its routes via
   `apiEndpoints([ new … ])`. Skip this and `cdklocal deploy *<svc>*` reports **"No stacks match"**. Add the
   service to `cloud/package.json` deps too (it resolves via root-hoisted `node_modules`, but declare it).
5. **Deploy to LocalStack** (`cdklocal deploy <svc>-local`) to create its S3/DDB/SQS, then run it.
6. Ports live in `@repo/cloud-manifest` `Ports`; the service id in `@repo/system` `Register.Service`; the
   Console shows it from `tools/console/src/shared/catalog.ts`.

## Enforcement (optional, recommended)

CLAUDE.md is guidance. To *enforce* the type rules, add ESLint
(`@typescript-eslint/typedef`, `explicit-function-return-type`, `naming-convention`, `no-explicit-any`) and a
`PostToolUse`/pre-commit hook that runs `tsc --noEmit` + `eslint`. Ask before adding these.
