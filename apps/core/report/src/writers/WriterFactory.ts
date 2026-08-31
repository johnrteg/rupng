//
import { Report } from "@repo/api";

import { Writer } from "./Writer";
import { CsvWriter } from "./CsvWriter";
import { JsonWriter } from "./JsonWriter";
import { XlsxWriter } from "./XlsxWriter";
import { PdfWriter } from "./PdfWriter";

//
// WriterFactory — the registry of output-format renderers (report-5.1), keyed by `Report.Format`. Mirrors
// GeneratorFactory / VoiceFactory's `Map<key, make>` + `register()`/`get()` shape.
//
export class WriterFactory
{
    private readonly registry : Map<Report.Format, () => Writer> = new Map<Report.Format, () => Writer>( [
        [ "csv",  () => new CsvWriter() ],
        [ "json", () => new JsonWriter() ],
        [ "xlsx", () => new XlsxWriter() ],
        [ "pdf",  () => new PdfWriter() ],
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register (or replace) a writer — add a format without editing call sites. */
    public register( format : Report.Format, make : () => Writer ) : void { this.registry.set( format, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Instantiate one format's writer, or undefined if none is registered. */
    public get( format : Report.Format ) : Writer | undefined
    {
        const make : ( () => Writer ) | undefined = this.registry.get( format );
        return make ? make() : undefined;
    }
}

export default WriterFactory;
// eof
