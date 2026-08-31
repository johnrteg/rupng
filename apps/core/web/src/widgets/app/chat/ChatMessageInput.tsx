//
import React from 'react';
import { JSX } from "react";

import { Box, Stack } from "@mui/material";
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';

import ButtonIcon from '@widgets/core/ButtonIcon';
import TextInput  from '@widgets/core/TextInput';

//
// ChatMessageInput — the compose row at the bottom of a ChatThread. Enter sends (Shift+Enter is a newline,
// handled by TextInput's own multiline behavior); the send button mirrors it for mouse/touch.
//
export function ChatMessageInput( props : ChatMessageInput.Props ) : JSX.Element
{
    const [text,setText] = React.useState< string >( "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onSend() : void
    {
        const trimmed : string = text.trim();
        if( trimmed === "" ) return;
        props.onSend( trimmed );
        setText( "" );
    }

    // Enter (without Shift) sends — the wrapping Box renders a div, so the handler is typed for that
    function onKeyDown( event : React.KeyboardEvent<HTMLDivElement> ) : void
    {
        if( event.key === "Enter" && !event.shiftKey ) { event.preventDefault(); onSend(); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack direction="row" spacing={ 1 } sx={{ p: 1, alignItems: "flex-end" }}>
                <Box sx={{ flexGrow: 1 }} onKeyDown={ onKeyDown }>
                    <TextInput id="chat-message-input" label={""} value={ text } onChange={ setText } multiline fullWidth placeHolder={"Message…"} />
                </Box>
                <ButtonIcon id="chat-message-send" label={"Send"} icon={ <SendOutlinedIcon fontSize="small" /> } onClick={ onSend } disabled={ text.trim() === "" } />
            </Stack>;
}

export namespace ChatMessageInput
{
    export interface Props
    {
        onSend : ( text : string ) => void;
    }
}

export default ChatMessageInput;
// eof
