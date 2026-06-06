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
    /** Opaque identifier (uuid / provider subject). */
    export type ID = string;

    /** ISO-8601 timestamp, e.g. "2026-06-05T09:00:00Z". */
    export type ISODateTime = string;

    /** Unix time in **seconds** — e.g. a DynamoDB TTL attribute (TTL requires seconds). */
    export type EpochSeconds = number;

    /**
     * Unix time in **milliseconds** — what `Date.now()` and most JS/Kafka timestamps produce.
     * Distinct from {@link EpochSeconds} (DynamoDB TTL): mixing the two is a 1000× error, so the
     * alias names which unit a numeric timestamp holds. (For a *duration* in ms — a timeout, a
     * backoff — use a plain `number` field named `…Ms`; that's an interval, not a point in time.)
     */
    export type EpochMilliseconds = number;

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
}
