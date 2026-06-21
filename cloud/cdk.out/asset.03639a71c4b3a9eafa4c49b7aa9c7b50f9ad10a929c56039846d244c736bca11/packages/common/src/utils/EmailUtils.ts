//
import StringUtils from "./StringUtils";

//
// EmailUtils — email validation (moved from Validator). Anchored, RFC-5322-ish, case-insensitive.
//
export default class EmailUtils
{
    /** RFC-5322-ish email (anchored). */
    private static readonly EMAIL : RegExp = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate an email address (anchored, case-insensitive). Guards null / undefined / non-string
     * (so `""` and `null` return false rather than throwing).
     */
    public static isValid( email : string ) : boolean
    {
        return StringUtils.isValid( email ) && EmailUtils.EMAIL.test( email.toLowerCase() );
    }
}
