//
// Shared scalar primitives used across the whole platform.
//
// Scoped under the `Type` namespace so call sites read clearly and the shared origin
// is obvious: Type.ID, Type.Email, Type.ISODateTime, Type.EpochSeconds, ...
//
// These are deliberately thin aliases over `string` / `number`: they document intent
// at the point of use and give one place to evolve a representation. The namespace is
// TYPE-ONLY (no runtime members), so it compiles away to nothing.
//

export namespace Type
{
    /** Opaque identifier — may be a {@link UUID}, a provider subject (Cognito sub, OAuth sub), or a
     *  composite key. Use this when the *form* of the id shouldn't be assumed. */
    export type ID = string;

    /**
     * RFC-4122 / RFC-9562 **UUID** string, e.g. "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f".
     * "UUID" (not "GUID" — the Microsoft name for the same thing) is the standard term in our
     * Node / PostgreSQL / AWS stack: `crypto.randomUUID()`, the Postgres `uuid` column, etc.
     * Prefer {@link ID} when an identifier is opaque; use `UUID` when the value is guaranteed a UUID.
     */
    export type UUID = string;

    /** ISO-8601 timestamp, e.g. "2026-06-05T09:00:00Z". */
    export type ISODateTime = string;

    /** Unix time in **seconds** — e.g. a DynamoDB TTL attribute (TTL requires seconds). */
    export type EpochSeconds = number;

    export type Seconds = number;

    /**
     * Unix time in **milliseconds** — what `Date.now()` and most JS/Kafka timestamps produce.
     * Distinct from {@link EpochSeconds} (DynamoDB TTL): mixing the two is a 1000× error, so the
     * alias names which unit a numeric timestamp holds. (For a *duration* in ms — a timeout, a
     * backoff — use a plain `number` field named `…Ms`; that's an interval, not a point in time.)
     */
    export type EpochMilliseconds = number;

    /** An **IANA** time-zone name, e.g. `"America/New_York"`. Validate with `TimeZoneUtils.isValidTimeZone`
     *  (checked against the runtime's `Intl` list — we don't hardcode the ~400 zones, they drift). */
    export type TimeZone = string;

    /** A **local** wall-clock date-time **without** offset/zone — `"YYYY-MM-DDTHH:mm:ss"` (`.SSS` optional).
     *  Only meaningful paired with a {@link TimeZone}; on its own it's not an instant. */
    export type LocalDateTime = string;

    /**
     * A **wall-clock time in a zone** — "3 PM in America/New_York". The actual instant depends on the
     * zone's offset/DST at that local time, so this is **not** itself a point in time: resolve it with
     * `TimeZoneUtils.toInstant`. Use this for *user-facing scheduled times* (schedules, quiet hours,
     * window anchors); for a pure **instant**, use {@link ISODateTime} / {@link EpochMilliseconds} (UTC).
     * See `common/src/SPECS.md` → Date, time & timezones.
     */
    export interface ZonedDateTime
    {
        local    : LocalDateTime;   // e.g. "2026-06-08T15:00:00"
        timeZone : TimeZone;        // e.g. "America/New_York"
    }

    /** RFC-5322 email address. */
    export type Email = string;

    /** E.164 phone number, e.g. "+15551234567". */
    export type PhoneE164 = string;

    /** Absolute URL. */
    export type Url = string;

    /** ISO-4217 currency code, e.g. "USD". */
    export type Currency = string;

    //
    // JSON — a precise, recursive type for "any JSON value", as an alternative to `any`
    // (which disables checking) and `object` (which excludes primitives + arrays). Use it
    // for payloads that are JSON by contract: API bodies, event/message payloads, stored
    // documents, a node's opaque output.
    //
    // Caveat: a value typed with a named `interface` is NOT assignable to `JsonObject`
    // (TS doesn't give interfaces an implicit index signature). For data you intend to pass
    // as JSON, declare it with a `type` alias (which is assignable), or accept `unknown` at
    // that boundary instead.
    //

    /** A JSON leaf value. */
    export type JsonPrimitive = string | number | boolean | null;

    /** A JSON object — string keys, JSON values. */
    export type JsonObject = { [key : string] : Json };

    /** A JSON array. */
    export type JsonArray = Array<Json>;

    /** Any value expressible as JSON (recursive). */
    export type Json = JsonPrimitive | JsonObject | JsonArray;

    /**
     * The platform's standard **non-throwing result** — return this instead of throwing, so callers
     * branch on `ok` rather than wrapping every call in try/catch. **Generic in `T`**, so on success
     * `data` carries the correctly-typed value; on failure `error` is a human-readable message and
     * `cause` keeps the original error for logging/debugging.
     *
     * Discriminated on `ok`: after `if (r.ok)`, `r.data` is `T`; in the `else`, `r.error` is a string.
     * Build these with the `ResultUtils` helpers (`ok` / `err` / `from` / `attempt`).
     */
    export type Result<T> =
        | { ok : true;  data : T }
        | { ok : false; error : string; cause? : unknown };

    // The platform's universal event envelope MOVED to `@repo/events` as `Events.Envelope` — the one body
    // carried over Kafka (inter-service), the WebSocket push frame (server → client), and outbound webhooks.
    // It lives there (not here) because it's typed by `Events.Object` / `Events.Verb`; `@repo/common` stays
    // dependency-free. (The old PII-light `MessageEnvelope` `{ type, data }` is superseded by it.)
}
