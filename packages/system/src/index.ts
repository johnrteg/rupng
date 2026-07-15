//
// @repo/system — the platform's foundational vocabulary: the service registry, the event vocabulary, the
// access model, and the entity-payload repository.
//
// The shared base that BOTH @repo/endpoint (the API/event contract) and @repo/cloud-manifest (the
// pub/sub topic bindings) build on, so these primitives have ONE home and can't drift. Pure types/enums —
// no AWS, no runtime, safe to import anywhere.
//
export { default as Register } from "./Register";   // canonical service registry — Register.Service.*
export { default as Access } from "./Access";
export { default as Events } from "./Events";
export { default as Providers } from "./Providers";   // credential-backed external providers (secrets registry)
export * as Payloads from "./payloads";   // the central entity-representation repository (event `data` + API GET responses)
