//
// Lambda entry (TEMPLATE for services deployed as a function rather than an ECS service).
//
// Bundled to bin/lambda.js by `npm run build:lambda` (esbuild, self-contained CJS).
// CDK wiring: set the LambdaSpec `handler` to "lambda.handler" and the function's asset to
// apps/<domain>/<service>/bin (ServiceStack.functionCode already resolves that dir).
//
// Unlike src/index.ts (a long-running Fastify server for ECS), this exports a `handler`
// the Lambda runtime invokes per event. Keep cold-start work at module scope (runs once
// per container), per-event work inside handler().
//

// Module-scope init runs once per cold start (reuse across warm invocations).
// e.g. const cloud = new CloudResolver(env, "dispatch"); const sqs = new SQSClient(sdkConfig());

/**
 * Lambda handler. Replace the body with the dispatch worker logic (e.g. drain an SQS batch).
 * @param event the invocation event (SQS records, EventBridge, etc.)
 */
export async function handler( event: unknown ): Promise<{ ok: boolean }>
{
    // TODO: wire to the dispatch Job/Service logic.
    void event;
    return { ok: true };
}
