//
import mjml2html, { type MjmlResult } from "mjml";
import { EmailTemplate } from "@repo/api";

//
// MjmlRenderer — compiles an EmailTemplate block tree (the editor's JSON source of truth) into MJML (the
// portable intermediate) and then into responsive, email-safe HTML using the REAL `mjml` engine (v5), which
// emits the full MJML feature set: Outlook VML fallbacks (background images / heroes), media-query column
// stacking, and every documented component attribute. The three representations mirror media's versioned
// bodies: JSON edits, MJML/HTML regenerate on save/publish. Merge-tag substitution (email-2) runs on the
// compiled HTML + subject just before send.
//
export namespace MjmlRenderer
{
    /** The compiled outputs for a document — both stored on the template entity (S3 version history + DDB). */
    export interface Compiled { mjml : string; html : string; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Compile a template doc → { mjml, html }. ASYNC — the mjml v5 engine returns a Promise. */
    export async function render( doc : EmailTemplate.Doc ) : Promise<Compiled>
    {
        // build the portable MJML, then compile it to responsive HTML through the real engine
        const mjml : string = toMjml( doc );
        const html : string = await compile( mjml );
        return { mjml, html };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Compile an MJML string → responsive HTML via the real mjml engine (soft validation collects problems
     *  rather than throwing; a hard engine failure falls back to a minimal wrapper so callers never throw). */
    export async function compile( mjml : string ) : Promise<string>
    {
        try
        {
            // soft validation: unknown attributes/tags are tolerated (we generate the markup ourselves)
            const result : MjmlResult = await mjml2html( mjml, { validationLevel: "soft", minify: false } );
            return result.html;
        }
        catch( error : unknown )
        {
            // an engine failure must not break preview/publish — emit a minimal, valid HTML document instead
            const message : string = error instanceof Error ? error.message : String( error );
            return `<!doctype html><html><head><meta charset="utf-8"></head><body><!-- mjml compile failed: ${ escapeText( message ) } --></body></html>`;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Build the MJML markup form of the block tree (the portable intermediate — head + body). */
    export function toMjml( doc : EmailTemplate.Doc ) : string
    {
        // wrap the sections in an mj-body sized to the doc settings, preceded by the compiled mj-head
        const width : number = doc.settings.width ?? 600;
        const background : string = str( doc.settings.backgroundColor, "#f4f4f4" );
        const head : string = headMarkup( doc );
        const bodyAttrs : string = attrString( { "width": `${ width }px`, "background-color": background } );
        const body : string = doc.blocks
            .map( ( block : EmailTemplate.Block ) : string => mjmlBlock( block ) )
            .join( "\n" );
        return `<mjml>\n  <mj-head>\n${ head }\n  </mj-head>\n  <mj-body${ bodyAttrs }>\n${ body }\n  </mj-body>\n</mjml>`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Substitute `{{ path }}` merge tags in a string with values from the merge data (dotted paths supported;
     *  an unresolved tag renders empty). Used on the subject + the compiled HTML/text just before send. */
    export function merge( input : string, data : Record<string, unknown> ) : string
    {
        return input.replace( /\{\{\s*([\w.]+)\s*\}\}/g, ( _match : string, path : string ) : string =>
        {
            const value : unknown = resolvePath( data, path );
            return value === undefined || value === null ? "" : String( value );
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── internals ────────────────────────────────────────────────────────────────────────────

    // resolve a dotted path ("contact.firstName") against the merge data
    function resolvePath( data : Record<string, unknown>, path : string ) : unknown
    {
        let current : unknown = data;
        for( const segment of path.split( "." ) )
        {
            if( current === null || typeof current !== "object" ) return undefined;
            current = ( current as Record<string, unknown> )[ segment ];
        }
        return current;
    }

    // read a string block/settings prop with a fallback (props are loose `unknown`)
    function str( value : unknown, fallback : string = "" ) : string { return typeof value === "string" ? value : fallback; }

    // escape a value for an HTML/MJML attribute (double-quoted)
    function escapeAttr( value : string ) : string { return value.replace( /&/g, "&amp;" ).replace( /"/g, "&quot;" ).replace( /</g, "&lt;" ).replace( />/g, "&gt;" ); }
    // escape text content (title / preview / comments)
    function escapeText( value : string ) : string { return value.replace( /&/g, "&amp;" ).replace( /</g, "&lt;" ).replace( />/g, "&gt;" ); }

    // serialize a { name: value } map → ` name="value"` MJML attributes; empty / undefined entries are skipped
    function attrString( attributes : Record<string, string | undefined> ) : string
    {
        const parts : Array<string> = [];
        for( const [ name, value ] of Object.entries( attributes ) )
        {
            if( value === undefined || value === "" ) continue;
            parts.push( ` ${ name }="${ escapeAttr( value ) }"` );
        }
        return parts.join( "" );
    }

    // the dedicated (editor-managed) props of a block mapped to their MJML attribute names — the generic
    // `block.attrs` bag is layered on top (and overrides) so any other MJML attribute is still settable
    function dedicatedAttrs( block : EmailTemplate.Block ) : Record<string, string | undefined>
    {
        const props : Record<string, unknown> = block.props ?? {};
        switch( block.type )
        {
            case EmailTemplate.BlockType.SECTION:
                return { "background-url": str( props.backgroundUrl ) || undefined, "background-size": str( props.backgroundSize ) || undefined, "background-repeat": str( props.backgroundRepeat ) || undefined, "background-position": str( props.backgroundPosition ) || undefined, "background-color": str( props.backgroundColor ) || undefined, "full-width": props.fullWidth === true ? "full-width" : undefined, "padding": str( props.padding ) || undefined };
            case EmailTemplate.BlockType.COLUMN:
                return { "width": str( props.width ) || undefined, "background-color": str( props.backgroundColor ) || undefined, "vertical-align": str( props.verticalAlign ) || undefined, "padding": str( props.padding ) || undefined };
            case EmailTemplate.BlockType.WRAPPER:
                return { "background-url": str( props.backgroundUrl ) || undefined, "background-color": str( props.backgroundColor ) || undefined, "full-width": props.fullWidth === true ? "full-width" : undefined, "padding": str( props.padding ) || undefined };
            case EmailTemplate.BlockType.HERO:
                return { "mode": str( props.mode, "fluid-height" ), "height": str( props.height ) || undefined, "background-url": str( props.backgroundUrl ) || undefined, "background-color": str( props.backgroundColor ) || undefined, "background-position": str( props.backgroundPosition ) || undefined, "vertical-align": str( props.verticalAlign ) || undefined, "padding": str( props.padding ) || undefined };
            case EmailTemplate.BlockType.TEXT:
                return { "color": str( props.color ) || undefined, "font-size": str( props.fontSize ) || undefined, "align": str( props.align ) || undefined, "line-height": str( props.lineHeight ) || undefined };
            case EmailTemplate.BlockType.IMAGE:
                return { "src": str( props.src ), "alt": str( props.alt ) || undefined, "href": str( props.href ) || undefined, "width": str( props.width ) || undefined, "align": str( props.align ) || undefined };
            case EmailTemplate.BlockType.BUTTON:
                return { "href": str( props.href, "#" ), "background-color": str( props.background ) || str( props.backgroundColor ) || undefined, "color": str( props.color ) || undefined, "border-radius": str( props.borderRadius ) || undefined, "align": str( props.align ) || undefined };
            case EmailTemplate.BlockType.DIVIDER:
                return { "border-color": str( props.borderColor ) || undefined, "border-width": str( props.borderWidth ) || undefined };
            case EmailTemplate.BlockType.SPACER:
                return { "height": str( props.height, "20px" ) };
            case EmailTemplate.BlockType.TABLE:
                return { "align": str( props.align ) || undefined, "width": str( props.width ) || undefined };
            case EmailTemplate.BlockType.SOCIAL:
                return { "mode": str( props.mode ) || undefined, "icon-size": str( props.iconSize ) || undefined, "font-size": str( props.fontSize ) || undefined, "align": str( props.align ) || undefined };
            case EmailTemplate.BlockType.SOCIAL_ELEMENT:
                return { "name": str( props.name ) || undefined, "href": str( props.href ) || undefined, "background-color": str( props.backgroundColor ) || undefined };
            case EmailTemplate.BlockType.NAVBAR:
                return { "align": str( props.align ) || undefined };
            case EmailTemplate.BlockType.NAVBAR_LINK:
                return { "href": str( props.href, "#" ), "color": str( props.color ) || undefined };
            case EmailTemplate.BlockType.CAROUSEL:
                return { "icon-width": str( props.iconWidth ) || undefined };
            case EmailTemplate.BlockType.CAROUSEL_IMAGE:
                return { "src": str( props.src ), "href": str( props.href ) || undefined };
            default:
                return {};
        }
    }

    // one block → its MJML element (recurses into children for the container types)
    function mjmlBlock( block : EmailTemplate.Block ) : string
    {
        const props : Record<string, unknown> = block.props ?? {};
        const attrs : string = attrString( { ...dedicatedAttrs( block ), ...( block.attrs ?? {} ) } );
        // container elements render their children; content elements render their prop content
        const children : string = ( block.children ?? [] )
            .map( ( child : EmailTemplate.Block ) : string => mjmlBlock( child ) )
            .join( "\n" );
        switch( block.type )
        {
            case EmailTemplate.BlockType.SECTION:           return `    <mj-section${ attrs }>\n${ children }\n    </mj-section>`;
            case EmailTemplate.BlockType.COLUMN:            return `      <mj-column${ attrs }>\n${ children }\n      </mj-column>`;
            case EmailTemplate.BlockType.GROUP:             return `      <mj-group${ attrs }>\n${ children }\n      </mj-group>`;
            case EmailTemplate.BlockType.WRAPPER:           return `    <mj-wrapper${ attrs }>\n${ children }\n    </mj-wrapper>`;
            case EmailTemplate.BlockType.HERO:              return `    <mj-hero${ attrs }>\n${ children }\n    </mj-hero>`;
            case EmailTemplate.BlockType.TEXT:              return `        <mj-text${ attrs }>${ str( props.html, str( props.text ) ) }</mj-text>`;
            case EmailTemplate.BlockType.IMAGE:             return `        <mj-image${ attrs } />`;
            case EmailTemplate.BlockType.BUTTON:            return `        <mj-button${ attrs }>${ str( props.text ) }</mj-button>`;
            case EmailTemplate.BlockType.DIVIDER:           return `        <mj-divider${ attrs } />`;
            case EmailTemplate.BlockType.SPACER:            return `        <mj-spacer${ attrs } />`;
            case EmailTemplate.BlockType.TABLE:             return `        <mj-table${ attrs }>${ str( props.html ) }</mj-table>`;
            case EmailTemplate.BlockType.SOCIAL:            return `        <mj-social${ attrs }>\n${ children }\n        </mj-social>`;
            case EmailTemplate.BlockType.SOCIAL_ELEMENT:    return `          <mj-social-element${ attrs }>${ str( props.label ) }</mj-social-element>`;
            case EmailTemplate.BlockType.NAVBAR:            return `        <mj-navbar${ attrs }>\n${ children }\n        </mj-navbar>`;
            case EmailTemplate.BlockType.NAVBAR_LINK:       return `          <mj-navbar-link${ attrs }>${ str( props.text ) }</mj-navbar-link>`;
            case EmailTemplate.BlockType.ACCORDION:         return `        <mj-accordion${ attrs }>\n${ children }\n        </mj-accordion>`;
            case EmailTemplate.BlockType.ACCORDION_ELEMENT: return `          <mj-accordion-element${ attrs }><mj-accordion-title>${ str( props.title ) }</mj-accordion-title><mj-accordion-text>${ str( props.text ) }</mj-accordion-text></mj-accordion-element>`;
            case EmailTemplate.BlockType.CAROUSEL:          return `        <mj-carousel${ attrs }>\n${ children }\n        </mj-carousel>`;
            case EmailTemplate.BlockType.CAROUSEL_IMAGE:    return `          <mj-carousel-image${ attrs } />`;
            case EmailTemplate.BlockType.HTML:              return `        <mj-raw>${ str( props.html ) }</mj-raw>`;
            default:                                        return "";
        }
    }

    // build the mj-head markup from the doc head + settings (title, preview, breakpoint, fonts, defaults, styles)
    function headMarkup( doc : EmailTemplate.Doc ) : string
    {
        const head : EmailTemplate.Head = doc.head ?? {};
        const lines : Array<string> = [];
        // title + inbox preview snippet
        if( head.title )   lines.push( `    <mj-title>${ escapeText( head.title ) }</mj-title>` );
        if( head.preview ) lines.push( `    <mj-preview>${ escapeText( head.preview ) }</mj-preview>` );
        // responsive breakpoint (below this width, columns stack)
        if( head.breakpoint ) lines.push( `    <mj-breakpoint width="${ escapeAttr( head.breakpoint ) }" />` );
        // imported web fonts
        for( const font of head.fonts ?? [] )
            lines.push( `    <mj-font name="${ escapeAttr( font.name ) }" href="${ escapeAttr( font.href ) }" />` );
        // global attribute defaults + reusable classes (wrapped in one mj-attributes)
        const attributeBlock : string = attributeDefaults( doc );
        if( attributeBlock !== "" ) lines.push( attributeBlock );
        // raw custom CSS blocks
        for( const css of head.styles ?? [] )
            lines.push( `    <mj-style>${ css }</mj-style>` );
        return lines.join( "\n" );
    }

    // build the mj-attributes element (base font on mj-all + per-component defaults + mj-class definitions)
    function attributeDefaults( doc : EmailTemplate.Doc ) : string
    {
        const head : EmailTemplate.Head = doc.head ?? {};
        const inner : Array<string> = [];
        // seed mj-all with the document base font so every text element inherits it
        const baseFont : string = str( doc.settings.fontFamily, "Arial, sans-serif" );
        inner.push( `      <mj-all${ attrString( { "font-family": baseFont } ) } />` );
        // per-component defaults (component "text" → mj-text, "all" → mj-all, …)
        for( const preset of head.defaults ?? [] )
            inner.push( `      <mj-${ preset.component }${ attrString( preset.attrs ) } />` );
        // reusable classes referenced by a block's `mj-class` attribute
        for( const cssClass of head.classes ?? [] )
            inner.push( `      <mj-class${ attrString( { "name": cssClass.name, ...cssClass.attrs } ) } />` );
        return `    <mj-attributes>\n${ inner.join( "\n" ) }\n    </mj-attributes>`;
    }
}

export default MjmlRenderer;
// eof
