//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Workflow } from "./model/Workflow";

//
// List a workflow definition's published version history (immutable snapshots, newest first).
//
export class GetWorkflowVersions extends RestfulEndpoint< GetWorkflowVersions.Query, undefined, GetWorkflowVersions.Response >
{
    public readonly uri      : string = GetWorkflowVersions.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listWorkflowVersions",
        summary:     "List a workflow's published versions",
        description: "Lists a workflow definition's immutable published version history, newest first.",
        tags:        [ "Workflow" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetWorkflowVersions
{
    export const URI : string = apiPath( "workflow", 1, "/definitions/:id/versions" );

    export interface Query { id : Type.UUID; }
    export interface Response { records : Array<Workflow.Entity>; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetWorkflowVersions;
