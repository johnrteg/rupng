//
import { GetWorkflow, Workflow } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";

//
// Fetch a single workflow definition's HEAD row (its current draft/published/paused state) by id.
//
export class GetWorkflowImpl extends GetWorkflow
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

        return { status: NetworkUtils.Status.OK, data: ObjectUtils.withDefaults( got.data, Workflow.DEFAULT ) };
    }
}

export default GetWorkflowImpl;
