import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { AuthConfig, LogLevel } from "@repo/api";
import { AuthConfigFormModel } from "./AuthConfigFormModel";
import { LockoutSection } from "./LockoutSection";
import { MfaSection } from "./MfaSection";
import { TokensSection } from "./TokensSection";
import { VerificationSection } from "./VerificationSection";
import { WebAuthnSection } from "./WebAuthnSection";
import { AbuseSection } from "./AbuseSection";
import { SsoSection } from "./SsoSection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// AuthConfigForm — the "smart" alternative to the raw JSON editor for the auth service's `settings` config.
// Mirrors mediaConfig/MediaConfigForm.tsx: one section per AuthConfig.Config concern. Reads/writes the SAME
// JSON text the JSON editor shows.
//
// IMPORTANT: any new field added to AuthConfig.Config (packages/api/src/auth/model/AuthConfig.ts) needs a
// matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the auth service's `settings` AppConfig profile. */
export function AuthConfigForm( props : AuthConfigForm.Props )
{
    const config : AuthConfig.Config | null = AuthConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated section back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof AuthConfig.Config>( key : Key, value : AuthConfig.Config[ Key ] ) : void
    {
        const next : AuthConfig.Config = { ...( config as AuthConfig.Config ), [ key ]: value };
        props.onChange( AuthConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <LockoutSection value={config.lockout} readOnly={props.readOnly} onChange={( value : AuthConfig.Lockout ) : void => update( "lockout", value )} />
            <MfaSection value={config.mfa} readOnly={props.readOnly} onChange={( value : AuthConfig.Mfa ) : void => update( "mfa", value )} />
            <TokensSection value={config.tokens} readOnly={props.readOnly} onChange={( value : AuthConfig.Tokens ) : void => update( "tokens", value )} />
            <VerificationSection value={config.verification} readOnly={props.readOnly} onChange={( value : AuthConfig.Verification ) : void => update( "verification", value )} />
            <WebAuthnSection value={config.webauthn} readOnly={props.readOnly} onChange={( value : AuthConfig.WebAuthn ) : void => update( "webauthn", value )} />
            <AbuseSection value={config.abuse} readOnly={props.readOnly} onChange={( value : AuthConfig.Abuse ) : void => update( "abuse", value )} />
            <SsoSection value={config.sso} readOnly={props.readOnly} onChange={( value : AuthConfig.Sso ) : void => update( "sso", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace AuthConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default AuthConfigForm;
