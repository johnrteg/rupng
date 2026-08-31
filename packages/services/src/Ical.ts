//
import { RRule, rrulestr } from "rrule";

import type { Type } from "@repo/common";
import { ResultUtils, TimeZoneUtils } from "@repo/common";

//
// Ical — a standalone, platform-shared wrapper over `rrule` (RFC-5545 recurrence). Lives here (not in a
// single service) so ANY service that needs "fire on this recurrence" can reuse the same DST-correct
// evaluation — first consumer is `report` (`ReportScheduleJob`'s iCal schedule sweep), with `workflow`
// expected to reuse it for its own recurring triggers.
//
// `nextOccurrence` anchors the rule's wall-clock evaluation to the caller's IANA `timezone` (compute-in-zone
// -> fire-in-UTC, the platform's timezone-discipline convention — see `TimeZoneUtils`): `rrule` itself only
// understands naive wall-clock time, so the candidate it returns is converted to a UTC instant via
// `TimeZoneUtils.toInstant`, never interpreted as the server's own local time.
//
export class Ical
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Validate an RFC-5545 recurrence string parses cleanly (reject a malformed `ical` before it's persisted). */
    public static validate( ical : string ) : Type.Result<void>
    {
        try { rrulestr( ical ); return ResultUtils.ok( undefined ); }
        catch( error ) { return ResultUtils.err( `invalid ical recurrence: ${ String( error ) }` ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * The next UTC fire instant for an iCal recurrence, evaluated in `timezone` (DST-correct) and strictly
     * after `after`.
     */
    public static nextOccurrence( ical : string, timezone : string, after : Date ) : Type.Result<Date>
    {
        if( !TimeZoneUtils.isValidTimeZone( timezone ) ) return ResultUtils.err( `invalid time zone "${ timezone }"` );

        let rule : RRule;
        try { rule = rrulestr( ical ) as RRule; }
        catch( error ) { return ResultUtils.err( `invalid ical recurrence: ${ String( error ) }` ); }

        // `after`'s WALL-CLOCK reading in the caller's zone — rrule needs a naive "after" boundary in the
        // same frame its own BYHOUR/BYMINUTE fields are expressed in.
        const afterZoned : Type.Result<Type.ZonedDateTime> = TimeZoneUtils.fromInstant( after, timezone );
        if( !afterZoned.ok ) return { ok: false, error: afterZoned.error };
        const afterNaive : Date = Ical.naiveDate( afterZoned.data.local );

        const candidate : Date | null = rule.after( afterNaive, false );
        if( candidate === null ) return ResultUtils.err( "recurrence has no future occurrence" );

        // the candidate is a naive Date (UTC-labeled fields holding wall-clock numbers) — read those fields
        // back out as the zone's local time, then convert to a real UTC instant.
        const local : string = Ical.isoLocal( candidate );
        return TimeZoneUtils.toInstant( { local, timeZone: timezone } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // rrule.after() operates on JS Dates using UTC getters internally when the rule has no explicit tzid —
    // build a "naive" Date whose UTC fields hold the zone's wall-clock numbers (never the true UTC instant).
    private static naiveDate( local : string ) : Date
    {
        const match : RegExpMatchArray | null = local.match( /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/ );
        if( match === null ) return new Date( NaN );
        const [ , year, month, day, hour, minute, second ] = match;
        return new Date( Date.UTC( Number( year ), Number( month ) - 1, Number( day ), Number( hour ), Number( minute ), Number( second ?? "0" ) ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the inverse of naiveDate — read a naive Date's UTC fields back out as a "YYYY-MM-DDTHH:mm:ss" local string.
    private static isoLocal( naive : Date ) : string
    {
        const pad = ( value : number ) : string => String( value ).padStart( 2, "0" );
        return `${ naive.getUTCFullYear() }-${ pad( naive.getUTCMonth() + 1 ) }-${ pad( naive.getUTCDate() ) }T${ pad( naive.getUTCHours() ) }:${ pad( naive.getUTCMinutes() ) }:${ pad( naive.getUTCSeconds() ) }`;
    }
}

export default Ical;
// eof
