//
// Local-development support — deploying the CDK app to LocalStack (Docker) under the
// `LOCAL` environment instead of real AWS.
//
// LocalStack is the deploy *target*; `Environment.LOCAL` is the config *profile* that
// makes everything tiny + disposable (1 AZ, no NAT, RemovalPolicy.DESTROY). Deploy with
// the `aws-cdk-local` wrapper: `cdklocal deploy -c env=local` (see cloud/local/).
//
import * as cdk from "aws-cdk-lib";
import { IConstruct } from "constructs";
import { Environment, ResourceKind } from "@repo/cloud-spec";

/** True when targeting the LocalStack (local Docker) environment. */
export function isLocal( env : Environment ) : boolean
{
    return env === Environment.LOCAL;
}

/**
 * Resource kinds not emulated even by LocalStack Pro — provisioned only against real AWS,
 * and skipped (with a synth-time notice) under `LOCAL`. Everything else (S3, SQS, SNS,
 * DynamoDB, Lambda, API Gateway, KMS, Secrets, RDS, ElastiCache, OpenSearch, Cognito,
 * CloudFront, EventBridge, ECS, Batch, …) is emulated by LocalStack Pro.
 *
 * MSK (Kafka) is handled separately: LocalStack's MSK emulation is unreliable, so locally
 * we skip the managed cluster and point services at a Kafka side-container (see cloud/local/).
 */
export const LOCAL_UNSUPPORTED : ReadonlySet<ResourceKind> = new Set<ResourceKind>( [
    ResourceKind.MEDIACONVERT,   // Elemental MediaConvert — no LocalStack support
    ResourceKind.RUM,            // CloudWatch RUM — no LocalStack support
    ResourceKind.AMPLIFY,        // Amplify Hosting — no LocalStack support
] );

/** Whether a resource kind can be provisioned against LocalStack (Pro). */
export function supportedLocally( kind : ResourceKind ) : boolean
{
    return !LOCAL_UNSUPPORTED.has( kind );
}

/**
 * Aspect that forces `RemovalPolicy.DESTROY` on every resource in a stack. Applied to local
 * stacks so a `cdklocal destroy` (or simply recreating the container) tears everything down
 * cleanly — no retained buckets/tables/keys, no deletion protection getting in the way.
 */
export class DestroyAll implements cdk.IAspect
{
    public visit( node : IConstruct ) : void
    {
        if( node instanceof cdk.CfnResource )
        {
            node.applyRemovalPolicy( cdk.RemovalPolicy.DESTROY );
        }
    }
}
