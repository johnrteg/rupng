//
import type { Context, SQSEvent, SQSRecord } from "aws-lambda";
import { Analytics } from "@repo/api";
import { Events } from "@repo/system";
import type { Type } from "@repo/common";

import AppJob from "./AppJob";

// keys whose string values look like they might carry raw PII (an email/phone) rather than an
// opaque id — a defensive backstop, NOT a substitute for the client only ever sending opaque
// values (analytics-2.1/2.5). Anything matching gets dropped, not redacted-in-place.
const EMAIL_PATTERN : RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN : RegExp = /^\+?[0-9()\-\s]{7,}$/;

//
// AppTelemetryJob — consumes the browser-facing telemetry intake queue (PostAppEvent → `telemetry`
// SQS). Per message: PII-scrub each behavior event's `props`, then republish onto
// `Events.Stream.BEHAVIOR` for analytics to ingest (app-5.2/5.3, analytics-2.2). Only the
// in-app-behavior shape lands here today — error/crash telemetry (→ monitor) arrives via a
// separate intake once that shape exists; this job doesn't branch on it yet.
//
export class AppTelemetryJob extends AppJob<SQSEvent, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( "telemetry" );
    }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : SQSEvent, _context : Context ) : Promise<void>
    {
        for( const record of event.Records ?? [] )
            await this.ingest( record );
    }

    /////////////////////////////////////////////////////////////////////
    /** Ingest one SQS message (a batch of behavior events from one PostAppEvent call). Never throws —
     *  a malformed message is logged and skipped so it can't poison the rest of the batch. */
    private async ingest( record : SQSRecord ) : Promise<void>
    {
        let parsed : unknown;
        try { parsed = JSON.parse( record.body ); }
        catch { this.log.warn( "telemetry: unparsable message body — skipping" ); return; }

        const events : Array<Analytics.BehaviorEvent> = ( parsed as { events?: Array<Analytics.BehaviorEvent> } )?.events ?? [];
        if( events.length === 0 ) { this.log.warn( "telemetry: message carried no events — skipping" ); return; }

        const scrubbed : Array<Analytics.BehaviorEvent> = events.map( ( raw : Analytics.BehaviorEvent ) : Analytics.BehaviorEvent => this.scrub( raw ) );

        const published : Type.Result<void> = await this.kafka.publishStream<Analytics.BehaviorEvent>(
            Events.Stream.BEHAVIOR,
            scrubbed,
            { key: ( value : Analytics.BehaviorEvent ) : string => value.accountId } );
        if( !published.ok ) this.log.error( "telemetry: publish to platform.behavior failed", { count: scrubbed.length, error: published.error } );
    }

    /////////////////////////////////////////////////////////////////////
    /** Drop any `props` value that looks like raw PII rather than an opaque id (analytics-2.1/2.5 —
     *  the client should already only send opaque ids; this is the last line of defense). */
    private scrub( raw : Analytics.BehaviorEvent ) : Analytics.BehaviorEvent
    {
        if( !raw.props ) return raw;
        const cleaned : { [ key : string ] : Type.Json } = {};
        for( const [ key, value ] of Object.entries( raw.props ) )
        {
            if( typeof value === "string" && ( EMAIL_PATTERN.test( value ) || PHONE_PATTERN.test( value ) ) )
            {
                this.log.warn( "telemetry: dropped a PII-shaped prop", { event: raw.event, propKey: key } );
                continue;
            }
            cleaned[ key ] = value;
        }
        return { ...raw, props: cleaned };
    }
}

//
// Lambda entrypoint — manifest `jobs.telemetry`, handler "jobs/AppTelemetryJob.handler".
//
const job : AppTelemetryJob = new AppTelemetryJob();
export const handler = ( event : SQSEvent, context : Context ) : Promise<void> => job.invoke( event, context );

export default AppTelemetryJob;
