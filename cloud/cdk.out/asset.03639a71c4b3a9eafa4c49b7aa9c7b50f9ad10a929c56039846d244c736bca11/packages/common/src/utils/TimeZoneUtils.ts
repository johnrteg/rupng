//
// TimeZoneUtils — convert between a Type.ZonedDateTime (wall-clock + IANA zone) and a UTC instant
// (Date), DST-correct, using only the built-in `Intl` (no dependency). Validation defers to the
// runtime's IANA list — we don't hardcode the ~400 zones (the tz database drifts). All conversions
// RETURN a Type.Result (no throw); see common/src/SPECS.md → Date, time & timezones.
//
import type { Type } from "../Types";
import ResultUtils from "./ResultUtils";

/** `"YYYY-MM-DDTHH:mm[:ss][.SSS]"` — `T` or space separator; seconds + millis optional. */
const LOCAL : RegExp = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;

export class TimeZoneUtils
{
    /////////////////////////////////////////////////////////////////////////////////
    /** True if `timeZone` is an IANA zone this runtime knows (the authoritative check). */
    public static isValidTimeZone( timeZone : string ) : boolean
    {
        try { new Intl.DateTimeFormat( "en-US", { timeZone } ); return true; }
        catch { return false; }
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** The runtime's full IANA zone list (current with its ICU). Use to populate a picker. */
    public static supportedTimeZones() : Array<Type.TimeZone>
    {
        return Intl.supportedValuesOf( "timeZone" );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Resolve a {@link Type.ZonedDateTime} (wall-clock + zone) to its **UTC instant** as a `Date`.
     * DST-correct (two-pass to settle near transitions). Returns `ok:false` for an invalid zone or a
     * malformed `local` string.
     *
     * Edge policy: a **non-existent** local time (spring-forward gap) shifts forward by the offset; an
     * **ambiguous** local time (fall-back overlap) resolves to the **post-transition** offset.
     */
    public static toInstant( zoned : Type.ZonedDateTime ) : Type.Result<Date>
    {
        if( !TimeZoneUtils.isValidTimeZone( zoned.timeZone ) )
            return ResultUtils.err<Date>( `TimeZoneUtils: invalid time zone "${zoned.timeZone}"` );

        const match : RegExpMatchArray | null = zoned.local.match( LOCAL );
        if( match === null )
            return ResultUtils.err<Date>( `TimeZoneUtils: malformed local date-time "${zoned.local}" (expected YYYY-MM-DDTHH:mm[:ss])` );

        const [ , year, month, day, hour, minute, second, millis ] = match;
        const guess : number = Date.UTC(
            Number( year ), Number( month ) - 1, Number( day ),
            Number( hour ), Number( minute ), Number( second ?? "0" ), Number( ( millis ?? "0" ).padEnd( 3, "0" ) ),
        );

        // Treat the wall-clock as if UTC, then subtract the zone's offset at that instant. Re-check once:
        // near a DST boundary the offset can change between the guess and the corrected instant.
        const offset1 : number = TimeZoneUtils.offsetMs( guess, zoned.timeZone );
        let   instant : number = guess - offset1;
        const offset2 : number = TimeZoneUtils.offsetMs( instant, zoned.timeZone );
        if( offset2 !== offset1 ) instant = guess - offset2;

        return ResultUtils.ok( new Date( instant ) );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** The wall-clock {@link Type.ZonedDateTime} an instant shows in `timeZone`. `ok:false` on a bad zone. */
    public static fromInstant( instant : Date, timeZone : Type.TimeZone ) : Type.Result<Type.ZonedDateTime>
    {
        if( !TimeZoneUtils.isValidTimeZone( timeZone ) )
            return ResultUtils.err<Type.ZonedDateTime>( `TimeZoneUtils: invalid time zone "${timeZone}"` );

        const parts : Record<string, string> = TimeZoneUtils.wallParts( instant.getTime(), timeZone );
        const local : Type.LocalDateTime = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
        return ResultUtils.ok( { local, timeZone } );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** **Now** as a wall-clock {@link Type.ZonedDateTime} in `timeZone` (replaces the old DateUtils
     *  `tzLocalTime`). `ok:false` on a bad zone. For the instant, just use `new Date()`. */
    public static nowIn( timeZone : Type.TimeZone ) : Type.Result<Type.ZonedDateTime>
    {
        return TimeZoneUtils.fromInstant( new Date(), timeZone );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** A zone's UTC offset **in minutes** (east-positive) at `instant` — e.g. EDT → `-240`. `ok:false`
     *  on a bad zone. For display ("GMT-4") / debugging; conversions use {@link toInstant} directly. */
    public static offsetMinutes( instant : Date, timeZone : Type.TimeZone ) : Type.Result<number>
    {
        if( !TimeZoneUtils.isValidTimeZone( timeZone ) )
            return ResultUtils.err<number>( `TimeZoneUtils: invalid time zone "${timeZone}"` );
        return ResultUtils.ok( TimeZoneUtils.offsetMs( instant.getTime(), timeZone ) / 60_000 );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** Zone offset (ms, east-positive) at a given UTC instant — `localWallClock - utc`. */
    private static offsetMs( utcMs : number, timeZone : string ) : number
    {
        const parts : Record<string, string> = TimeZoneUtils.wallParts( utcMs, timeZone );
        const asUtc : number = Date.UTC(
            Number( parts.year ), Number( parts.month ) - 1, Number( parts.day ),
            Number( parts.hour ), Number( parts.minute ), Number( parts.second ),
        );
        return asUtc - utcMs;
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** Format a UTC instant into a zone's wall-clock parts (`year`,`month`,`day`,`hour`,`minute`,`second`). */
    private static wallParts( utcMs : number, timeZone : string ) : Record<string, string>
    {
        const formatter : Intl.DateTimeFormat = new Intl.DateTimeFormat( "en-US", {
            timeZone, hourCycle: "h23",
            year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
        } );
        const parts : Record<string, string> = {};
        for( const part of formatter.formatToParts( new Date( utcMs ) ) )
            if( part.type !== "literal" ) parts[ part.type ] = part.value;
        return parts;
    }
}

export default TimeZoneUtils;
