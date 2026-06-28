//
// Validation — the one ajv setup the API models share. Each model co-locates a JSON Schema (`SCHEMA`)
// and a compiled `validate()` next to its types, so the SAME definition validates on every surface:
//   • the web client      (pre-submit checks + the CodeMirror config editor's live linting)
//   • the service endpoint (defensive validation of a request/config before acting on it)
//   • Kafka / SQS consumers (validating a message payload off the wire)
//   • the Console          (the AppConfig editor lints the JSON against the service's schema)
//
// Models export the raw `SCHEMA` object too (CodeMirror's ajv linter wants the plain schema), so a
// consumer can either call `validate(x)` or hand `SCHEMA` to an editor.
//
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

export namespace Validation
{
    /** A JSON Schema document (draft-07, what ajv compiles by default). */
    export type Schema = Record<string, unknown>;

    /** One validation failure, flattened to a path + message (ajv's verbose ErrorObject is overkill here). */
    export interface Issue
    {
        path    : string;       // JSON Pointer to the offending value, e.g. "/tokens/accessTtlSeconds" ("" = root)
        message : string;       // human-readable reason, e.g. "must be number"
    }

    export interface Result
    {
        valid  : boolean;
        issues : Array<Issue>;
    }

    /** A compiled validator — callable, exposes its `schema`, and offers an `is()` type guard. */
    export interface Validator<T>
    {
        ( data : unknown ) : Result;
        readonly schema : Schema;
        is( data : unknown ) : data is T;
    }

    // One shared ajv instance — `allErrors` so we report every issue (good for an editor), `allowUnionTypes`
    // for `type: ["boolean","string","number"]` (e.g. feature-flag values), formats added for
    // email / uri / date-time / etc. used across the contracts.
    const ajv : Ajv = new Ajv( { allErrors: true, allowUnionTypes: true } );
    addFormats( ajv );

    /** Compile a schema into a reusable validator co-located with a model. */
    export function compile<T>( schema : Schema ) : Validator<T>
    {
        const fn : ValidateFunction = ajv.compile( schema );

        const validator = ( ( data : unknown ) : Result =>
        {
            const valid : boolean = fn( data ) as boolean;
            const issues : Array<Issue> = valid ? [] : ( fn.errors ?? [] ).map( toIssue );
            return { valid, issues };
        } ) as Validator<T>;

        Object.defineProperty( validator, "schema", { value: schema, enumerable: true } );
        ( validator as { is : ( d : unknown ) => boolean } ).is = ( data : unknown ) : boolean => fn( data ) as boolean;
        return validator;
    }

    function toIssue( error : ErrorObject ) : Issue
    {
        return { path: error.instancePath || "", message: error.message ?? "invalid" };
    }
}

export default Validation;
