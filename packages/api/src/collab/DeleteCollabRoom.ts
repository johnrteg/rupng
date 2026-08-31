//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Archive a room (collab-6.4/7.5) — owner-gated (or ACCOUNT/ROOT) in the impl. Soft-delete: `archived: true`,
// the durable record (and its message history, within TTL) is retained.
//
export class DeleteCollabRoom extends RestfulEndpoint< DeleteCollabRoom.Query, undefined, DeleteCollabRoom.Response >
{
    public readonly uri      : string = DeleteCollabRoom.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "archiveCollabRoom",
        summary:     "Archive a room",
        description: "Archives a room. Owner-gated (or ACCOUNT/ROOT).",
        tags:        [ "Collab" ],
    };

    constructor( roomId? : string ) { super( { roomId: roomId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "roomId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteCollabRoom
{
    export const URI : string = apiPath( "collab", 1, "/rooms/:roomId" );
    export interface Query { roomId : string; }
    export interface Response { archived : true; }
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default DeleteCollabRoom;
// eof
