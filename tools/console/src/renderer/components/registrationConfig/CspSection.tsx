import TextField from "@mui/material/TextField";
import { ConfigSection } from "../configEditor/ConfigSection";

/** Our TCR CSP identity + the Secrets Manager REFERENCES (never the keys themselves) the registration
 *  service authenticates with — the direct-CSP model (SPECS.md gap #1, resolved). */
export function CspSection( props : CspSection.Props )
{
    return (
        <ConfigSection title="CSP identity" hint="Our TCR CSP identity + the credential references it authenticates with. Secrets live in Secrets Manager — these fields only NAME the entry.">
            <TextField
                size="small" label="CSP id" value={props.cspId} disabled={props.readOnly} fullWidth
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChangeCspId( event.target.value )}
            />
            <TextField
                size="small" label="Reseller id" value={props.resellerId} disabled={props.readOnly} fullWidth
                helperText="Required non-empty per TCR policy — a system-wide default"
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChangeResellerId( event.target.value )}
            />
            <TextField
                size="small" label="TCR secret ref" value={props.secretRef} disabled={props.readOnly} fullWidth
                helperText="Secrets Manager entry name for the TCR API credentials — never the key itself"
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChangeSecretRef( event.target.value )}
            />
            <TextField
                size="small" label="Campaign Verify secret ref" value={props.cvSecretRef ?? ""} disabled={props.readOnly} fullWidth
                helperText="Secrets Manager entry name for the Campaign Verify API key (political vetting) — optional"
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChangeCvSecretRef( event.target.value || undefined )}
            />
        </ConfigSection>
    );
}

export namespace CspSection
{
    export interface Props
    {
        cspId               : string;
        resellerId          : string;
        secretRef           : string;
        cvSecretRef?        : string;
        onChangeCspId       : ( value : string ) => void;
        onChangeResellerId  : ( value : string ) => void;
        onChangeSecretRef   : ( value : string ) => void;
        onChangeCvSecretRef : ( value : string | undefined ) => void;
        readOnly            : boolean;
    }
}

export default CspSection;
