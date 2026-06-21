//
export default class ArrayUtils
{
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** True if `value` is an array (moved from `Validator.isArray`). */
    public static isValid( value : any ) : boolean
    {
        return Array.isArray( value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * True if `value` is a **non-empty array of primitives** (moved from `Validator.isPrimitiveArray`).
     * Judged by the first element (assumes a homogeneous array); false for empty arrays / non-arrays.
     */
    public static isPrimitive( value : any ) : boolean
    {
        if( !ArrayUtils.isValid( value ) || value.length === 0 ) return false;
        const first : any = value[ 0 ];
        const firstIsObject : boolean = first !== null && first !== undefined && typeof first === "object";
        return !firstIsObject;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /*
        This deals with some arrays being returned that are not defined yet, but all indications that they are
    */
    public static size( ar : Array< string | number | any > | undefined ): number
    {
        return Array.isArray( ar ) ? ar.length : 0;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static includes( ar : Array< string > | undefined, item : string, case_insensitive : boolean = false ): boolean
    {
        if( !Array.isArray( ar ) ) return false;
        if( case_insensitive )
        {
            const lwr : string = item.toLowerCase();
            return ar.some( s => s.toLowerCase() === lwr );
        }
        else
            return ar.includes( item );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static includesAny( ar : Array< string > | undefined, items : Array<string> ): boolean
    {
        if( !Array.isArray( ar ) ) return false;
        const lwr : Array<string> = ar.map( s => s.toLowerCase() );
        return items.some( item => lwr.includes( item.toLowerCase() ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Compares if 2 arrays contain the same items.
    *
    * @param ar1 Array 1 of string, numbers or boolean
    * @param ar2 Array 2 of string, numbers or boolean
    * @return Returns true if the arrays are the same.
    */
    public static isSame( ar1 : Array< string | number | boolean>, ar2: Array<string | number | boolean > ): boolean
    {
        if( ar1.length !== ar2.length ) return false;
        const sorted1 : Array<string | number | boolean> = [...ar1].sort();
        const sorted2 : Array<string | number | boolean> = [...ar2].sort();
        for (let i = 0; i < sorted1.length; i++)
        {
            if( sorted1[i] !== sorted2[i] ) return false;
        }
        return true;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Sorts the parametric array by a certain field and specified direction
    *
    * @param arr Full array of object of the given T type
    * @param field Field in array to sort by
    * @param direction Direction to sort by.  Either ascending (asc) ir descending (desc)
    * @return Returns a new, sorted array.
    */
    public static sortByField<T>(arr: T[], field: keyof T, direction: "asc" | "desc" = "asc"): T[]
    {
        return arr.slice().sort((a : T, b : T) =>
        {
            const aValue = a[field];
            const bValue = b[field];
    
            // Handle undefined/null
            if (aValue == null && bValue == null) return 0;
            if (aValue == null) return direction === "asc" ? -1 : 1;
            if (bValue == null) return direction === "asc" ? 1 : -1;
    
            // For dates, numbers, and strings
            if (aValue < bValue) return direction === "asc" ? -1 : 1;
            if (aValue > bValue) return direction === "asc" ? 1 : -1;
            return 0;
        });
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Removes the spcified value from the array.  All occurances are removed.
    *
    * @param ar Arry of items
    * @param value Value to remove
    * @return Returns the array without the value(s) in it.
    */
    public static remove( ar : Array< string | number >, value : string | number ) : Array< string | number >
    {
        return ar.filter( item => item !== value )
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Returns true/false if all booleans in the array are true.
    *
    * @param ar Array of booleans
    * @return Returns 'true' if all the items in the array is true.
    */
    public static allTrue( ar : Array<boolean> ) : boolean
    {
        return ar.every( Boolean );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Returns true/false if any booleans in the array are true.
    *
    * @param ar Array of booleans
    * @return Returns 'true' if any the items in the array is true.
    */
    public static anyTrue( ar : Array<boolean> ) : boolean
    {
        return ar.some( Boolean);
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Counts the number of true values in a boolean array.
    *
    * @param ar Array of booleans
    * @return Returns the count of true values in the array.
    */
    public static countTrue( ar : Array<boolean> ) : number
    {
        return ar.filter( Boolean ).length;
    }

    //////////////////////////////////////////////////////////////////////////////////
    /**
     * Split an array into chunks of the given maximum size.
     *
     * @param arr - The input array to split.
     * @param size - Maximum size of each chunk (must be >= 1).
     * @returns An array of chunks (T[][]). If `arr` is empty returns [].
     *
     * @throws {Error} If `size` is less than 1.
     *
     * @example
     * // returns [[1,2],[3,4],[5]]
     * ArrayUtils.chunkArray([1,2,3,4,5], 2);
     */
    public static chunkArray<T>( arr: T[], size: number): T[][]
    {
        const result: T[][] = [];
        for (let i = 0; i < arr.length; i += size)
        {
            result.push(arr.slice(i, i + size));
        }
        return result;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Return a normalized allowed value from a list.
     *
     * Compares the provided item (case-insensitive) against the allowed values array and returns
     * the matching allowed value. If item is undefined or no match is found the first entry of
     * the allowed array is returned.
     *
     * @param ar - Array of allowed string values (preferred to be lowercase). The function returns one of these.
     * @param item - Value to match (will be compared case-insensitively). If undefined the first element of ar is returned.
     * @returns The matched allowed value from ar (lowercased comparison) or ar[0] as a fallback.
     *
     * @example
     * // returns 'foo'
     * ArrayUtils.match(['foo','bar'], 'FOO');
     */
    public static match( ar : Array<string>, item : string | undefined ) : string
    {
        if( item === undefined )return ar[0];
        
        // check that what is given is an allowable
        const lwr_item : string = item.toLowerCase();
        
        if( ar.includes( lwr_item ) )
            return lwr_item;
        else
            return ar[0];
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Removes all whitespace characters from every string in the array.
     *
     * @param ar - Array of strings to process. Each element will have all whitespace (spaces, tabs, newlines) removed.
     * @returns A new array of strings with whitespace removed from each element.
     *
     * @example
     * // returns ['foo','bar']
     * ArrayUtils.removeAllSpaces([' f o o ', '\tbar\n']);
     */
    public static removeAllSpaces( ar : Array<string> ) : Array<string>
    {
        return ar.map( ( flag : string ) => { return flag.replace(/\s+/g, '') } );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert all strings in the array to lowercase.
     *
     * @param ar - Array of strings to convert. Each element will be transformed using String.prototype.toLowerCase().
     * @returns A new array containing the lowercased strings (original array is not mutated).
     *
     * @example
     * // returns ['foo','bar']
     * ArrayUtils.toLowerCase(['Foo','BAR']);
     */
    public static toLowerCase( ar : Array<string> ) : Array<string>
    {
        return ar.map( ( flag : string ) => { return flag.toLowerCase() } );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert an array of numbers into a human-friendly, comma-separated string with ranges.
     *
     * Numbers are deduplicated and sorted ascending. Consecutive runs are collapsed into
     * "start-end". Single numbers are rendered as-is, pairs are rendered as "a, b".
     *
     * @param arr - Array of numbers (can be unsorted). Intended for integer values; consecutive detection uses `n + 1`.
     * @returns A string like "1-3, 5, 7-8". Returns an empty string for an empty input array.
     *
     * @example
     * // returns "1-3, 5, 7-8"
     * ArrayUtils.humanNumberArrayToString([3,1,2,7,8,5]);
     */
    public static humanNumberArrayToString( arr : Array<number> ) : string
    {
        if( arr.length === 0)  return "";

        // Sort and remove duplicates
        const sorted : Array<number> = Array.from(new Set(arr)).sort((a, b) => a - b);

        const result: Array<string> = [];
        let start : number = sorted[0];
        let end   : number = sorted[0];

        let i : number;
        for ( i = 1; i <= sorted.length; i++)
        {
            if (sorted[i] === end + 1)
            {
                end = sorted[i];
            }
            else
            {
                if (start === end)
                {
                    result.push(`${start}`);
                }
                else if (end === start + 1)
                {
                    result.push(`${start}, ${end}`);
                }
                else
                {
                    result.push(`${start}-${end}`);
                }
                start = sorted[i];
                end = sorted[i];
            }
        }

        return result.join(', ');
    }

    

}
// eof