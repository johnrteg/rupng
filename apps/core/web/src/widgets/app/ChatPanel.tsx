//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, Divider, Stack, Typography } from "@mui/material";
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import CloseOutlinedIcon             from '@mui/icons-material/CloseOutlined';

import AppModel      from '@model/AppModel';
import PubSubService from '@model/service/PubSubService';
import Subscriber    from '@widgets/core/Subscriber';
import ButtonIcon    from '@widgets/core/ButtonIcon';

//
// ChatPanel — the persistent right-side chat surface (team chat & presence, STUB). It sits beside the page
// content on every authed page (mounted by AuthPage) and stays open across navigation, like the nav. The nav
// "Chat" leaf toggles it via a PubSub CHAT event; its own header close button toggles it off. Open/closed is
// persisted in localStorage so it survives page changes + reloads. Renders nothing while closed (no width).
//
export function ChatPanel( props : ChatPanel.Props ) : JSX.Element | null
{
    const appmodel : AppModel = AppModel.instance();

    const [open,setOpen] = React.useState< boolean >( appmodel.localStorage.get( ChatPanel.STORAGE_KEY ) === "1" );

    // stub presence — how many account members are online (wired to a presence service later)
    const onlineCount : number = 0;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // persist + apply an open/closed value
    function apply( value : boolean ) : void
    {
        setOpen( value );
        appmodel.localStorage.set( ChatPanel.STORAGE_KEY, value ? "1" : "0" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the nav "Chat" leaf publishes CHAT → flip open ⇄ closed
    function onToggle() : void { apply( !open ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( !open )
        return <Subscriber event={ PubSubService.Type.CHAT } onChange={ onToggle } />;   // still listen so the nav can open it

    return  <>
                <Subscriber event={ PubSubService.Type.CHAT } onChange={ onToggle } />
                <Divider orientation="vertical" flexItem />
                <Stack direction="column" sx={{ width: 340, flexShrink: 0, height: "100%", minHeight: 0, overflow: "hidden", bgcolor: "background.paper" }}>

                    {/* header (pinned): title + presence + close */}
                    <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1 }}>
                        <ChatBubbleOutlineOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
                        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>{"Chat"}</Typography>
                        <Chip size="small" variant="outlined" color={ onlineCount > 0 ? "success" : "default" } label={ `${ onlineCount } online` } />
                        <ButtonIcon id="chat-close" label={"Close chat"} icon={ <CloseOutlinedIcon fontSize="small" /> } onClick={ () => apply( false ) } />
                    </Box>
                    <Divider />

                    {/* body (scrolls): stub — team chat & presence coming soon */}
                    <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", p: 2 }}>
                        <Stack spacing={ 2 } sx={{ alignItems: "center", textAlign: "center", mt: 4 }}>
                            <ChatBubbleOutlineOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} />
                            <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Team chat is on the way — you'll see who's online and message your team here."}</Typography>
                        </Stack>
                    </Box>

                </Stack>
            </>;
}

export namespace ChatPanel
{
    export const STORAGE_KEY : string = "chat.open";   // persisted open/closed flag ("1" | "0")

    export interface Props
    {
    }
}

export default ChatPanel;
// eof
