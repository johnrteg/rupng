//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Workflow } from "./model/Workflow";

//
// Fetch a single workflow definition (graph + triggers) by id. Tenant-scoped. USER-gated.
//
export class GetWorkflow extends RestfulEndpoint< GetWorkflow.Query, undefined, GetWorkflow.Response >
{
    public readonly uri      : string = GetWorkflow.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getWorkflow",
        summary:     "Get a workflow definition",
        description: "Fetches a workflow definition (graph + triggers).",
        tags:        [ "Workflow" ],
        errors:      { 404: "No such workflow in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetWorkflow
{
    export const URI : string = apiPath( "workflow", 1, "/definitions/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response extends Workflow.Entity {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetWorkflow;
