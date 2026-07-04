//
// PasswordPolicy — the password COMPOSITION rules. This is web-config (the public bootstrap projection):
// the web client renders + pre-validates against it, and the auth service enforces the same `Rule`. One
// definition, shared, with a co-located JSON Schema + validator.
//
import { Validation } from "../../model/Validation";

export namespace PasswordPolicy
{
    export interface Rule
    {
        minLength:      number;
        requireUpper?:  boolean;
        requireLower?:  boolean;
        requireNumber?: boolean;
        requireSymbol?: boolean;
    }

    /** JSON Schema for `Rule` — editor linting + programmatic validation. (No `$schema` key: it's also
     *  embedded inside GetBootstrap.SCHEMA, and a `$schema` in a subschema trips ajv strict mode.) */
    export const SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false,
        required: [ "minLength" ],
        properties: {
            minLength:     { type: "integer", minimum: 1, maximum: 256 },
            requireUpper:  { type: "boolean" },
            requireLower:  { type: "boolean" },
            requireNumber: { type: "boolean" },
            requireSymbol: { type: "boolean" },
        },
    };

    export const validate : Validation.Validator<Rule> = Validation.compile<Rule>( SCHEMA );

    export const DEFAULT : PasswordPolicy.Rule = { minLength: 8, requireUpper: true, requireLower: true, requireNumber: true, requireSymbol: false };
}

export default PasswordPolicy;
