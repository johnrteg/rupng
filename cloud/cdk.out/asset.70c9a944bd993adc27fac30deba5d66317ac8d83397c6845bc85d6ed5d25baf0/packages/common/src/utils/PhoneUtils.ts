//
// PhoneUtils — NANP (North American Numbering Plan) phone handling. The platform **stores** numbers as
// E.164 (`Type.PhoneE164`, e.g. "+12125550123"). This validates NANP rules and **normalizes** loose
// input to E.164, defaulting the country code to **+1** (US / NANP — the 10DLC assumption) when the
// input has none. Result-based (no throw). For non-NANP countries, pass a "+"-prefixed E.164 string.
//
import type { Type } from "../Types";
import ResultUtils from "./ResultUtils";

export class PhoneUtils
{
    /** Default country code when an input has none — `"1"` (US / NANP), the 10DLC assumption. */
    public static readonly DEFAULT_COUNTRY_CODE : string = "1";

    /** NANP national number (10 digits): NPA + NXX + 4-digit line. Area & exchange start **2-9** and
     *  are **not N11** service codes (e.g. 411 / 911). */
    private static readonly NANP : RegExp = /^(?![2-9]11)[2-9]\d{2}(?![2-9]11)[2-9]\d{2}\d{4}$/;
    /** E.164: `+` then 1-15 digits, leading digit 1-9. */
    private static readonly E164 : RegExp = /^\+[1-9]\d{1,14}$/;

    /////////////////////////////////////////////////////////////////////////////////
    /** True if `value` is a valid **NANP** number — accepts loose formatting + an optional `1`/`+1` prefix. */
    public static isValid( value : string ) : boolean
    {
        if( typeof value !== "string" ) return false;
        const national : string | null = PhoneUtils.national( PhoneUtils.digits( value ) );
        return national !== null && PhoneUtils.NANP.test( national );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** True if `value` is already in **E.164** form (`+` + 1-15 digits). */
    public static isE164( value : string ) : boolean
    {
        return typeof value === "string" && PhoneUtils.E164.test( value );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** True if `value` is a **5-6 digit SMS short code**. */
    public static isShortCode( value : string ) : boolean
    {
        return typeof value === "string" && /^\d{5,6}$/.test( value.trim() );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** True if `value` is an `sms:` URI whose target is a NANP number or a short code (e.g. `"sms:2125550123"`). */
    public static isSms( value : string ) : boolean
    {
        if( typeof value !== "string" ) return false;
        try
        {
            const uri : URL = new URL( value );
            return uri.protocol === "sms:" && ( PhoneUtils.isValid( uri.pathname ) || PhoneUtils.isShortCode( uri.pathname ) );
        }
        catch
        {
            return false;   // not a valid URI
        }
    }

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Normalize loose input to **E.164** for storage ({@link Type.PhoneE164}). A `+`-prefixed input is
     * taken as already-international and validated as E.164. A **bare** input is assumed **NANP** and
     * prefixed with `+${defaultCountryCode}` (default `"1"`); it must be a valid 10-digit NANP number.
     * Returns `ok:false` for anything that isn't a valid NANP / E.164 number.
     */
    public static toE164( value : string, defaultCountryCode : string = PhoneUtils.DEFAULT_COUNTRY_CODE ) : Type.Result<Type.PhoneE164>
    {
        if( typeof value !== "string" ) return ResultUtils.err<Type.PhoneE164>( "PhoneUtils.toE164: value is not a string" );
        const trimmed : string = value.trim();

        // explicit "+": already international — validate as E.164 (any country), keep as-is.
        if( trimmed.startsWith( "+" ) )
        {
            const e164 : string = "+" + PhoneUtils.digits( trimmed );
            return PhoneUtils.E164.test( e164 )
                ? ResultUtils.ok( e164 )
                : ResultUtils.err<Type.PhoneE164>( `PhoneUtils.toE164: invalid E.164 "${value}"` );
        }

        // bare: assume NANP, default the country code.
        const national : string | null = PhoneUtils.national( PhoneUtils.digits( trimmed ) );
        if( national === null )                 return ResultUtils.err<Type.PhoneE164>( `PhoneUtils.toE164: not a 10-digit NANP number "${value}"` );
        if( !PhoneUtils.NANP.test( national ) )  return ResultUtils.err<Type.PhoneE164>( `PhoneUtils.toE164: invalid NANP number "${value}"` );
        return ResultUtils.ok( `+${defaultCountryCode}${national}` );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** Pretty-print a NANP E.164 (`"+12125550123"`) as `"(212) 555-0123"`; returns the input unchanged
     *  if it isn't a NANP E.164 (e.g. a non-+1 international number). For display only — store the E.164. */
    public static format( e164 : Type.PhoneE164 ) : string
    {
        if( typeof e164 !== "string" ) return String( e164 );
        const match : RegExpMatchArray | null = e164.match( /^\+1(\d{3})(\d{3})(\d{4})$/ );
        return match ? `(${match[ 1 ]}) ${match[ 2 ]}-${match[ 3 ]}` : e164;
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** Digits only (strips formatting). */
    private static digits( value : string ) : string { return value.replace( /\D/g, "" ); }

    /** The 10-digit national part: bare 10 digits, or 11 digits with a leading `1`; else `null`. */
    private static national( digits : string ) : string | null
    {
        if( digits.length === 10 ) return digits;
        if( digits.length === 11 && digits.startsWith( "1" ) ) return digits.slice( 1 );
        return null;
    }
}

export default PhoneUtils;
