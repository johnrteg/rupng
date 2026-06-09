//
// BooleanUtils — boolean validation + coercion. Was Validator.isBoolean / getBoolean.
//
export default class BooleanUtils
{
    /////////////////////////////////////////////////////////////////////////////////
    /**
     * True if `value` can be interpreted as a boolean — native boolean, numeric 0/1, or the strings
     * "true"/"false"/"1"/"0"/"yes"/"no" (case-insensitive). False for null/undefined.
     */
    public static isValid( value : any ) : boolean
    {
        if( value === null || value === undefined ) return false;
        if( typeof value === "boolean" ) return true;
        if( typeof value === "number" && ( value === 1 || value === 0 ) ) return true;
        if( typeof value === "string" )
        {
            return [ "true", "false", "1", "0", "yes", "no" ].includes( value.toLowerCase() );
        }
        return false;
    }

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Coerce a boolean-like value to a boolean. True for `true` / `"true"` / `"1"` / `"yes"` / `1`
     * (strings case-insensitive); false for anything else (incl. non-boolean-like input).
     */
    public static get( value : any ) : boolean
    {
        if( !BooleanUtils.isValid( value ) ) return false;
        if( typeof value === "boolean" ) return value;
        if( typeof value === "number" )  return value === 1;
        return [ "true", "1", "yes" ].includes( String( value ).toLowerCase() );
    }
}
