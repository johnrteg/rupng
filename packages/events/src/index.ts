//
// @repo/events — the platform's foundational event vocabulary + access model.
//
// The shared base that BOTH @repo/endpoint (the API/event contract) and @repo/cloud-manifest (the
// pub/sub topic bindings) build on, so the event Object set, the verb set, and the access ladders
// have ONE home and can't drift. Pure types/enums — no AWS, no runtime, safe to import anywhere.
//
export { default as Access } from "./Access";
export { default as Events } from "./Events";
export * as Payloads from "./payloads";   // the central entity-representation repository (event `data` + API GET responses)
