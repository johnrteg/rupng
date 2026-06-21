//
import StringUtils from "./StringUtils";

//
// UuidUtils — UUID validation (moved from Validator).
//
export default class UuidUtils
{
    /** 8-4-4-4-12 hex, anchored (any version). */
    private static readonly UUID : RegExp = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate a UUID string (8-4-4-4-12 hex, **anchored**, any version). Returns false for
     * null / undefined / empty / non-string input.
     */
    public static isValid( value : string ) : boolean
    {
        return StringUtils.isValid( value ) && UuidUtils.UUID.test( value );
    }
}
