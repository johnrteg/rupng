//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Delete a Studio project (its record + its stored canvas snapshot). Does NOT touch any library asset the
// project saved to — those are independent Media.Assets.
export class DeleteStudioProject extends RestfulEndpoint<DeleteStudioProject.Query, undefined, DeleteStudioProject.Response>
{
    public readonly uri      : string = DeleteStudioProject.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteStudioProject
{
    export const URI : string = apiPath( "media", 1, "/projects/:id" );
    export interface Query { id : string; }
    export interface Response { deleted : boolean; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default DeleteStudioProject;
