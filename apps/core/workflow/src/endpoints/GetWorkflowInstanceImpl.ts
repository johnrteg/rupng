//
import { GetWorkflowInstance, WorkflowInstance } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";

//
// Fetch a single instance's live state — frontier (currentNodeId) · context · per-node history · status.
//
export class GetWorkflowInstanceImpl extends GetWorkflowInstance
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

        const got : Type.Result<WorkflowInstance.Entity | undefined> = await WorkflowStore.getInstance( this.service.dynamo, accountId, id );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow instance read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "workflow instance not found" } };

        return { status: NetworkUtils.Status.OK, data: got.data };
    }
}

export default GetWorkflowInstanceImpl;
