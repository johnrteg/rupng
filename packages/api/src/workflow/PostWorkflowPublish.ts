//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Workflow } from "./model/Workflow";

//
// Publish a workflow definition — validates the whole graph (Workflow.validateGraph), snapshots an
// immutable version, and flips status to `published`. Instances pin the version they started on.
//
export class PostWorkflowPublish extends RestfulEndpoint< PostWorkflowPublish.Query, undefined, PostWorkflowPublish.Response >
{
    public readonly uri      : string = PostWorkflowPublish.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "publishWorkflow",
        summary:     "Publish a workflow definition",
        description: "Validates the graph, snapshots an immutable version, and publishes it.",
        tags:        [ "Workflow" ],
        errors:      { 404: "No such workflow in this account", 400: "Graph failed validation" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostWorkflowPublish
{
    export const URI : string = apiPath( "workflow", 1, "/definitions/:id/publish" );

    export interface Query { id : Type.UUID; }
    export interface Response extends Workflow.Entity { issues? : Array<Workflow.GraphIssue>; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostWorkflowPublish;
