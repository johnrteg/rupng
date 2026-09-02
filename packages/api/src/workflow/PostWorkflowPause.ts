//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Workflow } from "./model/Workflow";

//
// Pause a published workflow — disables its triggers (no NEW instances start); in-flight instances
// continue (README.md "Definition lifecycle").
//
export class PostWorkflowPause extends RestfulEndpoint< PostWorkflowPause.Query, undefined, PostWorkflowPause.Response >
{
    public readonly uri      : string = PostWorkflowPause.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "pauseWorkflow",
        summary:     "Pause a workflow",
        description: "Disables a published workflow's triggers; in-flight instances keep running.",
        tags:        [ "Workflow" ],
        errors:      { 404: "No such workflow in this account", 409: "Workflow is not published" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostWorkflowPause
{
    export const URI : string = apiPath( "workflow", 1, "/definitions/:id/pause" );

    export interface Query { id : Type.UUID; }
    export interface Response extends Workflow.Entity {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostWorkflowPause;
