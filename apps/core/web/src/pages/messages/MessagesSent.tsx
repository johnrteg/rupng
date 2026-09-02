import { JSX } from "react";
import React from 'react';

import { Box, Tab, Tabs } from "@mui/material";

import { Access } from '@repo/system';

import AuthPage       from '@widgets/app/AuthPage';
import SentEmailPanel from '@pages/messages/panels/SentEmailPanel';
import SentVoicePanel from '@pages/messages/panels/SentVoicePanel';
import SentPrintPanel from '@pages/messages/panels/SentPrintPanel';

// the channels available on this page, in tab order — mirrors Messages : Send's channel set, minus Text (no
// send path shipped yet, so there's nothing to show a log for)
enum SentChannel { EMAIL = 0, VOICE = 1, PRINT = 2 }

//
// Messages : Sent — the account's per-channel send history + delivery/outcome status, one tab per channel
// (email-8.1 / voice-7.1). Each tab's list + detail dialog lives in its own panel component
// (SentEmailPanel/SentVoicePanel) — a new channel joins this view by adding a tab + panel, same shape as
// Messages : Send.
//
export function MessagesSent( _props : MessagesSent.Props ) : JSX.Element
{
    const [channel,setChannel] = React.useState< SentChannel >( SentChannel.EMAIL );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onChannelChanged( _event : React.SyntheticEvent, next : SentChannel ) : void { setChannel( next ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={ "Messages : Sent" }>
                <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                    <Tabs value={ channel } onChange={ onChannelChanged }>
                        <Tab label={"Email"} />
                        <Tab label={"Voice"} />
                        <Tab label={"Print"} />
                    </Tabs>
                </Box>

                <Box sx={{ p: 2 }}>
                    { channel === SentChannel.EMAIL && <SentEmailPanel /> }
                    { channel === SentChannel.VOICE && <SentVoicePanel /> }
                    { channel === SentChannel.PRINT && <SentPrintPanel /> }
                </Box>
            </AuthPage>;
}

export namespace MessagesSent
{
    export interface Props {}
}

export default MessagesSent;
// eof
