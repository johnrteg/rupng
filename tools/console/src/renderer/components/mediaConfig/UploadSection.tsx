import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import { Media, MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Media.Kind → its display label in the per-kind size override rows. */
const KIND_LABEL : Record<Media.Kind, string> =
{
    [ Media.Kind.IMAGE ]:    "Image",
    [ Media.Kind.VIDEO ]:    "Video",
    [ Media.Kind.AUDIO ]:    "Audio",
    [ Media.Kind.DOCUMENT ]: "Document",
    [ Media.Kind.OTHER ]:    "Other",
};

/** Upload validation + presign — global/per-kind size caps, allowed MIME types, presign URL TTL. */
export function UploadSection( props : UploadSection.Props )
{
    /** Patch one field of the upload config, preserving the rest. */
    function set( patch : Partial<MediaConfig.Upload> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    /** Set a per-kind size override from its row's numeric field. */
    function setKindMax( kind : Media.Kind, megabytes : number ) : void
    {
        set( { maxSizeMbByKind: { ...props.value.maxSizeMbByKind, [ kind ]: megabytes } } );
    }

    /** Split the comma-separated MIME matcher text back into the allow-list array. */
    function onAllowedMimeChange( event : React.ChangeEvent<HTMLInputElement> ) : void
    {
        const entries : Array<string> = event.target.value
            .split( "," )
            .map( ( entry : string ) : string => entry.trim() )
            .filter( ( entry : string ) : boolean => entry !== "" );
        set( { allowedMime: entries } );
    }

    return (
        <ConfigSection title="Upload" hint="Validation + presign for incoming files. A per-kind cap overrides the global max.">
            <RangeNumberField
                label="Global max size (MB)" help="Applies to any kind without its own override below."
                value={props.value.maxSizeMb} min={1} disabled={props.readOnly}
                onChange={( megabytes : number ) : void => set( { maxSizeMb: megabytes } )}
            />
            {Object.values( Media.Kind ).map( ( kind : Media.Kind ) => (
                <RangeNumberField
                    key={kind} label={`${KIND_LABEL[ kind ]} max size (MB)`}
                    value={props.value.maxSizeMbByKind[ kind ] ?? props.value.maxSizeMb} min={1} disabled={props.readOnly}
                    onChange={( megabytes : number ) : void => setKindMax( kind, megabytes )}
                />
            ) )}
            <RangeNumberField
                label="Presign URL TTL (sec)" help="How long an upload URL stays valid. 900 = 15 minutes."
                value={props.value.presignTtlSec} min={1} disabled={props.readOnly}
                onChange={( seconds : number ) : void => set( { presignTtlSec: seconds } )}
            />
            <Box>
                <Typography variant="body2">Allowed MIME types</Typography>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>Comma-separated matchers (e.g. "image/*, application/pdf"). Empty = allow any.</Typography>
                <TextField
                    fullWidth size="small" disabled={props.readOnly}
                    value={props.value.allowedMime.join( ", " )}
                    onChange={onAllowedMimeChange}
                    sx={{ mt: 0.5 }}
                />
            </Box>
        </ConfigSection>
    );
}

export namespace UploadSection
{
    export interface Props
    {
        value    : MediaConfig.Upload;
        onChange : ( value : MediaConfig.Upload ) => void;
        readOnly : boolean;
    }
}

export default UploadSection;
