//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Workflow } from "./model/Workflow";

//
// Edit a workflow definition's name / triggers / graph (nodes + edges). Editing a `published`/`paused`
// definition forks it back to `draft` (README.md "editing forks a new draft") — see PatchWorkflowImpl.
//
export class PatchWorkflow extends RestfulEndpoint< PatchWorkflow.Query, PatchWorkflow.Body, PatchWorkflow.Response >
{
    public readonly uri      : string = PatchWorkflow.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateWorkflow",
        summary:     "Update a workflow definition",
        description: "Edits a workflow's name/triggers/graph. Editing a published/paused definition forks it back to draft.",
        tags:        [ "Workflow" ],
        errors:      { 404: "No such workflow in this account", 409: "Workflow is archived (read-only)" },
    };

    constructor( id? : string, body? : PatchWorkflow.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true, properties: {} }; }
}

export namespace PatchWorkflow
{
    export const URI : string = apiPath( "workflow", 1, "/definitions/:id" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest, Workflow.UpdateWorkflow {}
    export interface Response extends Workflow.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PatchWorkflow;
