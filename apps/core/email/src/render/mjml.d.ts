//
// Local type facade for the `mjml` package (v5). The published `@types/mjml` describe the v4 SYNCHRONOUS API;
// v5's `mjml2html` is ASYNCHRONOUS (returns a Promise). We declare the exact v5 shape here so the renderer stays
// fully typed (no `any`) without depending on the stale community types.
//
declare module "mjml"
{
    /** A single validation problem reported by the compiler (soft validation collects rather than throws). */
    export interface MjmlError
    {
        line             : number;
        message          : string;
        tagName          : string;
        formattedMessage : string;
    }

    /** The compile result: the responsive HTML, the parsed AST, and any (soft) validation errors. */
    export interface MjmlResult
    {
        html   : string;
        json   : unknown;
        errors : Array<MjmlError>;
    }

    /** Compile options we use — soft validation (collect, don't throw), optional minify + custom fonts. */
    export interface MjmlOptions
    {
        validationLevel? : "strict" | "soft" | "skip";
        minify?          : boolean;
        keepComments?    : boolean;
        fonts?           : Record<string, string>;
    }

    /** Compile an MJML string → responsive, email-safe HTML (async in v5). */
    export default function mjml2html( mjml : string, options? : MjmlOptions ) : Promise<MjmlResult>;
}
