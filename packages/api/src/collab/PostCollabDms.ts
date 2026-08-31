//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Collab } from "./model/Collab";

//
// Find-or-create the 1:1 DM room between the caller and `userId` (collab-1.2) — repeat calls with the same
// pair return the SAME room, never a duplicate. Both users must be in the caller's account (a DM is not a
// cross-account guest surface in v1 — that's a channel-room-only capability, collab-7.2).
//
export class PostCollabDms extends RestfulEndpoint< {}, PostCollabDms.Body, PostCollabDms.Response >
{
    public readonly uri      : string = PostCollabDms.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "openCollabDm",
        summary:     "Open (or find) a DM",
        description: "Finds or creates the 1:1 DM room between the caller and another account member.",
        tags:        [ "Collab" ],
    };

    constructor( body? : PostCollabDms.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "userId" ], properties: { userId: { type: "string" } } };
    }
}

export namespace PostCollabDms
{
    export const URI : string = apiPath( "collab", 1, "/dms" );
    export interface Body extends RestfulEndpoint.AuthRequest { userId : string; }
    export interface Response { room : Collab.Room; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default PostCollabDms;
// eof
