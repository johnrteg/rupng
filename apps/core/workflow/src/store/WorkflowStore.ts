//
import type { Dynamo } from "@repo/services";
import type { Type } from "@repo/common";
import { Workflow, WorkflowInstance } from "@repo/api";

//
// WorkflowStore — the DynamoDB read/write shapes shared by every role that touches the `workflows` /
// `workflow_versions` / `workflow_instances` tables (WorkflowService, WorkflowConsumer, WorkflowJob —
// three DIFFERENT base classes per the platform's Service/Consumer/Job split, so this is plain functions
// taking a `Dynamo` facade rather than a method on any one base — no duplicated query logic across roles).
//
export namespace WorkflowStore
{
    /** The `workflows` table's key — the mutable HEAD row (current draft/published/paused state). */
    export function headKey( accountId : Type.ID, defId : Type.ID ) : Record<string, unknown>
    {
        return { accountId, defId };
    }

    /** The `workflow_versions` table's key — one immutable snapshot per published version. */
    export function versionKey( accountId : Type.ID, defId : Type.ID, version : number ) : Record<string, unknown>
    {
        return { accountId, versionSk: `${defId}#V${version}` };
    }

    /** The `workflow_instances` table's key — one row per run. */
    export function instanceKey( accountId : Type.ID, instanceId : Type.ID ) : Record<string, unknown>
    {
        return { accountId, instanceSk: `RUN#${instanceId}` };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Definitions (HEAD)
    ////////////////////////////////////////////////////////////////////////////////////////////

    export async function getHead( dynamo : Dynamo, accountId : Type.ID, defId : Type.ID ) : Promise<Type.Result<Workflow.Entity | undefined>>
    {
        return dynamo.get<Workflow.Entity>( "workflows", headKey( accountId, defId ) );
    }

    export async function putHead( dynamo : Dynamo, entity : Workflow.Entity ) : Promise<Type.Result<void>>
    {
        return dynamo.put( "workflows", { ...entity, defId: entity.id } );
    }

    export async function listHeads( dynamo : Dynamo, accountId : Type.ID ) : Promise<Type.Result<Array<Workflow.Entity>>>
    {
        return dynamo.query<Workflow.Entity>( "workflows", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Published version snapshots (immutable)
    ////////////////////////////////////////////////////////////////////////////////////////////

    export async function putVersion( dynamo : Dynamo, entity : Workflow.Entity ) : Promise<Type.Result<void>>
    {
        return dynamo.put( "workflow_versions", { ...entity, versionSk: `${entity.id}#V${entity.version}` } );
    }

    export async function getVersion( dynamo : Dynamo, accountId : Type.ID, defId : Type.ID, version : number ) : Promise<Type.Result<Workflow.Entity | undefined>>
    {
        return dynamo.get<Workflow.Entity>( "workflow_versions", versionKey( accountId, defId, version ) );
    }

    export async function listVersions( dynamo : Dynamo, accountId : Type.ID, defId : Type.ID ) : Promise<Type.Result<Array<Workflow.Entity>>>
    {
        return dynamo.query<Workflow.Entity>( "workflow_versions", {
            KeyConditionExpression:    "accountId = :a AND begins_with( versionSk, :prefix )",
            ExpressionAttributeValues: { ":a": accountId, ":prefix": `${defId}#V` },
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Instances (runs)
    ////////////////////////////////////////////////////////////////////////////////////////////

    export async function getInstance( dynamo : Dynamo, accountId : Type.ID, instanceId : Type.ID ) : Promise<Type.Result<WorkflowInstance.Entity | undefined>>
    {
        return dynamo.get<WorkflowInstance.Entity>( "workflow_instances", instanceKey( accountId, instanceId ) );
    }

    export async function putInstance( dynamo : Dynamo, instance : WorkflowInstance.Entity ) : Promise<Type.Result<void>>
    {
        return dynamo.put( "workflow_instances", { ...instance, instanceSk: `RUN#${instance.instanceId}` } );
    }

    export async function listInstances( dynamo : Dynamo, accountId : Type.ID, definitionId : Type.ID ) : Promise<Type.Result<Array<WorkflowInstance.Entity>>>
    {
        const found : Type.Result<Array<WorkflowInstance.Entity>> = await dynamo.query<WorkflowInstance.Entity>( "workflow_instances", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return found;
        return { ok: true, data: found.data.filter( ( instance : WorkflowInstance.Entity ) : boolean => instance.definitionId === definitionId ) };
    }

    /** Resolve an external inbound signal (e.g. a contact's SMS reply) to the parked instance awaiting it
     *  — via the `byWaitKey` GSI (README.md "subject-keyed" resume routing). */
    export async function findInstanceByWaitKey( dynamo : Dynamo, waitKey : string ) : Promise<Type.Result<WorkflowInstance.Entity | undefined>>
    {
        const found : Type.Result<Array<WorkflowInstance.Entity>> = await dynamo.query<WorkflowInstance.Entity>( "workflow_instances", {
            IndexName:                 "byWaitKey",
            KeyConditionExpression:    "waitKey = :w",
            ExpressionAttributeValues: { ":w": waitKey },
        } );
        if( !found.ok ) return found;
        return { ok: true, data: found.data[ 0 ] };
    }
}

export default WorkflowStore;
// eof
