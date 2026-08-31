//
import ExcelJS from "exceljs";

import { Writer } from "./Writer";

//
// XlsxWriter — renders the rows into a single-sheet Excel workbook (`exceljs`). Column headers come from
// `columns` (in order); each row is written as a plain object keyed the same way exceljs's `columns` option
// expects.
//
export class XlsxWriter implements Writer
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async write( rows : Array<Record<string, unknown>>, columns : Array<string> ) : Promise<Buffer>
    {
        const workbook : ExcelJS.Workbook = new ExcelJS.Workbook();
        const sheet : ExcelJS.Worksheet = workbook.addWorksheet( "Report" );
        sheet.columns = columns.map( ( column : string ) : Partial<ExcelJS.Column> => ( { header: column, key: column, width: 20 } ) );
        for( const row of rows ) sheet.addRow( row );

        const buffer : ExcelJS.Buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from( buffer );
    }
}

export default XlsxWriter;
// eof
