//
//
//
export { default as Trace } from './Trace';
export { default as Application } from './Application';
export { default as Daemon } from './Daemon';        // long-running base: Service + Consumer
export { default as Service } from './Service';       // request-driven daemon (HTTP)
export { default as Consumer } from './Consumer';     // self-driven daemon (consume/drain loop)
export { default as Job } from './Job';               // one-shot (Lambda / batch)
export { default as WorkQueue } from './WorkQueue';   // dispatch governor — fair-share + rate limit (composed as a member)
export { Ports } from '@repo/cloud-manifest';         // re-export: the port registry lives in cloud-manifest (shared by manifest + runtime)
export { Register, Events } from '@repo/system';      // re-export: Register.Service (a Service/Job's id) + the event vocabulary
export * from './aws';   // sdkConfig + the AWS facades (S3, Kms, AppConfig, Kafka, …)

