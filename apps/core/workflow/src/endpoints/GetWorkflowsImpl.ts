//
import { GetWorkflows, Workflow, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import WorkflowService from "../services/WorkflowService";
import { WorkflowStore } from "../store/WorkflowStore";

//
// List the acting account's workflow definitions (HEAD rows). Hides ARCHIVED unless a status filter asks
// otherwise, newest-updated first.
//
export class GetWorkflowsImpl extends GetWorkflows
{
    private service : WorkflowService;
    constructor( service : WorkflowService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Workflow.Entity>> = await WorkflowStore.listHeads( this.service.dynamo, accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "workflows read failed" } };

        const query : GetWorkflows.Query = this.query ?? {};
        const definitions : Array<Workflow.Entity> = found.data
            .map( ( row : Workflow.Entity ) : Workflow.Entity => ObjectUtils.withDefaults( row, Workflow.DEFAULT ) )
            .filter( ( row : Workflow.Entity ) : boolean => query.status ? row.status === query.status : row.status !== Workflow.Status.ARCHIVED )
            .sort( ( first : Workflow.Entity, second : Workflow.Entity ) : number => String( second.updatedAt ?? "" ).localeCompare( String( first.updatedAt ?? "" ) ) );

        const paged : Paging.Result<Workflow.Entity> = Paging.paginate( definitions, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetWorkflowsImpl;
