//
// PhoneFormat — country-aware phone formatting for the web client. Belongs to the LocaleService
// (exposed via LocaleService.phone / .phoneToE164 / .phoneValid / .phonePrefixes).
//
// The platform STORES numbers as E.164 ("+18583331234"); this turns loose, human-typed input into
// E.164 and back into a country's pretty national format for display. Behavior is driven by a small
// per-country CONFIG so new countries are a data edit, not a code change:
//
//   - prefix  : the country calling code without "+"   (US = "1")
//   - format  : the national display mask, "#" = a digit ("(###) ###-####")
//   - pattern : optional stricter validation of the national digits (NANP for US/CA)
//
import type { LocaleService } from "./LocaleService";


export class PhoneFormat
{
    /** Country assumed when a caller doesn't specify one (the 10DLC / NANP assumption). */
    public static readonly DEFAULT_COUNTRY : string = "US";

    /**
     * Per-country phone config, keyed by ISO 3166-1 alpha-2 country code. `format` uses "#" as a digit
     * placeholder; every other character is emitted literally. US/CA share the +1 NANP plan. Add a
     * country by adding a row here.
     */
    private static readonly CONFIG : Record<string, PhoneFormat.Country> =
    {
        US: { prefix: "1",  format: "(###) ###-####", pattern: /^[2-9]\d{2}[2-9]\d{6}$/ },
        CA: { prefix: "1",  format: "(###) ###-####", pattern: /^[2-9]\d{2}[2-9]\d{6}$/ },
        MX: { prefix: "52", format: "## #### ####" },
        GB: { prefix: "44", format: "##### ######" },
        AU: { prefix: "61", format: "### ### ###" },
        DE: { prefix: "49", format: "#### #######" },
    };


    /////////////////////////////////////////////////////////////////////////////////
    /** The config for a country (defaults to {@link DEFAULT_COUNTRY}); `undefined` if unknown. */
    public static config( country : string = PhoneFormat.DEFAULT_COUNTRY ) : PhoneFormat.Country | undefined
    {
        return PhoneFormat.CONFIG[ country.toUpperCase() ];
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** The "+"-prefixed calling code for a country (e.g. "US" → "+1"); "" if unknown. */
    public static prefix( country : string = PhoneFormat.DEFAULT_COUNTRY ) : string
    {
        const cfg : PhoneFormat.Country | undefined = PhoneFormat.config( country );
        return cfg ? `+${cfg.prefix}` : "";
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** The national display mask for a country (e.g. "(###) ###-####") — "" if unknown. Use as a placeholder. */
    public static placeholder( country : string = PhoneFormat.DEFAULT_COUNTRY ) : string
    {
        const cfg : PhoneFormat.Country | undefined = PhoneFormat.config( country );
        return cfg ? cfg.format : "";
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** Digits only — strips spaces, "+", and all formatting. */
    public static digits( value : string ) : string
    {
        return typeof value === "string" ? value.replace( /\D/g, "" ) : "";
    }

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * **As-you-type** formatting — masks the digits entered so far against the country's format and
     * STOPS at the last digit (no trailing separators), so "(858) 333-1234" builds up cleanly while
     * typing. A leading country code is stripped; digits beyond the national length are dropped.
     */
    public static formatPartial( value : string, country : string = PhoneFormat.DEFAULT_COUNTRY ) : string
    {
        const cfg : PhoneFormat.Country | undefined = PhoneFormat.config( country );
        if( !cfg ) return value;

        let digits : string = PhoneFormat.digits( value );
        const want : number = PhoneFormat.expected( cfg );
        if( digits.length === want + cfg.prefix.length && digits.startsWith( cfg.prefix ) ) digits = digits.slice( cfg.prefix.length );
        digits = digits.slice( 0, want );

        let out : string = "";
        let index : number = 0;
        for( const ch of cfg.format )
        {
            if( index >= digits.length ) break;            // stop at the last typed digit — no trailing literals
            out += ch === "#" ? digits[ index++ ] : ch;
        }
        return out;
    }

    /////////////////////////////////////////////////////////////////////////////////
    /** True when a (loosely-formatted) number is valid for the given country. */
    public static isValid( value : string, country : string = PhoneFormat.DEFAULT_COUNTRY ) : boolean
    {
        return PhoneFormat.national( value, country ) !== null;
    }

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Normalize loose/pretty input to **E.164** for storage — e.g. "(858) 333-1234" → "+18583331234".
     * Accepts the bare national number, the number with its country code, or an already "+"-prefixed
     * value. Returns `null` when the digits don't form a valid number for the country.
     */
    public static toE164( value : string, country : string = PhoneFormat.DEFAULT_COUNTRY ) : string | null
    {
        const resolved : string = PhoneFormat.resolveCountry( value, country );
        const cfg : PhoneFormat.Country | undefined = PhoneFormat.config( resolved );
        if( !cfg ) return null;

        const national : string | null = PhoneFormat.national( value, resolved );
        if( national === null ) return null;

        return `+${cfg.prefix}${national}`;
    }

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Pretty-print to a country's national format — e.g. "+18583331234" → "(858) 333-1234". Accepts an
     * E.164 string or a bare national number. `country` is optional: when omitted it's inferred from the
     * E.164 calling code (defaulting to {@link DEFAULT_COUNTRY}). Returns the input unchanged if it
     * isn't a valid number for the resolved country.
     */
    public static format( value : string, country? : string ) : string
    {
        const resolved : string = PhoneFormat.resolveCountry( value, country ?? PhoneFormat.DEFAULT_COUNTRY );
        const cfg : PhoneFormat.Country | undefined = PhoneFormat.config( resolved );
        if( !cfg ) return value;

        const national : string | null = PhoneFormat.national( value, resolved );
        if( national === null ) return value;

        return PhoneFormat.applyMask( national, cfg.format );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Map ISO country codes to calling-code choices for a dropdown:
     *   ["US","CA"] → [ { value: "+1", label: "US" }, { value: "+1", label: "CA" } ]
     * Unknown codes are skipped. `label` defaults to the country code; pass `nameLabels` to use the
     * full country name from the supplied map (e.g. LocaleService.COUNTRIES).
     */
    public static prefixChoices( countries : Array<string>, nameLabels? : Record<string,string> ) : Array<LocaleService.Choice>
    {
        const choices : Array<LocaleService.Choice> = [];
        countries.forEach( ( country : string ) =>
        {
            const code : string = country.toUpperCase();
            const cfg : PhoneFormat.Country | undefined = PhoneFormat.config( code );
            if( !cfg ) return;
            choices.push( { value: `+${cfg.prefix}`, label: nameLabels && nameLabels[ code ] ? nameLabels[ code ] : code } );
        } );
        return choices;
    }


    /////////////////////////////////////////////////////////////////////////////////
    // ---- internals ----------------------------------------------------------------

    /** Expected count of national digits for a country = the number of "#" in its mask. */
    private static expected( cfg : PhoneFormat.Country ) : number
    {
        return ( cfg.format.match( /#/g ) || [] ).length;
    }

    /**
     * Extract the valid national digits from loose input for a country, or `null` if invalid. Accepts
     * the bare national number or one prefixed with the country's calling code (with/without "+"), then
     * checks the length matches the mask and any per-country `pattern`.
     */
    private static national( value : string, country : string ) : string | null
    {
        const cfg : PhoneFormat.Country | undefined = PhoneFormat.config( PhoneFormat.resolveCountry( value, country ) );
        if( !cfg ) return null;

        let digits : string = PhoneFormat.digits( value );
        const want : number = PhoneFormat.expected( cfg );

        // strip a leading country code if present (e.g. "1" on "18583331234")
        if( digits.length === want + cfg.prefix.length && digits.startsWith( cfg.prefix ) )
        {
            digits = digits.slice( cfg.prefix.length );
        }

        if( digits.length !== want ) return null;
        if( cfg.pattern && !cfg.pattern.test( digits ) ) return null;
        return digits;
    }

    /** Fill a mask's "#" placeholders with the national digits left-to-right. */
    private static applyMask( national : string, mask : string ) : string
    {
        let result : string = "";
        let index  : number = 0;
        for( const ch of mask )
        {
            if( ch === "#" )
            {
                if( index < national.length ) result += national[ index++ ];
            }
            else
            {
                result += ch;
            }
        }
        return result;
    }

    /** The country to use: a "+"-prefixed value identifies its own country (auto-detected); otherwise `country`. */
    private static resolveCountry( value : string, country : string ) : string
    {
        if( typeof value === "string" && value.trim().startsWith( "+" ) )
        {
            const detected : string | null = PhoneFormat.countryFromE164( value );
            if( detected ) return detected;
        }
        return country;
    }

    /** Best-effort country lookup from an E.164 value by matching its leading calling code. */
    private static countryFromE164( value : string ) : string | null
    {
        if( typeof value !== "string" || !value.trim().startsWith( "+" ) ) return null;
        const digits : string = PhoneFormat.digits( value );

        // longest prefix first so "1" doesn't shadow a hypothetical longer code
        const entries : Array<[string,PhoneFormat.Country]> = Object.entries( PhoneFormat.CONFIG )
            .sort( ( a, b ) => b[ 1 ].prefix.length - a[ 1 ].prefix.length );

        for( const [ code, cfg ] of entries )
        {
            if( digits.startsWith( cfg.prefix ) && digits.length === cfg.prefix.length + PhoneFormat.expected( cfg ) )
            {
                return code;
            }
        }
        return null;
    }
}

export namespace PhoneFormat
{
    /** Per-country phone configuration. */
    export interface Country
    {
        /** Country calling code without "+" (US = "1"). */
        prefix  : string;
        /** National display mask; "#" = a digit, everything else is literal ("(###) ###-####"). */
        format  : string;
        /** Optional stricter validation of the national digits (e.g. NANP for US/CA). */
        pattern? : RegExp;
    }
}

export default PhoneFormat;
