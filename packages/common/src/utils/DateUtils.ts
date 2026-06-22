//
import StringUtils from "./StringUtils";
import NumberUtils from "./NumberUtils";

export class DateUtils
{
    /////////////////////////////////////////////////////////////////////////////////
    /** True if `value` is a `Date` instance (moved from `Validator.isDate`). Note: doesn't check
     *  validity of the date's time value — use `!Number.isNaN(value.getTime())` for that. */
    public static isValid( value : any ) : boolean
    {
        return value instanceof Date;
    }

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Parse a value into a Date object.
     *
     * Accepts numbers (timestamps in seconds, milliseconds, or microseconds), strings (ISO 8601 or 
     * simple date formats), or null/undefined values. Automatically detects timestamp precision
     * based on the number of digits: 10 digits = seconds, 13 digits = milliseconds, 
     * other lengths = microseconds.
     *
     * @param value - The value to parse. Can be a timestamp number, date string, or null/undefined.
     * @returns A Date object if parsing succeeds, null if the input is null/undefined or invalid.
     *
     * @example
     * DateUtils.parse(1753059107); // Date from seconds timestamp
     * DateUtils.parse(1753059107136); // Date from milliseconds timestamp
     * DateUtils.parse('2025-01-15'); // Date from ISO string
     * DateUtils.parse('2025/12/3'); // Date from simple format
     * DateUtils.parse(null); // null
     */
    public static parse( value : number | string | null | undefined ) : Date | null
    {
        if( value === undefined || value === null )
        {
            return null;
        }
        // is a normal number OR looks is a number inside a string ("1776279127870")
        else if( NumberUtils.isValid( value ) || ( StringUtils.isValid( value ) && /^\d+$/.test( value as string ) ) )
        {
            const num_value : number = parseInt( value.toString() );    // catches both cases
            const value_str : string = value.toString();

            // check for milli vs micro seconds
            // 1753059107136 : miliseconds
            if( value_str.length === 10 )            // seconds
                return new Date( num_value * 1000 );
            else if( value_str.length === 13 )       // milliseconds
                return new Date( num_value );
            else                                    // microseconds
                return new Date( num_value / 1000 );
        }
        else if( StringUtils.isValid( value ) && ( value as string ).trim() !== "" )
        {
            const value_trimmed : string = ( value as string ).trim();

            // support iso 8601
            // support simple date formats like "2025/12/3"
            
            // Fix for date-only ISO strings (e.g., "2025-11-18")
            // JavaScript treats these as UTC, but we want local time
            if( /^\d{4}-\d{2}-\d{2}$/.test( value_trimmed ) )
            {
                // For date-only strings, append local time to avoid UTC interpretation
                return new Date( value_trimmed + 'T00:00:00' );
            }
            else
                return new Date( value_trimmed );
        }
        else
        {
            return null;
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static compare( a : Date | null, b : Date | null, dir : number ) : number
    {
        const at : number = a ? a.getTime() : 0;
        const bt : number = b ? b.getTime() : 0;
        return ( at - bt ) * dir;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Checks if a date falls between two boundary dates (inclusive).
     *
     * Returns true if the date is within the specified range, or if any of the parameters are null.
     * The comparison is inclusive, meaning the date can equal the start or end dates.
     * If the date parameter is null, the function returns true (no date to validate).
     *
     * @param start_date - The start boundary date (inclusive). If null, no lower bound is applied.
     * @param end_date - The end boundary date (inclusive). If null, no upper bound is applied.
     * @param date - The date to check. If null, returns true.
     * @returns True if the date is between start_date and end_date (inclusive), or if date is null.
     *
     * @example
     * const start : Date = new Date('2025-01-01');
     * const end : Date = new Date('2025-12-31');
     * const testDate : Date = new Date('2025-06-15');
     * DateUtils.between(start, end, testDate); // true
     * 
     * DateUtils.between(null, end, testDate); // true (no start boundary)
     * DateUtils.between(start, null, testDate); // true (no end boundary)
     * DateUtils.between(start, end, null); // true (no date to validate)
     */
    public static between( start_date : Date | null, end_date : Date | null, date : Date | null ): boolean
    {
        if( !date )return true;
        const time : number = date.getTime();
        if( start_date && time < start_date.getTime() )return false;
        if( end_date   && time > end_date.getTime() )return false;
        return true;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    // NOTE: date <-> IANA-timezone conversion lives in **TimeZoneUtils** — "current wall-clock in a zone"
    // is `TimeZoneUtils.nowIn(tz)` (returns a Type.ZonedDateTime, not a Date that misrepresents the
    // instant). DateUtils keeps machine-local + general date helpers; zoned conversion is not here.

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Returns a new Date object representing the start of the day (midnight) for the given date in local time.
     *
     * Note: this intentionally uses local time (setHours), not UTC (setUTCHours).
     */
    public static startOfDay( date : Date ): Date
    {
        const newdate : Date = new Date( date ); // create a copy
        newdate.setHours(0, 0, 0, 0);   // set to 00:00:00.000 local
        return newdate;
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Returns a new Date object representing the end of the day (just before midnight) for the given date in local time.
     *
     * Note: this intentionally uses local time (setHours), not UTC (setUTCHours).
     */
    public static endOfDay( date : Date ): Date
    {
        const newdate : Date = new Date( date ); // create a copy
        newdate.setHours(23, 59, 59, 999); // set to 23:59:59.999 local
        return newdate;
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Converts a Date object to an ISO 8601-like string using the date's local time components.
     *

     * @param date - The date to convert to a local string representation.
     * @returns A string in ISO 8601 format using local time components, ending with "Z".
     *
     * @example
     * const date = new Date('2025-01-15T14:30:45.123');
     * DateUtils.toLocalString(date);
     * // Returns: "2025-01-15T14:30:45.123Z" (using local time components)
     * 
     * // Compare with native toISOString() which uses UTC
     * date.toISOString();
     * // Returns: "2025-01-15T19:30:45.123Z" (if local timezone is UTC-5)
     */
    public static toLocalString( date : Date ): string
    {
        return date.getFullYear() +
                '-' + String(date.getMonth() + 1).padStart(2, '0') +
                '-' + String(date.getDate()).padStart(2, '0') +
                'T' + String(date.getHours()).padStart(2, '0') +
                ':' + String(date.getMinutes()).padStart(2, '0') +
                ':' + String(date.getSeconds()).padStart(2, '0') +
                '.' + String(date.getMilliseconds()).padStart(3, '0') +
                'Z';
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Converts a Date object to an ISO 8601 date string (YYYY-MM-DD format) or returns empty string for null.
     *
     * @param date - The date to convert to ISO date string, or null.
     * @returns A string in "YYYY-MM-DD" format, or empty string if date is null.
     *
     * @example
     * const date = new Date('2025-01-15T14:30:45.123Z');
     * DateUtils.toIsoDate(date); // "2025-01-15"
     */
    public static toIsoDate( date : Date | null ): string
    {
        return date ? date.toISOString().slice(0, 10) : ""; 
    }

    ////////////////////////////////////////////////////////////////////////////////////
    /**
     * Converts a Date object to an ISO 8601 datetime string (YYYY-MM-DDTHH:mm format) or returns empty string for null.
     *
     * @param date - The date to convert to ISO datetime string, or null.
     * @returns A string in "YYYY-MM-DDTHH:mm" format, or empty string if date is null.
     *
     * @example
     * const date = new Date('2025-01-15T14:30:45.123Z');
     * DateUtils.toIsoTime(date); // "2025-01-15T14:30"
     *
     */
    public static toIsoTime( date : Date | null ) : string
    {
        return date ? date.toISOString().slice(0,16) : "";
    }

    ////////////////////////////////////////////////////////////////////////////////////
    /**
     * Converts a Date object to an ISO 8601 to just the time portion. (e.g. "14:21")
     *
     * @param date - The date to convert to ISO datetime string, or null.
     * @returns A string in "YYYY-MM-DDTHH:mm" format, or empty string if date is null.
     *
     * @example
     * const date = new Date('2025-01-15T14:30:45.123Z');
     * DateUtils.toIsoTime(date); // "14:30"
     *
     */
    public static toLocalTime( date : Date | null ) : string
    {
        return date ? StringUtils.format( "{0}:{1}", StringUtils.leadingZero( date.getHours(), 2 ), StringUtils.leadingZero( date.getMinutes(), 2 ) ) : "";
    }

    ////////////////////////////////////////////////////////////////////////////////////
    /**
     * Converts a Date object to a full ISO 8601 string (YYYY-MM-DDTHH:mm:ss.sssZ format) or returns empty string for null.
     *
     * @param date - The date to convert to full ISO string, or null.
     * @returns A string in "YYYY-MM-DDTHH:mm:ss.sssZ" format, or empty string if date is null.
     *
     * @example
     * const date = new Date('2025-01-15T14:30:45.123Z');
     * DateUtils.toIsoFull(date); // "2025-01-15T14:30:45.123Z"
     * };
     */
    public static toIsoFull( date : Date | null ) : string
    {
        return date !== null ? date.toISOString() : "";
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Gets the local timezone offset from GMT/UTC in GMT±HHMM format.
     *
     * Calculates the current local timezone's offset from GMT/UTC and returns it as a
     * formatted string. The offset accounts for daylight saving time if applicable.
     *
     * @returns A string in "GMT±HHMM" format representing the local timezone offset.
     *
     * @example
     * // If running in Eastern Standard Time (UTC-5)
     * DateUtils.getLocalGMTOffset(); // "GMT-0500"
     * 
     */
    public static getLocalGMTOffset(): string
    {
        const offset : number = new Date().getTimezoneOffset(); // in minutes
        const sign : string = offset > 0 ? "-" : "+";
        const absOffset : number = Math.abs(offset);
        const hours : string = Math.floor(absOffset / 60)
                                    .toString()
                                    .padStart(2, "0");
        const minutes : string = (absOffset % 60).toString().padStart(2, "0");
        return `GMT${sign}${hours}${minutes}`;
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Converts a Date object to an ISO 8601-like string using local time components (without timezone indicator).
     *
     * @param date - The date to convert to a local ISO string representation.
     * @returns A string in "YYYY-MM-DDTHH:mm:ss.sss" format using local time components (no timezone suffix).
     *
     * @example
     * const date = new Date('2025-01-15T14:30:45.123');
     * DateUtils.toLocalISOString(date);
     * // Returns: "2025-01-15T14:30:45.123" (using local time components, no Z suffix)
     */
    public static toLocalISOString( date: Date ): string
    {
        const pad : Function = (n: number) => n.toString().padStart(2, '0');
        return (
            date.getFullYear() + '-' +
            pad(date.getMonth() + 1) + '-' +
            pad(date.getDate()) + 'T' +
            pad(date.getHours()) + ':' +
            pad(date.getMinutes()) + ':' +
            pad(date.getSeconds()) + '.' +
            date.getMilliseconds().toString().padStart(3, '0')
        );
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Adds the specified number of minutes to a given date and returns a new Date object.
     * The original date object remains unchanged. Supports both positive and negative minute values
     * for adding or subtracting time respectively.
     * 
     * @param date - The base date to add minutes to. Must be a valid Date object.
     * @param minutes - The number of minutes to add. Can be positive (future) or negative (past).
     *                 Accepts decimal values for fractional minutes (e.g., 1.5 = 90 seconds).
     * @returns A new Date object representing the original date plus the specified minutes.
     *          Returns Invalid Date if the input date is invalid.
     * 
     * @example
     * ```typescript
     * // Add 30 minutes to current time
     * const now : Date = new Date();
     * const futureTime : Date = DateUtils.addMinutes(now, 30);
     * console.log(`30 minutes from now: ${futureTime.toISOString()}`);
     * ```
     */
    public static addMinutes( date : Date, minutes : number ): Date
    {
        return new Date( date.getTime() + ( minutes * DateUtils.Time.MINUTES_TO_MS ) );
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Adds the specified number of days to a given date and returns a new Date object.
     * The original date object remains unchanged. Supports both positive and negative day values
     * for adding or subtracting days respectively. The time component remains unchanged.
     * 
     * @param date - The base date to add days to. Must be a valid Date object.
     * @param days - The number of days to add. Can be positive (future) or negative (past).
     *               Accepts decimal values for fractional days (e.g., 0.5 = 12 hours).
     * @returns A new Date object representing the original date plus the specified days.
     *          Returns Invalid Date if the input date is invalid.
     * 
     * @example
     * ```typescript
     * // Add 7 days (one week) to current date
     * const today : Date = new Date();
     * const nextWeek : Date = DateUtils.addDays(today, 7);
     * console.log(`Next week: ${nextWeek.toISOString()}`);
     * ```
     */
    public static addDays( date : Date, days : number ): Date
    {
        return new Date( date.getTime() + ( days * DateUtils.Time.DAYS_TO_MS ) );
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Adds the specified number of hours to a given date and returns a new Date object.
     * The original date object remains unchanged. Supports both positive and negative hour values
     * for adding or subtracting time respectively. Returns null if the input date is null.
     * 
     * @param date - The base date to add hours to. Can be a valid Date object or null.
     *               If null, the function returns null without performing any operations.
     * @param hours - The number of hours to add. Can be positive (future) or negative (past).
     *                Accepts decimal values for fractional hours (e.g., 0.5 = 30 minutes).
     * @returns A new Date object representing the original date plus the specified hours,
     *          or null if the input date is null. Returns Invalid Date if the input date is invalid.
     * 
     * @example
     * ```typescript
     * // Add 3 hours to current time
     * const now : Date = new Date();
     * const threeHoursLater : Date = DateUtils.addHours(now, 3);
     * console.log(`3 hours from now: ${threeHoursLater?.toISOString()}`);
     * ```
     */
    public static addHours( date : Date | null, hours : number ): Date | null
    {
        if( date === null )return null;
        return new Date( date.getTime() + ( hours * DateUtils.Time.HOURS_TO_MS ) );
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Converts a 24-hour time string to 12-hour AM/PM format with zero-padded hours.
     * 
     * Parses time strings in "H:MM" or "HH:MM" format and converts them to 12-hour clock format
     * with AM/PM suffix. Hours greater than 23 are wrapped using modulo 24. If the input string
     * doesn't match the expected format, it returns the original string unchanged.
     * 
     * @param time - The time string to convert. Must be in "H:MM" or "HH:MM" format.
     *               Leading/trailing whitespace is automatically trimmed.
     * @returns A string in "HH:MM AM/PM" format, or the original string if parsing fails.
     * 
     * @example
     * ```typescript
     * // Standard 24-hour to 12-hour conversions
     * DateUtils.parseTimeTo12HourClock("14:30"); // "02:30 PM"
     * DateUtils.parseTimeTo12HourClock("09:15"); // "09:15 AM"
     * DateUtils.parseTimeTo12HourClock("00:00"); // "12:00 AM" (midnight)
     * DateUtils.parseTimeTo12HourClock("12:00"); // "12:00 PM" (noon)
     * DateUtils.parseTimeTo12HourClock("23:59"); // "11:59 PM"
     * ```
     */
    public static parseTimeTo12HourClock( time : string ): string
    {
        const match : RegExpExecArray | null = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
        if ( !match ) return time;

        let hour : number = parseInt(match[1], 10);
        const minute = match[2];

        // Wrap hour to 24-hour format, then to 12-hour format
        hour = hour % 24;
        const ampm : string = hour < 12 ? 'AM' : 'PM';

        let hour12 : number = hour % 12;
        if (hour12 === 0) hour12 = 12;

        const hourStr : string = hour12.toString().padStart(2, '0');
        return `${hourStr}:${minute} ${ampm}`;
    }

    ////////////////////////////////////////////////////////////////////////////
    public static hoursTo24String( time : number ): string
    {
        const hours   : number = Math.floor( time );
        const minutes : number = Math.round( (time - hours) * 60 );
        return `${String( hours ).padStart( 2, '0' )}:${String( minutes ).padStart( 2, '0' )}`;
    }

    ////////////////////////////////////////////////////////////////////////////
    public static parseHoursToNumber( time : string ): number
    {
        const match : RegExpExecArray | null = /^(\d{1,2}):(\d{2})$/.exec( time.trim() );
        if( !match ) return 0;
        const hours   : number = parseInt( match[1], 10 );
        const minutes : number = parseInt( match[2], 10 );
        return hours + ( minutes / 60 );
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Parses a date string and converts it to ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ).
     * 
     * Handles various date string formats and normalizes them to standard ISO format.
     * Special handling for datetime strings with AM/PM notation that contain 'T' separators.
     * Returns empty string for invalid dates or empty input.
     * 
     * @param dt - The date string to parse and convert. Can be in various formats including
     *             ISO dates, simple date formats, or datetime with AM/PM notation.
     *             Empty or falsy strings return empty string.
     * @returns A string in ISO 8601 format "YYYY-MM-DDTHH:mm:ss.sssZ", or empty string if parsing fails.
     * 
     * @example
     * ```typescript
     * // Standard ISO date parsing
     * DateUtils.parseDateToIso("2025-01-15"); // "2025-01-15T00:00:00.000Z"
     * DateUtils.parseDateToIso("2025-01-15T14:30:45"); // "2025-01-15T14:30:45.000Z"
     * ```
     */
    public static parseDateToIso( dt : string ): string
    {
        if (!dt) return "";

        // Replace 'T' with space if AM/PM is present
        let normalized : string = dt;
        if (/T.*(AM|PM)/i.test(dt))
        {
            normalized = dt.replace('T', ' ');
        }

        const date : Date = new Date(normalized);

        // Check for invalid date
        if( isNaN( date.getTime()) ) return "";

        return date.toISOString();
    }

    ///////////////////////////////////////////////////////////////////
    /**
     * Converts a "HH:mm" time string to a Date object with today's date.
     * Returns null if input is falsy or invalid.
     *
     * @param time - Time string in "HH:mm" format.
     * @returns Date object with today's date and given time, or null.
     */
    public static timeStringToDate(time?: string): Date | null
    {
        if (!time) return null;
        const [h, m] = time.split(":");
        if (h === undefined || m === undefined) return null;
        const d = new Date();
        d.setHours(Number(h), Number(m), 0, 0);
        return d;
    }

    ///////////////////////////////////////////////////////////////////
    /**
     * Converts a Date object to a "HH:mm" time string.
     * Returns empty string if input is null.
     *
     * @param date - Date object.
     * @returns Time string in "HH:mm" format, or "".
     */
    public static dateToTimeString(date: Date | null): string
    {
        if (!date) return "";
        return StringUtils.format(
            "{0}:{1}",
            StringUtils.leadingZero(date.getHours(), 2),
            StringUtils.leadingZero(date.getMinutes(), 2)
        );
    }
}

export namespace DateUtils
{
    export namespace Time
    {
        export const SECONDS_TO_MS : number = 1000;
        export const MINUTES_TO_MS : number = 60000;
        export const HOURS_TO_MS : number = 3600000;
        export const DAYS_TO_MS : number = 86400000;
    }
}

export default DateUtils;
//
// eof
//