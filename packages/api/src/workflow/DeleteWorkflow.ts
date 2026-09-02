//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";

//
// Archive a workflow definition (terminal, read-only — never hard-deleted; version history + past
// instances are retained for audit). Does NOT stop in-flight instances (README.md "drain by default").
//
export class DeleteWorkflow extends RestfulEndpoint< DeleteWorkflow.Query, undefined, DeleteWorkflow.Response >
{
    public readonly uri      : string = DeleteWorkflow.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "archiveWorkflow",
        summary:     "Archive a workflow definition",
        description: "Archives a workflow definition (terminal, read-only; never hard-deleted).",
        tags:        [ "Workflow" ],
        errors:      { 404: "No such workflow in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteWorkflow
{
    export const URI : string = apiPath( "workflow", 1, "/definitions/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response { id : Type.UUID; archived : boolean; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteWorkflow;
