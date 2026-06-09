#
# `@repo/common` — utilities & types
#

Shared types (`Type.*`) and a set of **single-purpose `…Utils` classes**, each named for its domain.
There is no catch-all "Validator" / "MathUtils" / "Network" / "SysConstants" anymore — those were
decomposed/renamed (see below) so every utility has an obvious, domain-named home.

## Utilities (index)

| Util | Purpose |
|---|---|
| `ValueUtils` | presence — `isNull`/`notNull`/`isUndefined`/`notUndefined`/`isValid` |
| `BooleanUtils` | boolean — `isValid` (boolean-like) / `get` (coerce) |
| `StringUtils` | string ops + `isValid` (is-a-string) |
| `NumberUtils` | number — `isValid`/`get` + `randomRange`/`percent`/`compare` (was **MathUtils** + number checks) |
| `ByteUtils` | byte sizes — `KB`/`MB`/`GB`/`TB` + `toString` (was **SysConstants/MemoryUtils**) |
| `ArrayUtils` | array ops + `isValid` / `isPrimitive` |
| `ObjectUtils` | object ops + `isValid` + `parseJSON` (safe, returns null) |
| `DateUtils` | dates — `isValid`, parse/compare/format, `Time.*` ms multipliers |
| `TimeZoneUtils` | `ZonedDateTime` ⇄ instant (IANA, Intl-based) — see Date/time below |
| `UuidUtils` | UUID — `isValid` |
| `EmailUtils` | email — `isValid` |
| `PhoneUtils` | NANP — `isValid`/`isShortCode`/`isSms` + `toE164`/`isE164`/`format` |
| `NetworkUtils` | HTTP enums (`Status`/`Method`/`Protocol`/`MimeType`) + URL helpers + `isUrl`/`isHostname`/`isIpAddress` (was **Network** + URL validators) |
| `ColorUtils` · `FileUtils` | colors · file helpers |
| `ResultUtils` | build/run `Type.Result` (`ok`/`err`/`from`/`attempt`) — the one place try/catch lives |

> **Decomposition (what moved):** the old catch-all **`Validator`** was split into per-domain `isValid`
> checks (`String`/`Number`/`Object`/`Array`/`Date`/`Uuid`/`Email`/`Network`/`Phone`Utils) + `ValueUtils`
> (null/undefined) + `BooleanUtils`. Renames: **`MathUtils`→`NumberUtils`**, **`Network`→`NetworkUtils`**,
> **`SysConstants`/`MemoryUtils`→`ByteUtils`** (with the time multipliers moving to `DateUtils.Time`).

---

# The event envelope — `Type.MessageEnvelope`

The platform's **one event body**, carried unreshaped by every transport: Kafka (service ↔ service),
the WebSocket push frame (server → client), and the client pub/sub bus (component ↔ component). It lives
here, in `@repo/common`, because it's the only package all three share **and** it's dependency-free — so
defining it here keeps AWS/server types out of the web bundle.

```ts
interface MessageEnvelope<T = Json> {
    type : string;   // the verb to switch on — "contact.updated", "theme"
    data : T;        // the typed payload
    // optional metadata, filled in by whichever layer has it:
    key?, id?, time?, source?, transactionId?, version?, seq?, changed?
}
```

Only `type` + `data` are required; the rest is metadata (`key` = ordering/partition key, `id` = dedup,
`time`/`source`/`transactionId` = provenance, `version`/`seq` = schema/ordering, `changed` = updated
fields). Named `MessageEnvelope`, **not `Event`**, to avoid colliding with DOM `Event`.

Consumers:
* **Kafka** — `Kafka.Event` (`@repo/services`) `extends` this, re-requiring `key`.
* **WebSocket** — `WebSocketService.Message` (web) **is** this (type-only import).
* **Pub/sub bus** — re-publishes the server envelope **whole**, routed by `type`.

Platform-wide convention + the fat-event / per-entity-topic rules: [root SPECS → Events & messaging](../../../SPECS.md).

---

# Date, time & timezones

The platform's time primitives. The whole model rests on **one distinction**: an *instant* is not the
same thing as a *wall-clock time in a zone*. Conflating them is the classic scheduling bug — so we type
them differently. This is the local, code-level companion to the platform-wide convention in the root
[SPECS.md → Time, scheduling & timezones](../../../SPECS.md).

## Two concepts, two representations

| Concept | Meaning | Type | Stored as |
|---|---|---|---|
| **Instant** | an absolute point in time | `Type.ISODateTime` / `Type.EpochMilliseconds` / `Type.EpochSeconds` | **UTC** (`…Z` / epoch) |
| **Zoned wall-clock** | "3 PM in America/New_York" — depends on DST for its instant | **`Type.ZonedDateTime`** | `{ local, timeZone }` |

* An **instant** is already absolute — a `Date` *is* an instant. Attaching a zone to it is only for
  **display**. Persist instants in **UTC**; the service's own zone is never used.
* A **zoned wall-clock** (`{ local, timeZone }`) is what *user-facing scheduled times* are — schedule
  fires, quiet-hours, window anchors. It resolves to an instant only when you apply the zone's
  offset/DST **at that local time** (`TimeZoneUtils.toInstant`).

```ts
Type.TimeZone        // IANA name, e.g. "America/New_York"
Type.LocalDateTime   // "YYYY-MM-DDTHH:mm:ss" — wall-clock, NO offset
Type.ZonedDateTime   // { local: LocalDateTime, timeZone: TimeZone }
```

> Also note `Type.Seconds` / `…Ms` fields are **durations** (intervals), not points in time — don't
> confuse them with `EpochSeconds` / `EpochMilliseconds`.

## Constants

Named unit multipliers — use these instead of magic numbers (`86400000`).

```ts
import { DateUtils, ByteUtils } from "@repo/common";

DateUtils.Time.SECONDS_TO_MS   // 1000
DateUtils.Time.MINUTES_TO_MS   // 60_000
DateUtils.Time.HOURS_TO_MS     // 3_600_000
DateUtils.Time.DAYS_TO_MS      // 86_400_000

ByteUtils.KB                   // 1024
ByteUtils.MB / GB / TB         // 1024-based
ByteUtils.toString( 1536 )     // "1.5 KB"
```

* **`DateUtils.Time.*`** are **milliseconds** multipliers — e.g. a `…Ms` timeout of "5 minutes" is
  `5 * DateUtils.Time.MINUTES_TO_MS`. For a DynamoDB TTL (which wants **seconds**, `EpochSeconds`),
  divide by `SECONDS_TO_MS` — the constant makes the unit explicit and guards the 1000× mistake.
* **`ByteUtils`** for byte sizes (upload limits, S3 part sizes) + `toString` for human-readable sizes.

## Why no enumerated zone list

The IANA tz database changes **several times a year** (zones added / renamed / merged), so a hardcoded
~400-entry enum drifts and goes stale. The runtime is the authoritative, always-current source:

* **`TimeZoneUtils.isValidTimeZone(tz)`** — validate any IANA string against the runtime (`Intl`).
* **`TimeZoneUtils.supportedTimeZones()`** — the runtime's full IANA list (`Intl.supportedValuesOf`).
  A UI **picker curates** from this (e.g. US + major world zones) rather than us maintaining a list.

`Type.TimeZone` is therefore a validated **string**, not an enum.

## Conversion (Intl-based, no dependency, `Result`)

`TimeZoneUtils` converts both directions DST-correctly using only the built-in `Intl` — no library. All
conversions **return `Type.Result`** (never throw):

```ts
import { TimeZoneUtils } from "@repo/common";
import type { Type } from "@repo/common";

// wall-clock + zone → UTC instant
const at : Type.Result<Date> = TimeZoneUtils.toInstant( { local: "2026-06-08T15:00:00", timeZone: "America/New_York" } );
// at.ok → at.data is 2026-06-08T19:00:00Z (EDT, UTC-4); the SAME local in January → 20:00Z (EST, UTC-5)

// UTC instant → wall-clock in a zone (for display)
const shown : Type.Result<Type.ZonedDateTime> = TimeZoneUtils.fromInstant( new Date(), "America/Los_Angeles" );
```

* **DST is automatic** — "3 PM Eastern" stays 3 PM local across the EST↔EDT switch; the instant shifts
  (a two-pass settles the offset near a transition).
* **`ok:false`** on an **invalid zone** or a **malformed `local`** string — no throw.

### DST edge policy (document, don't surprise)
Two local times are pathological at a transition; the resolver's defined behavior:
* **Non-existent** local time (spring-forward *gap*, e.g. 02:30 when clocks jump 02:00→03:00) → **shifts
  forward** by the offset.
* **Ambiguous** local time (fall-back *overlap*, a local time that occurs twice) → resolves to the
  **post-transition** offset.

## Rules of thumb

* **Compute + store instants in UTC.** Only attach a zone to *interpret* a wall-clock or to *display*.
* **A scheduled time is a `ZonedDateTime`** — keep `local` + IANA `timeZone` together; resolve to a UTC
  instant with `toInstant` at fire time, and (per the platform convention) **stamp the resolved instant**.
* **Always display the zone** — never a bare local time (3 PM Eastern ≠ 3 PM Pacific).

See: root [SPECS.md → Time, scheduling & timezones](../../../SPECS.md) · [report spec → Timezone discipline](../../../apps/core/report/SPECS.md) · [`TimeZoneUtils`](src/utils/TimeZoneUtils.ts).

---

# Validation & formats

Validation lives in **domain-specific utils**, each exposing an `isValid` (or named) check — there is no
catch-all "Validator" (it was decomposed into these). Pick the util by what you're validating:

| Util | Checks |
|---|---|
| `ValueUtils` | `isNull`/`notNull` · `isUndefined`/`notUndefined` · `isValid` (present — not null/undefined) |
| `BooleanUtils` | `isValid` (boolean-like) · `get` (coerce to boolean) |
| `StringUtils.isValid` | is a string |
| `NumberUtils` | `isValid` (number, not NaN) · `get` (number or 0) · `randomRange`/`percent`/`compare` |
| `ObjectUtils.isValid` | is a non-null object |
| `ArrayUtils.isValid` / `isPrimitive` | is an array / non-empty array of primitives |
| `DateUtils.isValid` | is a `Date` instance |
| `UuidUtils.isValid` | UUID (8-4-4-4-12 hex, anchored) |
| `EmailUtils.isValid` | RFC-5322-ish email (anchored, case-insensitive) |
| `NetworkUtils` | `isUrl` (http/https) · `isHostname` · `isIpAddress` (IPv4, range-checked) |
| `PhoneUtils` | `isValid` (NANP) · `isShortCode` · `isSms` · `toE164` · `isE164` · `format` |

## Phone — NANP validation, E.164 storage

The platform is SMS-heavy (10DLC), so phone handling is strict and uniform — all in [`PhoneUtils`](src/utils/PhoneUtils.ts):

* **Validate to NANP** (`isValid`) — North American Numbering Plan: area (NPA) + exchange (NXX) start
  **2-9** and aren't **N11** service codes; accepts loose formatting + an optional `1`/`+1` prefix.
* **Store as E.164** (`toE164` → `Type.PhoneE164`, e.g. `"+12125550123"`). A bare number is assumed
  **NANP** and prefixed with **`+1`** (the **10DLC default country code**, `DEFAULT_COUNTRY_CODE = "1"`);
  a `+`-prefixed input is taken as already-international and validated as E.164.
* **Display** with `format` (`"+12125550123"` → `"(212) 555-0123"`) — store the E.164, format for the UI.

> Scope today is **NANP / US-default**; non-NANP numbers must be passed as explicit `+`-prefixed E.164.
> If we expand to full international parsing, `libphonenumber-js` is the upgrade path (behind the same
> `PhoneUtils` surface).
