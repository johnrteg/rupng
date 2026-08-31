import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, List, ListItemButton, ListItemText, Stack, Typography, CircularProgress } from "@mui/material";
import TagOutlinedIcon      from '@mui/icons-material/TagOutlined';
import LockOutlinedIcon     from '@mui/icons-material/LockOutlined';
import PersonOutlineOutlined from '@mui/icons-material/PersonOutlineOutlined';
import AddOutlinedIcon      from '@mui/icons-material/AddOutlined';

import { Collab, GetCollabRooms, PostCollabRooms, PostCollabDms } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import ButtonIcon from '@widgets/core/ButtonIcon';
import CreateChannelDialog from './CreateChannelDialog';
import NewDmDialog from './NewDmDialog';

//
// ChatRoomList — the room-list pane of the chat panel: the caller's channels + DMs (GetCollabRooms), with
// actions to create a channel or start a new DM. Selecting a room hands its id up to the parent (ChatPanel),
// which swaps this pane for ChatThread.
//
export function ChatRoomList( props : ChatRoomList.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [rooms,setRooms]           = React.useState< Array<Collab.Room> >( [] );
    const [loading,setLoading]       = React.useState< boolean >( true );
    const [creatingChannel,setCreatingChannel] = React.useState< boolean >( false );
    const [startingDm,setStartingDm] = React.useState< boolean >( false );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [] );
    function componentLoaded() : void { void load(); }

    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetCollabRooms.Response> = await appmodel.server.fetch( new GetCollabRooms() );
        if( reply.ok && reply.data ) setRooms( reply.data.records );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onCreateChannel( name : string, visibility : Collab.Visibility ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostCollabRooms.Response> = await appmodel.server.fetch( new PostCollabRooms( { name, visibility } ) );
        if( !reply.ok ) return false;
        await load();
        return true;
    }

    async function onStartDm( userId : string ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostCollabDms.Response> = await appmodel.server.fetch( new PostCollabDms( { userId } ) );
        if( !reply.ok || !reply.data ) return false;
        await load();
        props.onSelectRoom( reply.data.room.roomId );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a DM room has no name — label it with the OTHER member's id (v1 simplification: no cross-service name
    // resolution here; a future pass could denormalize the other member's display name onto the room record)
    function labelFor( room : Collab.Room ) : string
    {
        if( room.type === Collab.RoomType.CHANNEL ) return room.name ?? "(unnamed channel)";
        const otherUserId : string | undefined = room.memberIds.find( ( id : string ) : boolean => id !== props.currentUserId );
        return otherUserId ?? "Direct message";
    }

    function iconFor( room : Collab.Room ) : JSX.Element
    {
        if( room.type === Collab.RoomType.DM ) return <PersonOutlineOutlined fontSize="small" sx={{ color: "text.secondary" }} />;
        return room.visibility === Collab.Visibility.PRIVATE
            ? <LockOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
            : <TagOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <>
                <Stack direction="row" spacing={ 0.5 } sx={{ px: 1.5, py: 1, alignItems: "center" }}>
                    <Typography variant="overline" sx={{ flexGrow: 1, color: "text.secondary" }}>{"Rooms"}</Typography>
                    <ButtonIcon id="chat-new-dm" label={"New direct message"} icon={ <PersonOutlineOutlined fontSize="small" /> } onClick={ () => setStartingDm( true ) } size="small" />
                    <ButtonIcon id="chat-new-channel" label={"Create channel"} icon={ <AddOutlinedIcon fontSize="small" /> } onClick={ () => setCreatingChannel( true ) } size="small" />
                </Stack>

                { loading
                    ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 2, py: 1 }}><CircularProgress size={ 16 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                    : rooms.length === 0
                        ? <Box sx={{ px: 2, py: 1 }}><Typography variant="body2" sx={{ color: "text.secondary" }}>{"No rooms yet — create a channel or start a DM."}</Typography></Box>
                        : <List dense disablePadding>
                              { rooms.map( ( room : Collab.Room ) : JSX.Element =>
                                  <ListItemButton key={ room.roomId } onClick={ () => props.onSelectRoom( room.roomId ) } sx={{ gap: 1 }}>
                                      { iconFor( room ) }
                                      <ListItemText primary={ labelFor( room ) }
                                                    sx={{ "& .MuiListItemText-primary": { fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }} />
                                  </ListItemButton> ) }
                          </List> }

                { creatingChannel && <CreateChannelDialog onCreate={ onCreateChannel } onClose={ () => setCreatingChannel( false ) } /> }
                { startingDm && <NewDmDialog excludeUserId={ props.currentUserId } onStart={ onStartDm } onClose={ () => setStartingDm( false ) } /> }
            </>;
}

export namespace ChatRoomList
{
    export interface Props
    {
        currentUserId : string;
        onSelectRoom  : ( roomId : string ) => void;
    }
}

export default ChatRoomList;
// eof
