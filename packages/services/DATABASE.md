# Choosing a datastore — DynamoDB vs RDS/Aurora vs Redis

A decision guide for service authors. The three stores solve **different** problems — this is
mostly "DynamoDB or RDS for my system of record?", with **Redis as a complement** (cache), not
an alternative.

> **Platform default: DynamoDB.** It runs identically in LocalStack and AWS, is connectionless
> (no pool exhaustion under Lambda), and matches our access patterns (per-account, key-based).
> Use **OpenSearch/analytics** for query-heavy reads, **RDS/Aurora** only for a genuinely
> *relational* workload (transactions + ad-hoc joins/reporting, e.g. billing), and **Redis**
> for ephemeral data. See also `DEVELOP.md` and the facades in `src/aws/`.

---

## TL;DR — pick by access pattern

| Your need | Use |
|-----------|-----|
| Key/per-account lookups, high scale, event-driven, serverless | **DynamoDB** ✅ default |
| Full-text search, segmentation, aggregations, reporting over DynamoDB data | **OpenSearch** (index projection) |
| Complex multi-table joins, FK integrity, ad-hoc SQL, multi-row transactions | **RDS / Aurora Postgres** |
| Ephemeral: cache, sessions, rate-limit counters, locks, pub/sub, leaderboards | **Redis** (ElastiCache) |

Repo facades: `Dynamo` · `Database` (`Database.Access` Read/Write/ReadWrite) · `Cache`. Each
resolves cloud-spec **logical keys** via `CloudResolver` (`tableName` / `databaseUrl` /
`cacheEndpoint`).

---

## At a glance

| Dimension | **DynamoDB** | **RDS / Aurora Postgres** | **Redis (ElastiCache)** |
|---|---|---|---|
| Model | NoSQL key-value / document | Relational SQL | In-memory key-value + data structures |
| Role | System of record | System of record | **Cache / ephemeral** (not SoR) |
| Schema | Schemaless (keys only) | Strict, enforced | Schemaless |
| Joins / FK | ❌ (app-side) | ✅ native | ❌ |
| Transactions | ✅ limited (≤100 items, 1 region) | ✅ full ACID | ⚠️ MULTI/Lua (not ACID across nodes) |
| Type enforcement | App-level (ajv/TS) | **DB-enforced** | App-level |
| Query flexibility | Pre-designed access patterns | Ad-hoc SQL | Key + structure ops |
| Connections | Connectionless (HTTPS+IAM) | Pooled (needs **RDS Proxy**) | Pooled (ioredis) |
| Scaling | Automatic, unbounded | Vertical + read replicas / Aurora ACU | Vertical / shards / serverless |
| Latency | Single-digit ms | low-ms (network + query) | **sub-ms** |
| Cost shape | Pay-per-request + storage; **$0 idle** | Instance/ACU-hours + storage + proxy; **always-on** | Memory-hours; always-on |
| Encryption at rest | **On by default** (KMS) | KMS (enable at create) | KMS (opt-in) |
| Backups | On-demand + PITR (35d) | Snapshots + PITR (35d) | Snapshots (if used as store) |
| Multi-region DR | **Global Tables** (active-active) | Aurora Global DB / cross-region replica | Global Datastore |
| LocalStack | ✅ **Community** | ⚠️ Pro; **Proxy unreliable** → use a container | ⚠️ Pro → or a `redis` container |
| Auth | IAM (no passwords) | IAM (via Proxy) or secret | AUTH token / IAM, TLS |

---

## Data model & table definitions

### DynamoDB
- A table has a **primary key**: a partition key (PK), optionally + a sort key (SK). That's the
  *only* required schema. Items are JSON-ish bags of attributes; two items in a table need not
  share attributes beyond the key.
- Alternate access via **GSIs** (Global Secondary Indexes — own PK/SK, eventually consistent)
  and **LSIs** (Local — same PK, alt SK). You design indexes around the queries you'll run.
- **Single-table design** is common: many entity types in one table, discriminated by key
  prefixes (`ACCOUNT#123`, `CONTACT#456`) — trades modeling effort for fewer round-trips.
- In cloud-spec: `TableSpec { partitionKey, sortKey?, globalSecondaryIndexes?, billingMode, … }`.

### RDS/Aurora
- Tables = typed **columns** with constraints. Normalized across many tables; relationships via
  **foreign keys**. Indexes (`CREATE INDEX`) for query paths. Full DDL.
- In cloud-spec: `DatabaseSpec { engine, serverless?, sizing, … }` — the *cluster*; the **schema
  lives in migrations** the service owns (not in cloud-spec).

### Redis
- No tables. Keys → values that are strings / hashes / lists / sets / sorted-sets / streams.
  Model by key naming (`session:<id>`, `rl:<account>:<window>`) + per-key TTL.

## Relationships, PK & FK, "linking tables"

- **RDS** — the only one with real relationships: PK + **FK with referential integrity**,
  join tables for many-to-many, `JOIN` at query time, `ON DELETE CASCADE`, etc. If your domain
  is genuinely relational (invoices↔line-items↔payments), this is where it's natural.
- **DynamoDB** — **no FKs, no joins**. You model relationships by (a) embedding/denormalizing
  (store the related data in the item), (b) composite keys + item collections (parent and
  children share a PK, differ by SK), or (c) a GSI to "look up by the other side". A
  many-to-many "linking table" becomes **adjacency-list items** (two mirrored items, or a GSI).
  Integrity is **your code's job** (and DynamoDB transactions for atomic multi-item writes).
- **Redis** — relationships are not a thing; use sets/sorted-sets to model membership/indexes by hand.

## Schema changes & type enforcement

| | DynamoDB | RDS/Postgres | Redis |
|---|---|---|---|
| Add a field | Free (schemaless) — just write it | `ALTER TABLE ADD COLUMN` (migration) | Free |
| Remove a field | App stops writing it; old items keep it until rewritten | `ALTER TABLE DROP COLUMN` (migration; do it *late*) | Free |
| Add an index | Add a **GSI** online (backfills automatically) | `CREATE INDEX CONCURRENTLY` (online) | N/A |
| Change a key/PK | ❌ not possible in place → **new table + migrate** | possible but heavy | N/A |
| Type enforcement | **None at the DB** — enforce with ajv + TS (`@repo/endpoint` schemas, `@repo/common` `Type`) | **DB-enforced** column types + constraints | None |

> DynamoDB pushes type/shape enforcement up into the application (where we already validate with
> ajv). RDS enforces it in the engine. If "the database must guarantee shape/uniqueness/FKs," that's
> a point for RDS.

## Migrations (incl. data-type migrations & "safe" migrations)

**RDS/Postgres** — use a versioned migration runner (ordered `NNNN_*.sql` up/down; e.g.
node-pg-migrate / Flyway). The **expand → migrate → contract** pattern is the "safe"/online recipe:
1. **Expand** — additive, backward-compatible (add a *nullable* column / new table / index
   `CONCURRENTLY`). Old and new code both work.
2. **Backfill** — populate the new shape in batches (avoid long locks).
3. **Switch** — deploy code that reads/writes the new shape.
4. **Contract** — only after nothing uses the old shape, drop it.
   - *Type change* (e.g. `text`→`int`): never `ALTER COLUMN TYPE` in place on a big/locked table
     — add a new column, backfill, dual-write, swap, drop. Same expand/contract.
   - Avoid: adding `NOT NULL` without a default, blocking `ALTER`s, renaming columns in one step.

**DynamoDB** — there's no `ALTER`. Migrations are **data-driven**:
- **Additive** is trivial (write new attributes lazily).
- **Versioned items** — stamp a `schemaVersion`; **migrate-on-read** (upgrade an item when you
  load it) and/or a **backfill job** (scan → transform → `BatchWriteItem`, or drive off **DynamoDB
  Streams** + Lambda).
- **Key/index reshape** — create a new table (or GSI), **dual-write**, backfill, cut reads over,
  retire the old. PITR + on-demand backup before destructive steps.
- *Type change* of an attribute = a data migration (rewrite items), same backfill tooling.

**Redis** — you don't migrate a cache; change the key schema and let it re-warm (or bump a key
prefix/namespace to invalidate the old shape).

## Seeding

- **DynamoDB** — `BatchWriteItem` (25/req) via a seed script (`Dynamo.client`), or `awslocal
  dynamodb batch-write-item` locally.
- **RDS** — a seed step in the migration runner, or `INSERT`/`COPY` SQL.
- **Redis** — warm on first use (cache-aside); rarely "seeded".
- Keep seeds **idempotent** (conditional writes / `ON CONFLICT DO NOTHING`) so they're safe to re-run.

## Performance & scaling

- **DynamoDB** — single-digit-ms reads/writes at *any* scale **if the partition key spreads load**
  (a hot key = throttling). On-demand auto-scales; provisioned needs WCU/RCU planning. No connection
  ceiling. Big scans are an anti-pattern — design for `Query`, push search to OpenSearch.
- **RDS/Aurora** — superb for complex/joined queries; scales **vertically** + **read replicas**
  (route SELECTs to the reader — our `Database.Access.READ`). Aurora Serverless v2 autoscales ACUs.
  **Connection-bound** → RDS Proxy multiplexes (essential under Lambda).
- **Redis** — sub-ms, very high throughput; scale by larger node, shards (cluster mode), or
  serverless. Watch memory + eviction policy.

## Configuration (in this repo)

| | cloud-spec | CDK (ServiceStack) | Runtime facade |
|---|---|---|---|
| DynamoDB | `owns.tables: TableSpec[]` | table + GSIs + PITR + KMS | `Dynamo` (`new Dynamo(this.cloud)`) |
| RDS/Aurora | `owns.databases: DatabaseSpec[]` | cluster/instance **+ RDS Proxy + READ_ONLY endpoint** + IAM connect | `Database` (`Database.Access`) |
| Redis | `owns.caches: CacheSpec[]` | ElastiCache (serverless/cluster) | `Cache` (ioredis) |

All keyed by logical name; the CDK injects the physical id as an env var the facade reads back via
`CloudResolver`.

## Cost (shape, not numbers)

- **DynamoDB** — pay-per-request (on-demand) or provisioned capacity, + storage. **No idle cost** →
  cheapest for spiky/low/zero-baseline workloads. Predictable per-request at scale; very large
  steady throughput can favor provisioned.
- **RDS/Aurora** — instance-hours (or Serverless v2 **ACU-hours**, min capacity always running) +
  storage + I/O + backups + **RDS Proxy hours**. **Always-on baseline** — you pay even when idle.
- **Redis** — node/ACU memory-hours, always-on. Sized to your working set.
- Rule of thumb: DynamoDB wins on **low/variable** load and ops simplicity; RDS earns its baseline
  when you genuinely need relational power.

## Runtime — AWS vs LocalStack

| | AWS | LocalStack |
|---|---|---|
| DynamoDB | ✅ | ✅ **Community** — true local parity, no extra setup |
| RDS/Aurora | ✅ | ⚠️ **Pro**, and **RDS Proxy emulation is unreliable** — the `Database` facade depends on the proxy, so locally run a **`postgres` container** + `DB_PASSWORD` (the facade's local branch uses password auth + no TLS, no proxy) |
| ElastiCache/Redis | ✅ | ⚠️ Pro — or just a **`redis` container** |

This local friction is a real reason DynamoDB is the default. (See `cloud/local/README.md`.)

### Managed engine: Aurora PostgreSQL-Compatible

When a service does need relational, the managed engine is **Amazon Aurora PostgreSQL-Compatible**
(not plain RDS-for-Postgres) — so the same CDK cluster construct and the same Postgres wire
protocol / SQL / `pg` driver work in both environments.

* **AWS** — real managed Aurora: Serverless v2 ACU autoscaling, reader replicas, Multi-AZ, Aurora
  Global Database, optional RDS Data API.
* **LocalStack (Pro)** — emulates the **cluster control plane** (`CreateDBCluster` with
  `Engine = aurora-postgresql`, `CreateDBInstance`) and the **RDS Data API** (`rds-data`
  `ExecuteStatement` / `BatchExecuteStatement`), **backed by a real PostgreSQL** process. You get a
  cluster + endpoint and normal SQL behavior — enough to develop and integration-test the same
  constructs.
* **Stubbed locally — don't test these against LocalStack:** Serverless v2 **autoscaling / pause-resume**
  (fixed local Postgres), and Aurora's **storage architecture, replicas/replication, Global Database,
  and failover** behavior/timing. Local = "Aurora API shape over one real Postgres"; the elastic/HA
  characteristics are AWS-only.
* The **RDS Proxy** caveat above still applies locally — the `Database` facade's local branch uses
  password auth + no TLS + no proxy (`DB_PASSWORD`), reserving IAM-via-Proxy for the cloud.

## Connections & auth

- **DynamoDB** — **connectionless**: HTTPS calls signed with IAM. No pools, no exhaustion — ideal
  for Lambda fan-out. No passwords.
- **RDS** — TCP connections are scarce; **always go through RDS Proxy** (pools + IAM auth, no static
  creds in the service). The `Database` facade uses an IAM token in the cloud, `DB_PASSWORD` locally.
- **Redis** — persistent connection pool (ioredis); AUTH token or IAM + TLS.

## Transactions & consistency

- **DynamoDB** — eventually-consistent reads by default (strongly-consistent optional, single
  region). `TransactWriteItems` = ACID across **≤100 items in one region**; **conditional writes**
  for optimistic concurrency. No cross-region transactions (Global Tables are last-writer-wins).
- **RDS** — full ACID, arbitrary multi-row/multi-table transactions, isolation levels, locks. Use
  `Database.tx()` (BEGIN/COMMIT/ROLLBACK on the writer).
- **Redis** — `MULTI/EXEC` + Lua are atomic on a node, but it's not a transactional SoR; don't rely
  on it for durability.

### Read-after-write — "I POST then GET, is it there?"

A successful write is **durably committed** in both stores; the catch is purely *which read sees it*.

| Read | Read-after-write? |
|---|---|
| DynamoDB `GetItem` (default) | ❌ not guaranteed (eventually consistent — usually ms) |
| DynamoDB `get(..., { consistent: true })` / `ConsistentRead` (base table) | ✅ guaranteed |
| DynamoDB **GSI** query | ❌ *always* eventually consistent — `ConsistentRead` not allowed |
| RDS read from the **writer** | ✅ guaranteed (ACID; sees committed data) |
| RDS read from a **reader** (`Database.Access.READ`) | ❌ replication lag (usually ms) |

So immediately after a write:
- **Same item, by key, must be visible** → DynamoDB: `get(key, { consistent: true })`; RDS: read from the
  **writer** (`Access.WRITE` / `ReadWrite`), not the reader.
- **GET is a list/search** (DynamoDB GSI, or an OpenSearch projection) → you *can't* get strong
  consistency; design for eventual.
- **Best pattern regardless:** have the **POST return the created resource** in its response, so the
  client needn't immediately re-GET — sidesteps the consistency window entirely.

## Backups & disaster recovery

| | DynamoDB | RDS/Aurora | Redis |
|---|---|---|---|
| Point-in-time recovery | ✅ PITR (to the second, 35 days) | ✅ PITR (35 days) | n/a (cache) |
| On-demand / snapshot | ✅ on-demand backups | ✅ manual + automated snapshots | optional RDB/AOF snapshot |
| Multi-AZ | **Built in** (3 AZs) | Multi-AZ standby/replicas (configure) | Multi-AZ replicas |
| Multi-region DR | **Global Tables** (active-active, ~1s replication) | Aurora **Global Database** / cross-region read replica | **Global Datastore** |
| Recovery model | Restore to new table | Restore to new instance/cluster | Re-warm; restore from snapshot if persisted |

Treat **Redis data as disposable** — design so a cold cache is a performance event, not data loss.

## Encryption

- **DynamoDB** — **encrypted at rest by default** (AWS-owned key, or a CMK via cloud-spec `kmsKey`);
  TLS in transit; IAM for access.
- **RDS/Aurora** — at-rest encryption via **KMS, set at creation** (can't toggle on an existing
  instance without snapshot→restore — decide up front); TLS in transit (the facade enables it in
  cloud); IAM auth via Proxy.
- **Redis** — at-rest (KMS) and in-transit (TLS) are **opt-in** on ElastiCache; enable both for
  anything sensitive; use the AUTH token / IAM.
- Cross-cutting: encrypt with a **customer-managed KMS key** (cloud-spec `kmsKey` on the resource)
  when you need key rotation/audit control; use envelope encryption (`Kms.dataKey`) for
  application-level field encryption regardless of the store.

---

## Decision checklist

Answer these; if you're saying "yes" mostly in the **left** column, use DynamoDB.

1. Is access primarily **by key / per-account**, not ad-hoc multi-table queries? → Dynamo / RDS
2. Do you need **FK integrity + joins + arbitrary SQL** the engine enforces? → **RDS**
3. Is load **spiky or low-baseline**, and do you want **zero idle cost** + no connection mgmt? → **DynamoDB**
4. Do you need **multi-row ACID transactions** across entities? → RDS (Dynamo only ≤100 items/region)
5. Is the data **ephemeral** (cache/session/counter/lock)? → **Redis** (alongside your SoR)
6. Do you need **search / aggregation / reporting**? → keep SoR in DynamoDB, project to **OpenSearch**
7. Must it **run cleanly in LocalStack with no extra containers**? → **DynamoDB**

**Default to DynamoDB; reach for RDS deliberately when the relational checklist items win; add
Redis as a cache; project to OpenSearch for query.**
