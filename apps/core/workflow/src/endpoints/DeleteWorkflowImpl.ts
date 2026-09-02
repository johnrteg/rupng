//
import { DeleteWorkflow, Workflow } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";

//
// Archive a workflow definition (terminal, read-only — never hard-deleted; version history + past
// instances are retained for audit). Does NOT stop in-flight instances (README.md "drain by default").
//
export class DeleteWorkflowImpl extends DeleteWorkflow
{
    private service : WorkflowService;
    constructor( service : WorkflowService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id )            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const got : Type.Result<Workflow.Entity | undefined> = await WorkflowStore.getHead( this.service.dynamo, accountId, id );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "workflow not found" } };

        const current : Workflow.Entity = ObjectUtils.withDefaults( got.data, Workflow.DEFAULT );
        const now : Type.ISODateTime = new Date().toISOString();
        const archived : Workflow.Entity = { ...current, status: Workflow.Status.ARCHIVED, updatedAt: now };

        const wrote : Type.Result<void> = await WorkflowStore.putHead( this.service.dynamo, archived );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow archive failed" } };

        const payload : Payloads.Workflow = { id: archived.id, accountId: archived.accountId, name: archived.name, status: archived.status, version: archived.version };
        void this.service.emit( Events.Object.WORKFLOW_WORKFLOW, Events.Verb.DELETED, archived.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: { id, archived: true } };
    }
}

export default DeleteWorkflowImpl;
