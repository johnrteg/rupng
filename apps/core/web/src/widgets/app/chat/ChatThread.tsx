import AppModel from "@model/AppModel";
import LocaleService from "@model/service/LocaleService";
//
import React from 'react';
import { JSX } from "react";

import { Box, Stack, Typography, Divider, CircularProgress } from "@mui/material";
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';

import { Collab, GetCollabMessages } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import ButtonIcon  from '@widgets/core/ButtonIcon';
import Subscriber  from '@widgets/core/Subscriber';
import ChatMessageInput from './ChatMessageInput';
import CollabSocketService from '@model/service/CollabSocketService';
import { useActivityStatus, ActivityStatus } from '@utils/useActivityStatus';

//
// ChatThread — the live session for ONE open room: history (GetCollabMessages) + the room socket
// (CollabSocketService) for real-time send/receive. Owns the socket's connect/disconnect lifecycle (opens on
// mount / roomId change, closes on unmount) and reports this client's active/idle signal (useActivityStatus)
// over the socket whenever it CHANGES.
//
export function ChatThread( props : ChatThread.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const activity : ActivityStatus = useActivityStatus();

    const [messages,setMessages] = React.useState< Array<Collab.Message> >( [] );
    const [loading,setLoading]   = React.useState< boolean >( true );
    const socketRef = React.useRef< CollabSocketService | null >( null );
    const lastReportedActivity = React.useRef< ActivityStatus | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( roomChanged, [ props.roomId ] );

    // (re)connect the socket + reload history whenever the OPEN room changes; disconnect on unmount/switch
    function roomChanged() : () => void
    {
        void loadHistory();
        const socket : CollabSocketService = new CollabSocketService( appmodel, props.roomId );
        socketRef.current = socket;
        socket.connect();
        return () : void => socket.disconnect();
    }

    async function loadHistory() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetCollabMessages.Response> = await appmodel.server.fetch( new GetCollabMessages( props.roomId ) );
        if( reply.ok && reply.data ) setMessages( reply.data.records );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // report the activity signal ONLY on change (never continuously) — active/idle only, ONLINE/OFFLINE are
    // derived server-side from the connection itself
    React.useEffect( activityChanged, [ activity ] );
    function activityChanged() : void
    {
        if( lastReportedActivity.current === activity ) return;
        lastReportedActivity.current = activity;
        socketRef.current?.sendPresenceStatus( activity === "active" ? Collab.PresenceStatus.ACTIVE : Collab.PresenceStatus.IDLE );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a frame arrived on this room's socket — only `chat.message` grows the visible list in v1 (presence/evict
    // are logged, not yet rendered inline — a documented, deferred UI polish item)
    function onFrame( frame : CollabSocketService.ServerFrame ) : void
    {
        if( frame.op === "chat.message" ) setMessages( ( prior : Array<Collab.Message> ) : Array<Collab.Message> => [ ...prior, frame.message ] );
        else if( frame.op === "evict" ) props.onBack();   // removed from the room — bounce back to the list
    }

    function onSend( text : string ) : void { socketRef.current?.sendChat( text ); }

    function whenIso( iso : string ) : string { return appmodel.ui.locale.dateTime( new Date( iso ), LocaleService.Format.SHORT ) || ""; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack direction="column" sx={{ height: "100%", minHeight: 0 }}>
                <Subscriber key={ props.roomId } event={ CollabSocketService.topicFor( props.roomId ) } onChange={ onFrame } />

                <Stack direction="row" spacing={ 1 } sx={{ px: 1, py: 1, alignItems: "center", flexShrink: 0 }}>
                    <ButtonIcon id="chat-thread-back" label={"Back to rooms"} icon={ <ArrowBackOutlinedIcon fontSize="small" /> } onClick={ props.onBack } size="small" />
                </Stack>
                <Divider />

                <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", p: 1.5 }}>
                    { loading
                        ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 16 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                        : messages.length === 0
                            ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No messages yet — say hello."}</Typography>
                            : <Stack spacing={ 1 }>
                                  { messages.map( ( message : Collab.Message ) : JSX.Element =>
                                      <Box key={ message.messageId }>
                                          <Stack direction="row" spacing={ 1 } sx={{ alignItems: "baseline" }}>
                                              <Typography variant="caption" sx={{ fontWeight: 600 }}>{ message.authorId }</Typography>
                                              <Typography variant="caption" sx={{ color: "text.secondary" }}>{ whenIso( message.createdAt ) }</Typography>
                                          </Stack>
                                          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{ message.text }</Typography>
                                      </Box> ) }
                              </Stack> }
                </Box>

                <Divider />
                <ChatMessageInput onSend={ onSend } />
            </Stack>;
}

export namespace ChatThread
{
    export interface Props
    {
        roomId : string;
        onBack : () => void;
    }
}

export default ChatThread;
// eof
