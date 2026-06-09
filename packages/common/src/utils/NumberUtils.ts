//
// NumberUtils — number validation/coercion + math helpers (absorbs the former MathUtils).
//
export default class NumberUtils
{
    /////////////////////////////////////////////////////////////////////////////////
    /** True if `value` is a real number (typeof number, not NaN). Moved from `Validator.isNumber`. */
    public static isValid( value : any ) : boolean
    {
        return typeof value === "number" && !Number.isNaN( value );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** The value if it's a valid number, else `0` (safe fallback). Moved from `Validator.getNumber`. */
    public static get( value : any ) : number
    {
        return NumberUtils.isValid( value ) ? value as number : 0;
    }

    //////////////////////////////////////////////////////////////////////////////////////
    /**
     * Generate a random integer within a specified range (inclusive).
     *
     * @param min_value - The minimum value (inclusive) of the random range.
     * @param max_value - The maximum value (inclusive) of the random range.
     * @returns A random integer between min_value and max_value, inclusive.
     *
     * @example
     * NumberUtils.randomRange(1, 6); // Random integer from 1 to 6 (like a dice roll)
     */
    public static randomRange( min_value : number, max_value : number ): number
    {
        return Math.floor( Math.random() * (max_value - min_value + 1)) + min_value;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Calculate the percentage of a value relative to a total (capped at 100%). Returns 0 for null
     * inputs or a zero total (avoids division by zero).
     *
     * @example
     * NumberUtils.percent(25, 100); // 25
     * NumberUtils.percent(150, 100); // 100 (capped)
     */
    public static percent( value : number | null, total : number | null ) : number
    {
        if( value === null || total === null || total === 0 )
            return 0;
        else
            return Math.min( ( value / total ) * 100, 100 );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    /** Comparator helper: `(a - b) * dir` (dir 1 = ascending, -1 = descending). */
    public static compare( a : number, b : number, dir : number ) : number
    {
        return ( a - b ) * dir;
    }
}

//
// eof
//
