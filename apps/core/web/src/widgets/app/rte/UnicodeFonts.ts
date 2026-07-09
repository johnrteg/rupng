// =============================================================================
// UnicodeFonts.ts
//
// Table-driven Unicode font system.
//
// Each font entry maps A–Z, a–z, and optionally 0–9 to their styled Unicode
// codepoints.  Sparse/irregular blocks (script, fraktur, etc.) use explicit
// 26-element arrays; regular blocks use makeRange() to generate them from a
// base offset.
//
// Adding a new style = one new entry in FONTS.  No new functions needed.
// =============================================================================

export interface UnicodeFontMap
{
    upper   : Array<number>;    // 26 codepoints for A–Z
    lower   : Array<number>;    // 26 codepoints for a–z
    digits? : Array<number>;    // 10 codepoints for 0–9 (optional)
}

export interface UnicodeFontChoice
{
    value : string;
    label : string;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////
function makeRange( base : number, count : number, overrides : Record<number, number> = {} ) : Array<number>
{
    return Array.from( { length: count }, ( _, i ) => overrides[i] !== undefined ? overrides[i] : base + i );
}

// =============================================================================
export class UnicodeFonts
{
    // key for the plain / un-styled font: has no Unicode mapping, just strips back to ASCII
    static readonly NORMAL : string = 'normal';

    // font table
    static readonly FONTS : Record<string, UnicodeFontMap> =
    {
        //                                  A-Z base       a-z base       overrides (index → codepoint)
        bold:             { upper: makeRange( 0x1D400, 26 ), lower: makeRange( 0x1D41A, 26 ), digits: makeRange( 0x1D7CE, 10 ) },
        italic:           { upper: makeRange( 0x1D434, 26 ), lower: makeRange( 0x1D44E, 26, { 7: 0x210E } ) },   // h gap → U+210E
        bold_italic:      { upper: makeRange( 0x1D468, 26 ), lower: makeRange( 0x1D482, 26 ) },
        sans:             { upper: makeRange( 0x1D5A0, 26 ), lower: makeRange( 0x1D5BA, 26 ), digits: makeRange( 0x1D7E2, 10 ) },
        sans_bold:        { upper: makeRange( 0x1D5D4, 26 ), lower: makeRange( 0x1D5EE, 26 ), digits: makeRange( 0x1D7EC, 10 ) },
        sans_italic:      { upper: makeRange( 0x1D608, 26 ), lower: makeRange( 0x1D622, 26 ) },
        sans_bold_italic: { upper: makeRange( 0x1D63C, 26 ), lower: makeRange( 0x1D656, 26 ) },
        mono:             { upper: makeRange( 0x1D670, 26 ), lower: makeRange( 0x1D68A, 26 ), digits: makeRange( 0x1D7F6, 10 ) },
        double:           { upper: makeRange( 0x1D538, 26, { 2:0x2102, 7:0x210D, 14:0x2115, 15:0x2119, 16:0x211A, 17:0x211D, 25:0x2124 } ),
                            lower: makeRange( 0x1D552, 26 ), digits: makeRange( 0x1D7D8, 10 ) },
        fraktur:          { upper: makeRange( 0x1D504, 26, { 2:0x212D, 7:0x210C, 8:0x2111, 17:0x211C, 25:0x2128 } ),
                            lower: makeRange( 0x1D51E, 26 ) },
        bold_fraktur:     { upper: makeRange( 0x1D56C, 26 ), lower: makeRange( 0x1D586, 26 ) },
        script:           { upper: [ 0x1D49C,0x212C,0x1D49E,0x1D49F,0x2130,0x2131,0x1D4A2,0x210B,0x2110,0x1D4A5,
                                      0x1D4A6,0x2112,0x2133,0x1D4A9,0x1D4AA,0x1D4AB,0x1D4AC,0x211B,0x1D4AE,0x1D4AF,
                                      0x1D4B0,0x1D4B1,0x1D4B2,0x1D4B3,0x1D4B4,0x1D4B5 ],
                            lower: [ 0x1D4B6,0x1D4B7,0x1D4B8,0x1D4B9,0x212F,0x1D4BB,0x210A,0x1D4BD,0x1D4BE,0x1D4BF,
                                      0x1D4C0,0x1D4C1,0x1D4C2,0x1D4C3,0x2134,0x1D4C5,0x1D4C6,0x1D4C7,0x1D4C8,0x1D4C9,
                                      0x1D4CA,0x1D4CB,0x1D4CC,0x1D4CD,0x1D4CE,0x1D4CF ] },
        bold_script:      { upper: makeRange( 0x1D4D0, 26 ), lower: makeRange( 0x1D4EA, 26 ) },
        full_width:       { upper: makeRange( 0xFF21, 26 ),  lower: makeRange( 0xFF41, 26 ),  digits: makeRange( 0xFF10, 10 ) },
        bubble:           { upper: makeRange( 0x24B6, 26 ),  lower: makeRange( 0x24D0, 26 ),
                            digits: [ 0x24EA, 0x2460, 0x2461, 0x2462, 0x2463, 0x2464, 0x2465, 0x2466, 0x2467, 0x2468 ] },
        black_bubble:     { upper: makeRange( 0x1F150, 26 ), lower: makeRange( 0x1F150, 26 ) },
        square:           { upper: makeRange( 0x1F130, 26 ), lower: makeRange( 0x1F130, 26 ) },
        black_square:     { upper: makeRange( 0x1F170, 26 ), lower: makeRange( 0x1F170, 26 ) },
        small_caps:       { upper: [ 0x1D00,0x0299,0x1D04,0x1D05,0x1D07,0xA730,0x0262,0x029C,0x026A,0x1D0A,
                                      0x1D0B,0x029F,0x1D0D,0x0274,0x1D0F,0x1D18,0xA76F,0x0280,0xA731,0x1D1B,
                                      0x1D1C,0x1D20,0x1D21,0x1D61,0x028F,0x1D22 ],
                            lower: [ 0x1D00,0x0299,0x1D04,0x1D05,0x1D07,0xA730,0x0262,0x029C,0x026A,0x1D0A,
                                      0x1D0B,0x029F,0x1D0D,0x0274,0x1D0F,0x1D18,0xA76F,0x0280,0xA731,0x1D1B,
                                      0x1D1C,0x1D20,0x1D21,0x1D61,0x028F,0x1D22 ] },
    };

    //
    // ── dropdown choices (value + preview label in that font) ─────────────────
    //
    static readonly CHOICES : Array<UnicodeFontChoice> =
    [
        { value: UnicodeFonts.NORMAL, label: 'Normal' },
        { value: 'bold',              label: '𝐁𝐨𝐥𝐝' },
        { value: 'italic',            label: '𝐼𝑡𝑎𝑙𝑖𝑐' },
        { value: 'bold_italic',       label: '𝑩𝒐𝒍𝒅 𝑰𝒕𝒂𝒍𝒊𝒄' },
        { value: 'script',            label: '𝒮𝒸𝓇𝒾𝓅𝓉' },
        { value: 'bold_script',       label: '𝓑𝓸𝓵𝓭 𝓢𝓬𝓻𝓲𝓹𝓽' },
        { value: 'fraktur',           label: '𝔉𝔯𝔞𝔨𝔱𝔲𝔯' },
        { value: 'bold_fraktur',      label: '𝕱𝖗𝖆𝖐𝖙𝖚𝖗 𝕭𝖔𝖑𝖉' },
        { value: 'double',            label: '𝔻𝕠𝕦𝕓𝕝𝕖' },
        { value: 'sans',              label: '𝖲𝖺𝗇𝗌' },
        { value: 'sans_bold',         label: '𝗦𝗮𝗻𝘀 𝗕𝗼𝗹𝗱' },
        { value: 'sans_italic',       label: '𝘚𝘢𝘯𝘴 𝘐𝘵𝘢𝘭𝘪𝘤' },
        { value: 'sans_bold_italic',  label: '𝙎𝙖𝙣𝙨 𝘽𝙤𝙡𝙙 𝙄𝙩𝙖𝙡𝙞𝙘' },
        { value: 'mono',              label: '𝙼𝚘𝚗𝚘' },
        { value: 'small_caps',        label: 'Sᴍᴀʟʟ Cᴀᴘs' },
        { value: 'full_width',        label: 'Ｆｕｌｌ Ｗｉｄｔｈ' },
        { value: 'bubble',            label: 'Ⓑⓤⓑⓑⓛⓔ' },
        { value: 'black_bubble',      label: '🅑🅛🅐🅒🅚' },
        { value: 'square',            label: '🅂🅀🅄🄰🅁🄴' },
        { value: 'black_square',      label: '🆂🆀🆄🅰🆁🅴' },
    ];

    //
    // ── reverse lookup: codepoint → ASCII char
    //
    static readonly REVERSE : Map<number, string> = UnicodeFonts._buildReverse();

    private static _buildReverse() : Map<number, string>
    {
        const map : Map<number, string> = new Map<number, string>();
        Object.values( UnicodeFonts.FONTS ).forEach( ( font ) =>
        {
            font.upper.forEach(  ( cp, i ) => map.set( cp, String.fromCodePoint( 0x41 + i ) ) );
            font.lower.forEach(  ( cp, i ) => map.set( cp, String.fromCodePoint( 0x61 + i ) ) );
            font.digits?.forEach(( cp, i ) => map.set( cp, String.fromCodePoint( 0x30 + i ) ) );
        } );
        return map;
    }


    ///////////////////////////////////////////////////////////////////////////////////////
    /** Convert ASCII text to the given font style. */
    static toFont( text : string, fontKey : string ) : string
    {
        // "normal" has no Unicode mapping - strip any existing styling back to plain ASCII
        if( fontKey === UnicodeFonts.NORMAL ) return UnicodeFonts.toAscii( text );

        const font = UnicodeFonts.FONTS[ fontKey ];
        if( !font ) return text;
        return Array.from( text ).map( ( ch ) =>
        {
            const code = ch.codePointAt(0) ?? 0;
            if( code >= 0x41 && code <= 0x5A ) return String.fromCodePoint( font.upper[ code - 0x41 ] );
            if( code >= 0x61 && code <= 0x7A ) return String.fromCodePoint( font.lower[ code - 0x61 ] );
            if( font.digits && code >= 0x30 && code <= 0x39 ) return String.fromCodePoint( font.digits[ code - 0x30 ] );
            return ch;
        } ).join('');
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Strip all known Unicode font styling from text, returning plain ASCII. */
    static toAscii( text : string ) : string
    {
        return Array.from( text ).map( ( ch ) =>
        {
            const code : number | undefined = ch.codePointAt(0) ?? 0;
            if( code <= 0x7F ) return ch;
            return UnicodeFonts.REVERSE.get( code ) ?? ch;
        } ).join('');
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * Remove all known Unicode font characters, with several exceptions that are normalized to a
     * close ASCII equivalent rather than dropped:
     *   - any Unicode space separator (NBSP, en/em/thin space, etc.) -> a single ASCII space
     *   - any Unicode dash (en dash, em dash, figure dash, etc.)      -> a single ASCII hyphen
     *   - accented Latin letters (é, ï, ç, ñ, ü, …)                   -> their base letter (e, i, c, n, u)
     * ASCII control characters (newlines, tabs) are preserved as-is. Anything with no ASCII
     * representation (emoji, ★, €, non-Latin scripts) is dropped.
     */
    static removeAll( text : string ) : string
    {
        return Array.from( text ).map( ( ch ) =>
        {
            const code : number | undefined = ch.codePointAt(0) ?? 0;
            if( code <= 0x7F ) return ch;   // plain ASCII incl. \n, \r, \t — keep verbatim

            // always strip the Hangul Filler (U+3164) - an invisible "blank" character
            if( code === 0x3164 ) return '';

            // normalize unicode spaces and dashes instead of dropping them
            // https://www.compart.com/en/unicode/category/Zs
            if( /\p{Zs}/u.test( ch ) ) return ' ';
            if( /\p{Pd}/u.test( ch ) ) return '-';

            // known styled font glyph -> its ASCII letter/digit
            const known : string | undefined = UnicodeFonts.REVERSE.get( code );
            if( known !== undefined ) return known;

            // fold accents: decompose (NFD), drop combining marks, keep only what's left if ASCII
            // ( é -> "e" + ◌́ -> "e" ).  No ASCII remains for emoji/symbols/other scripts -> dropped.
            return ch.normalize( 'NFD' ).replace( /\p{M}/gu, '' ).replace( /[^\x00-\x7F]/g, '' );
        } ).join('');
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Returns true if any character in text belongs to the given font. */
    static isFont( text : string, fontKey : string ) : boolean
    {
        // "normal" is active when the text carries no known font styling at all
        if( fontKey === UnicodeFonts.NORMAL )
            return !Array.from( text ).some( ( ch ) => UnicodeFonts.REVERSE.has( ch.codePointAt(0) ?? -1 ) );

        const font = UnicodeFonts.FONTS[ fontKey ];
        if( !font ) return false;
        const set : Set<number> = new Set<number>( [ ...font.upper, ...font.lower, ...( font.digits ?? [] ) ] );
        return Array.from( text ).some( ( ch ) => set.has( ch.codePointAt(0) ?? 0 ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * Apply fontKey to text: if the text is already in that font, toggle it
     * back to ASCII; otherwise normalise any existing font first then apply.
     */
    static applyFont( text : string, fontKey : string ) : string
    {
        const ascii : string = UnicodeFonts.toAscii( text );
        if( UnicodeFonts.isFont( text, fontKey ) ) return ascii;   // toggle off
        return UnicodeFonts.toFont( ascii, fontKey );
    }
}

export default UnicodeFonts;
