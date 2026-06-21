//
// @repo/oauth — the OAuth-broker capability. One interface (OAuthBroker), a Nango-backed adapter for the
// long tail (self-hosted → tokens stay in our infra), and a factory that lets high-value providers slot a
// native adapter behind the same interface (hybrid). See README.md.
//
export { OAuthBroker, OAuth, default } from "./OAuthBroker";
export { NangoBroker } from "./adapters/NangoBroker";
export { OAuthFactory } from "./OAuthFactory";
