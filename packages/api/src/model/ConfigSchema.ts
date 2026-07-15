//
// ConfigSchema — a registry mapping a service's name → the JSON Schema for its editable AppConfig
// `settings` profile. The Console's Config tab is generic (it edits whatever service you pick), so it
// looks the schema up here to drive CodeMirror's live ajv linting + a save-time gate. One place to
// register a new service's config schema.
//
import { Validation } from "./Validation";
import { AuthConfig } from "../auth/model/AuthConfig";
import { AccountConfig } from "../account/model/AccountConfig";

export namespace ConfigSchema
{
    /** service name (as in CloudManifest `service` / the Console catalog) → its `config/settings` schema. */
    const REGISTRY : Record<string, Validation.Schema> =
    {
        auth:    AuthConfig.SCHEMA,
        account: AccountConfig.SCHEMA,
    };

    /** service name → the compiled validator (reuses each config's already-compiled `validate`). */
    const VALIDATORS : Record<string, Validation.Validator<unknown>> =
    {
        auth:    AuthConfig.validate as Validation.Validator<unknown>,
        account: AccountConfig.validate as Validation.Validator<unknown>,
    };

    /** The JSON Schema for a service's `settings` profile (for editor linting), or undefined. */
    export function forService( service : string ) : Validation.Schema | undefined
    {
        return REGISTRY[ service ];
    }

    /** The compiled validator for a service's `settings` profile, or undefined. */
    export function validatorFor( service : string ) : Validation.Validator<unknown> | undefined
    {
        return VALIDATORS[ service ];
    }

    /** Services that have a registered config schema. */
    export function services() : Array<string>
    {
        return Object.keys( REGISTRY );
    }
}

export default ConfigSchema;
