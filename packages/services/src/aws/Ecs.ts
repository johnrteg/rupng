//
// ECS facade — read-only service/task-state queries over `@aws-sdk/client-ecs`, addressed by
// PHYSICAL cluster + service names — a reader (e.g. monitor) inspects services it does not own.
//
import { ECSClient, DescribeServicesCommand } from "@aws-sdk/client-ecs";
import type { DescribeServicesCommandOutput, Service as EcsServiceState } from "@aws-sdk/client-ecs";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";

/**
 * ECS facade — the routine read-only `DescribeServices` query over `@aws-sdk/client-ecs`.
 * Like `CloudWatch`, this facade takes no `CloudResolver` — a caller (e.g. `monitor`) inspects
 * Fargate services across the fleet by their physical cluster/service names, not its own.
 */
export class Ecs
{
    private _client? : ECSClient;

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** The raw `ECSClient` — escape hatch (task lists, deployments, …). Lazy + cached. */
    get client() : ECSClient { return this._client ??= ClientUtils.createClient( ECSClient ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Describe one or more services in a cluster — desired/running/pending task counts and
     * deployment status, the basic "is this service up and at capacity" signal.
     *
     * @param cluster      cluster name or ARN.
     * @param serviceNames the service names (or ARNs) to describe (ECS caps this at 10 per call).
     */
    describeServices( cluster : string, serviceNames : Array<string> ) : Promise<Type.Result<Array<EcsServiceState>>>
    {
        return ResultUtils.from( async () : Promise<Array<EcsServiceState>> =>
        {
            const result : DescribeServicesCommandOutput = await this.client.send( new DescribeServicesCommand( {
                cluster,
                services: serviceNames,
            } ) );
            return result.services ?? [];
        } );
    }
}
