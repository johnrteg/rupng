import { JSX } from "react";
import React from 'react';

import { Box, Tab, Tabs } from "@mui/material";

import { Access } from '@repo/system';

import AuthPage       from '@widgets/app/AuthPage';
import SendEmailPanel from '@pages/messages/panels/SendEmailPanel';
import SendTextPanel  from '@pages/messages/panels/SendTextPanel';
import SendVoicePanel from '@pages/messages/panels/SendVoicePanel';

// the channels available on this page, in tab order
enum SendChannel { EMAIL = 0, TEXT = 1, VOICE = 2 }

//
// Messages : Send — an ad-hoc compose-and-send tool (no template/campaign involved), one tab per channel. Email
// is the only wired channel today; Text/Voice are placeholders until those services ship (each tab's compose
// form lives in its own panel component — SendEmailPanel/SendTextPanel/SendVoicePanel).
//
export function MessagesSend( _props : MessagesSend.Props ) : JSX.Element
{
    const [channel,setChannel] = React.useState< SendChannel >( SendChannel.EMAIL );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onChannelChanged( _event : React.SyntheticEvent, next : SendChannel ) : void { setChannel( next ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.SENDER } title={ "Messages : Send" }>
                <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                    <Tabs value={ channel } onChange={ onChannelChanged }>
                        <Tab label={"Email"} />
                        <Tab label={"Text"} />
                        <Tab label={"Voice"} />
                    </Tabs>
                </Box>

                { channel === SendChannel.EMAIL && <SendEmailPanel /> }
                { channel === SendChannel.TEXT  && <SendTextPanel /> }
                { channel === SendChannel.VOICE && <SendVoicePanel /> }
            </AuthPage>;
}

export namespace MessagesSend
{
    export interface Props {}
}

export default MessagesSend;
// eof
