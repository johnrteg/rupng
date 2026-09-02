//
import WorkflowService from "./WorkflowService";

import GetWorkflowsImpl from "../endpoints/GetWorkflowsImpl";
import GetWorkflowImpl from "../endpoints/GetWorkflowImpl";
import PostWorkflowImpl from "../endpoints/PostWorkflowImpl";
import PatchWorkflowImpl from "../endpoints/PatchWorkflowImpl";
import DeleteWorkflowImpl from "../endpoints/DeleteWorkflowImpl";
import PostWorkflowPublishImpl from "../endpoints/PostWorkflowPublishImpl";
import GetWorkflowVersionsImpl from "../endpoints/GetWorkflowVersionsImpl";
import PostWorkflowPauseImpl from "../endpoints/PostWorkflowPauseImpl";
import PostWorkflowResumeImpl from "../endpoints/PostWorkflowResumeImpl";
import GetWorkflowInstancesImpl from "../endpoints/GetWorkflowInstancesImpl";
import GetWorkflowInstanceImpl from "../endpoints/GetWorkflowInstanceImpl";
import PostWorkflowInstanceImpl from "../endpoints/PostWorkflowInstanceImpl";

//
// MAIN role — the /workflow/* API (definition CRUD + versioning/publish/pause/resume, instance reads,
// manual start). Single HTTP deployable role.
//
export class WorkflowMainService extends WorkflowService
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( WorkflowService.Role.MAIN );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the workflow endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new GetWorkflowsImpl( this ) );
        this.register( new GetWorkflowImpl( this ) );
        this.register( new PostWorkflowImpl( this ) );
        this.register( new PatchWorkflowImpl( this ) );
        this.register( new DeleteWorkflowImpl( this ) );
        this.register( new PostWorkflowPublishImpl( this ) );
        this.register( new GetWorkflowVersionsImpl( this ) );
        this.register( new PostWorkflowPauseImpl( this ) );
        this.register( new PostWorkflowResumeImpl( this ) );
        this.register( new GetWorkflowInstancesImpl( this ) );
        this.register( new GetWorkflowInstanceImpl( this ) );
        this.register( new PostWorkflowInstanceImpl( this ) );
    }
}

export default WorkflowMainService;
