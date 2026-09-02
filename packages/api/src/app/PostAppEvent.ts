//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Analytics } from "../analytics/model/Analytics";

//
// Public, unauthenticated, rate-limited intake for the web app's first-party behavior-event
// telemetry (SPECS app-5.2/5.3; analytics-2.2). The client's `track()` batches events and flushes
// them here (periodic + `sendBeacon` on page-hide — see apps/core/web/SPECS.md); the impl only
// validates + enqueues to the `telemetry` SQS queue (AppTelemetryJob:5.2/5.3 drains it, scrubs, and
// republishes onto `Events.Stream.BEHAVIOR` for analytics to ingest — apps/core/app/SPECS.md,
// apps/core/analytics/SPECS.md analytics-2.x). No auth: a not-yet-logged-in visitor still emits
// screen views, so `userId`/`sessionId` travel in the body rather than coming from a JWT.
//
export class PostAppEvent extends RestfulEndpoint<{}, PostAppEvent.Body, PostAppEvent.Response>
{
    public readonly uri      : string = PostAppEvent.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated (intake-only)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;   // edge-reachable, not a published dev API

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "postAppEvent",
        summary:     "Ingest a batch of first-party in-app behavior events",
        description: "Unauthenticated, rate-limited intake for the web app's behavior-event telemetry. Events are enqueued for async scrub + publish onto the analytics stream.",
        tags:        [ "App" ],
        errors:      { 400: "Malformed batch" },
    };

    constructor( body? : PostAppEvent.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: 'object',
            properties:
            {
                events:
                {
                    type: 'array',
                    minItems: 1,
                    maxItems: 100,
                    items:
                    {
                        type: 'object',
                        properties:
                        {
                            eventId:       { type: 'string', minLength: 1 },
                            occurredAt:    { type: 'string', minLength: 1 },
                            accountId:     { type: 'string', minLength: 1 },
                            userId:        { type: 'string', minLength: 1 },
                            sessionId:     { type: 'string', minLength: 1 },
                            event:         { type: 'string', minLength: 1 },
                            route:         { type: 'string' },
                            fromRoute:     { type: 'string' },
                            transactionId: { type: 'string' },
                            appVersion:    { type: 'string' },
                            device:        { type: 'object' },
                            props:         { type: 'object' },
                        },
                        required: [ 'eventId', 'occurredAt', 'accountId', 'userId', 'sessionId', 'event' ],
                        additionalProperties: false,
                    },
                },
            },
            required: [ 'events' ],
            additionalProperties: false,
        };
    }
}

export namespace PostAppEvent
{
    export const URI : string = apiPath( "app", 1, "/events" );   // /api/app/v1/events

    /** The canonical behavior-event shape (@repo/api's `Analytics.BehaviorEvent`), pre-scrub as the
     *  client sends it — AppTelemetryJob is the PII-scrub boundary before it reaches Kafka. */
    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        events : Array<Analytics.BehaviorEvent>;
    }

    export interface Response
    {
        accepted : number;   // count enqueued
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostAppEvent;
