//
import { GetWorkflowInstances, WorkflowInstance, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";

//
// List a workflow definition's runs (instances), newest-started first.
//
export class GetWorkflowInstancesImpl extends GetWorkflowInstances
{
    private service : WorkflowService;
    constructor( service : WorkflowService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const definitionId : string = this.query?.definitionId ?? "";
        if( !definitionId )  return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "definitionId required" } };

        const found : Type.Result<Array<WorkflowInstance.Entity>> = await WorkflowStore.listInstances( this.service.dynamo, accountId, definitionId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflow instances read failed" } };

        const query : GetWorkflowInstances.Query = this.query ?? { definitionId };
        const instances : Array<WorkflowInstance.Entity> = found.data
            .filter( ( row : WorkflowInstance.Entity ) : boolean => query.status ? row.status === query.status : true )
            .sort( ( first : WorkflowInstance.Entity, second : WorkflowInstance.Entity ) : number => String( second.startedAt ?? "" ).localeCompare( String( first.startedAt ?? "" ) ) );

        const paged : Paging.Result<WorkflowInstance.Entity> = Paging.paginate( instances, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetWorkflowInstancesImpl;
