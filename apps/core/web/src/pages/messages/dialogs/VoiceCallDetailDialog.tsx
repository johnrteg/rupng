import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, Divider, Stack, Typography } from "@mui/material";

import { Voice } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import LocaleService from '@model/service/LocaleService';

//
// VoiceCallDetailDialog — a read-only inspector for one Messages : Sent (Voice) row: the resolved caller-ID +
// provider actually used, the played message (TTS text or recording url), and the call outcome (duration /
// opt-out / error). Recording/transcript (PII, S3-lifecycle-TTL'd — see apps/core/voice/SPECS.md gap #8) are
// NOT fetched here — that's a separate presigned-URL read (`GetVoiceCallRecording`/`GetVoiceCallTranscript`),
// left for a future pass rather than added speculatively. Parent owns open/close.
//
export function VoiceCallDetailDialog( props : VoiceCallDetailDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const record : Voice.CallLog = props.record;

    // status cell color — mirrors SentVoicePanel's statusRenderer (success/error/warning/neutral)
    const statusColor : "success" | "warning" | "default" | "error" | "info" =
        record.status === Voice.Status.ANSWERED ? "success" :
        record.status === Voice.Status.FAILED || record.status === Voice.Status.OPTED_OUT ? "error" :
        record.status === Voice.Status.NO_ANSWER || record.status === Voice.Status.BUSY || record.status === Voice.Status.SUPPRESSED ? "warning" : "info";

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a labelled value row (skips empty/undefined values)
    function row( label : string, value : string | undefined ) : JSX.Element | null
    {
        if( value === undefined || value === "" ) return null;
        return  <Box key={ label } sx={{ display: "flex", gap: 2, py: 0.25 }}>
                    <Typography variant="caption" sx={{ color: "text.secondary", width: 110, flexShrink: 0 }}>{ label }</Typography>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{ value }</Typography>
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="messages-sent-voice-call-detail"
                          title={"Call info"}
                          yesLabel={"Close"}
                          minWidth="md"
                          onYes={ () => Promise.resolve( true ) }
                          onClose={ props.onClose }>
                <Stack spacing={ 1.5 } sx={{ p: 2 }}>

                    {/* ── envelope ──────────────────────────────────────────────────────────── */}
                    <Box>
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", mb: 0.5 }}>
                            <Typography variant="subtitle2">{ record.to }</Typography>
                            <Chip size="small" variant="outlined" color={ statusColor } label={ record.status } />
                        </Stack>
                        <Box>
                            { row( "To",              record.to ) }
                            { row( "Caller ID",        record.callerId ) }
                            { row( "Provider",         record.provider ) }
                            { row( "Placed",           appmodel.ui.locale.dateTime( new Date( record.createdAt ), LocaleService.Format.SHORT ) || undefined ) }
                            { row( "Duration",         record.durationSec !== undefined ? `${ record.durationSec }s` : undefined ) }
                            { row( "Campaign",         record.campaignId ) }
                            { row( "Provider call id", record.providerCallId ) }
                            { row( "Opted out",        record.optedOut ? "Yes" : undefined ) }
                        </Box>
                    </Box>

                    {/* ── error (if any) ───────────────────────────────────────────────────── */}
                    { record.error &&
                        <Box sx={{ p: 1, border: 1, borderColor: "error.main", borderRadius: 1, bgcolor: ( theme ) => theme.palette.mode === "dark" ? "rgba(248,81,73,0.08)" : "rgba(248,81,73,0.06)" }}>
                            <Typography variant="caption" sx={{ color: "error.main", fontWeight: 600 }}>{"Error"}</Typography>
                            <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{ record.error }</Typography>
                        </Box> }

                    {/* ── message preview ──────────────────────────────────────────────────── */}
                    <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Message"}</Typography></Divider>
                    { record.message.kind === "tts" && record.message.text
                        ? <Typography variant="body2" component="pre" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", m: 0 }}>{ record.message.text }</Typography>
                        : record.message.recordingUrl
                            ? <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{ record.message.recordingUrl }</Typography>
                            : <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No message captured for this call."}</Typography> }

                </Stack>
            </DialogWindow>;
}

export namespace VoiceCallDetailDialog
{
    export interface Props
    {
        record  : Voice.CallLog;
        onClose : () => void;
    }
}

export default VoiceCallDetailDialog;
// eof
