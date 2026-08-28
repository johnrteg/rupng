import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import { GetBootstrap } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** Publishable (non-secret) client keys ONLY — Stripe's publishable key, a reCAPTCHA site key, a maps key.
 *  Never a secret; this blob is public and unauthenticated. */
export function PublishableKeysSection( props : PublishableKeysSection.Props )
{
    /** Patch one field of the publishable keys, preserving the rest. Blank clears the field. */
    function set( patch : Partial<GetBootstrap.PublishableKeys> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Publishable keys" hint="PUBLISHABLE keys only — never a secret. This blob is public and unauthenticated.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Stripe publishable key</Typography>
                <TextField
                    size="small" value={props.value.stripePublishable ?? ""} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { stripePublishable: event.target.value || undefined } )}
                    sx={{ minWidth: 220 }}
                />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">reCAPTCHA site key</Typography>
                <TextField
                    size="small" value={props.value.recaptchaSiteKey ?? ""} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { recaptchaSiteKey: event.target.value || undefined } )}
                    sx={{ minWidth: 220 }}
                />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Maps key</Typography>
                <TextField
                    size="small" value={props.value.mapsKey ?? ""} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { mapsKey: event.target.value || undefined } )}
                    sx={{ minWidth: 220 }}
                />
            </Box>
        </ConfigSection>
    );
}

export namespace PublishableKeysSection
{
    export interface Props
    {
        value    : GetBootstrap.PublishableKeys;
        onChange : ( value : GetBootstrap.PublishableKeys ) => void;
        readOnly : boolean;
    }
}

export default PublishableKeysSection;
