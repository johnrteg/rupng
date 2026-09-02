//
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";

import { Print } from "@repo/api";

//
// ProofRenderer — a pure, no-dependency PDF proof builder (print-1.1/1.4). This is the "own-render" PROOF path
// (print-3.5's back-pocket option, used here for the author-time preview since v1 otherwise BUYS provider
// templates — SPECS.md gap #4): merges `mergeData` into the template's schema (a simple label/value block,
// NOT the full SVG-canvas designer yet) plus the address block, laid out to the physical dimensions + bleed/
// safe-zone insets for the mailpiece `type`. NOT press-final (no CMYK profile step — print-1.1's checklist
// item 3 — that's the documented `PrintRenderJob` backend step once own-render graduates past proofing).
//
export class ProofRenderer
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Render one proof PDF for a template + merge data + (optional) recipient address block. Never throws —
     *  pdf-lib's API is synchronous/pure aside from the final serialize, so a malformed schema just renders a
     *  sparser page rather than failing the job. */
    public static async render( type : Print.MailpieceType, template : Print.Template, mergeData : Record<string, unknown>, recipient? : Print.Address ) : Promise<Uint8Array>
    {
        const dims : ProofRenderer.Dimensions = ProofRenderer.DIMENSIONS[ type ];
        const doc : PDFDocument = await PDFDocument.create();
        const font : PDFFont = await doc.embedFont( StandardFonts.Helvetica );
        const boldFont : PDFFont = await doc.embedFont( StandardFonts.HelveticaBold );

        // canvas sized to TRIM + bleed on every edge (print-1.1's checklist item 1 — physical units, here
        // PDF points at 72/in, matching pdf-lib's native unit)
        const pageWidth : number = ( dims.widthIn + 2 * ProofRenderer.BLEED_IN ) * 72;
        const pageHeight : number = ( dims.heightIn + 2 * ProofRenderer.BLEED_IN ) * 72;
        const page : PDFPage = doc.addPage( [ pageWidth, pageHeight ] );

        const safeIn : number = ProofRenderer.BLEED_IN + ProofRenderer.SAFE_IN;
        const safeX : number = safeIn * 72;
        let cursorY : number = pageHeight - safeIn * 72;

        // title
        page.drawText( template.name, { x: safeX, y: cursorY, size: 16, font: boldFont, color: rgb( 0.1, 0.1, 0.1 ) } );
        cursorY -= 24;

        // merged field lines — a simple label:value block (the full SVG-canvas compile is a documented
        // follow-up; this proof exists so authors see SOMETHING real, not a placeholder)
        for( const [ key, value ] of Object.entries( mergeData ) )
        {
            if( cursorY < safeIn * 72 + 40 ) break;   // ran out of safe-zone room — truncate rather than overflow the bleed
            page.drawText( `${ key }: ${ String( value ) }`, { x: safeX, y: cursorY, size: 10, font, color: rgb( 0.2, 0.2, 0.2 ) } );
            cursorY -= 14;
        }

        // recipient address block, bottom-left of the safe zone (postcard/letter convention)
        if( recipient !== undefined )
        {
            const lines : Array<string> = ProofRenderer.addressLines( recipient );
            let addressY : number = safeIn * 72 + lines.length * 12;
            for( const line of lines )
            {
                page.drawText( line, { x: safeX, y: addressY, size: 10, font, color: rgb( 0, 0, 0 ) } );
                addressY -= 12;
            }
        }

        return doc.save();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private static addressLines( address : Print.Address ) : Array<string>
    {
        const lines : Array<string> = [];
        if( address.name ) lines.push( address.name );
        lines.push( address.line1 );
        if( address.line2 ) lines.push( address.line2 );
        lines.push( `${ address.city }, ${ address.region } ${ address.postalCode }` );
        return lines;
    }

    // print-1.1's checklist: 0.125in bleed past trim, 0.25in safe zone inside trim
    private static readonly BLEED_IN : number = 0.125;
    private static readonly SAFE_IN : number = 0.25;

    // TRIM dimensions per mailpiece type (print-1.1's "physical dimensions per type")
    private static readonly DIMENSIONS : Record<Print.MailpieceType, ProofRenderer.Dimensions> =
    {
        [ Print.MailpieceType.POSTCARD ]:    { widthIn: 6,   heightIn: 4 },
        [ Print.MailpieceType.LETTER ]:      { widthIn: 8.5, heightIn: 11 },
        [ Print.MailpieceType.SELF_MAILER ]: { widthIn: 8.5, heightIn: 11 },
        [ Print.MailpieceType.CHECK ]:       { widthIn: 8.5, heightIn: 3.5 },
    };
}

export namespace ProofRenderer
{
    export interface Dimensions { widthIn : number; heightIn : number; }
}

export default ProofRenderer;
// eof
