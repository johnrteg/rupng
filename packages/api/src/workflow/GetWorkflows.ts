//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Workflow } from "./model/Workflow";
import { Paging } from "../model/Paging";

//
// List the acting account's workflow definitions (paged, `{ records, page }` envelope). USER-gated.
//
export class GetWorkflows extends RestfulEndpoint< GetWorkflows.Query, undefined, GetWorkflows.Response >
{
    public readonly uri      : string = GetWorkflows.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listWorkflows",
        summary:     "List workflow definitions",
        description: "Lists the acting account's workflow definitions (paged).",
        tags:        [ "Workflow" ],
    };

    constructor( query? : GetWorkflows.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetWorkflows
{
    export const URI : string = apiPath( "workflow", 1, "/definitions" );

    export interface Query extends Paging.Request
    {
        status? : Workflow.Status;
    }

    export interface Response extends Paging.Result<Workflow.Entity> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetWorkflows;
