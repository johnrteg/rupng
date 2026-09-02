//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Workflow } from "./model/Workflow";

//
// Resume a paused workflow — re-enables its triggers.
//
export class PostWorkflowResume extends RestfulEndpoint< PostWorkflowResume.Query, undefined, PostWorkflowResume.Response >
{
    public readonly uri      : string = PostWorkflowResume.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "resumeWorkflow",
        summary:     "Resume a paused workflow",
        description: "Re-enables a paused workflow's triggers.",
        tags:        [ "Workflow" ],
        errors:      { 404: "No such workflow in this account", 409: "Workflow is not paused" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostWorkflowResume
{
    export const URI : string = apiPath( "workflow", 1, "/definitions/:id/resume" );

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

export default PostWorkflowResume;
