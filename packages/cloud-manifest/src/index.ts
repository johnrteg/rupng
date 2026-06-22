//
// @repo/cloud-manifest — the contract between services (which declare their cloud
// footprint) and the /cloud CDK app (which builds it and wires runtime references).
//
export * from "./Environment";
export * from "./Sizing";
export * from "./Common";
export * from "./Resources";
export * from "./Manifest";
export * from "./Naming";
export * from "./Resolver";
export * from "./TableKeys";   // keyOf<E>() / ttlOf<E>() — bind DynamoDB TableSpec keys to the entity interface
export { default as Ports } from "./Ports";   // service → default port registry (also feeds manifest containerPort)
// Kafka topic names are NOT a separate registry — they ARE Events.Object / Events.Stream (@repo/system).
