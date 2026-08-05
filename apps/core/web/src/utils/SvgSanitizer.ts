//
import DOMPurify, { UponSanitizeAttributeHookEvent } from "dompurify";

//
// SvgSanitizer — a first client-side pass over raw SVG markup before it's embedded into a doc (direct file
// import) or previewed. This is NOT the trust boundary — the media service's SvgSanitizer (Node/sanitize-html)
// re-sanitizes on save/export; this pass just gives the user immediate feedback and keeps obviously-bad
// markup out of the live canvas. Mirrors the server policy's shape as closely as DOMPurify's config surface
// allows: <use>/<style>/gradient-href/inline-style reuse is kept (Illustrator/Figma exports commonly rely on
// it — an invalid or missing gradient/clipPath reference falls back to solid black per the SVG spec, which
// is what unconditionally forbidding <use>/<style>/href produced before this file), but every href/xlink:href
// is validated down to a same-document fragment ref, and every style value is scrubbed of external CSS
// references, via an uponSanitizeAttribute hook.
//
export class SvgSanitizer
{
    // href/xlink:href only ever survive on these tags — <use> instancing a <defs> shape, or a gradient
    // inheriting another gradient's <stop>s — and only as a same-document fragment ref, never elsewhere
    private static readonly REF_TAGS : Array<string> = [ "use", "linearGradient", "radialGradient" ];

    // a bare same-document fragment reference only, e.g. "#SVGID_1_" — never a scheme, host, or path
    private static readonly FRAGMENT_REF : RegExp = /^#[A-Za-z_][\w:.-]*$/;

    // DOMPurify hooks are registered process-global — guard so repeated sanitize() calls don't stack duplicates
    private static hookRegistered : boolean = false;

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
    /** Register the DOMPurify hook that restricts href/xlink:href to a same-document fragment ref on
     *  REF_TAGS (stripped everywhere else), and scrubs external CSS out of every `style` attribute value.
     *  Idempotent — safe to call from every sanitize(). */
    private static ensureAttributeHook() : void
    {
        if( SvgSanitizer.hookRegistered )
        {
            return;
        }
        DOMPurify.addHook( "uponSanitizeAttribute", ( node : Element, data : UponSanitizeAttributeHookEvent ) : void =>
        {
            if( data.attrName === "style" )
            {
                data.attrValue = SvgSanitizer.scrubCss( data.attrValue );
                return;
            }
            const isRefAttr : boolean = data.attrName === "href" || data.attrName === "xlink:href";
            if( !isRefAttr )
            {
                return;
            }
            const tagName : string = node.tagName.toLowerCase();
            const isRefTag : boolean = SvgSanitizer.REF_TAGS.includes( tagName );
            data.keepAttr = isRefTag && SvgSanitizer.FRAGMENT_REF.test( data.attrValue );
        } );
        SvgSanitizer.hookRegistered = true;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Scrub external CSS references out of every <style> block's content, before DOMPurify's DOM parse —
     *  the attribute-level scrub in the hook above can't reach text content, only attribute values. */
    private static stripStyleBlocks( raw : string ) : string
    {
        return raw.replace(
            /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
            ( _match : string, open : string, body : string, close : string ) : string =>
                `${ open }${ SvgSanitizer.scrubCss( body ) }${ close }`,
        );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Sanitize raw SVG markup for safe client-side embedding/preview. Never throws. */
    public static sanitize( raw : string ) : string
    {
        SvgSanitizer.ensureAttributeHook();
        // event handler attributes (onload, onclick, …) are always stripped by DOMPurify's core sanitization —
        // no config needed for those; FORBID_TAGS below keeps out the remaining genuine external-reference
        // vectors, and the hook registered above gates href/xlink:href + scrubs style attribute values
        return DOMPurify.sanitize( SvgSanitizer.stripStyleBlocks( raw ), {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: [ "script", "foreignObject", "image", "iframe" ],
        } );
    }
}

export default SvgSanitizer;
// eof
