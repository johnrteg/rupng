//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Collab } from "./model/Collab";

//
// Create a room (collab-1.2/7.2/7.4/7.5) — `type` CHANNEL only (a DM is created via PostCollabDms, which
// find-or-creates rather than always making a new room). Owning account = caller's; creator = owner.
//
export class PostCollabRooms extends RestfulEndpoint< {}, PostCollabRooms.Body, PostCollabRooms.Response >
{
    public readonly uri      : string = PostCollabRooms.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createCollabRoom",
        summary:     "Create a chat room",
        description: "Creates a named channel room; the caller becomes its owner.",
        tags:        [ "Collab" ],
    };

    constructor( body? : PostCollabRooms.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "name", "visibility" ],
            properties: { name: { type: "string" }, visibility: { type: "string", enum: Object.values( Collab.Visibility ) } },
        };
    }
}

export namespace PostCollabRooms
{
    export const URI : string = apiPath( "collab", 1, "/rooms" );
    export interface Body extends RestfulEndpoint.AuthRequest { name : string; visibility : Collab.Visibility; }
    export interface Response { room : Collab.Room; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default PostCollabRooms;
// eof
