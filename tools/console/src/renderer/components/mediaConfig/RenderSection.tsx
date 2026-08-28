import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** Studio video-render engine — switchable without a redeploy; the endpoint routes each render to that
 *  engine's queue. */
export function RenderSection( props : RenderSection.Props )
{
    /** Switch the render engine. */
    function onEngineChange( event : SelectChangeEvent ) : void
    {
        props.onChange( { engine: event.target.value as MediaConfig.RenderEngine } );
    }

    return (
        <ConfigSection title="Studio render" hint="Which engine Studio video renders are queued to.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Engine</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>
                        ffmpeg = fast, in-process, some effects approximated. remotion = exact preview==output fidelity, needs a Chromium-capable worker.
                    </Typography>
                </Box>
                <Select size="small" value={props.value.engine} disabled={props.readOnly} onChange={onEngineChange} sx={{ minWidth: 150 }}>
                    {Object.values( MediaConfig.RenderEngine ).map( ( engine : MediaConfig.RenderEngine ) => <MenuItem key={engine} value={engine}>{engine}</MenuItem> )}
                </Select>
            </Box>
        </ConfigSection>
    );
}

export namespace RenderSection
{
    export interface Props
    {
        value    : MediaConfig.Render;
        onChange : ( value : MediaConfig.Render ) => void;
        readOnly : boolean;
    }
}

export default RenderSection;
