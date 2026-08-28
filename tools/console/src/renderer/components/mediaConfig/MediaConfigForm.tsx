import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { LogLevel, MediaConfig } from "@repo/api";
import { MediaConfigFormModel } from "./MediaConfigFormModel";
import { UploadSection } from "./UploadSection";
import { VariantsSection } from "./VariantsSection";
import { DeliverySection } from "./DeliverySection";
import { LifecycleSection } from "./LifecycleSection";
import { ScanSection } from "./ScanSection";
import { LimitsSection } from "./LimitsSection";
import { AutoTagSection } from "./AutoTagSection";
import { DownloadsSection } from "./DownloadsSection";
import { VideoTargetsSection } from "./VideoTargetsSection";
import { DensitiesSection } from "./DensitiesSection";
import { RenderSection } from "./RenderSection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// MediaConfigForm — the "smart" alternative to the raw JSON editor for the media service's `settings`
// config. Renders every MediaConfig.Config section as its own widget (a select for enums, a range-clamped
// numeric input, a repeating-row editor for the named video/density targets) so an operator can't typo a
// field name or push an out-of-range value. Reads/writes the SAME JSON text the JSON editor shows —
// ConfigPanel keeps ONE source of truth (`content`) and just swaps which editor renders it.
//
// IMPORTANT: any new field added to MediaConfig.Config (packages/api/src/media/model/MediaConfig.ts) needs
// a matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the media service's `settings` AppConfig profile. */
export function MediaConfigForm( props : MediaConfigForm.Props )
{
    const config : MediaConfig.Config | null = MediaConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated section back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof MediaConfig.Config>( key : Key, value : MediaConfig.Config[ Key ] ) : void
    {
        const next : MediaConfig.Config = { ...( config as MediaConfig.Config ), [ key ]: value };
        props.onChange( MediaConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <UploadSection value={config.upload} readOnly={props.readOnly} onChange={( value : MediaConfig.Upload ) : void => update( "upload", value )} />
            <VariantsSection value={config.variants} readOnly={props.readOnly} onChange={( value : MediaConfig.Variants ) : void => update( "variants", value )} />
            <DeliverySection value={config.delivery} readOnly={props.readOnly} onChange={( value : MediaConfig.Delivery ) : void => update( "delivery", value )} />
            <LifecycleSection value={config.lifecycle} readOnly={props.readOnly} onChange={( value : MediaConfig.Lifecycle ) : void => update( "lifecycle", value )} />
            <ScanSection value={config.scan} readOnly={props.readOnly} onChange={( value : MediaConfig.Scan ) : void => update( "scan", value )} />
            <LimitsSection value={config.limits} readOnly={props.readOnly} onChange={( value : MediaConfig.Limits ) : void => update( "limits", value )} />
            <AutoTagSection value={config.autoTag} readOnly={props.readOnly} onChange={( value : MediaConfig.AutoTag ) : void => update( "autoTag", value )} />
            <DownloadsSection value={config.downloads} readOnly={props.readOnly} onChange={( value : MediaConfig.Downloads ) : void => update( "downloads", value )} />
            <VideoTargetsSection value={config.videoTargets} readOnly={props.readOnly} onChange={( value : Record<string, MediaConfig.VideoTarget> ) : void => update( "videoTargets", value )} />
            <DensitiesSection value={config.densities} readOnly={props.readOnly} onChange={( value : Record<string, MediaConfig.DensityTarget> ) : void => update( "densities", value )} />
            <RenderSection value={config.render} readOnly={props.readOnly} onChange={( value : MediaConfig.Render ) : void => update( "render", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace MediaConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default MediaConfigForm;
