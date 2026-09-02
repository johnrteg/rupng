//
import { PostWorkflowPublish, Workflow } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";

//
// Publish a workflow definition — validates the whole graph (Workflow.validateGraph: reachability,
// labeled-edge completeness, no dangling references), then snapshots an immutable version and flips
// the HEAD row to PUBLISHED. A running instance always pins the version it started on (see
// WorkflowStore.getVersion), so this never disturbs in-flight runs.
//
export class PostWorkflowPublishImpl extends PostWorkflowPublish
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
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "workflow is archived (read-only)" } };

        const issues : Array<Workflow.GraphIssue> = Workflow.validateGraph( current );
        if( issues.length > 0 )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "graph failed validation", issues } };

        const now : Type.ISODateTime = new Date().toISOString();
        const published : Workflow.Entity =
        {
            ...current,
            status:      Workflow.Status.PUBLISHED,
            version:     current.version + 1,
            publishedAt: now,
            updatedAt:   now,
        };

        const snapshotted : Type.Result<void> = await WorkflowStore.putVersion( this.service.dynamo, published );
        if( !snapshotted.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow version snapshot failed" } };

        const wrote : Type.Result<void> = await WorkflowStore.putHead( this.service.dynamo, published );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow head write failed" } };

        const payload : Payloads.Workflow = { id: published.id, accountId: published.accountId, name: published.name, status: published.status, version: published.version };
        void this.service.emit( Events.Object.WORKFLOW_WORKFLOW, Events.Verb.UPDATED, published.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: published };
    }
}

export default PostWorkflowPublishImpl;
