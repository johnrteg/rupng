//
import PDFDocument from "pdfkit";

import { Writer } from "./Writer";

//
// PdfWriter — a simple header+rows text dump (`pdfkit`) — one line per row, columns joined with a fixed
// separator. Not a formatted table (no column alignment/pagination-aware layout) — the deliberately minimal
// v1 PDF rendering the SPECS call for ("lib TBD per format"); a real tabular PDF renderer is a follow-up.
//
export class PdfWriter implements Writer
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async write( rows : Array<Record<string, unknown>>, columns : Array<string> ) : Promise<Buffer>
    {
        return new Promise<Buffer>( ( resolve : ( buffer : Buffer ) => void ) : void =>
        {
            const document : PDFKit.PDFDocument = new PDFDocument( { margin: 36 } );
            const chunks : Array<Buffer> = [];
            document.on( "data", ( chunk : Buffer ) : void => { chunks.push( chunk ); } );
            document.on( "end", () : void => resolve( Buffer.concat( chunks ) ) );

            // header row (bold-ish via font size bump; pdfkit has no CSV-style column widths, so this is a
            // simple pipe-delimited text dump, not a formatted table — see the class doc comment)
            document.fontSize( 12 ).text( columns.join( " | " ) );
            document.moveDown( 0.5 );
            document.fontSize( 10 );
            for( const row of rows )
            {
                const line : string = columns.map( ( column : string ) : string => String( row[ column ] ?? "" ) ).join( " | " );
                document.text( line );
            }

            document.end();
        } );
    }
}

export default PdfWriter;
// eof
