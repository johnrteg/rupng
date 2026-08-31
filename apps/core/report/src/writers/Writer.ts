//
//
// Writer — the contract every output-format renderer implements (report-5.1: one format per run). Takes a
// generator's flat `rows`/`columns` table and renders the requested artifact's bytes.
//
export interface Writer
{
    /** Render the given rows into this writer's format, in `columns` order. Never throws — a rendering
     *  failure should be a thrown error only for genuinely unrecoverable cases (the caller wraps the whole
     *  generate+write pipeline in `ResultUtils.from` at the job level). */
    write( rows : Array<Record<string, unknown>>, columns : Array<string> ) : Promise<Buffer>;
}

export default Writer;
// eof
