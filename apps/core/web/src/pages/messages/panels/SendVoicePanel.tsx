import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, CircularProgress, Divider, Stack } from "@mui/material";
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';

import { Voice, GetVoiceNumbers, PostVoiceCallsTest } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import SnackAlert     from '@widgets/core/SnackAlert';
import TelephoneInput from '@widgets/core/TelephoneInput';
import SelectInput    from '@widgets/core/SelectInput';
import TextInput      from '@widgets/core/TextInput';

//
// SendVoicePanel — the Voice tab of Messages : Send. An ad-hoc "place a test call" tool: composes a TTS
// message, picks one of the account's configured caller-ID numbers, and places it via PostVoiceCallsTest — the
// one user-facing dial route (always addressed at a number the composer controls, same enqueue/gate/dispatch
// path as a real send). A full bulk/segment voice send has no `@repo/api` endpoint yet (see PostVoiceCallsBulk
// vs this — bulk is S2S-only today), so this mirrors SendEmailPanel's compose-and-enqueue shape scoped to what
// the API actually supports: one destination at a time.
//
export function SendVoicePanel( _props : SendVoicePanel.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [numbers,setNumbers] = React.useState< Array<Voice.NumberEntry> >( [] );
    const [to,setTo]           = React.useState< string >( "" );
    const [callerId,setCallerId] = React.useState< string >( "" );
    const [text,setText]       = React.useState< string >( "" );
    const [sending,setSending] = React.useState< boolean >( false );
    const [snack,setSnack]     = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    const ready : boolean = to.trim() !== "" && callerId !== "" && text.trim() !== "" && !sending;

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [] );

    // load the account's configured caller-ID numbers once, defaulting the picker to the first one
    function componentLoaded() : void { void loadNumbers(); }

    async function loadNumbers() : Promise<void>
    {
        const reply : RestfulService.Reply<GetVoiceNumbers.Response> = await appmodel.server.fetch( new GetVoiceNumbers() );
        if( !reply.ok || !reply.data ) return;
        setNumbers( reply.data.numbers );
        if( reply.data.numbers.length > 0 ) setCallerId( reply.data.numbers[ 0 ].callerId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onSend() : Promise<void>
    {
        setSending( true );
        const sent : RestfulService.Reply<PostVoiceCallsTest.Response> = await appmodel.server.fetch( new PostVoiceCallsTest( {
            to: to.trim(), callerId, message: { kind: "tts", text: text.trim() },
        } ) );

        setSending( false );
        if( !sent.ok )
        {
            setSnack( { message: RestfulService.error( sent, "Could not place the call" ), severity: "error" } );
            return;
        }

        setSnack( { message: "Call queued — track its status in Messages : Sent.", severity: "success" } );
        setTo( "" ); setText( "" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const numberChoices : Array<SelectInput.Choice> = numbers.map( ( entry : Voice.NumberEntry ) : SelectInput.Choice => ( { value: entry.callerId, label: entry.label ? `${ entry.label } (${ entry.callerId })` : entry.callerId } ) );

    return  <>
                <Box sx={{ p: 2, mx: "auto", maxWidth: 720, display: "flex", flexDirection: "column", gap: 2 }}>
                    <Card variant="outlined">
                        <CardHeader title={"Place a test call"} subheader={"Dial a number you control to verify the message before a real send"} />
                        <Divider />
                        <CardContent>
                            <Stack spacing={ 2 }>
                                <TelephoneInput id="messages-send-voice-to" label={"To"} value={ to } fullWidth onChange={ setTo } />
                                <SelectInput id="messages-send-voice-caller-id" label={"Caller ID"} value={ callerId } choices={ numberChoices }
                                             disabled={ numberChoices.length === 0 } onChange={ setCallerId } />
                                <TextInput id="messages-send-voice-text" label={"Message (spoken via text-to-speech)"} value={ text } multiline onChange={ setText } />

                                <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
                                    <Button variant="contained" disabled={ !ready }
                                            startIcon={ sending ? <CircularProgress size={ 16 } color="inherit" /> : <SendOutlinedIcon /> }
                                            onClick={ () => void onSend() }>
                                        { sending ? "Calling…" : "Call" }
                                    </Button>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                </Box>

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </>;
}

export namespace SendVoicePanel
{
    export interface Props {}
}

export default SendVoicePanel;
// eof
