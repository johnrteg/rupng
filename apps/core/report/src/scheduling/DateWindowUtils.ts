//
import type { Type } from "@repo/common";
import { ResultUtils, TimeZoneUtils } from "@repo/common";
import { Report } from "@repo/api";

//
// DateWindowUtils — resolves a `Report.DateWindow` to a concrete `{ start, end }`, per SPECS.md's "Date
// windows" section (report-3.5/9). Report-specific (unlike the platform-shared `Ical` class in
// `@repo/services`, which is pure RFC-5545 recurrence — this is the `Report.DateWindow` preset/rolling/fixed
// semantics only report's generators/schedules parameterize on).
//
export namespace DateWindowUtils
{
    /**
     * Resolve a `Report.DateWindow` to a concrete `{ start, end }` (both ISO instants). `timezone` is the
     * frame period boundaries ("this month", "yesterday") are computed in; `now` is the instant this
     * resolution is anchored to (the submit/fire moment). The caller is responsible for rejecting a `fixed`
     * window on a Schedule (report-3.3) — this function only resolves whatever window it's handed.
     */
    export function resolveDateWindow( window : Report.DateWindow, timezone : string, now : Date ) : Type.Result<{ start : string; end : string }>
    {
        if( window.kind === "fixed" )
        {
            const start : string = window.start ?? new Date( 0 ).toISOString();
            const end   : string = window.end ?? now.toISOString();
            return ResultUtils.ok( { start, end } );
        }

        if( !TimeZoneUtils.isValidTimeZone( timezone ) ) return ResultUtils.err( `invalid time zone "${ timezone }"` );
        const nowZoned : Type.Result<Type.ZonedDateTime> = TimeZoneUtils.fromInstant( now, timezone );
        if( !nowZoned.ok ) return { ok: false, error: nowZoned.error };
        const parts : WallParts = wallParts( nowZoned.data.local );

        if( "preset" in window ) return resolvePreset( window.preset, timezone, parts );

        // the general `rolling` shape — `amount` units back from `now`, minus an optional `endOffsetDays`
        // (e.g. "last 7 days, ending yesterday").
        const endDay   : Date = addUnits( parts, "day", -( window.endOffsetDays ?? 0 ) );
        const startDay : Date = addUnits( parts, window.rolling.unit, -window.rolling.amount );
        return dayRangeToInstants( startDay, endDay, timezone );
    }

    // one preset's start/end wall-clock day boundaries, in the zone's local calendar.
    function resolvePreset( preset : Report.RelativePreset, timezone : string, parts : WallParts ) : Type.Result<{ start : string; end : string }>
    {
        const today : Date = dayStart( parts );
        switch( preset )
        {
            case Report.RelativePreset.LAST_7_DAYS:
                return dayRangeToInstants( shiftDays( today, -7 ), today, timezone );
            case Report.RelativePreset.LAST_30_DAYS:
                return dayRangeToInstants( shiftDays( today, -30 ), today, timezone );
            case Report.RelativePreset.LAST_90_DAYS:
                return dayRangeToInstants( shiftDays( today, -90 ), today, timezone );
            case Report.RelativePreset.WEEK_TO_DATE:
                return dayRangeToInstants( startOfWeek( today ), today, timezone );
            case Report.RelativePreset.MONTH_TO_DATE:
                return dayRangeToInstants( startOfMonth( today ), today, timezone );
            case Report.RelativePreset.QUARTER_TO_DATE:
                return dayRangeToInstants( startOfQuarter( today ), today, timezone );
            case Report.RelativePreset.YEAR_TO_DATE:
                return dayRangeToInstants( startOfYear( today ), today, timezone );
            case Report.RelativePreset.LAST_WEEK:
            {
                const thisWeekStart : Date = startOfWeek( today );
                return dayRangeToInstants( shiftDays( thisWeekStart, -7 ), thisWeekStart, timezone );
            }
            case Report.RelativePreset.LAST_MONTH:
            {
                const thisMonthStart : Date = startOfMonth( today );
                const lastMonthStart : Date = new Date( Date.UTC( thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() - 1, 1 ) );
                return dayRangeToInstants( lastMonthStart, thisMonthStart, timezone );
            }
            case Report.RelativePreset.LAST_QUARTER:
            {
                const thisQuarterStart : Date = startOfQuarter( today );
                const lastQuarterStart : Date = new Date( Date.UTC( thisQuarterStart.getUTCFullYear(), thisQuarterStart.getUTCMonth() - 3, 1 ) );
                return dayRangeToInstants( lastQuarterStart, thisQuarterStart, timezone );
            }
            case Report.RelativePreset.LAST_YEAR:
            {
                const thisYearStart : Date = startOfYear( today );
                const lastYearStart : Date = new Date( Date.UTC( thisYearStart.getUTCFullYear() - 1, 0, 1 ) );
                return dayRangeToInstants( lastYearStart, thisYearStart, timezone );
            }
            default:
                return ResultUtils.err( `unknown RelativePreset "${ String( preset ) }"` );
        }
    }

    // ── wall-clock day arithmetic (all in a "naive UTC" representation — see isoLocal below) ──

    interface WallParts { year : number; month : number; day : number; }

    function wallParts( local : string ) : WallParts
    {
        const match : RegExpMatchArray | null = local.match( /^(\d{4})-(\d{2})-(\d{2})/ );
        if( match === null ) return { year: 1970, month: 1, day: 1 };
        return { year: Number( match[ 1 ] ), month: Number( match[ 2 ] ), day: Number( match[ 3 ] ) };
    }

    function dayStart( parts : WallParts ) : Date { return new Date( Date.UTC( parts.year, parts.month - 1, parts.day ) ); }
    function shiftDays( day : Date, amount : number ) : Date { return new Date( day.getTime() + ( amount * 86400000 ) ); }
    function startOfWeek( day : Date ) : Date
    {
        // Sunday = 0 .. Saturday = 6; a week starts Sunday (platform convention for WEEK_TO_DATE/LAST_WEEK)
        return shiftDays( day, -day.getUTCDay() );
    }
    function startOfMonth( day : Date ) : Date { return new Date( Date.UTC( day.getUTCFullYear(), day.getUTCMonth(), 1 ) ); }
    function startOfQuarter( day : Date ) : Date { return new Date( Date.UTC( day.getUTCFullYear(), Math.floor( day.getUTCMonth() / 3 ) * 3, 1 ) ); }
    function startOfYear( day : Date ) : Date { return new Date( Date.UTC( day.getUTCFullYear(), 0, 1 ) ); }

    // add `amount` of `unit` (day/week/month/quarter/year) to a wall-clock day, staying in naive-UTC terms.
    function addUnits( parts : WallParts, unit : Report.Unit, amount : number ) : Date
    {
        const day : Date = dayStart( parts );
        switch( unit )
        {
            case "day":     return shiftDays( day, amount );
            case "week":    return shiftDays( day, amount * 7 );
            case "month":   return new Date( Date.UTC( day.getUTCFullYear(), day.getUTCMonth() + amount, day.getUTCDate() ) );
            case "quarter": return new Date( Date.UTC( day.getUTCFullYear(), day.getUTCMonth() + ( amount * 3 ), day.getUTCDate() ) );
            case "year":    return new Date( Date.UTC( day.getUTCFullYear() + amount, day.getUTCMonth(), day.getUTCDate() ) );
            default:        return day;
        }
    }

    // isoLocal: read a naive Date's UTC fields back out as a "YYYY-MM-DDTHH:mm:ss" local string (the inverse
    // of the naive-UTC construction `dayStart`/`shiftDays`/etc. build).
    function isoLocal( naive : Date ) : string
    {
        const pad = ( value : number ) : string => String( value ).padStart( 2, "0" );
        return `${ naive.getUTCFullYear() }-${ pad( naive.getUTCMonth() + 1 ) }-${ pad( naive.getUTCDate() ) }T${ pad( naive.getUTCHours() ) }:${ pad( naive.getUTCMinutes() ) }:${ pad( naive.getUTCSeconds() ) }`;
    }

    // convert a [startDay, endDay) naive-UTC wall-clock pair into real UTC instants via the zone.
    function dayRangeToInstants( startDay : Date, endDay : Date, timezone : string ) : Type.Result<{ start : string; end : string }>
    {
        const startInstant : Type.Result<Date> = TimeZoneUtils.toInstant( { local: isoLocal( startDay ), timeZone: timezone } );
        if( !startInstant.ok ) return { ok: false, error: startInstant.error };
        const endInstant : Type.Result<Date> = TimeZoneUtils.toInstant( { local: isoLocal( endDay ), timeZone: timezone } );
        if( !endInstant.ok ) return { ok: false, error: endInstant.error };
        return ResultUtils.ok( { start: startInstant.data.toISOString(), end: endInstant.data.toISOString() } );
    }
}

export default DateWindowUtils;
// eof
