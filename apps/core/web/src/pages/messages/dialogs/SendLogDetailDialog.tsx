import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, Divider, Stack, Typography } from "@mui/material";

import { Email } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import LocaleService from '@model/service/LocaleService';

//
// SendLogDetailDialog — a read-only inspector for one Messages : Sent row (email-8.1): the resolved provider +
// from/reply-to identity actually used, the rendered body (HTML preview in a sandboxed iframe, falling back to
// the plain-text body), and the transport outcome (provider message id / error). Parent owns open/close.
//
export function SendLogDetailDialog( props : SendLogDetailDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const record : Email.SendLog = props.record;

    // status cell color — mirrors SentEmailPanel's statusRenderer (success/error/warning/neutral)
    const statusColor : "success" | "warning" | "default" | "error" | "info" =
        record.status === Email.Status.DELIVERED || record.status === Email.Status.OPENED || record.status === Email.Status.CLICKED ? "success" :
        record.status === Email.Status.BOUNCED || record.status === Email.Status.COMPLAINED || record.status === Email.Status.FAILED ? "error" :
        record.status === Email.Status.SUPPRESSED ? "warning" : "info";

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
    return  <DialogWindow id="messages-sent-log-detail"
                          title={"Message info"}
                          yesLabel={"Close"}
                          minWidth="md"
                          onYes={ () => Promise.resolve( true ) }
                          onClose={ props.onClose }>
                <Stack spacing={ 1.5 } sx={{ p: 2 }}>

                    {/* ── envelope (headers) ───────────────────────────────────────────────── */}
                    <Box>
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", mb: 0.5 }}>
                            <Typography variant="subtitle2">{ record.subject }</Typography>
                            <Chip size="small" variant="outlined" color={ statusColor } label={ record.status } />
                        </Stack>
                        <Box>
                            { row( "To",       record.to ) }
                            { row( "From",     record.from ) }
                            { row( "Reply-to", record.replyTo ) }
                            { row( "Provider", record.provider ) }
                            { row( "Sent",     appmodel.ui.locale.dateTime( new Date( record.createdAt ), LocaleService.Format.SHORT ) || undefined ) }
                            { row( "Notification type", record.notificationType ) }
                            { row( "Campaign",          record.campaignId ) }
                            { row( "Provider message id", record.providerMessageId ) }
                        </Box>
                        { record.headers && Object.keys( record.headers ).length > 0 &&
                            <Box sx={{ mt: 0.5 }}>
                                { Object.entries( record.headers ).map( ( [ key, value ] ) => row( key, value ) ) }
                            </Box> }
                    </Box>

                    {/* ── error (if any) ───────────────────────────────────────────────────── */}
                    { record.error &&
                        <Box sx={{ p: 1, border: 1, borderColor: "error.main", borderRadius: 1, bgcolor: ( theme ) => theme.palette.mode === "dark" ? "rgba(248,81,73,0.08)" : "rgba(248,81,73,0.06)" }}>
                            <Typography variant="caption" sx={{ color: "error.main", fontWeight: 600 }}>{"Error"}</Typography>
                            <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{ record.error }</Typography>
                        </Box> }

                    {/* ── body preview ─────────────────────────────────────────────────────── */}
                    <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Body"}</Typography></Divider>
                    { record.html
                        ? <Box sx={{ display: "flex", justifyContent: "center", bgcolor: "action.hover", p: 1, borderRadius: 1 }}>
                              <Box component="iframe" title="sent-body" sandbox="" srcDoc={ record.html }
                                   sx={{ width: "100%", height: 420, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fff" }} />
                          </Box>
                        : record.text
                            ? <Typography variant="body2" component="pre" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", m: 0 }}>{ record.text }</Typography>
                            : <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No body captured for this message."}</Typography> }

                </Stack>
            </DialogWindow>;
}

export namespace SendLogDetailDialog
{
    export interface Props
    {
        record  : Email.SendLog;
        onClose : () => void;
    }
}

export default SendLogDetailDialog;
// eof
