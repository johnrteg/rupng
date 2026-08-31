//
// ConfigSchema — a registry mapping a service's name + AppConfig PROFILE key → that profile's JSON Schema.
// The Console's Config tab is generic (it edits whatever service/profile you pick), so it looks the schema
// up here to drive CodeMirror's live ajv linting + a save-time gate. One place to register a new service's
// (or a new profile's) config schema.
//
// Most services have exactly one editable profile, named `"settings"`. `app` is the one exception with
// TWO: `"web"` (`GetBootstrap.Config` — the PUBLIC, unauthenticated bootstrap blob served to every
// browser) and `"settings"` (`AppServiceConfig.Config` — internal ops policy, today just `logLevel`).
//
import { Validation } from "./Validation";
import { AuthConfig } from "../auth/model/AuthConfig";
import { AccountConfig } from "../account/model/AccountConfig";
import { MediaConfig } from "../media/model/MediaConfig";
import { EmailConfig } from "../email/model/EmailConfig";
import { SocialConfig } from "../social/model/SocialConfig";
import { MonitorConfig } from "../monitor/model/MonitorConfig";
import { VoiceConfig } from "../voice/model/VoiceConfig";
import { ReportConfig } from "../report/model/ReportConfig";
import { GetBootstrap } from "../app/GetBootstrap";
import { AppServiceConfig } from "../app/model/AppServiceConfig";

export namespace ConfigSchema
{
    /** service name (as in CloudManifest `service` / the Console catalog) → profile key → that profile's
     *  schema. */
    const REGISTRY : Record<string, Record<string, Validation.Schema>> =
    {
        auth:    { settings: AuthConfig.SCHEMA },
        account: { settings: AccountConfig.SCHEMA },
        media:   { settings: MediaConfig.SCHEMA },
        email:   { settings: EmailConfig.SCHEMA },
        voice:   { settings: VoiceConfig.SCHEMA },
        report:  { settings: ReportConfig.SCHEMA },
        social:  { settings: SocialConfig.SCHEMA },
        monitor: { settings: MonitorConfig.SCHEMA },
        app:     { web: GetBootstrap.SCHEMA, settings: AppServiceConfig.SCHEMA },
    };

    /** service name → profile key → the compiled validator (reuses each config's already-compiled `validate`). */
    const VALIDATORS : Record<string, Record<string, Validation.Validator<unknown>>> =
    {
        auth:    { settings: AuthConfig.validate as Validation.Validator<unknown> },
        account: { settings: AccountConfig.validate as Validation.Validator<unknown> },
        media:   { settings: MediaConfig.validate as Validation.Validator<unknown> },
        email:   { settings: EmailConfig.validate as Validation.Validator<unknown> },
        voice:   { settings: VoiceConfig.validate as Validation.Validator<unknown> },
        report:  { settings: ReportConfig.validate as Validation.Validator<unknown> },
        social:  { settings: SocialConfig.validate as Validation.Validator<unknown> },
        monitor: { settings: MonitorConfig.validate as Validation.Validator<unknown> },
        app:     { web: GetBootstrap.validate as Validation.Validator<unknown>, settings: AppServiceConfig.validate as Validation.Validator<unknown> },
    };

    /** service name → the profile key the Console should auto-select when the Config tab first loads.
     *  Everything not listed here defaults to `"settings"`; `app` defaults to `"web"` (the more commonly
     *  edited of its two profiles) even though `"settings"` is ALSO registered and smart-editable. */
    const DEFAULT_PROFILE : Record<string, string> =
    {
        app: "web",
    };

    /** The JSON Schema for a service's profile (for editor linting), or undefined if neither the service
     *  nor that profile is registered. `profile` defaults to `"settings"` — the convention every service
     *  but `app` follows. */
    export function forService( service : string, profile : string = "settings" ) : Validation.Schema | undefined
    {
        return REGISTRY[ service ]?.[ profile ];
    }

    /** The compiled validator for a service's profile, or undefined. `profile` defaults to `"settings"`. */
    export function validatorFor( service : string, profile : string = "settings" ) : Validation.Validator<unknown> | undefined
    {
        return VALIDATORS[ service ]?.[ profile ];
    }

    /** The AppConfig profile KEY the Console should auto-select for a service (defaults to `"settings"`). */
    export function profileFor( service : string ) : string
    {
        return DEFAULT_PROFILE[ service ] ?? "settings";
    }

    /** The profile keys registered for a service (e.g. `app` → `[ "web", "settings" ]`) — lets the Console
     *  offer a smart editor on WHICHEVER profile is currently selected, not just the default one. */
    export function profilesFor( service : string ) : Array<string>
    {
        return Object.keys( REGISTRY[ service ] ?? {} );
    }

    /** Services that have at least one registered config schema. */
    export function services() : Array<string>
    {
        return Object.keys( REGISTRY );
    }
}

export default ConfigSchema;
