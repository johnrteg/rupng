//
import { Writer } from "./Writer";

//
// CsvWriter — hand-rolled CSV rendering (no external dependency needed for this simple format). Escapes a
// cell per RFC 4180: any value containing a comma, a double-quote, or a newline is wrapped in double quotes,
// with embedded quotes doubled.
//
export class CsvWriter implements Writer
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async write( rows : Array<Record<string, unknown>>, columns : Array<string> ) : Promise<Buffer>
    {
        const lines : Array<string> = [ columns.map( CsvWriter.escape ).join( "," ) ];
        for( const row of rows )
        {
            const cells : Array<string> = columns.map( ( column : string ) : string => CsvWriter.escape( CsvWriter.cell( row[ column ] ) ) );
            lines.push( cells.join( "," ) );
        }
        return Buffer.from( lines.join( "\r\n" ), "utf8" );
    }

    // stringify a cell value for CSV — undefined/null render blank, everything else via String().
    private static cell( value : unknown ) : string
    {
        if( value === undefined || value === null ) return "";
        return String( value );
    }

    // RFC 4180 escaping — quote + double-up embedded quotes whenever the value needs it.
    private static escape( value : string ) : string
    {
        if( !/[",\r\n]/.test( value ) ) return value;
        return `"${ value.replace( /"/g, '""' ) }"`;
    }
}

export default CsvWriter;
// eof
