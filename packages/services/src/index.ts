//
//
//
export { default as Trace } from './Trace';
export { default as RequestContext } from './RequestContext';   // ambient per-request/event correlation (transactionId)
export { default as Application } from './Application';
export { default as Daemon } from './Daemon';        // long-running base: Service + Consumer
export { default as Service } from './Service';       // request-driven daemon (HTTP)
export { default as FakeService } from './FakeService'; // base for DEV-ONLY fake-provider leaf services (fake ESP/SMS/…)
export { default as Authorizer } from './Authorizer'; // shared authz-store reader (Service.resolveRole + prod Lambda authorizer)
export { default as Consumer } from './Consumer';     // self-driven daemon (consume/drain loop)
export { default as Job } from './Job';               // one-shot (Lambda / batch)
export { default as WorkQueue } from './WorkQueue';   // dispatch governor — fair-share + rate limit (composed as a member)
export { default as Webhook } from './Webhook';       // inbound provider webhooks — verify + ack-fast enqueue (composed as a member)
export { Ports } from '@repo/cloud-manifest';         // re-export: the port registry lives in cloud-manifest (shared by manifest + runtime)
export { Register, Events } from '@repo/system';      // re-export: Register.Service (a Service/Job's id) + the event vocabulary
export * from './aws';   // sdkConfig + the AWS facades (S3, Kms, AppConfig, Kafka, …)

// Malware/file scanning — the SHARED scan service (media-5): the Scanner contract + engine adapters +
// ScanFactory. Any service that ingests bytes (media, contacts, future importers) scans before promoting them.
export { Scanner } from './scan/Scanner';
export { ScanFactory } from './scan/ScanFactory';
export { NoopScanner } from './scan/NoopScanner';
export { HeuristicScanner } from './scan/HeuristicScanner';
export { ClamAvScanner } from './scan/ClamAvScanner';

