//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SocialInbound } from "./model/SocialInbound";
import { Paging } from "../model/Paging";

//
// List inbound items — filter by type / platform / tag / campaign / status / time window. USER-gated.
// Inbound doesn't arrive via these endpoints (SPECS.md "Inbound is not these endpoints") — it's
// ingested by `SocialWebhookService` (Meta push) + `SocialPollJob` (X/TikTok/LinkedIn pull) into
// `SocialInboundJob`'s normalize pipeline; this just reads the result.
//
export class GetInbox extends RestfulEndpoint< GetInbox.Query, undefined, GetInbox.Response >
{
    public readonly uri      : string = GetInbox.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listSocialInbox",
        summary:     "List inbound items",
        description: "Lists the acting account's inbound DMs/comments/mentions/reviews (paged).",
        tags:        [ "Social" ],
    };

    constructor( query? : GetInbox.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInbox
{
    export const URI : string = apiPath( "social", 1, "/inbox" );

    export interface Query extends Paging.Request
    {
        type?       : SocialInbound.Type_;
        platform?   : string;
        tag?        : SocialInbound.Tag;
        campaignId? : string;
        status?     : SocialInbound.Status;
        from?       : string;   // ISO date-time, inclusive
        to?         : string;   // ISO date-time, exclusive
    }

    export interface Response extends Paging.Result<SocialInbound.Entity> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInbox;
