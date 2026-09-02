//
import { randomUUID } from "node:crypto";

import { PostWorkflow, Workflow } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";

//
// Create a workflow definition in DRAFT state. Server assigns id / accountId / status / version (0) /
// ownerId / timestamps, and seeds the starter graph (start -> end) when the caller supplies no nodes —
// so a brand-new definition opens on a valid, publishable (if trivial) graph.
//
export class PostWorkflowImpl extends PostWorkflow
{
    private service : WorkflowService;
    constructor( service : WorkflowService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const name : string = this.body?.name ?? "";
        if( !name )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name required" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const id : Type.UUID = randomUUID();
        const graph : Pick<Workflow.Entity, "nodes" | "edges"> = ( this.body?.nodes && this.body.nodes.length > 0 )
            ? { nodes: this.body.nodes, edges: this.body.edges ?? [] }
            : Workflow.starterGraph( randomUUID(), randomUUID(), randomUUID() );

        const entity : Workflow.Entity =
        {
            id,
            accountId,
            name,
            status:   Workflow.Status.DRAFT,
            version:  0,
            triggers: this.body?.triggers ?? [],
            nodes:    graph.nodes,
            edges:    graph.edges,
            ownerId:  auth.userId,
            createdAt: now,
            updatedAt: now,
        };

        const wrote : Type.Result<void> = await WorkflowStore.putHead( this.service.dynamo, entity );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow write failed" } };

        const payload : Payloads.Workflow = { id: entity.id, accountId: entity.accountId, name: entity.name, status: entity.status, version: entity.version };
        void this.service.emit( Events.Object.WORKFLOW_WORKFLOW, Events.Verb.CREATED, entity.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: entity };
    }
}

export default PostWorkflowImpl;
