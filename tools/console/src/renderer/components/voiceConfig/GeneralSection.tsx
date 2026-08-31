import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import type { SelectChangeEvent } from "@mui/material/Select";
import { Voice } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** The default outbound provider + the account-wide toggles an operator flips before anything else: whether
 *  calls are recorded (+ transcribed), and whether answering-machine detection (AMD) gates every call. */
export function GeneralSection( props : GeneralSection.Props )
{
    /** Switch the default outbound provider (an account's `SendRequest` can still override it per-call). */
    function onProviderChange( event : SelectChangeEvent ) : void
    {
        props.onChangeProvider( event.target.value as Voice.Provider );
    }

    return (
        <ConfigSection title="General" hint="The default provider a call uses when the request doesn't override it, plus recording/transcription + answering-machine detection.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Typography variant="body2">Default provider</Typography>
                <Select size="small" value={props.provider} disabled={props.readOnly} onChange={onProviderChange} sx={{ minWidth: 150 }}>
                    {Object.values( Voice.Provider ).map( ( provider : Voice.Provider ) => <MenuItem key={provider} value={provider}>{provider}</MenuItem> )}
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Box>
                    <Typography variant="body2">Recording enabled</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Recordings are PII — captured to the `voice` bucket (`recordings/` prefix, 90-day lifecycle expiry) and erasable via the forget hook.</Typography>
                </Box>
                <Switch checked={props.recordingEnabled} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChangeRecordingEnabled( event.target.checked )} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Box>
                    <Typography variant="body2">Transcription enabled</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Requires recording enabled — transcribes the recorded audio via the routed SPEECH_TO_TEXT provider. Transcripts are PII, same erase/TTL posture as recordings.</Typography>
                </Box>
                <Switch checked={props.transcriptionEnabled} disabled={props.readOnly || !props.recordingEnabled} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChangeTranscriptionEnabled( event.target.checked )} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Box>
                    <Typography variant="body2">Answering-machine detection (AMD)</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Twilio only today — adds per-call latency/cost. A machine answer plays the request's voicemail message (or hangs up silently if none given).</Typography>
                </Box>
                <Switch checked={props.amdEnabled} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChangeAmdEnabled( event.target.checked )} />
            </Box>
        </ConfigSection>
    );
}

export namespace GeneralSection
{
    export interface Props
    {
        provider                     : Voice.Provider;
        recordingEnabled             : boolean;
        transcriptionEnabled         : boolean;
        amdEnabled                   : boolean;
        onChangeProvider             : ( value : Voice.Provider ) => void;
        onChangeRecordingEnabled     : ( value : boolean ) => void;
        onChangeTranscriptionEnabled : ( value : boolean ) => void;
        onChangeAmdEnabled           : ( value : boolean ) => void;
        readOnly                     : boolean;
    }
}

export default GeneralSection;
