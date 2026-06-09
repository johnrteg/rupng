//
//import parsePhoneNumber, { PhoneNumber } from 'libphonenumber-js';
//import Languages from '@main/definitions/Languages';
import { DateUtils, StringUtils } from "@repo/common";


interface NumberFomat
{
  [key:number] : Intl.NumberFormat;
}

//
//
//
export class LocaleService
{

    public language             : string = LocaleService.Language.AMERICAN;

    public languages            : Array<string> = [LocaleService.Language.AMERICAN];

    private language_data       : any;

    private currencyDigits  : NumberFomat = {};
    private numberDigits    : NumberFomat = {};

    public date_short!          : Intl.DateTimeFormat;
    public date_normal!         : Intl.DateTimeFormat;
    public date_long!           : Intl.DateTimeFormat;

    public date_time_short!     : Intl.DateTimeFormat;
    public date_time_normal!    : Intl.DateTimeFormat;
    public date_time_long!      : Intl.DateTimeFormat;

    public time_short!     : Intl.DateTimeFormat;
    public time_normal!    : Intl.DateTimeFormat;
    public time_long!      : Intl.DateTimeFormat;


    ///////////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    public currency( value : number | null, digits : number ) : string
    {
        if( value === null )return "";
        
        // create cache
        if( !this.currencyDigits[ digits ] )
        {
            this.currencyDigits[ digits ] = new Intl.NumberFormat( this.language, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
        }
        return this.currencyDigits[ digits ].format( value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    public number( value : number | null, digits : number ) : string
    {
        if( value !== null )
        {
            // create cache
            if( !this.numberDigits[ digits ] )
            {
                this.numberDigits[ digits ] = new Intl.NumberFormat( this.language, { style: 'decimal', minimumFractionDigits: digits, maximumFractionDigits: digits });
            }
            return this.numberDigits[ digits ].format( value );
        }
        else
            return "";
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    public date( value : Date | null, format : LocaleService.Format ) : string
    {
        if( value === null || isNaN( value.getTime() ) )return "";
        switch( format )
        {
            case  LocaleService.Format.SHORT : return this.date_short.format( value ); break;
            case  LocaleService.Format.MEDIUM : return this.date_normal.format( value ); break;
            case  LocaleService.Format.LONG : return this.date_long.format( value ); break;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    public time( value : Date | null, format : LocaleService.Format ) : string
    {
        if( value === null || isNaN( value.getTime() ) )return "";
        switch( format )
        {
            case  LocaleService.Format.SHORT : return this.time_short.format( value ); break;
            case  LocaleService.Format.MEDIUM : return this.time_normal.format( value ); break;
            case  LocaleService.Format.LONG : return this.time_long.format( value ); break;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    public dateTime( value : Date | null, format : LocaleService.Format ) : string
    {
        if( value === null || isNaN( value.getTime() ) )return "";
        switch( format )
        {
            case  LocaleService.Format.SHORT : return this.date_time_short.format( value ); break;
            case  LocaleService.Format.MEDIUM : return this.date_time_normal.format( value ); break;
            case  LocaleService.Format.LONG : return this.date_time_long.format( value ); break;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    public async setLanguage( lang : string, data : any ) : Promise<void>
    {
        this.language = lang;
        this.language_data = data;

        // re-create under new language
        const ckeys : Array<string> = Object.keys( this.currencyDigits );
        ckeys.forEach( ( key : string ) => { this.currencyDigits[ parseInt( key ) ] = new Intl.NumberFormat( this.language, { style: 'currency', currency: 'USD', minimumFractionDigits: parseInt( key ), maximumFractionDigits: parseInt( key ) });  } );

        const nkeys : Array<string> = Object.keys( this.numberDigits );
        nkeys.forEach( ( nkey : string ) => { this.numberDigits[ parseInt( nkey ) ] = new Intl.NumberFormat( this.language, { style: 'decimal', minimumFractionDigits: parseInt( nkey ), maximumFractionDigits: parseInt( nkey ) });  } );

        this.date_short   = new Intl.DateTimeFormat( lang, { dateStyle: 'short' });
        this.date_normal  = new Intl.DateTimeFormat( lang, { dateStyle: 'medium' });
        this.date_long    = new Intl.DateTimeFormat( lang, { dateStyle: 'long' });

        this.date_time_short   = new Intl.DateTimeFormat( lang, { dateStyle: 'short', timeStyle: "short" });
        this.date_time_normal  = new Intl.DateTimeFormat( lang, { dateStyle: 'medium', timeStyle: "medium" });
        this.date_time_long    = new Intl.DateTimeFormat( lang, { dateStyle: 'long', timeStyle: "long" });

        this.time_short   = new Intl.DateTimeFormat( lang, { timeStyle: "short" });
        this.time_normal  = new Intl.DateTimeFormat( lang, { timeStyle: "medium" });
        this.time_long    = new Intl.DateTimeFormat( lang, { timeStyle: "long" });

    }

/*
    ////////////////////////////////////////////////////////////////////////////////////////////////
    public phone( phone : string ) : string
    {
        const phoneNumber : PhoneNumber | undefined = parsePhoneNumber( phone , 'US' );
        return phoneNumber ? phoneNumber.formatNational() : phone;
    }
*/

    ////////////////////////////////////////////////////////////////////////////////////////////////
    public label( path : string, options? : LocaleService.LabelOptions ) : string
    {
        if( this.language_data[ path ] )
        {
            let str : string = this.language_data[ path ];
            if( options !== undefined )
            {
                if( options.bullet !== undefined && options.bullet === true )str = StringUtils.format( "{0} {1}", StringUtils.BULLET, str );
                if( options.lowerCase !== undefined && options.lowerCase === true )str = str.toLowerCase();
                if( options.colon !== undefined && options.colon === true )str += ": ";
                if( options.ellipse !== undefined && options.ellipse === true )str += StringUtils.ELLIPSE;
                if( options.bracket !== undefined && options.bracket === true )str = StringUtils.format( "({0})", str );
                if( options.quotes !== undefined && options.quotes === true )str = StringUtils.format( '"{0}"', str );
                if( options.required !== undefined && options.required === true )str = StringUtils.format( '{0}*', str );
            }
            
            return str;
        }
        else
            return StringUtils.format( "!{0}", path );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    public amount( path : string, default_amt : number ) : number
    {
        if( this.language_data[ path ] )
            return parseInt( this.language_data[ path ] );
        else
            return default_amt;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    public minutes( min : number ) : string
    {
        if( min < 60 )
        {
            return `${min} minute${min === 1 ? '' : 's'}`;
        }
        // less than a day
        else if (min < 1440)
        { 
            const hours : number = min / 60;
            const rounded : number = parseFloat(hours.toFixed(1));
            return rounded === 1
                ? `${rounded} hour`
                : `${rounded} hours`;
        }
        // less than a month (30 days)
        else if ( min < 43200)
        { 
            const days : number = min / 1440;
            const rounded : number = parseFloat(days.toFixed(1));
            return rounded === 1
                ? `${rounded} day`
                : `${rounded} days`;
        }
        else
        {
            const months : number = min / 43200;
            const rounded : number = parseFloat(months.toFixed(1));
            return rounded === 1
                ? `${rounded} month`
                : `${rounded} months`;
        }
    }


}

export namespace LocaleService
{
    export interface LabelOptions
    {
        lowerCase? : boolean;
        colon? : boolean;
        ellipse? : boolean;
        bracket? : boolean;
        bullet? : boolean;
        quotes? : boolean;
        required? : boolean;
    }

    export enum Format
    {
        SHORT = "short",
        MEDIUM = "medium",
        LONG = "long"
    }

    export enum Language
    {
        AMERICAN   = "en-US",
        SPANISH    = "es-ES",
        FRENCH     = "fr-FR",
        KOREAN     = "ko-KR",
        CHINESE    = "zh-CN",
        VIETNAMESE  = "vi-VN",
    }

    export interface Choice
    {
        label : string;
        value : string;
    }

    export const STATES : Record<string, string> = {
            AA: "Armed Forces America",
            AE: "Armed Forces",
            AP: "Armed Forces Pacific",
            AK: "Alaska",
            AL: "Alabama",
            AR: "Arkansas",
            AS: "American Samoa",
            AZ: "Arizona",
            CA: "California",
            CO: "Colorado",
            CT: "Connecticut",
            DC: "Washington DC",
            DE: "Delaware",
            FL: "Florida",
            GA: "Georgia",
            GU: "Guam",
            HI: "Hawaii",
            IA: "Iowa",
            ID: "Idaho",
            IL: "Illinois",
            IN: "Indiana",
            KS: "Kansas",
            KY: "Kentucky",
            LA: "Louisiana",
            MA: "Massachusetts",
            MD: "Maryland",
            ME: "Maine",
            MI: "Michigan",
            MN: "Minnesota",
            MO: "Missouri",
            MP: "Northern Mariana Islands",
            MS: "Mississippi",
            MT: "Montana",
            NC: "North Carolina",
            ND: "North Dakota",
            NE: "Nebraska",
            NH: "New Hampshire",
            NJ: "New Jersey",
            NM: "New Mexico",
            NV: "Nevada",
            NY: "New York",
            OH: "Ohio",
            OK: "Oklahoma",
            OR: "Oregon",
            PA: "Pennsylvania",
            PR: "Puerto Rico",
            RI: "Rhode Island",
            SC: "South Carolina",
            SD: "South Dakota",
            TN: "Tennessee",
            TX: "Texas",
            UT: "Utah",
            VA: "Virginia",
            VI: "Virgin Islands",
            VT: "Vermont",
            WA: "Washington",
            WI: "Wisconsin",
            WV: "West Virginia",
            WY: "Wyoming",
        };

    export const AREA_CODES : Array<LocaleService.Choice> = [
            { label: "(201) New Jersey",                value: "201" }, { label: "(202) Washington DC",              value: "202" }, { label: "(203) Connecticut",                value: "203" }, { label: "(204) Manitoba, Canada",           value: "204" }, { label: "(205) Alabama",                    value: "205" },
            { label: "(206) Washington",                value: "206" }, { label: "(207) Maine",                      value: "207" }, { label: "(208) Idaho",                      value: "208" }, { label: "(209) California",                 value: "209" }, { label: "(210) Texas",                      value: "210" },
            { label: "(212) New York",                  value: "212" }, { label: "(213) California",                 value: "213" }, { label: "(214) Texas",                      value: "214" }, { label: "(215) Pennsylvania",               value: "215" }, { label: "(216) Ohio",                       value: "216" },
            { label: "(217) Illinois",                  value: "217" }, { label: "(218) Minnesota",                  value: "218" }, { label: "(219) Indiana",                    value: "219" }, { label: "(220) Ohio",                       value: "220" }, { label: "(223) Pennsylvania",               value: "223" },
            { label: "(224) Illinois",                  value: "224" }, { label: "(225) Louisiana",                  value: "225" }, { label: "(226) Ontario, Canada",            value: "226" }, { label: "(228) Mississippi",                value: "228" }, { label: "(229) Georgia",                    value: "229" },
            { label: "(231) Michigan",                  value: "231" }, { label: "(234) Ohio",                       value: "234" }, { label: "(236) British Columbia, Canada",   value: "236" }, { label: "(239) Florida",                    value: "239" }, { label: "(240) Maryland",                   value: "240" },
            { label: "(248) Michigan",                  value: "248" }, { label: "(249) Ontario, Canada",            value: "249" }, { label: "(250) British Columbia, Canada",   value: "250" }, { label: "(251) Alabama",                    value: "251" }, { label: "(252) North Carolina",             value: "252" },
            { label: "(253) Washington",                value: "253" }, { label: "(254) Texas",                      value: "254" }, { label: "(256) Alabama",                    value: "256" }, { label: "(260) Indiana",                    value: "260" }, { label: "(262) Wisconsin",                  value: "262" },
            { label: "(263) Montreal, Canada",          value: "263" }, { label: "(267) Pennsylvania",               value: "267" }, { label: "(269) Michigan",                   value: "269" }, { label: "(270) Kentucky",                   value: "270" }, { label: "(272) Pennsylvania",               value: "272" },
            { label: "(276) Virginia",                  value: "276" }, { label: "(279) California",                 value: "279" }, { label: "(281) Texas",                      value: "281" }, { label: "(289) Ontario, Canada",            value: "289" }, { label: "(301) Maryland",                   value: "301" },
            { label: "(302) Delaware",                  value: "302" }, { label: "(303) Colorado",                   value: "303" }, { label: "(304) West Virginia",              value: "304" }, { label: "(305) Florida",                    value: "305" }, { label: "(306) Saskatchewan, Canada",       value: "306" },
            { label: "(307) Wyoming",                   value: "307" }, { label: "(308) Nebraska",                   value: "308" }, { label: "(309) Illinois",                   value: "309" }, { label: "(310) California",                 value: "310" }, { label: "(312) Illinois",                   value: "312" },
            { label: "(313) Michigan",                  value: "313" }, { label: "(314) Missouri",                   value: "314" }, { label: "(315) New York",                   value: "315" }, { label: "(316) Kansas",                     value: "316" }, { label: "(317) Indiana",                    value: "317" },
            { label: "(318) Louisiana",                 value: "318" }, { label: "(319) Iowa",                       value: "319" }, { label: "(320) Minnesota",                  value: "320" }, { label: "(321) Florida",                    value: "321" }, { label: "(323) California",                 value: "323" },
            { label: "(325) Texas",                     value: "325" }, { label: "(326) Ohio",                       value: "326" }, { label: "(330) Ohio",                       value: "330" }, { label: "(331) Illinois",                   value: "331" }, { label: "(332) New York",                   value: "332" },
            { label: "(334) Alabama",                   value: "334" }, { label: "(336) North Carolina",             value: "336" }, { label: "(337) Louisiana",                  value: "337" }, { label: "(339) Massachusetts",              value: "339" }, { label: "(340) Virgin Islands",             value: "340" },
            { label: "(341) California",                value: "341" }, { label: "(343) Ontario, Canada",            value: "343" }, { label: "(346) Texas",                      value: "346" }, { label: "(347) New York",                   value: "347" }, { label: "(350) California",                 value: "350" },
            { label: "(351) Massachusetts",             value: "351" }, { label: "(352) Florida",                    value: "352" }, { label: "(354) Granby, Canada",             value: "354" }, { label: "(360) Washington",                 value: "360" }, { label: "(361) Texas",                      value: "361" },
            { label: "(363) New York",                  value: "363" }, { label: "(364) Kentucky",                   value: "364" }, { label: "(365) Ontario, Canada",            value: "365" }, { label: "(367) Quebec, Canada",             value: "367" }, { label: "(368) Calgary, Canada",            value: "368" },
            { label: "(380) Ohio",                      value: "380" }, { label: "(385) Utah",                       value: "385" }, { label: "(386) Florida",                    value: "386" }, { label: "(401) Rhode Island",               value: "401" }, { label: "(402) Nebraska",                   value: "402" },
            { label: "(403) Alberta, Canada",           value: "403" }, { label: "(404) Georgia",                    value: "404" }, { label: "(405) Oklahoma",                   value: "405" }, { label: "(406) Montana",                    value: "406" }, { label: "(407) Florida",                    value: "407" },
            { label: "(408) California",                value: "408" }, { label: "(409) Texas",                      value: "409" }, { label: "(410) Maryland",                   value: "410" }, { label: "(412) Pennsylvania",               value: "412" }, { label: "(413) Massachusetts",              value: "413" },
            { label: "(414) Wisconsin",                 value: "414" }, { label: "(415) California",                 value: "415" }, { label: "(416) Ontario, Canada",            value: "416" }, { label: "(417) Missouri",                   value: "417" }, { label: "(418) Quebec, Canada",             value: "418" },
            { label: "(419) Ohio",                      value: "419" }, { label: "(423) Tennessee",                  value: "423" }, { label: "(424) California",                 value: "424" }, { label: "(425) Washington",                 value: "425" }, { label: "(430) Texas",                      value: "430" },
            { label: "(431) Manitoba, Canada",          value: "431" }, { label: "(432) Texas",                      value: "432" }, { label: "(434) Virginia",                   value: "434" }, { label: "(435) Utah",                       value: "435" }, { label: "(437) Ontario, Canada",            value: "437" },
            { label: "(438) Quebec, Canada",            value: "438" }, { label: "(440) Ohio",                       value: "440" }, { label: "(442) California",                 value: "442" }, { label: "(443) Maryland",                   value: "443" }, { label: "(445) Pennsylvania",               value: "445" },
            { label: "(447) Illinois",                  value: "447" }, { label: "(448) Florida",                    value: "448" }, { label: "(450) Quebec, Canada",             value: "450" }, { label: "(458) Oregon",                     value: "458" }, { label: "(463) Indiana",                    value: "463" },
            { label: "(464) Illinois",                  value: "464" }, { label: "(468) Sherbrooke, Canada",         value: "468" }, { label: "(469) Texas",                      value: "469" }, { label: "(470) Georgia",                    value: "470" }, { label: "(472) North Carolina",             value: "472" },
            { label: "(474) Saskatchewan, Canada",      value: "474" }, { label: "(475) Connecticut",                value: "475" }, { label: "(478) Georgia",                    value: "478" }, { label: "(479) Arkansas",                   value: "479" }, { label: "(480) Arizona",                    value: "480" },
            { label: "(484) Pennsylvania",              value: "484" }, { label: "(501) Arkansas",                   value: "501" }, { label: "(502) Kentucky",                   value: "502" }, { label: "(503) Oregon",                     value: "503" }, { label: "(504) Louisiana",                  value: "504" },
            { label: "(505) New Mexico",                value: "505" }, { label: "(506) New Brunswick, Canada",      value: "506" }, { label: "(507) Minnesota",                  value: "507" }, { label: "(508) Massachusetts",              value: "508" }, { label: "(509) Washington",                 value: "509" },
            { label: "(510) California",                value: "510" }, { label: "(512) Texas",                      value: "512" }, { label: "(513) Ohio",                       value: "513" }, { label: "(514) Quebec, Canada",             value: "514" }, { label: "(515) Iowa",                       value: "515" },
            { label: "(516) New York",                  value: "516" }, { label: "(517) Michigan",                   value: "517" }, { label: "(518) New York",                   value: "518" }, { label: "(519) Ontario, Canada",            value: "519" }, { label: "(520) Arizona",                    value: "520" },
            { label: "(530) California",                value: "530" }, { label: "(531) Nebraska",                   value: "531" }, { label: "(534) Wisconsin",                  value: "534" }, { label: "(539) Oklahoma",                   value: "539" }, { label: "(540) Virginia",                   value: "540" },
            { label: "(541) Oregon",                    value: "541" }, { label: "(548) London, Canada",             value: "548" }, { label: "(551) New Jersey",                 value: "551" }, { label: "(557) Missouri",                   value: "557" }, { label: "(559) California",                 value: "559" },
            { label: "(561) Florida",                   value: "561" }, { label: "(562) California",                 value: "562" }, { label: "(563) Iowa",                       value: "563" }, { label: "(564) Washington",                 value: "564" }, { label: "(567) Ohio",                       value: "567" },
            { label: "(570) Pennsylvania",              value: "570" }, { label: "(571) Virginia",                   value: "571" }, { label: "(572) Oklahoma",                   value: "572" }, { label: "(573) Missouri",                   value: "573" }, { label: "(574) Indiana",                    value: "574" },
            { label: "(575) New Mexico",                value: "575" }, { label: "(579) Quebec, Canada",             value: "579" }, { label: "(580) Oklahoma",                   value: "580" }, { label: "(581) Quebec, Canada",             value: "581" }, { label: "(582) Pennsylvania",               value: "582" },
            { label: "(584) Manitoba, Canada",          value: "584" }, { label: "(585) New York",                   value: "585" }, { label: "(586) Michigan",                   value: "586" }, { label: "(587) Alberta, Canada",            value: "587" }, { label: "(600) Canada",                     value: "600" },
            { label: "(601) Mississippi",               value: "601" }, { label: "(602) Arizona",                    value: "602" }, { label: "(603) New Hampshire",              value: "603" }, { label: "(604) British Columbia, Canada",   value: "604" }, { label: "(605) South Dakota",               value: "605" },
            { label: "(606) Kentucky",                  value: "606" }, { label: "(607) New York",                   value: "607" }, { label: "(608) Wisconsin",                  value: "608" }, { label: "(609) New Jersey",                 value: "609" }, { label: "(610) Pennsylvania",               value: "610" },
            { label: "(612) Minnesota",                 value: "612" }, { label: "(613) Ontario, Canada",            value: "613" }, { label: "(614) Ohio",                       value: "614" }, { label: "(615) Tennessee",                  value: "615" }, { label: "(616) Michigan",                   value: "616" },
            { label: "(617) Massachusetts",             value: "617" }, { label: "(618) Illinois",                   value: "618" }, { label: "(619) California",                 value: "619" }, { label: "(620) Kansas",                     value: "620" }, { label: "(623) Arizona",                    value: "623" },
            { label: "(626) California",                value: "626" }, { label: "(628) California",                 value: "628" }, { label: "(629) Tennessee",                  value: "629" }, { label: "(630) Illinois",                   value: "630" }, { label: "(631) New York",                   value: "631" },
            { label: "(636) Missouri",                  value: "636" }, { label: "(639) Saskatchewan, Canada",       value: "639" }, { label: "(640) New Jersey",                 value: "640" }, { label: "(641) Iowa",                       value: "641" }, { label: "(646) New York",                   value: "646" },
            { label: "(647) Ontario, Canada",           value: "647" }, { label: "(650) California",                 value: "650" }, { label: "(651) Minnesota",                  value: "651" }, { label: "(656) Florida",                    value: "656" }, { label: "(657) California",                 value: "657" },
            { label: "(659) Alabama",                   value: "659" }, { label: "(660) Missouri",                   value: "660" }, { label: "(661) California",                 value: "661" }, { label: "(662) Mississippi",                value: "662" }, { label: "(667) Maryland",                   value: "667" },
            { label: "(669) California",                value: "669" }, { label: "(670) Northern Mariana Islands",   value: "670" }, { label: "(671) Guam",                       value: "671" }, { label: "(672) Vancouver, Canada",          value: "672" }, { label: "(678) Georgia",                    value: "678" },
            { label: "(680) New York",                  value: "680" }, { label: "(681) West Virginia",              value: "681" }, { label: "(682) Texas",                      value: "682" }, { label: "(683) Sudbury, Canada",            value: "683" }, { label: "(684) American Samoa",             value: "684" },
            { label: "(689) Florida",                   value: "689" }, { label: "(701) North Dakota",               value: "701" }, { label: "(702) Nevada",                     value: "702" }, { label: "(703) Virginia",                   value: "703" }, { label: "(704) North Carolina",             value: "704" },
            { label: "(705) Ontario, Canada",           value: "705" }, { label: "(706) Georgia",                    value: "706" }, { label: "(707) California",                 value: "707" }, { label: "(708) Illinois",                   value: "708" }, { label: "(709) Newfoundland, Canada",       value: "709" },
            { label: "(712) Iowa",                      value: "712" }, { label: "(713) Texas",                      value: "713" }, { label: "(714) California",                 value: "714" }, { label: "(715) Wisconsin",                  value: "715" }, { label: "(716) New York",                   value: "716" },
            { label: "(717) Pennsylvania",              value: "717" }, { label: "(718) New York",                   value: "718" }, { label: "(719) Colorado",                   value: "719" }, { label: "(720) Colorado",                   value: "720" }, { label: "(724) Pennsylvania",               value: "724" },
            { label: "(725) Nevada",                    value: "725" }, { label: "(726) Texas",                      value: "726" }, { label: "(727) Florida",                    value: "727" }, { label: "(731) Tennessee",                  value: "731" }, { label: "(732) New Jersey",                 value: "732" },
            { label: "(734) Michigan",                  value: "734" }, { label: "(737) Texas",                      value: "737" }, { label: "(740) Ohio",                       value: "740" }, { label: "(742) Hamilton, Canada",           value: "742" }, { label: "(743) North Carolina",             value: "743" },
            { label: "(747) California",                value: "747" }, { label: "(753) Ottawa, Canada",             value: "753" }, { label: "(754) Florida",                    value: "754" }, { label: "(757) Virginia",                   value: "757" }, { label: "(760) California",                 value: "760" },
            { label: "(762) Georgia",                   value: "762" }, { label: "(763) Minnesota",                  value: "763" }, { label: "(765) Indiana",                    value: "765" }, { label: "(769) Mississippi",                value: "769" }, { label: "(770) Georgia",                    value: "770" },
            { label: "(771) Washington DC",             value: "771" }, { label: "(772) Florida",                    value: "772" }, { label: "(773) Illinois",                   value: "773" }, { label: "(774) Massachusetts",              value: "774" }, { label: "(775) Nevada",                     value: "775" },
            { label: "(778) British Columbia, Canada",  value: "778" }, { label: "(779) Illinois",                   value: "779" }, { label: "(780) Alberta, Canada",            value: "780" }, { label: "(781) Massachusetts",              value: "781" }, { label: "(782) Nova Scotia, Canada",        value: "782" },
            { label: "(785) Kansas",                    value: "785" }, { label: "(786) Florida",                    value: "786" }, { label: "(787) Puerto Rico",                value: "787" }, { label: "(800) Toll-free",                  value: "800" }, { label: "(801) Utah",                       value: "801" },
            { label: "(802) Vermont",                   value: "802" }, { label: "(803) South Carolina",             value: "803" }, { label: "(804) Virginia",                   value: "804" }, { label: "(805) California",                 value: "805" }, { label: "(806) Texas",                      value: "806" },
            { label: "(807) Ontario, Canada",           value: "807" }, { label: "(808) Hawaii",                     value: "808" }, { label: "(810) Michigan",                   value: "810" }, { label: "(812) Indiana",                    value: "812" }, { label: "(813) Florida",                    value: "813" },
            { label: "(814) Pennsylvania",              value: "814" }, { label: "(815) Illinois",                   value: "815" }, { label: "(816) Missouri",                   value: "816" }, { label: "(817) Texas",                      value: "817" }, { label: "(818) California",                 value: "818" },
            { label: "(819) Quebec, Canada",            value: "819" }, { label: "(820) California",                 value: "820" }, { label: "(825) Calgary, Canada",            value: "825" }, { label: "(826) Virginia",                   value: "826" }, { label: "(828) North Carolina",             value: "828" },
            { label: "(830) Texas",                     value: "830" }, { label: "(831) California",                 value: "831" }, { label: "(832) Texas",                      value: "832" }, { label: "(833) Toll-free",                  value: "833" }, { label: "(835) Pennsylvania",               value: "835" },
            { label: "(838) New York",                  value: "838" }, { label: "(839) South Carolina",             value: "839" }, { label: "(840) California",                 value: "840" }, { label: "(843) South Carolina",             value: "843" }, { label: "(844) Toll-free",                  value: "844" },
            { label: "(845) New York",                  value: "845" }, { label: "(847) Illinois",                   value: "847" }, { label: "(848) New Jersey",                 value: "848" }, { label: "(850) Florida",                    value: "850" }, { label: "(854) South Carolina",             value: "854" },
            { label: "(855) Toll-free",                 value: "855" }, { label: "(856) New Jersey",                 value: "856" }, { label: "(857) Massachusetts",              value: "857" }, { label: "(858) California",                 value: "858" }, { label: "(859) Kentucky",                   value: "859" },
            { label: "(860) Connecticut",               value: "860" }, { label: "(862) New Jersey",                 value: "862" }, { label: "(863) Florida",                    value: "863" }, { label: "(864) South Carolina",             value: "864" }, { label: "(865) Tennessee",                  value: "865" },
            { label: "(866) Toll-free",                 value: "866" }, { label: "(867) Yukon, Canada",              value: "867" }, { label: "(870) Arkansas",                   value: "870" }, { label: "(872) Illinois",                   value: "872" }, { label: "(873) Quebec, Canada",             value: "873" },
            { label: "(877) Toll-free",                 value: "877" }, { label: "(878) Pennsylvania",               value: "878" }, { label: "(888) Toll-free",                  value: "888" }, { label: "(901) Tennessee",                  value: "901" }, { label: "(902) Nova Scotia, Canada",        value: "902" },
            { label: "(903) Texas",                     value: "903" }, { label: "(904) Florida",                    value: "904" }, { label: "(905) Ontario, Canada",            value: "905" }, { label: "(906) Michigan",                   value: "906" }, { label: "(907) Alaska",                     value: "907" },
            { label: "(908) New Jersey",                value: "908" }, { label: "(909) California",                 value: "909" }, { label: "(910) North Carolina",             value: "910" }, { label: "(912) Georgia",                    value: "912" }, { label: "(913) Kansas",                     value: "913" },
            { label: "(914) New York",                  value: "914" }, { label: "(915) Texas",                      value: "915" }, { label: "(916) California",                 value: "916" }, { label: "(917) New York",                   value: "917" }, { label: "(918) Oklahoma",                   value: "918" },
            { label: "(919) North Carolina",            value: "919" }, { label: "(920) Wisconsin",                  value: "920" }, { label: "(925) California",                 value: "925" }, { label: "(928) Arizona",                    value: "928" }, { label: "(929) New York",                   value: "929" },
            { label: "(930) Indiana",                   value: "930" }, { label: "(931) Tennessee",                  value: "931" }, { label: "(934) New York",                   value: "934" }, { label: "(936) Texas",                      value: "936" }, { label: "(937) Ohio",                       value: "937" },
            { label: "(938) Alabama",                   value: "938" }, { label: "(939) Puerto Rico",                value: "939" }, { label: "(940) Texas",                      value: "940" }, { label: "(941) Florida",                    value: "941" }, { label: "(943) Georgia",                    value: "943" },
            { label: "(945) Texas",                     value: "945" }, { label: "(947) Michigan",                   value: "947" }, { label: "(948) Virginia",                   value: "948" }, { label: "(949) California",                 value: "949" }, { label: "(951) California",                 value: "951" },
            { label: "(952) Minnesota",                 value: "952" }, { label: "(954) Florida",                    value: "954" }, { label: "(956) Texas",                      value: "956" }, { label: "(959) Connecticut",                value: "959" }, { label: "(970) Colorado",                   value: "970" },
            { label: "(971) Oregon",                    value: "971" }, { label: "(972) Texas",                      value: "972" }, { label: "(973) New Jersey",                 value: "973" }, { label: "(978) Massachusetts",              value: "978" }, { label: "(979) Texas",                      value: "979" },
            { label: "(980) North Carolina",            value: "980" }, { label: "(983) Colorado",                   value: "983" }, { label: "(984) North Carolina",             value: "984" }, { label: "(985) Louisiana",                  value: "985" }, { label: "(986) Idaho",                      value: "986" },
            { label: "(989) Michigan",                  value: "989" },
        ];

    export const STATES_LIST : Array<LocaleService.Choice> = Object.entries( STATES ).map( ( [value, label] ) => ( { value, label } ) );


    export const COUNTRIES : Record<string, string> = {
            US: "United States",
            CA: "Canada",
        };

    export const COUNTRIES_LIST : Array<LocaleService.Choice> = Object.entries( COUNTRIES ).map( ( [value, label] ) => ( { value, label } ) );

}

export default LocaleService;
