//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Collab } from "./model/Collab";
import { Paging } from "../model/Paging";

//
// List rooms the caller can access (collab-7.1/7.4) — the caller's channels + DMs, plus the account's public
// channels the caller hasn't joined yet. Paged, `{ records, page }` envelope.
//
export class GetCollabRooms extends RestfulEndpoint< GetCollabRooms.Query, undefined, GetCollabRooms.Response >
{
    public readonly uri      : string = GetCollabRooms.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listCollabRooms",
        summary:     "List accessible rooms",
        description: "Lists the caller's rooms (channels + DMs) plus the account's other public channels.",
        tags:        [ "Collab" ],
    };

    constructor( query? : GetCollabRooms.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetCollabRooms
{
    export const URI : string = apiPath( "collab", 1, "/rooms" );
    export interface Query extends Paging.Request {}
    export interface Response extends Paging.Result<Collab.Room> {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetCollabRooms;
// eof
