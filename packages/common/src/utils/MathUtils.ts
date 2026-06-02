//
export default class MathUtils
{

    //////////////////////////////////////////////////////////////////////////////////////
    /**
     * Generate a random integer within a specified range (inclusive).
     *
     * Returns a random integer between min_value and max_value, where both
     * the minimum and maximum values are included in the possible results.
     *
     * @param min_value - The minimum value (inclusive) of the random range.
     * @param max_value - The maximum value (inclusive) of the random range.
     * @returns A random integer between min_value and max_value, inclusive.
     *
     * @example
     * MathUtils.randomRange(1, 6); // Random integer from 1 to 6 (like a dice roll)
     * MathUtils.randomRange(10, 20); // Random integer from 10 to 20
     * MathUtils.randomRange(0, 100); // Random integer from 0 to 100
     */
    public static randomRange( min_value : number, max_value : number ): number
    {
        return Math.floor( Math.random() * (max_value - min_value + 1)) + min_value;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Calculate the percentage of a value relative to a total.
     *
     * Returns the percentage representation of value/total * 100, capped at 100%.
     * Returns 0 for null inputs or when the total is 0 to avoid division by zero errors.
     *
     * @param value - The numerator value, or null.
     * @param total - The denominator (total) value, or null.
     * @returns The percentage as a number (0-100), or 0 if inputs are invalid.
     *
     * @example
     * MathUtils.percent(25, 100); // 25
     * MathUtils.percent(3, 4); // 75
     * MathUtils.percent(150, 100); // 100 (capped at 100%)
     * MathUtils.percent(null, 100); // 0
     * MathUtils.percent(50, 0); // 0 (avoids division by zero)
     */
    public static percent( value : number | null, total : number | null ) : number
    {
        if( value === null || total === null || total === 0 )
            return 0;
        else
            return Math.min( ( value / total ) * 100, 100 );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    public static compare( a : number, b : number, dir : number ) : number
    {
        return ( a - b ) * dir
    }


}


//
// eof
//