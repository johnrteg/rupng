//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";

//
// Remove a contact from a segment's manual membership (deletes the join row). USER-gated, first-party.
//
export class DeleteSegmentMember extends RestfulEndpoint< DeleteSegmentMember.Query, undefined, DeleteSegmentMember.Response >
{
    public readonly uri      : string = DeleteSegmentMember.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "removeSegmentMember",
        summary:     "Remove a contact from a segment",
        description: "Removes a contact from a segment's manual membership.",
        tags:        [ "Contact" ],
    };

    constructor( id? : string, contactId? : string ) { super( { id: id ?? "", contactId: contactId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "id",        location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "contactId", location: RestfulEndpoint.AttrLocation.URI, required: true },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteSegmentMember
{
    export const URI : string = apiPath( "contact", 1, "/segments/:id/members/:contactId" );

    export interface Query { id : Type.UUID; contactId : Type.UUID; }
    export interface Response { removed : boolean; size : number; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteSegmentMember;
