//
import sanitizeHtml from "sanitize-html";

//
// SvgSanitizer — the server-side trust boundary for ANY SVG markup entering the platform (direct upload,
// Browse provider import, or a doc's `Asset.embedded` on save/export). Raw SVG can carry <script>, on*
// event handlers, external <image>/<use> references — a real XSS surface once inlined as native markup
// (unlike an opaque <image href>, inlined markup runs in-document). Strips to a safe structural/shape/text
// subset, but keeps <use>/<style>/inline-style/gradient-href reuse (common in Illustrator/Figma exports —
// a gradient inheriting its stops via xlink:href, a class-based `fill:url(#…)` in a <style> block, or a
// <stop> coloring itself via `style="stop-color:…"` rather than the stop-color attribute) by validating
// those references rather than forbidding the feature outright: an invalid or missing gradient/clipPath
// reference falls back to solid black per the SVG spec, which is exactly what unconditionally forbidding
// <use>/<style>/href/style produced before this file.
//
export class SvgSanitizer
{
    // structural/shape/text/gradient/reuse elements — still no <script>, <foreignObject>, <iframe>, or
    // <image> (a genuine external-reference vector); <use> and <style> are allowed because exported logos
    // commonly rely on them, but their reference attributes/CSS content are validated in sanitize() below
    private static readonly ALLOWED_TAGS : Array<string> =
    [
        "svg", "g", "path", "rect", "circle", "ellipse", "line", "polygon", "polyline",
        "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask",
        "text", "tspan", "title", "desc", "symbol", "pattern", "use", "style",
    ];

    // presentation/geometry attributes — no event handlers (onload, onclick, …); href/xlink:href are NOT
    // listed here — they're only granted to REF_TAGS below, and even then only as a same-document fragment
    // ref. "style" IS listed — it's a common carrier of stop-color/fill/clip-path in exported logos — but its
    // value is scrubbed of external CSS references by sanitizeAttribs() below before it's ever kept.
    private static readonly ALLOWED_ATTRIBUTES : Array<string> =
    [
        "id", "class", "style", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
        "width", "height", "points", "transform", "viewBox", "preserveAspectRatio", "xmlns", "version",
        "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
        "stroke-dasharray", "stroke-opacity", "opacity", "clip-path", "clip-rule", "mask",
        "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline",
        "letter-spacing", "gradientTransform", "gradientUnits", "offset", "stop-color", "stop-opacity",
    ];

    // tags whose href/xlink:href is a legitimate same-document reference: <use> instancing a <defs> shape,
    // or a gradient inheriting another gradient's <stop>s. Every other tag never gets the attribute at all.
    private static readonly REF_TAGS : Array<string> = [ "use", "linearGradient", "radialGradient" ];

    // href/xlink:href are only ever meaningful as a same-document reference in this sanitizer's model
    private static readonly REF_ATTRIBUTES : Array<string> = [ "href", "xlink:href" ];

    // a bare same-document fragment reference only, e.g. "#SVGID_1_" — never a scheme, host, or path
    private static readonly FRAGMENT_REF : RegExp = /^#[A-Za-z_][\w:.-]*$/;

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Scrub external references out of a raw CSS string (a <style> block's content, or a `style="…"`
     *  attribute value) — url()/@import survive only when the url() target is a same-document fragment
     *  (e.g. `url(#SVGID_3_)`, a gradient/clipPath paint reference). */
    private static scrubCss( css : string ) : string
    {
        return css
            .replace( /@import[^;]*;?/gi, "" )
            .replace( /url\(\s*(?!['"]?#)[^)]*\)/gi, "none" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Scrub external CSS references out of every <style> block's content, before the DOM parse — the
     *  attribute-level scrub in sanitizeAttribs() below can't reach text content, only attribute values. */
    private static stripStyleBlocks( raw : string ) : string
    {
        return raw.replace(
            /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
            ( _match : string, open : string, body : string, close : string ) : string =>
                `${ open }${ SvgSanitizer.scrubCss( body ) }${ close }`,
        );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** transformTags wildcard handler — scrubs external CSS out of every tag's `style` attribute, and
     *  restricts href/xlink:href to a same-document fragment ref on REF_TAGS (dropped everywhere else). */
    private static sanitizeAttribs( tagName : string, attribs : sanitizeHtml.Attributes ) : sanitizeHtml.Tag
    {
        const cleaned : sanitizeHtml.Attributes = { ...attribs };
        if( cleaned[ "style" ] !== undefined )
        {
            cleaned[ "style" ] = SvgSanitizer.scrubCss( cleaned[ "style" ] );
        }
        const keepRefAttrs : boolean = SvgSanitizer.REF_TAGS.includes( tagName );
        for( const refAttr of SvgSanitizer.REF_ATTRIBUTES )
        {
            const value : string | undefined = cleaned[ refAttr ];
            const isValidRef : boolean = keepRefAttrs && value !== undefined && SvgSanitizer.FRAGMENT_REF.test( value );
            if( value !== undefined && !isValidRef )
            {
                delete cleaned[ refAttr ];
            }
        }
        return { tagName, attribs: cleaned };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Sanitize raw SVG markup down to a safe structural/shape/text/reuse subset. Never throws — an
     *  unparsable or fully-stripped input just returns an empty/minimal string, which callers should
     *  treat as a failure. */
    public static sanitize( raw : string ) : string
    {
        // grant href/xlink:href, whose validity is enforced by sanitizeAttribs(), only to REF_TAGS
        const allowedAttributes : Record<string, Array<string>> = { "*": SvgSanitizer.ALLOWED_ATTRIBUTES };
        for( const tag of SvgSanitizer.REF_TAGS )
        {
            allowedAttributes[ tag ] = [ ...SvgSanitizer.ALLOWED_ATTRIBUTES, ...SvgSanitizer.REF_ATTRIBUTES ];
        }

        return sanitizeHtml( SvgSanitizer.stripStyleBlocks( raw ), {
            allowedTags: SvgSanitizer.ALLOWED_TAGS,
            allowedAttributes,
            allowedSchemes: [],           // belt+suspenders — a fragment-only ref has no scheme to check anyway
            allowProtocolRelative: false, // also reject "//host/…" refs, which carry no explicit scheme
            transformTags: { "*": SvgSanitizer.sanitizeAttribs },
            disallowedTagsMode: "discard",
            // <style> is a real XSS surface in general (arbitrary CSS-driven exfiltration via url()) — accepted
            // here because stripStyleBlocks()/sanitizeAttribs() above scrub every url()/@import down to
            // same-document fragment refs only, and no <script>/event-handler ever reaches this far regardless
            allowVulnerableTags: true,
            // SVG element/attribute names are case-sensitive (linearGradient, clipPath, viewBox, …) — sanitize-html
            // lowercases by default (an HTML assumption), which would silently break every camelCase SVG name
            parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
        } );
    }
}

export default SvgSanitizer;
// eof
