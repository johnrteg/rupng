//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Distribution } from "./model/Distribution";

//
// Distribute a published survey to an audience over a channel, on a schedule (survey-3.1). SENDER-gated —
// distributing rides the same consent/canSend() gate as any channel send (survey-7.1), enforced by the
// channel at hand-off time, not here.
//
export class PostDistribution extends RestfulEndpoint< {}, PostDistribution.Body, PostDistribution.Response >
{
    public readonly uri      : string = PostDistribution.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createDistribution",
        summary:     "Distribute a survey",
        description: "Schedules a survey send to an audience over a channel.",
        tags:        [ "Survey" ],
    };

    constructor( body? : PostDistribution.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "surveyId", "channel", "audience", "schedule" ],
            properties:
            {
                surveyId: { type: "string" },
                channel:  { type: "string", enum: Object.values( Distribution.Channel ) },
                audience: { type: "object", additionalProperties: true },
                schedule: { type: "string", enum: Object.values( Distribution.Schedule ) },
                sendAt:   { type: "string" },
                anonymous: { type: "boolean" },
                callerId: { type: "string" },   // PHONE only — the account's registered outbound number
            },
        };
    }
}

export namespace PostDistribution
{
    export const URI : string = apiPath( "survey", 1, "/distributions" );

    export interface Body extends RestfulEndpoint.AuthRequest, Distribution.CreateDistribution {}

    /** `warnings` — non-blocking, e.g. PHONE dropping a question type its DTMF-only gather can't render
     *  (survey-2.4) — the distribution is still created; the caller decides whether to proceed. */
    export interface Response extends Distribution.Entity { warnings? : Array<string>; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostDistribution;
// eof
