//
// AWS SDK client configuration — one place to honor a local (LocalStack) endpoint.
//
// Named `sdkConfig` (not `awsConfig`) to avoid confusion with the AppConfig facade: this is
// the SDK *connection* config, not the AppConfig runtime-config/feature-flag service.
//
// When AWS_ENDPOINT_URL is set (local cloud dev against LocalStack), every client is
// redirected there with dummy credentials. When it's unset (real deploys), only the
// region is returned and the SDK resolves real credentials normally — so identical code
// runs locally and in the cloud.
//

/** Connection config passed to an AWS SDK v3 client constructor (a subset of the SDK's options). */
export interface SdkClientConfig
{
    region          : string;
    endpoint?       : string;      // set only for LocalStack
    credentials?    : { accessKeyId : string; secretAccessKey : string };   // dummy, for LocalStack
    forcePathStyle? : boolean;     // S3 in LocalStack needs path-style addressing
}

/**
 * Build the AWS SDK v3 client connection config for the current environment.
 *
 * - **Local (LocalStack):** when `AWS_ENDPOINT_URL` is set, returns the fixed endpoint + dummy
 *   credentials + path-style S3.
 * - **Real AWS:** when it's unset, returns just the region and lets the SDK resolve real
 *   credentials from the environment / instance / task role.
 *
 * So the same service code runs locally and in the cloud. Prefer {@link ClientUtils.createClient} over
 * calling this directly — it spreads this in plus retries/tracing.
 */
export function sdkConfig() : SdkClientConfig
{
    const region   : string = process.env.AWS_REGION ?? "us-east-1";
    const endpoint : string | undefined = process.env.AWS_ENDPOINT_URL;

    if( endpoint === undefined || endpoint === "" )
    {
        return { region };                          // real AWS — SDK resolves credentials normally
    }

    // LocalStack — fixed endpoint, dummy credentials, path-style S3.
    return {
        region,
        endpoint,
        credentials    : { accessKeyId: "test", secretAccessKey: "test" },
        forcePathStyle : true,
    };
}
