//
// Shared AWS SDK v3 client construction — the ONE place client config is centralized:
// LocalStack endpoint (via sdkConfig), region, and a default retry policy. Also the single
// hook for X-Ray tracing later (wrap with aws-xray-sdk-core's captureAWSv3Client when
// manifest.tracing is on) — added here so no facade has to think about it.
//
import { sdkConfig } from "./sdkConfig";

export namespace ClientUtils
{
    /**
     * Construct an AWS SDK v3 client with the shared connection config applied — the LocalStack
     * endpoint (via {@link sdkConfig}), region, and a default retry policy (and, later, X-Ray).
     *
     * Always build clients through this rather than `new XClient()` directly, so endpoint /
     * region / retry / tracing concerns live in exactly one place. Facades call it lazily.
     *
     * @typeParam T  the SDK client type (inferred from `Ctor`; annotate the call site for clarity).
     * @param Ctor   an AWS SDK v3 client constructor, e.g. `S3Client`.
     * @param extra  optional config overrides merged last — e.g. a discovered `endpoint`
     *               (MediaConvert) or the management-API callback URL (WebSocket).
     * @returns      a configured client instance.
     * @example const s3 : S3Client = ClientUtils.createClient( S3Client );
     */
    export function createClient<T>( Ctor : new ( cfg : Record<string, unknown> ) => T, extra : Record<string, unknown> = {} ) : T
    {
        return new Ctor( { ...sdkConfig(), maxAttempts: 5, ...extra } );
    }
}
