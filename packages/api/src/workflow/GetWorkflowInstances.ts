//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { WorkflowInstance } from "./model/WorkflowInstance";
import { Paging } from "../model/Paging";

//
// List a workflow definition's runs (instances), optionally filtered by status. USER-gated.
//
export class GetWorkflowInstances extends RestfulEndpoint< GetWorkflowInstances.Query, undefined, GetWorkflowInstances.Response >
{
    public readonly uri      : string = GetWorkflowInstances.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listWorkflowInstances",
        summary:     "List workflow instances",
        description: "Lists runs (instances) for a workflow definition, optionally filtered by status.",
        tags:        [ "Workflow" ],
    };

    constructor( query? : GetWorkflowInstances.Query ) { super( query ?? { definitionId: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetWorkflowInstances
{
    export const URI : string = apiPath( "workflow", 1, "/instances" );

    export interface Query extends Paging.Request
    {
        definitionId: string;
        status?:      WorkflowInstance.Status;
    }

    export interface Response extends Paging.Result<WorkflowInstance.Entity> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetWorkflowInstances;
