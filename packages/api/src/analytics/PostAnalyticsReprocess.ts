//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Trigger a rollup backfill/recompute (analytics-3.7/4.4) — re-derives every rollup bucket for one
// account/channel/date-range directly from the raw lake, REPLACING whatever the live rollup
// consumer already computed. Staff-only (APPLICATION): this is an ops recovery action (a
// normalization bug shipped, or a straggler landed after a period closed), not a tenant self-serve
// tool. Enqueues onto `analytics-backfill`; `AnalyticsBackfillJob` does the work off the request path.
//
export class PostAnalyticsReprocess extends RestfulEndpoint< {}, PostAnalyticsReprocess.Body, PostAnalyticsReprocess.Response >
{
    public readonly uri      : string = PostAnalyticsReprocess.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "postAnalyticsReprocess",
        summary:     "Trigger a rollup backfill/recompute",
        description: "Re-derives rollup buckets for one account/channel/date-range from the raw lake, replacing the live consumer's counts. Staff-only.",
        tags:        [ "Analytics" ],
    };

    constructor( body? : PostAnalyticsReprocess.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "channel", "from", "to" ],
            properties: {
                accountId: { type: "string" },
                channel:   { type: "string" },
                from:      { type: "string", description: "YYYY-MM-DD, inclusive" },
                to:        { type: "string", description: "YYYY-MM-DD, inclusive" },
            },
        };
    }
}

export namespace PostAnalyticsReprocess
{
    export const URI : string = apiPath( "analytics", 1, "/reprocess" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        accountId : string;
        channel   : string;
        from      : string;   // YYYY-MM-DD, inclusive
        to        : string;   // YYYY-MM-DD, inclusive
    }

    export interface Response { queued : boolean; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostAnalyticsReprocess;
// eof
