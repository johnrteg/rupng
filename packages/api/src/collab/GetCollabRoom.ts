//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Collab } from "./model/Collab";

//
// Get one room's metadata by id (collab-7.1/7.5).
//
export class GetCollabRoom extends RestfulEndpoint< GetCollabRoom.Query, undefined, GetCollabRoom.Response >
{
    public readonly uri      : string = GetCollabRoom.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getCollabRoom",
        summary:     "Get a room's metadata",
        description: "Fetches one room's metadata (type, visibility, owner, members, version) by id.",
        tags:        [ "Collab" ],
    };

    constructor( roomId? : string ) { super( { roomId: roomId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "roomId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetCollabRoom
{
    export const URI : string = apiPath( "collab", 1, "/rooms/:roomId" );
    export interface Query { roomId : string; }
    export interface Response { room : Collab.Room; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetCollabRoom;
// eof
