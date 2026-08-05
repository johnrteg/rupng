//
import { SvgAsset } from "@repo/api";

//
// SvgThreatScanner — the pre-sanitize gate for SVG library uploads (SvgAssetService.create()). SvgSanitizer
// silently strips disallowed markup and continues sanitizing whatever's left; that's the right behavior for
// a save/export re-sanitize pass, but a library upload arriving with a real attack payload (a <script>, an
// event handler, an external network reference) shouldn't be silently rewritten and stored — the uploader
// gets no signal their file was tampered with, and the stored asset now has none of its original intent.
// This scanner instead flags genuine vulnerability markers on the RAW (pre-sanitize) markup so the caller can
// reject the upload outright and quarantine the raw bytes (see SvgAssetService.create()). Constructs
// SvgSanitizer re-legitimizes — same-document <use>/gradient xlink:href, class-based <style>, inline
// style="stop-color:…" — are deliberately NOT flagged here; only what SvgSanitizer would still strip counts.
//
export class SvgThreatScanner
{
    // a <script> element — never a legitimate construct in a static graphic
    private static readonly SCRIPT_TAG : RegExp = /<\s*script\b/i;

    // an on* event handler attribute (onload, onclick, onerror, …)
    private static readonly EVENT_HANDLER_ATTR : RegExp = /\son[a-z]+\s*=/i;

    // <foreignObject>/<iframe>/<image> — arbitrary embedding/external-content vectors with no reuse case
    private static readonly EXTERNAL_EMBED_TAG : RegExp = /<\s*(foreignObject|iframe|image)\b/i;

    // an href/xlink:href value carrying an explicit scheme or a protocol-relative host — never a bare
    // same-document fragment ("#id"), which is the only form SvgSanitizer ever keeps
    private static readonly EXTERNAL_REF_ATTR : RegExp = /(?:xlink:href|href)\s*=\s*["'](?!#)[^"']*["']/i;

    // @import, or a CSS url() target that isn't a same-document fragment — both fetch/leak to an external
    // origin once the SVG is rendered, whether inside a <style> block or an inline style="…" attribute
    private static readonly EXTERNAL_CSS : RegExp = /@import\b|url\(\s*(?!['"]?#)[^)]+\)/i;

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Scan RAW (pre-sanitize) SVG markup for genuine vulnerability markers. Returns the empty array when
     *  the markup is clean; a non-empty array means the caller should reject-and-quarantine rather than
     *  sanitize-and-store. */
    public static scan( raw : string ) : Array<SvgAsset.RejectReason>
    {
        const reasons : Array<SvgAsset.RejectReason> = [];
        if( SvgThreatScanner.SCRIPT_TAG.test( raw ) )
        {
            reasons.push( SvgAsset.RejectReason.SCRIPT );
        }
        if( SvgThreatScanner.EVENT_HANDLER_ATTR.test( raw ) )
        {
            reasons.push( SvgAsset.RejectReason.EVENT_HANDLER );
        }
        if( SvgThreatScanner.EXTERNAL_EMBED_TAG.test( raw ) || SvgThreatScanner.EXTERNAL_REF_ATTR.test( raw ) )
        {
            reasons.push( SvgAsset.RejectReason.EXTERNAL_REFERENCE );
        }
        if( SvgThreatScanner.EXTERNAL_CSS.test( raw ) )
        {
            reasons.push( SvgAsset.RejectReason.EXTERNAL_STYLESHEET );
        }
        return reasons;
    }
}

export default SvgThreatScanner;
// eof
