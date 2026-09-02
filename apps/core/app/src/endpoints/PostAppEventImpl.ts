//
import { PostAppEvent, Analytics } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AppService from '../services/AppService';

//
// Unauthenticated behavior-event intake (analytics-2.2) — validate the batch shape (Ajv already
// enforced it against getBodySchema()) and hand it straight to the `telemetry` queue; the endpoint
// does no enrichment/scrubbing itself so it stays fast enough to survive a page-hide `sendBeacon`
// flood. AppTelemetryJob drains the queue, scrubs, and republishes onto `Events.Stream.BEHAVIOR`.
//
export class PostAppEventImpl extends PostAppEvent
{
    private service : AppService;
    constructor( service : AppService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const events : Array<Analytics.BehaviorEvent> = this.body?.events ?? [];
        if( events.length === 0 ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no events" } };

        // enqueue the whole batch as one SQS message — AppTelemetryJob fans out per-record on drain
        const queued : Type.Result<void> = await this.service.sqs.send( "telemetry", { events } );
        if( !queued.ok )
        {
            this.service.log.warn( "telemetry enqueue failed", { count: events.length, error: queued.error } );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not accept events" } };
        }

        return { status: NetworkUtils.Status.OK, data: { accepted: events.length } };
    }
}

export default PostAppEventImpl;
