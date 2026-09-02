//
import { PostWorkflowPause, Workflow } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";

//
// Pause a published workflow — disables its triggers (WorkflowTriggerConsumer checks status before
// starting a new instance); in-flight instances keep running.
//
export class PostWorkflowPauseImpl extends PostWorkflowPause
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
        if( current.status !== Workflow.Status.PUBLISHED )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "workflow is not published" } };

        const paused : Workflow.Entity = { ...current, status: Workflow.Status.PAUSED, updatedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await WorkflowStore.putHead( this.service.dynamo, paused );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow write failed" } };

        const payload : Payloads.Workflow = { id: paused.id, accountId: paused.accountId, name: paused.name, status: paused.status, version: paused.version };
        void this.service.emit( Events.Object.WORKFLOW_WORKFLOW, Events.Verb.UPDATED, paused.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: paused };
    }
}

export default PostWorkflowPauseImpl;
