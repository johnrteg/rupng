//
import { GetWorkflowVersions, Workflow } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";

//
// List a workflow definition's immutable published version history, newest first.
//
export class GetWorkflowVersionsImpl extends GetWorkflowVersions
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

        const found : Type.Result<Array<Workflow.Entity>> = await WorkflowStore.listVersions( this.service.dynamo, accountId, id );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow versions read failed" } };

        const records : Array<Workflow.Entity> = found.data
            .sort( ( first : Workflow.Entity, second : Workflow.Entity ) : number => second.version - first.version );

        return { status: NetworkUtils.Status.OK, data: { records } };
    }
}

export default GetWorkflowVersionsImpl;
