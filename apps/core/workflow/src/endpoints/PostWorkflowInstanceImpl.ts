//
import { randomUUID } from "node:crypto";

import { PostWorkflowInstance, Workflow, WorkflowInstance } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";
import { AdvanceMessage } from "../engine/AdvanceMessage";

//
// Manually/API-start an instance of a PUBLISHED workflow definition for a subject. Seeds the instance at
// its `start` node then enqueues the first advance — WorkflowStepJob does the actual decide/dispatch.
//
export class PostWorkflowInstanceImpl extends PostWorkflowInstance
{
    private service : WorkflowService;
    constructor( service : WorkflowService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const definitionId : string = this.body?.definitionId ?? "";
        const subject : string = this.body?.subject ?? "";
        if( !definitionId || !subject ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "definitionId and subject required" } };

        const got : Type.Result<Workflow.Entity | undefined> = await WorkflowStore.getHead( this.service.dynamo, accountId, definitionId );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "workflow not found" } };

        const definition : Workflow.Entity = ObjectUtils.withDefaults( got.data, Workflow.DEFAULT );
        if( definition.status !== Workflow.Status.PUBLISHED )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "workflow is not published" } };

        const startNode : Workflow.Node | undefined = definition.nodes.find( ( node : Workflow.Node ) : boolean => node.type === Workflow.NodeType.START );
        if( !startNode ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "published workflow has no start node" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const instance : WorkflowInstance.Entity =
        {
            instanceId:    randomUUID(),
            accountId,
            definitionId:  definition.id,
            defVersion:    definition.version,
            subject,
            status:        WorkflowInstance.Status.RUNNING,
            context:       this.body?.context ?? {},
            currentNodeId: startNode.id,
            history:       [],
            startedAt:     now,
            updatedAt:     now,
        };

        const wrote : Type.Result<void> = await WorkflowStore.putInstance( this.service.dynamo, instance );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow instance write failed" } };

        const message : AdvanceMessage = { accountId, instanceId: instance.instanceId, nodeId: startNode.id };
        const enqueued : Type.Result<void> = await this.service.sqs.send( "workflow-advance", message );
        if( !enqueued.ok ) this.service.log.warn( "workflow-advance enqueue failed", { instanceId: instance.instanceId, error: enqueued.error } );

        const payload : Payloads.WorkflowInstance = { instanceId: instance.instanceId, accountId, definitionId: instance.definitionId, status: instance.status };
        void this.service.emit( Events.Object.WORKFLOW_INSTANCE, Events.Verb.CREATED, instance.instanceId, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: instance };
    }
}

export default PostWorkflowInstanceImpl;
