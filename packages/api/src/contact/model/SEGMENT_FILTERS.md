# Segment filters — types, operators & field catalog

Reference + **verification** doc for the segmentation filter model in
[`Segment.ts`](./Segment.ts) (`Segment` in `@repo/api`). This is the contract the visual query builder, the
saved-query model, and the search-side evaluator all share. **Please verify the tables below** — the field
list and operator sets will grow, and the type→operator grouping is a *default*, so field-level **exceptions**
are expected and called out explicitly.

## Query shape

A saved segment query is a **hierarchical boolean tree**:

- A **Group** has an `op` and a list of `conditions`, where each entry is either a **Condition** or another
  **Group** (so groups nest arbitrarily).
- A **Condition** is `{ field, operator, value?/values? }`.

### Group operators (`Segment.GroupOp`)

| UI label | value  | Boolean | Meaning                          |
|----------|--------|---------|----------------------------------|
| All      | `all`  | AND     | every rule in the group matches  |
| Any      | `any`  | OR      | at least one rule matches        |
| None     | `none` | NOT     | no rule in the group matches     |

Groups are hierarchical — a group's `conditions` may contain sub-groups, each with its own `op`.

## Operators (`Segment.Operator`)

| Operator                 | value          | Operand   | Notes                                   |
|--------------------------|----------------|-----------|-----------------------------------------|
| Is                       | `is`           | single    | equals                                  |
| Is not                   | `is_not`       | single    | not equals                              |
| Contains                 | `contains`     | single    | substring                               |
| Begins with              | `begins_with`  | single    |                                         |
| Ends with                | `ends_with`    | single    | e.g. email-domain match (exception op)  |
| Less than                | `lt`           | single    |                                         |
| Less than or equal to    | `lte`          | single    |                                         |
| Greater than             | `gt`           | single    |                                         |
| Greater than or equal to | `gte`          | single    |                                         |
| Between                  | `between`      | pair      | `values = [from, to]`, inclusive        |
| Any of                   | `any_of`       | set       | set intersects (≥ 1 of)                 |
| Every of                 | `every_of`     | set       | set superset (all of)                   |
| None of                  | `none_of`      | set       | set disjoint (none of)                  |
| Within                   | `within`       | geo       | `value = { lat, lng, radius, unit }`    |
| Is empty                 | `is_empty`     | none      | unset / no value                        |
| Is not empty             | `is_not_empty` | none      | has any value                           |

**Operand shapes** (`Segment.Operand`, in `Condition`):
- `single` → `value`
- `pair` → `values = [from, to]`
- `set` → `values = [...]`
- `geo` → `value = GeoWithin { lat, lng, radius, unit }` (`unit` = `mi` | `km`)
- `none` → no operand

## Field data types → default operators (`Segment.DEFAULT_OPERATORS`)

A field inherits these unless it **overrides** them (see *Exceptions*).

| Type (`FilterType`) | is | is_not | contains | begins_with | ends_with | lt | lte | gt | gte | between | any_of | every_of | none_of | within | is_empty | is_not_empty |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `string`      | ✅ | ✅ | ✅ | ✅ |   |   |   |   |   |   |   |   |   |   | ✅ | ✅ |
| `number`      | ✅ | ✅ |   |   |   | ✅ | ✅ | ✅ | ✅ | ✅ |   |   |   |   | ✅ | ✅ |
| `date`        | ✅ | ✅ |   |   |   | ✅ | ✅ | ✅ | ✅ | ✅ |   |   |   |   | ✅ | ✅ |
| `datetime`    | ✅ | ✅ |   |   |   | ✅ | ✅ | ✅ | ✅ | ✅ |   |   |   |   | ✅ | ✅ |
| `boolean`     | ✅ |   |   |   |   |   |   |   |   |   |   |   |   |   | ✅ | ✅ |
| `enum`        | ✅ | ✅ |   |   |   |   |   |   |   |   | ✅ |   | ✅ |   | ✅ | ✅ |
| `phone`       | ✅ | ✅ | ✅ | ✅ |   |   |   |   |   |   |   |   |   |   | ✅ | ✅ |
| `tags`        |   |   |   |   |   |   |   |   |   |   | ✅ | ✅ | ✅ |   | ✅ | ✅ |
| `segment_ref` |   |   |   |   |   |   |   |   |   |   | ✅ | ✅ | ✅ |   | ✅ | ✅ |
| `ref_set`     |   |   |   |   |   |   |   |   |   |   | ✅ |   | ✅ |   | ✅ | ✅ |
| `geo`         |   |   |   |   |   |   |   |   |   |   |   |   |   | ✅ | ✅ | ✅ |

## Field catalog — the first set (`Segment.FIELDS`)

| Field (`FieldId`) | id | Type | UI group | Operators |
|---|---|---|---|---|
| Belongs to segment      | `segment`            | `segment_ref` | Membership | any_of, every_of, none_of, is_empty, is_not_empty — operand is **one or more segment ids** (multi-select) |
| In campaign audience    | `campaign`           | `segment_ref` | Membership | operand is campaign id(s); **indirection** → resolves each campaign to the segment it owns, then tests membership |
| Imported from           | `importedFrom`       | `ref_set`     | Membership | any_of, none_of, is_empty, is_not_empty |
| Tags                    | `tags`               | `tags`        | Membership | any_of, every_of, none_of, is_empty, is_not_empty |
| First name              | `firstName`          | `string`      | Identity   | string defaults |
| Last name               | `lastName`           | `string`      | Identity   | string defaults |
| Email                   | `email`              | `string`      | Identity   | **+ ends_with** (exception) |
| Phone number            | `phoneNumber`        | `phone`       | Phone      | phone defaults |
| Street                  | `street`             | `string`      | Location   | string defaults |
| City                    | `city`               | `string`      | Location   | string defaults |
| County                  | `county`             | `string`      | Location   | string defaults |
| State                   | `state`              | `enum`        | Location   | enum defaults (**exception**: not free text) |
| Zip                     | `zip`                | `string`      | Location   | string defaults (begins_with = prefix match) |
| Country                 | `country`            | `enum`        | Location   | enum defaults (**exception**) |
| Area code               | `areaCode`           | `string`      | Phone      | string defaults |
| Phone country code      | `phoneCountryCode`   | `enum`        | Phone      | enum defaults |
| Timezone                | `timezone`           | `enum`        | Location   | enum defaults |
| Timezone of area code   | `timezoneOfAreaCode` | `enum`        | Phone      | enum defaults (derived from area code) |
| Location within         | `geoDistance`        | `geo`         | Location   | within, is_empty, is_not_empty (lat/long + distance) |
| Created date            | `createdDate`        | `datetime`    | Dates      | date defaults |
| Modified date           | `modifiedDate`       | `datetime`    | Dates      | date defaults |
| Last sync date/time     | `lastSyncAt`         | `datetime`    | Sync       | date defaults |
| **Custom fields**       | *(field uid)*        | *(mapped)*    | Custom fields | from the def's type — see below |

## Custom fields → filter type (`Segment.customFieldFilterType`)

Account custom fields join the catalog at runtime (`Segment.customField( def )`), typed from their definition:

| `CustomFieldType` | → `FilterType` |
|---|---|
| `text`, `multiline`, `url`, `email` | `string` |
| `number`, `currency` | `number` |
| `date` | `date` |
| `datetime` | `datetime` |
| `boolean` | `boolean` |
| `choice` | `enum` |
| `multi_choice` | `tags` |
| `phone` | `phone` |

## Membership, pins & materialization

A segment's membership is a set of `segment_members` join rows, each with a **`source`**:

| Source | Meaning | Reconciled on refresh? |
|---|---|---|
| `query` | matched the filter | **yes** — added/removed to track the filter |
| `manual` | user **pinned it IN** (manual add) | no — always kept |
| `excluded` | user **pinned it OUT** (manual remove → a tombstone) | no — never re-added; **not counted** as a member |
| `import` | added by a CSV import | no — owned by the importer |

- **Effective membership** = `(query matches ∪ pinned-in) − pinned-out`. A manual add wins over a prior remove
  (overwrites the tombstone → `manual`); a manual remove wins over the query (writes an `excluded` tombstone).
  So manual intent **survives every refresh** — nothing is silently lost.

- **Materialization is a job** (`contact-segment-materialize`). Saving/refreshing enqueues it; it evaluates the
  filter, applies the segment's `sort` + top-N `limit`, reconciles **only** the `query` rows against the match
  set, recounts, and logs a run. Filterless (import-sourced) segments skip derivation — just a recount.

- **Status lifecycle** (`Segment.Status`): `pending → processing → active` (active = materialized/complete),
  or `failed`. Plus `inactive` / `archived` / `deleted`.

- **Refresh** — `POST /contact/segments/:id/refresh` re-runs the job (trigger `refresh`).

- **Run history** — `POST` a run record per materialization to `segment_runs`, read via
  `GET /contact/segments/:id/runs`: **when** (`at`), **who** (`by`), **trigger** (`initial|edit|refresh`),
  **added**, **removed**, **total**, **status**. A segment can be refreshed many times, so this is the audit trail.

- **Unpin** — two ways:
  - `POST /contact/segments/:id/reset-overrides` `{ clearPins?, clearExclusions? }` (default: both) — clears the
    manual rows and re-materializes so membership reverts to pure query.
  - `POST /contact/segments/:id/copy` `{ name?, copyPins?, copyExclusions? }` — clones the filter/sort/limit into
    a new segment, choosing which pins to carry (**all / drop add-pins / drop remove-pins / drop both**). Copying
    with both off is the clean "start fresh from the query" path.

## Exceptions & extensibility (design intent)

- **Type→operator is a default, not a rule.** `DEFAULT_OPERATORS[type]` seeds a field's operators; any field
  sets `FilterField.operators` to override. Verified exceptions today: `state` / `country` / `phoneCountryCode`
  / `timezone(OfAreaCode)` are `enum` (pick-list) rather than free `string`; `email` adds `ends_with`.
- **The field set grows.** Add a `FieldId` + a `FIELDS` entry (and, if a new kind of value, a `FilterType` +
  its `DEFAULT_OPERATORS` row). Nothing else needs to change for the builder to render it.
- **New operators grow too.** Add to `Operator` + give it an `OPERATOR_OPERAND` cardinality so the builder
  knows which operand editor to show.
- **Set refs take multiple values.** `segment_ref` / `ref_set` operands are **sets** (`values`), so
  "belongs to segment" is a multi-select of segment ids — `any_of` / `every_of` / `none_of` over that set.
- **Campaign is an indirection.** A campaign that builds an audience creates + stores a **real segment**
  behind the scenes (`Segment.campaignId` links them) and marks it `hidden` (excluded from the default
  segments list — see `GetSegments.includeHidden`). The `campaign` filter field's operand is campaign id(s);
  evaluation resolves each campaign → its owned segment → membership. So filtering "in a campaign's audience"
  is really "in the segment that campaign selected."

### Open questions to confirm
- `zip` as `string` (prefix match via `begins_with`) vs a dedicated type — OK as string?
- `areaCode` as `string` (allows `any_of` list, `begins_with`) — or `enum`/`number`?
- `email` `ends_with` for domain matching — keep, or drop to plain string defaults?
- `ref_set` ("imported from") — should it also allow `every_of` (imported from *all* of these sources)?
- `boolean` — keep `is` only, or also `is_not`?
