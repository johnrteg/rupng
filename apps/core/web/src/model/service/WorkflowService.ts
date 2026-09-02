//
import {
    GetWorkflows, GetWorkflow, PostWorkflow, PatchWorkflow, DeleteWorkflow,
    PostWorkflowPublish, GetWorkflowVersions, PostWorkflowPause, PostWorkflowResume,
    GetWorkflowInstances, GetWorkflowInstance, PostWorkflowInstance,
    Workflow,
} from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import AppModel from "../AppModel";

//
// WorkflowService (web) — the client wrapper over the workflow authoring/instance endpoints. Mirrors
// the house service pattern (SvgService): every call goes through `appmodel.server.fetch` and returns
// the RestfulService Reply (a Result) — the caller branches on `reply.ok`, this layer never throws.
//
export class WorkflowService
{
    private appmodel : AppModel;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( app : AppModel )
    {
        this.appmodel = app;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** List the acting account's workflow definitions. */
    public list( query? : GetWorkflows.Query ) : Promise<RestfulService.Reply<GetWorkflows.Response>>
    {
        return this.appmodel.server.fetch( new GetWorkflows( query ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch one workflow definition's HEAD row (graph + triggers). */
    public get( id : string ) : Promise<RestfulService.Reply<GetWorkflow.Response>>
    {
        return this.appmodel.server.fetch( new GetWorkflow( id ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Create a new draft workflow definition. */
    public create( body : Workflow.CreateWorkflow ) : Promise<RestfulService.Reply<PostWorkflow.Response>>
    {
        return this.appmodel.server.fetch( new PostWorkflow( body ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Save edits to a definition's name/triggers/graph. */
    public update( id : string, body : Workflow.UpdateWorkflow ) : Promise<RestfulService.Reply<PatchWorkflow.Response>>
    {
        return this.appmodel.server.fetch( new PatchWorkflow( id, body ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Archive a definition (terminal, read-only). */
    public archive( id : string ) : Promise<RestfulService.Reply<DeleteWorkflow.Response>>
    {
        return this.appmodel.server.fetch( new DeleteWorkflow( id ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Publish a definition — validates the graph server-side, snapshots a version. */
    public publish( id : string ) : Promise<RestfulService.Reply<PostWorkflowPublish.Response>>
    {
        return this.appmodel.server.fetch( new PostWorkflowPublish( id ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** List a definition's published version history. */
    public versions( id : string ) : Promise<RestfulService.Reply<GetWorkflowVersions.Response>>
    {
        return this.appmodel.server.fetch( new GetWorkflowVersions( id ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Pause a published definition's triggers. */
    public pause( id : string ) : Promise<RestfulService.Reply<PostWorkflowPause.Response>>
    {
        return this.appmodel.server.fetch( new PostWorkflowPause( id ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Resume a paused definition's triggers. */
    public resume( id : string ) : Promise<RestfulService.Reply<PostWorkflowResume.Response>>
    {
        return this.appmodel.server.fetch( new PostWorkflowResume( id ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** List a definition's runs (instances). */
    public listInstances( query : GetWorkflowInstances.Query ) : Promise<RestfulService.Reply<GetWorkflowInstances.Response>>
    {
        return this.appmodel.server.fetch( new GetWorkflowInstances( query ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch one instance's live state. */
    public getInstance( id : string ) : Promise<RestfulService.Reply<GetWorkflowInstance.Response>>
    {
        return this.appmodel.server.fetch( new GetWorkflowInstance( id ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Manually start an instance of a published definition for a subject. */
    public startInstance( definitionId : string, subject : string, context? : Record<string, unknown> ) : Promise<RestfulService.Reply<PostWorkflowInstance.Response>>
    {
        return this.appmodel.server.fetch( new PostWorkflowInstance( { definitionId, subject, context } ) );
    }
}

export default WorkflowService;
