//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Collab } from "./model/Collab";

//
// Rename / change a room's visibility (collab-1.2/7.4) — owner-gated (or ACCOUNT/ROOT) in the impl.
//
export class PatchCollabRoom extends RestfulEndpoint< PatchCollabRoom.Query, PatchCollabRoom.Body, PatchCollabRoom.Response >
{
    public readonly uri      : string = PatchCollabRoom.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateCollabRoom",
        summary:     "Rename / change a room's visibility",
        description: "Updates a room's name and/or visibility. Owner-gated (or ACCOUNT/ROOT).",
        tags:        [ "Collab" ],
    };

    constructor( roomId? : string, body? : PatchCollabRoom.Body ) { super( { roomId: roomId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "roomId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: true, properties: { name: { type: "string" }, visibility: { type: "string", enum: Object.values( Collab.Visibility ) } } };
    }
}

export namespace PatchCollabRoom
{
    export const URI : string = apiPath( "collab", 1, "/rooms/:roomId" );
    export interface Query { roomId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { name? : string; visibility? : Collab.Visibility; }
    export interface Response { room : Collab.Room; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PatchCollabRoom;
// eof
