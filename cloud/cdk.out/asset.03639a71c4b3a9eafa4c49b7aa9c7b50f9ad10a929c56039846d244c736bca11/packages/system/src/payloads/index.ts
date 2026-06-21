//
// The central PAYLOAD REPOSITORY — the platform's canonical entity representations, by service.
//
// Each payload is the shape an entity has on the wire: the `data` of its events (`Events.Of<O>`) AND the
// response of its API `GET` (an `@repo/endpoint` def references the SAME type) — so the two can't drift.
// Many events may share one payload; register the Object → payload mapping in `Events.EventPayload`.
//
// Pure types — these files import only `@repo/common`. (The Object → payload map lives in `Events.ts`,
// which imports from here; keeping the map there avoids an events ⇄ payloads cycle.)
//
export * from "./app";
export * from "./media";

