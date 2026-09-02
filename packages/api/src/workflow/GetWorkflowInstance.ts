//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { WorkflowInstance } from "./model/WorkflowInstance";

//
// Fetch a single instance's live state — frontier (currentNodeId) · context · per-node history · status.
//
export class GetWorkflowInstance extends RestfulEndpoint< GetWorkflowInstance.Query, undefined, GetWorkflowInstance.Response >
{
    public readonly uri      : string = GetWorkflowInstance.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getWorkflowInstance",
        summary:     "Get a workflow instance",
        description: "Fetches a run's live state — frontier, context, and per-node history.",
        tags:        [ "Workflow" ],
        errors:      { 404: "No such instance in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetWorkflowInstance
{
    export const URI : string = apiPath( "workflow", 1, "/instances/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response extends WorkflowInstance.Entity {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetWorkflowInstance;
