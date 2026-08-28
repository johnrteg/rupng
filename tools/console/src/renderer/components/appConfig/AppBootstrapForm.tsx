import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { GetBootstrap } from "@repo/api";
import { AppBootstrapFormModel } from "./AppBootstrapFormModel";
import { BrandingSection } from "./BrandingSection";
import { PasswordPolicySection } from "./PasswordPolicySection";
import { UploadLimitsSection } from "./UploadLimitsSection";
import { PublishableKeysSection } from "./PublishableKeysSection";
import { FeatureFlagsSection } from "./FeatureFlagsSection";
import { LocalizationSection } from "./LocalizationSection";
import { SessionSection } from "./SessionSection";

//
// AppBootstrapForm — the "smart" alternative to the raw JSON editor for the app service's `web` profile
// (GetBootstrap.Config — the PUBLIC, unauthenticated bootstrap blob served to every browser at login).
// Mirrors mediaConfig/MediaConfigForm.tsx: one section per concern. Reads/writes the SAME JSON text the
// JSON editor shows.
//
// TWO deliberate differences from the other smart editors:
//   - `notices` (Array<GetBootstrap.Notice>) stays JSON-only — it's a rich, server-assembled union
//     (audience targeting, sanitized HTML, timed windows) authored through its own in-app Tools UI
//     (app-3.6), not this config profile; a form here would just duplicate that surface poorly.
//   - NO Logging section: this profile is `app`'s public `web` blob, not its (currently unimplemented)
//     `settings` profile — Application.refreshLogLevel polls `config/settings`, so a `logLevel` field
//     here would do nothing AND would leak an ops knob into a public, unauthenticated payload.
//
// IMPORTANT: any new field added to GetBootstrap.Config (packages/api/src/app/GetBootstrap.ts) needs a
// matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the app service's `web` AppConfig profile (the public bootstrap blob). */
export function AppBootstrapForm( props : AppBootstrapForm.Props )
{
    const config : GetBootstrap.Config | null = AppBootstrapFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated section back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof GetBootstrap.Config>( key : Key, value : GetBootstrap.Config[ Key ] ) : void
    {
        const next : GetBootstrap.Config = { ...( config as GetBootstrap.Config ), [ key ]: value };
        props.onChange( AppBootstrapFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <BrandingSection
                name={config.name} displayName={config.branding.displayName} readOnly={props.readOnly}
                onChange={( name : string, displayName : string ) : void =>
                {
                    const next : GetBootstrap.Config = { ...config, name, branding: { displayName } };
                    props.onChange( AppBootstrapFormModel.stringify( next ) );
                }}
            />
            <PasswordPolicySection value={config.passwordPolicy} readOnly={props.readOnly} onChange={( value ) : void => update( "passwordPolicy", value )} />
            <UploadLimitsSection value={config.uploadLimits} readOnly={props.readOnly} onChange={( value ) : void => update( "uploadLimits", value )} />
            <PublishableKeysSection value={config.publishableKeys} readOnly={props.readOnly} onChange={( value ) : void => update( "publishableKeys", value )} />
            <FeatureFlagsSection value={config.featureFlags} readOnly={props.readOnly} onChange={( value ) : void => update( "featureFlags", value )} />
            <LocalizationSection
                countries={config.countries} country={config.country} readOnly={props.readOnly}
                onChange={( countries : Array<string>, country : string ) : void =>
                {
                    const next : GetBootstrap.Config = { ...config, countries, country };
                    props.onChange( AppBootstrapFormModel.stringify( next ) );
                }}
            />
            <SessionSection value={config.session} readOnly={props.readOnly} onChange={( value ) : void => update( "session", value )} />
            <Box sx={{ px: 1, py: 0.5 }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>
                    Notices ({config.notices.length}) are authored via the in-app Tools UI, not here — switch to the JSON editor to hand-edit them directly.
                </Typography>
            </Box>
        </Box>
    );
}

export namespace AppBootstrapForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default AppBootstrapForm;
