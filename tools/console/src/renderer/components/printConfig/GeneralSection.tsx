import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { Print } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** The default mail-fulfillment provider + the SEPARATE default address-verification source (print-2.6 —
 *  two independent factories), plus the account-default mail class and the NCOA cache reuse window
 *  (regulated ≤95d for presort discounts). */
export function GeneralSection( props : GeneralSection.Props )
{
    function onProviderChange( event : SelectChangeEvent ) : void { props.onChangeProvider( event.target.value as Print.Provider ); }
    function onVerifierChange( event : SelectChangeEvent ) : void { props.onChangeVerifier( event.target.value as Print.AddressVerifierId ); }
    function onMailClassChange( event : SelectChangeEvent ) : void { props.onChangeMailClass( event.target.value as Print.MailClass ); }

    return (
        <ConfigSection title="General" hint="The default mail-fulfillment provider and the SEPARATE default address-verification source (verify with one, mail with another), plus the account-default mail class.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Typography variant="body2">Default mail provider</Typography>
                <Select size="small" value={props.provider} disabled={props.readOnly} onChange={onProviderChange} sx={{ minWidth: 150 }}>
                    {Object.values( Print.Provider ).map( ( provider : Print.Provider ) => <MenuItem key={provider} value={provider}>{provider}</MenuItem> )}
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Typography variant="body2">Default address verifier</Typography>
                <Select size="small" value={props.verifier} disabled={props.readOnly} onChange={onVerifierChange} sx={{ minWidth: 150 }}>
                    {Object.values( Print.AddressVerifierId ).map( ( verifier : Print.AddressVerifierId ) => <MenuItem key={verifier} value={verifier}>{verifier}</MenuItem> )}
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Typography variant="body2">Default mail class</Typography>
                <Select size="small" value={props.mailClass} disabled={props.readOnly} onChange={onMailClassChange} sx={{ minWidth: 150 }}>
                    {Object.values( Print.MailClass ).map( ( value : Print.MailClass ) => <MenuItem key={value} value={value}>{value}</MenuItem> )}
                </Select>
            </Box>
            <RangeNumberField
                label="NCOA cache window (days)" help="USPS move-update — regulated ≤95 days for presort discounts." value={props.ncoaMaxAgeDays} min={1} max={95} disabled={props.readOnly}
                onChange={props.onChangeNcoaMaxAgeDays}
            />
        </ConfigSection>
    );
}

export namespace GeneralSection
{
    export interface Props
    {
        provider              : Print.Provider;
        verifier              : Print.AddressVerifierId;
        mailClass             : Print.MailClass;
        ncoaMaxAgeDays        : number;
        onChangeProvider      : ( value : Print.Provider ) => void;
        onChangeVerifier      : ( value : Print.AddressVerifierId ) => void;
        onChangeMailClass     : ( value : Print.MailClass ) => void;
        onChangeNcoaMaxAgeDays : ( value : number ) => void;
        readOnly              : boolean;
    }
}

export default GeneralSection;
