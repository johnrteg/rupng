//
import { Writer } from "./Writer";

//
// JsonWriter — renders the rows as a pretty-printed JSON array, each object restricted to (and ordered by)
// `columns` so the JSON output matches the same shape the other writers render.
//
export class JsonWriter implements Writer
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async write( rows : Array<Record<string, unknown>>, columns : Array<string> ) : Promise<Buffer>
    {
        const shaped : Array<Record<string, unknown>> = rows.map( ( row : Record<string, unknown> ) : Record<string, unknown> =>
        {
            const ordered : Record<string, unknown> = {};
            for( const column of columns ) ordered[ column ] = row[ column ] ?? null;
            return ordered;
        } );
        return Buffer.from( JSON.stringify( shaped, null, 2 ), "utf8" );
    }
}

export default JsonWriter;
// eof
