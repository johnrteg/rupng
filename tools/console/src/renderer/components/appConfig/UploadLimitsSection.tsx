import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import { GetBootstrap } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Client-side upload validation the web app pre-checks against (the service enforces its own caps too —
 *  this just lets the browser reject early with a friendly message). */
export function UploadLimitsSection( props : UploadLimitsSection.Props )
{
    /** Patch one field of the upload limits, preserving the rest. */
    function set( patch : Partial<GetBootstrap.UploadLimits> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    /** Split the comma-separated MIME matcher text back into the allow-list array. */
    function onMimeTypesChange( event : React.ChangeEvent<HTMLInputElement> ) : void
    {
        const entries : Array<string> = event.target.value
            .split( "," )
            .map( ( entry : string ) : string => entry.trim() )
            .filter( ( entry : string ) : boolean => entry !== "" );
        set( { allowedMimeTypes: entries } );
    }

    return (
        <ConfigSection title="Upload limits" hint="Client-side pre-check for the web app's own uploads (e.g. avatars).">
            <RangeNumberField
                label="Max file size (bytes)" value={props.value.maxFileBytes} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { maxFileBytes: value } )}
            />
            <Box>
                <Typography variant="body2">Allowed MIME types</Typography>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>Comma-separated, e.g. "image/jpeg, image/png".</Typography>
                <TextField
                    fullWidth size="small" disabled={props.readOnly}
                    value={props.value.allowedMimeTypes.join( ", " )}
                    onChange={onMimeTypesChange}
                    sx={{ mt: 0.5 }}
                />
            </Box>
        </ConfigSection>
    );
}

export namespace UploadLimitsSection
{
    export interface Props
    {
        value    : GetBootstrap.UploadLimits;
        onChange : ( value : GetBootstrap.UploadLimits ) => void;
        readOnly : boolean;
    }
}

export default UploadLimitsSection;
