//
import React from 'react';
import { JSX } from "react";

import { Box, Divider, Stack, Typography } from "@mui/material";
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import CloseOutlinedIcon             from '@mui/icons-material/CloseOutlined';

import AppModel      from '@model/AppModel';
import PubSubService from '@model/service/PubSubService';
import Subscriber    from '@widgets/core/Subscriber';
import ButtonIcon    from '@widgets/core/ButtonIcon';
import ChatRoomList  from '@widgets/app/chat/ChatRoomList';
import ChatThread    from '@widgets/app/chat/ChatThread';

//
// ChatPanel — the persistent right-side chat surface (Slack-like rooms/DMs — apps/core/collab). It sits
// beside the page content on every authed page (mounted by AuthPage) and stays open across navigation, like
// the nav. The nav "Chat" leaf toggles it via a PubSub CHAT event; its own header close button toggles it
// off. Open/closed is persisted in localStorage so it survives page changes + reloads. Renders nothing while
// closed (no width). Shows a room list (ChatRoomList) or, once a room is selected, its live thread
// (ChatThread) — v1 chat only, no Y.js/Hocuspocus document co-editing (see apps/core/collab/SPECS.md).
//
export function ChatPanel( props : ChatPanel.Props ) : JSX.Element | null
{
    const appmodel : AppModel = AppModel.instance();

    const [open,setOpen]     = React.useState< boolean >( appmodel.localStorage.get( ChatPanel.STORAGE_KEY ) === "1" );
    const [roomId,setRoomId] = React.useState< string | null >( null );

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

                    {/* header (pinned): title + close */}
                    <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1 }}>
                        <ChatBubbleOutlineOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
                        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>{"Chat"}</Typography>
                        <ButtonIcon id="chat-close" label={"Close chat"} icon={ <CloseOutlinedIcon fontSize="small" /> } onClick={ () => apply( false ) } />
                    </Box>
                    <Divider />

                    {/* body (scrolls): room list, or the selected room's live thread */}
                    <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
                        { roomId === null
                            ? <ChatRoomList currentUserId={ appmodel.auth.login?.userId ?? "" } onSelectRoom={ setRoomId } />
                            : <ChatThread roomId={ roomId } onBack={ () => setRoomId( null ) } /> }
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
