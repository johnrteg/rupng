# DynamoDB tables — SPEC: the entity interface ⇄ the manifest `TableSpec`

How a service's **TypeScript entity interface** (the item's full schema) relates to the **`TableSpec`** it
declares in its manifest. This is the contract that keeps the two in sync.

Scope: the manifest side of DynamoDB. For *when* to pick DynamoDB vs RDS/Redis, relationships, migrations, and
change discipline, see [`@repo/services` DATABASE.md](../../services/DATABASE.md). For the manifest as a whole,
see [`MANIFEST.md`](./MANIFEST.md). The types are in [`Resources.ts`](../src/Resources.ts) (`TableSpec`) and
[`TableKeys.ts`](../src/TableKeys.ts) (`keyOf` / `ttlOf`).

---

## Layout — accounts, services, tables (and what `key` actually is)

The hierarchy, top down:

```
AWS account            one per MARKET × ENVIRONMENT  (e.g. US-prod, EU-prod, US-dev)
  └─ service stack     one per service               (app, auth, contact, …) — OWNS its tables
       └─ table        logical key "notices"  ⇒  physical  prod-app-table-notices
            └─ items   rows; each a bag of attributes (schemaless beyond the key)
```

* **Services segment the tables.** Every table is **owned by exactly one service** (declared in that
  service's `owns.tables`). A service never reaches into another's table directly — it declares `uses` and the
  CDK grants least-privilege IAM. Think of each service as owning its **own database/schema**: no shared
  tables, no cross-service joins.
* **`key` is the *logical* table name, not the physical one.** In the manifest and in code you say `"notices"`.
  At synth the physical AWS table name is composed as **`<env>-<service>-<kind>-<key>`** →
  `prod-app-table-notices` ([`makeTable`](../../../cloud/src/lib/ServiceStack.ts) via `physicalName`). The
  `<env>-<service>-` prefix is what **isolates** every environment and service (no name collisions, clean IAM
  scoping). Code never hardcodes the physical name — `CloudResolver.tableName("notices")` resolves it at boot.
  So within a service the `key` uniquely names the table; globally it's prefixed.
* **One table per entity is the default**; DynamoDB *single-table design* (many entity types in one table,
  discriminated by key prefixes) is an option — see the note under the mapping rules.

### SQL analogy

| SQL (Postgres) | DynamoDB (here) |
|---|---|
| a **database / schema** | a **service's** set of tables (`<env>-<service>-` namespace; the service owns it) |
| a **table** | a DynamoDB table — `key` = logical name; physical = `<env>-<service>-table-<key>` |
| a **row** | an **item** |
| a **column** (typed, declared) | an **attribute** (schemaless — only the key attributes are declared) |
| **primary key** | **partition key** (+ optional **sort key**) |
| a secondary **index** | a **GSI** (own PK/SK) / **LSI** (same PK, alt SK) |
| **foreign key / `JOIN`** | — none — denormalize, or model adjacency lists / a GSI "by the other side" |
| `USE db; SELECT … FROM notices WHERE …` | `resolver.tableName("notices")` → the env+service-scoped physical table, then `query` |

Where the analogy **breaks**: a SQL table is one entity type with a fixed column set the engine enforces; a
DynamoDB table is a key-addressed item store with no column schema, and *single-table design* can put many
entity types in **one** physical table (no SQL equivalent). That's why the **entity interface** — not the
table — carries the schema (next section).

---

## The core idea — two artifacts, one table, **keys are the only overlap**

DynamoDB is **schemaless except for its keys.** An item is a bag of attributes; two items in a table need not
share anything beyond the key. So a table is described by **two** things that live in **two** places:

| Artifact | Lives in | Describes | Owns |
|---|---|---|---|
| **Entity interface** (`interface Notice {…}`) | the service's `src/` (app code) | the **full item shape** — *every* attribute + its type | the application (enforced by TS + ajv at the edges) |
| **`TableSpec`** | the service's `CloudManifest.ts` (manifest) | **only what AWS must provision** — the key schema, indexes, TTL attr, stream, encryption, capacity | `/cloud` (provisions the table) |

**The only overlap is the key attributes.** The `TableSpec` names a handful of fields — the partition key, an
optional sort key, each GSI's keys, and the TTL attribute — and **those names must be fields of the entity
interface, with matching types.** Everything else in the interface is a **non-key attribute**: DynamoDB stores
it without being told, so it never appears in the manifest.

```
interface Notice {                          TableSpec (manifest)
  accountId : Type.ID;    ───────────────▶  partitionKey: { name: "accountId", type: S }
  noticeId  : Type.ID;    ───────────────▶  sortKey:      { name: "noticeId",  type: S }
  status    : NoticeStatus;  ──┐
  title     : string;          │  non-key attributes —
  body      : string;          ├─ stored as-is, NOT in        (only key fields cross the line)
  audience  : string[];        │  the manifest (schemaless)
  expiresAt : Type.EpochSeconds;  ────────▶  ttlAttribute: "expiresAt"   (epoch-SECONDS, not millis)
}
```

> **Type the interface with the semantic `Type.*` aliases** (`@repo/common`), not bare `string`/`number`:
> `Type.ID` (ids), `Type.ISODateTime` / `Type.EpochMilliseconds` (instants), and — critically for TTL —
> **`Type.EpochSeconds`** (its doc warns mixing it with `EpochMilliseconds` is a 1000× error). They still map
> to DynamoDB key types by their underlying primitive (`Type.ID → S`, `Type.EpochSeconds → N`), so `keyOf` /
> `ttlOf` and `AttrTypeOf` work unchanged — you just gain the intent at the field.

The interface is the **authoritative schema**; the `TableSpec` is a **projection of its key fields** plus
table-level infrastructure config. Type/shape enforcement happens in the app (TS + ajv) — not at the DB.

---

## `TableSpec` — field reference

```ts
export interface TableSpec {
  key                     : ResourceKey;                 // logical handle (e.g. "notices") — resolves to the physical name
  partitionKey            : KeyAttr;                     // { name, type } — REQUIRED; the field items hash/partition on
  sortKey?                : KeyAttr;                     // optional second key element (item collections, range queries)
  billingMode?            : BillingMode;                 // ON_DEMAND (default) | PROVISIONED
  capacity?               : PerEnv<{ readUnits; writeUnits }>;  // PROVISIONED only
  ttlAttribute?           : string;                      // a NUMERIC field (epoch-seconds) DynamoDB auto-expires on
  stream?                 : StreamViewType | false;      // NEW_AND_OLD_IMAGES etc. — CDC for event publishing / replicas
  globalSecondaryIndexes? : GsiSpec[];                   // alternate access paths (own PK/SK)
  pointInTimeRecovery?    : boolean;                     // continuous backups
  kmsKey?                 : ResourceKey;                 // → a KmsKeySpec for CMK encryption (else AWS-managed)
  tags?                   : Tags;
}

export interface KeyAttr { name: string; type: AttrType; }          // AttrType = STRING "S" | NUMBER "N" | BINARY "B"
export interface GsiSpec {
  name: string; partitionKey: KeyAttr; sortKey?: KeyAttr;
  projection?: "ALL" | "KEYS_ONLY" | "INCLUDE"; projected?: string[];   // which attributes the index copies
}
```

`KeyAttr.type` is one of **`AttrType.STRING` (S) / `NUMBER` (N) / `BINARY` (B)** — the only three DynamoDB key
types. (Non-key attributes can be any DynamoDB type; they're never declared here.)

---

## The mapping rules

For a `TableSpec` describing entity `E`:

1. **Every key name is a field of `E`.** `partitionKey.name`, `sortKey?.name`, every GSI key name, and
   `ttlAttribute` **must** be keys of the interface. (A typo or rename here is the classic drift bug.)
2. **`AttrType` matches the field's TS type.** `string → S`, `number → N`, `Uint8Array → B`. A literal union
   (`status: "draft" | "sent"`) or branded id (`Type.ID = string`) is still `S`.
3. **Key fields are required and effectively immutable.** A partition/sort key can't be changed in place — you
   re-key by writing a new item. Model keys as **required, stable** fields on the interface.
4. **`ttlAttribute` is optional; type its field `Type.EpochSeconds`** (`@repo/common`) — Unix epoch-**seconds**,
   *not* millis, *not* an ISO string. ⚠️ Don't use `Type.EpochMilliseconds` here: TTL needs seconds, so a millis
   value is ~1000× too large → items never expire (the 1000× error `Type.EpochSeconds`'s own doc warns about).
   Store `Math.floor(ms / 1000)`. `ttlOf<E>()` checks the field is `number` but **can't** tell seconds from
   millis (both alias `number`) — so `Type.EpochSeconds` is the *intent* contract, not a nominal guard.
   **Opting out of expiry:** omit `ttlAttribute` from the `TableSpec` for a table where *nothing* expires; for
   a table where only *some* items expire, make the field **optional** (`expiresAt?`) and set it only on the
   ones that should — DynamoDB expires an item only when the attribute is **present + numeric + ≤ now**, so an
   absent attribute = permanent. (The facade's `removeUndefinedValues` drops an unset `expiresAt` cleanly;
   `ttlOf` still accepts the optional field via `NonNullable`.)
5. **Non-key fields never appear in the manifest.** Adding/removing them is a pure code change (schemaless).
6. **GSI keys follow the same rules** — their names are fields of `E`, types match. `projection` decides which
   *other* attributes the index carries (`ALL` = full item; `KEYS_ONLY` = keys only; `INCLUDE` = `projected[]`).

> **Single-table design.** If you overload one table across entity types (`PK = "ACCOUNT#123"`, `SK =
> "CONTACT#456"`), the key fields are *generic* (`pk: string; sk: string`) and the per-entity interfaces are a
> discriminated union over them. The key `AttrType` is `S`; the entity discriminator lives in a non-key
> attribute. Same rules — the manifest still only knows the generic key fields.

---

## Recommended: bind the keys to the interface (`keyOf` / `ttlOf`)

Because `partitionKey.name` is a plain string, nothing *forces* it to match the interface — that's a drift
point. Use [`keyOf<E>()` / `ttlOf<E>()`](../src/TableKeys.ts) so the binding is **checked at compile time**:

`keyOf<E>()` returns a **`KeyBuilder<E>`** (and `ttlOf<E>()` a `TtlBuilder<E>`) — a generic *function* bound to
the entity, not a value. Annotate it if you like, or just call it inline:

```ts
import { keyOf, ttlOf, KeyBuilder, AttrType } from "@repo/cloud-manifest";

const k : KeyBuilder<Notice> = keyOf<Notice>();   // a key-builder FUNCTION bound to the Notice interface
// type of k: <K extends keyof Notice & string>( name: K, type: AttrTypeOf<Notice[K]> ) => KeyAttr

tables: [ {
  key          : "notices",
  partitionKey : k( "accountId", AttrType.STRING ),   // ✓
  sortKey      : k( "noticeId",  AttrType.STRING ),   // ✓
  ttlAttribute : ttlOf<Notice>()( "expiresAt" ),      // ✓ (expiresAt must be `number`)
  billingMode  : BillingMode.ON_DEMAND,
  kmsKey       : "data",
} ]

// k( "acountId", AttrType.STRING )      → compile error: "acountId" is not a field of Notice
// k( "accountId", AttrType.NUMBER )     → compile error: accountId is a string (S), not N
// ttlOf<Notice>()( "title" )            → compile error: title is not numeric
```

A rename of `accountId` in the interface now **breaks the build** until the manifest follows — the same
single-source-of-truth discipline used for ports and event topics. Plain `{ name, type }` literals still work
(the helper is opt-in), but `keyOf`/`ttlOf` are preferred for real entities.

---

## Worked example

```ts
// ── notice.ts (app code) — the AUTHORITATIVE schema ───────────────────────────
export enum NoticeStatus { DRAFT = "draft", PUBLISHED = "published" }

export interface Notice {
  accountId   : Type.ID;              // ← partition key      (S)
  noticeId    : Type.ID;              // ← sort key           (S)
  status      : NoticeStatus;         // ← GSI partition key  (S)   — "list notices by status"
  publishedAt : Type.EpochMilliseconds;  // ← GSI sort key    (N)   — an instant
  title       : string;               //   non-key
  body        : string;               //   non-key
  audience    : string[];             //   non-key
  expiresAt?  : Type.EpochSeconds;    // ← TTL  (N, SECONDS)  — OPTIONAL: set → expires then; absent → permanent
}

// ── CloudManifest.ts (manifest) — the PROVISIONING projection ─────────────────
const k : KeyBuilder<Notice> = keyOf<Notice>();
tables: [ {
  key          : "notices",
  partitionKey : k( "accountId", AttrType.STRING ),
  sortKey      : k( "noticeId",  AttrType.STRING ),
  ttlAttribute : ttlOf<Notice>()( "expiresAt" ),
  billingMode  : BillingMode.ON_DEMAND,
  kmsKey       : "data",
  stream       : StreamViewType.NEW_AND_OLD_IMAGES,   // CDC → publish media-style change events
  globalSecondaryIndexes: [
    { name: "byStatus",
      partitionKey: k( "status",      AttrType.STRING ),
      sortKey:      k( "publishedAt", AttrType.NUMBER ),
      projection: "ALL" },
  ],
} ]
```

`title` / `body` / `audience` are in the interface but **not** the manifest — DynamoDB stores them with no
declaration. `accountId`/`noticeId`/`status`/`publishedAt`/`expiresAt` appear in **both**, names and types
bound by `keyOf`/`ttlOf`.

---

## Multi-tenant keys, sorting & paging

### The default key
For a tenant-scoped entity, the default is **`PK = accountId`, `SK = itemId`** (a uuid). It gives tenant
isolation in the key, "list all of this tenant's items" via `Query(PK = accountId)`, and a cheap point
`GetItem(accountId, itemId)`. Caveats, decided per entity:
* **Lookup by `itemId` alone** isn't possible (GetItem needs the full key) → add a GSI `byId` with
  `PK = itemId` for public links / webhooks / staff tooling. (Usually you *have* the `accountId` from the session.)
* **A uuid `SK` has no useful order** (see sorting, below).
* **Hot partition** risk for high-volume-per-tenant tables → shard the PK (`accountId#<n>`) for those.

### Sorting — DynamoDB sorts by the SORT KEY only, never an arbitrary field
There is **no `ORDER BY <any column>`**. Within a `Query` (partition key fixed), items come back ordered by
the **sort key** — that is the *only* ordering DynamoDB does. So "sort on any field that isn't `accountId`/
`itemId`" means: **make a GSI whose sort key is that field**, keeping `accountId` as the GSI partition key so
the tenant scope is preserved:

```ts
// manifest — one GSI per sort order you need (keep PK = accountId for tenant scope)
globalSecondaryIndexes: [
  { name: "byCreated",  partitionKey: k("accountId", AttrType.STRING), sortKey: k("createdAt", AttrType.NUMBER) },
  { name: "byStatus",   partitionKey: k("accountId", AttrType.STRING), sortKey: k("status",    AttrType.STRING) },
]
```

* **One GSI = one sort order.** You pre-declare each sortable access path; you can't reorder by an arbitrary
  attribute at query time. So index the *few* fields you actually sort/filter on — not every column.
* **Encode the SK so lexical order = logical order.** DynamoDB orders `S` keys **lexicographically**, `N` keys
  **numerically**. Use epoch-seconds / zero-padded numbers / ISO-8601 (`…Z`) for dates so the byte order is the
  order you want. Composite + tie-break: `SK = "<status>#<createdAtEpoch>#<itemId>"` ("by status, then newest,
  uuid breaks ties"). The `itemId` suffix also keeps the GSI key unique.
* **Sparse by nature:** an item missing the GSI's key field simply isn't in that index — often useful (index
  only the rows that have the field).

### Sort direction
`ScanIndexForward: true` (default) = **ascending** by sort key; `false` = **descending** (e.g. newest-first).
Per-query, and the only direction control — you read the one SK order forwards or backwards.

### Recommended: a `byModified` index for "recent activity"
The common listing is "this tenant's items, **newest-changed first**." Give the entity a numeric
`lastModifiedAt` (epoch — bump it on every write) and add the standard index, then page it descending:

```ts
// manifest
globalSecondaryIndexes: [
  { name: "byModified", partitionKey: k("accountId", AttrType.STRING), sortKey: k("lastModifiedAt", AttrType.NUMBER) },
]
```

### Paging — cursor, not offset (`Dynamo.queryPage`)
A `Query` returns at most **1 MB** of items (or `Limit`, whichever hits first). `Dynamo.queryPage` surfaces the
continuation cursor (an opaque string wrapping `LastEvaluatedKey`); pass it back to get the next page. It's
**forward cursor paging** — there is **no `OFFSET` / "jump to page 50."** `opts.limit` is the page size,
`opts.forward` the sort direction.

```ts
// "newest 25 notices for this account", page by page (GSI byModified, descending)
let cursor : string | undefined = undefined;   // page 1 starts with no cursor

const page : Type.Result<Dynamo.Page<Notice>> = await this.dynamo.queryPage<Notice>( "notices", {
  IndexName                 : "byModified",
  KeyConditionExpression    : "accountId = :a",
  ExpressionAttributeValues : { ":a": accountId },        // DocumentClient — plain value, no { S: … }
}, { limit: 25, forward: false, cursor } );               // forward:false → newest first; cursor: undefined on page 1

if ( page.ok )
{
    const items  : Array<Notice>      = page.data.items;    // the page of entities
    cursor                            = page.data.cursor;   // opaque string for the next page; undefined = last page
}
```

> **Expression placeholders.** `:a` is a **value** placeholder (a bind parameter, like SQL `:param`) — its
> value comes from `ExpressionAttributeValues` (`{ ":a": accountId }`); you can't inline a literal in the
> expression. `#x` is the sibling for an **attribute name** (`ExpressionAttributeNames`), required when a field
> is a DynamoDB **reserved word** — e.g. `status` is reserved, so the `byStatus` GSI needs
> `KeyConditionExpression: "#st = :s"`, `ExpressionAttributeNames: { "#st": "status" }`,
> `ExpressionAttributeValues: { ":s": NoticeStatus.PUBLISHED }`. (Values are plain — DocumentClient — not `{ S: … }`.)

### Limits & the filter gotcha
`opts.limit` caps the items DynamoDB **reads**, *before* any `FilterExpression` is applied. A filter runs
**after** the read — so a filtered page can return **fewer than `limit`** items even when more match deeper in
the partition (and you still pay read cost for the filtered-out items). Filters don't index. Put selective
discriminators **in the key / a GSI**, not in a filter. (For batch / transaction / scan, reach through
`dynamo.client`.)

### When you need arbitrary sort/filter (sortable-column tables, search, facets)
GSIs serve **known** access patterns. If a screen sorts/filters by many columns ad-hoc, or needs full-text /
facets, that's **OpenSearch's** job (the platform's search cluster) — mirror the entity into the search index
and query there; keep DynamoDB as the system of record + key access. Don't model N sortable columns as N GSIs.

---

## Runtime — the entity interface IS the facade's type parameter

The service reads/writes through the [`Dynamo`](../../services/src/aws/Dynamo.ts) facade, addressing the table by
its **logical key** (`CloudResolver.tableName` → physical name) and parameterizing on the entity interface:

```ts
// get → Result<Notice | undefined>; unwrap (non-throwing) to the typed entity
const got : Type.Result<Notice | undefined> = await this.dynamo.get<Notice>( "notices", { accountId, noticeId } );
if ( got.ok && got.data )
{
    const notice : Notice = got.data;          // the entity, fully typed by its interface (notice.title, .status, …)
}

// put → the item you write IS a Notice (key fields required)
const draft : Notice = { accountId, noticeId, status: NoticeStatus.DRAFT, publishedAt, title, body, audience };
const saved : Type.Result<void> = await this.dynamo.put( "notices", draft );

// query → Result<Notice[]>
const live : Type.Result<Array<Notice>> = await this.dynamo.query<Notice>( "notices", { /* KeyCondition on byStatus … */ } );
if ( live.ok )
{
    const notices : Array<Notice> = live.data;
}
```

So `Notice` is the single schema: the manifest projects its **keys** (for provisioning), and the facade uses
the **whole interface** (for typed reads/writes). The DB enforces neither — keep validation at the edges
(ajv + `@repo/endpoint` schemas). The same code runs locally, on LocalStack, and in AWS — only the resolved
table name differs.

---

## Change discipline (summary — full table in [DATABASE.md](../../services/DATABASE.md))

* **Add a non-key field** → free; just write it (update the interface). Old items lack it until rewritten.
* **Add a GSI** → add a `GsiSpec`; DynamoDB backfills online.
* **Change a partition/sort key** → ❌ not possible in place → **new table + migrate**. Choose keys carefully.
* **TTL** is best-effort (deletes within ~48h of `expiresAt`); don't rely on it for correctness-critical expiry.
