//
// Runtime resolution of resource identifiers by LOGICAL KEY.
//
// The /cloud CDK app injects each resource's physical identifier (queue URL, table
// name, bucket name, secret ARN, ...) into the service's compute as an environment
// variable named by envVarName(kind, key). A service resolves logical keys -> physical
// ids through this class, so it never hardcodes physical names.
//
// (For identifiers not injectable as env vars, the same logical keys resolve against
//  SSM Parameter Store via ssmPath() — wire that lookup in here behind the same API.)
//

import { Environment } from "./Environment";
import { ResourceKind, ResourceKey } from "./Common";
import { envVarName } from "./Naming";

/**
 * Resolves resource identifiers by logical key at runtime. The /cloud CDK app injects each
 * resource's physical id (queue URL, table name, bucket name, secret ARN, ...) into the
 * service's compute as an env var named by `envVarName(kind, key)`; a service uses this class
 * to turn a logical key back into the physical id, so it never hardcodes physical names.
 */
export class CloudResolver
{
    private readonly env     : Environment;
    private readonly service : string;
    private readonly source  : Record<string, string | undefined>;

    /**
     * @param env     current deployment environment
     * @param service the owning service name
     * @param source  identifier source to read from (defaults to `process.env`)
     */
    constructor( env : Environment, service : string, source? : Record<string, string | undefined> )
    {
        this.env     = env;
        this.service = service;
        // access process.env via globalThis index to avoid TS2591 ("Cannot find name 'process'")
        // when this file is type-checked by the web tsconfig, which excludes @types/node. At
        // runtime this file only runs in Node, so process.env is always present.
        const globalRecord : Record<string, unknown> = globalThis as Record<string, unknown>;
        const nodeEnv : Record<string, string | undefined> = ( globalRecord[ "process" ] as { env : Record<string, string | undefined> } | undefined )?.env ?? {};
        this.source  = source ?? nodeEnv;
    }

    // ── Typed accessors by resource kind (each resolves a logical key -> physical id) ──

    /** Resolve an SQS queue URL by logical key. */
    public queueUrl( key : ResourceKey )      : string { return this.require( ResourceKind.QUEUE, key ); }
    /** Resolve an S3 bucket name by logical key. */
    public bucketName( key : ResourceKey )    : string { return this.require( ResourceKind.BUCKET, key ); }
    /** Resolve a DynamoDB table name by logical key. */
    public tableName( key : ResourceKey )     : string { return this.require( ResourceKind.TABLE, key ); }
    /** Resolve an RDS/Aurora endpoint by logical key. */
    public databaseUrl( key : ResourceKey )   : string { return this.require( ResourceKind.DATABASE, key ); }
    /** Resolve a Secrets Manager secret ARN by logical key. */
    public secretArn( key : ResourceKey )     : string { return this.require( ResourceKind.SECRET, key ); }
    /** Resolve an EventBridge bus name by logical key. */
    public eventBusName( key : ResourceKey )  : string { return this.require( ResourceKind.EVENT_BUS, key ); }
    /** Resolve a Kafka topic name by logical key. */
    public topicName( key : ResourceKey )     : string { return this.require( ResourceKind.TOPIC, key ); }
    /** Resolve a Lambda function ARN by logical key. */
    public functionArn( key : ResourceKey )   : string { return this.require( ResourceKind.FUNCTION, key ); }
    /** Resolve an SNS topic ARN by logical key. */
    public snsTopicArn( key : ResourceKey )   : string { return this.require( ResourceKind.SNS_TOPIC, key ); }
    /** Resolve an API Gateway URL by logical key. */
    public apiUrl( key : ResourceKey )        : string { return this.require( ResourceKind.API, key ); }
    /** Resolve a KMS key ARN by logical key. */
    public kmsKeyArn( key : ResourceKey )     : string { return this.require( ResourceKind.KMS_KEY, key ); }
    /** Resolve an AppConfig application id by logical key. */
    public appConfigId( key : ResourceKey )   : string { return this.require( ResourceKind.APP_CONFIG, key ); }
    /** Resolve an ElastiCache endpoint by logical key. */
    public cacheEndpoint( key : ResourceKey ) : string { return this.require( ResourceKind.CACHE, key ); }
    /** Resolve an OpenSearch endpoint by logical key. */
    public searchEndpoint( key : ResourceKey ) : string { return this.require( ResourceKind.SEARCH, key ); }
    /** Resolve a CloudFront distribution domain by logical key. */
    public cdnDomain( key : ResourceKey )     : string { return this.require( ResourceKind.CDN, key ); }
    /** Resolve a Cognito user pool id by logical key. */
    public userPoolId( key : ResourceKey )    : string { return this.require( ResourceKind.USER_POOL, key ); }
    /** Resolve a MediaConvert queue ref by logical key. */
    public mediaConvertQueue( key : ResourceKey ) : string { return this.require( ResourceKind.MEDIACONVERT, key ); }
    /** Resolve a CloudWatch RUM app-monitor id by logical key. */
    public rumAppMonitor( key : ResourceKey ) : string { return this.require( ResourceKind.RUM, key ); }
    /** Resolve an Amplify app id by logical key. */
    public amplifyAppId( key : ResourceKey )  : string { return this.require( ResourceKind.AMPLIFY, key ); }
    /** Resolve a WebSocket API URL by logical key. */
    public webSocketUrl( key : ResourceKey )  : string { return this.require( ResourceKind.WEBSOCKET, key ); }

    // ── Generic access ──

    /**
     * Resolve a logical key to its physical id, or `undefined` if it isn't present.
     * @param kind the resource kind
     * @param key  the logical resource key
     */
    public lookup( kind : ResourceKind, key : ResourceKey ) : string | undefined
    {
        return this.source[ envVarName( kind, key ) ];
    }

    /**
     * Resolve a logical key to its physical id, throwing (fail-fast at boot) if it isn't present.
     * @param kind the resource kind
     * @param key  the logical resource key
     * @throws if the identifier env var is missing or empty
     */
    public require( kind : ResourceKind, key : ResourceKey ) : string
    {
        const name  : string = envVarName( kind, key );
        const value : string | undefined = this.source[ name ];
        if( value === undefined || value === "" )
        {
            throw new Error( `CloudResolver[${this.env}/${this.service}]: missing resource identifier '${name}' (${kind}:${key})` );
        }
        return value;
    }
}
