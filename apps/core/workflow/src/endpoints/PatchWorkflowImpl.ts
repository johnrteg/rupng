//
import { PatchWorkflow, Workflow } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";

//
// Edit a workflow definition's name / triggers / graph. ARCHIVED is terminal + read-only. Editing a
// PUBLISHED/PAUSED definition forks it back to DRAFT (README.md "editing forks a new draft") — this
// pass models that as a status flip on the mutable HEAD row (the immutable snapshot from the last
// publish stays intact in `workflow_versions`, unaffected), not a brand-new head-row-per-draft-revision.
//
export class PatchWorkflowImpl extends PatchWorkflow
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
        if( current.status === Workflow.Status.ARCHIVED )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "workflow is archived (read-only)" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const merged : Workflow.Entity =
        {
            ...current,
            ...this.body,
            id:        current.id,
            accountId: current.accountId,
            // editing (from ANY non-archived status) forks back to draft — new triggers won't start on
            // the stale edit until it's re-published; existing instances keep running their pinned version.
            status:    Workflow.Status.DRAFT,
            version:   current.version,
            ownerId:   current.ownerId,
            createdAt: current.createdAt,
            updatedAt: now,
        };

        const wrote : Type.Result<void> = await WorkflowStore.putHead( this.service.dynamo, merged );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow write failed" } };

        const payload : Payloads.Workflow = { id: merged.id, accountId: merged.accountId, name: merged.name, status: merged.status, version: merged.version };
        void this.service.emit( Events.Object.WORKFLOW_WORKFLOW, Events.Verb.UPDATED, merged.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: merged };
    }
}

export default PatchWorkflowImpl;
