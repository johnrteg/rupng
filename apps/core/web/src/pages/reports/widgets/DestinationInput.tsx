//
import React from 'react';
import { JSX } from "react";

import { Stack } from "@mui/material";

import type { Type } from '@repo/common';
import { Report } from '@repo/api';

import SelectInput from '@widgets/core/SelectInput';
import TextInput   from '@widgets/core/TextInput';
import UrlInput    from '@widgets/core/UrlInput';

const KIND_CHOICES : Array<SelectInput.Choice> = SelectInput.enumToChoices( Report.DestinationKind );

//
// DestinationInput — the ONE shared editor for a `Report.Destination`, reused by the submit + schedule
// dialogs. `config` is kind-specific loose Json (report only records + forwards it, never interprets it) —
// this renders the single field each kind actually needs: EMAIL -> `to`, WEBHOOK -> `url`; DOWNLOAD needs
// no config at all.
//
export function DestinationInput( props : DestinationInput.Props ) : JSX.Element
{
    // the config's current string fields (read defensively — config is loose Json, may be missing/wrong-typed)
    const config : Type.JsonObject = ( props.value.config as Type.JsonObject ) ?? {};
    const emailTo : string    = typeof config.to  === "string" ? config.to  : "";
    const webhookUrl : string = typeof config.url === "string" ? config.url : "";

    ////////////////////////////////////////////////////////////////////////////////////////////
    // switching kind resets `config` to that kind's empty shape
    function onKindChange( kind : string ) : void
    {
        const next : Report.DestinationKind = kind as Report.DestinationKind;
        if( next === Report.DestinationKind.EMAIL )        props.onChange( { kind: next, config: { to: "" } } );
        else if( next === Report.DestinationKind.WEBHOOK ) props.onChange( { kind: next, config: { url: "" } } );
        else                                                props.onChange( { kind: next, config: {} } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onEmailToChange( to : string ) : void
    {
        props.onChange( { ...props.value, config: { ...config, to } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onWebhookUrlChange( url : string ) : void
    {
        props.onChange( { ...props.value, config: { ...config, url } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack direction="row" spacing={ 1 } sx={{ alignItems: "flex-start" }}>
                <SelectInput id="destination-kind" label={"Destination"} value={ props.value.kind } choices={ KIND_CHOICES } onChange={ onKindChange } sx={{ width: 180 }} />
                { props.value.kind === Report.DestinationKind.EMAIL &&
                    <TextInput id="destination-email-to" label={"Send to (email)"} value={ emailTo } onChange={ onEmailToChange } fullWidth /> }
                { props.value.kind === Report.DestinationKind.WEBHOOK &&
                    <UrlInput id="destination-webhook-url" label={"Webhook URL"} value={ webhookUrl } onChange={ onWebhookUrlChange } /> }
            </Stack>;
}

export namespace DestinationInput
{
    export interface Props
    {
        value    : Report.Destination;
        onChange : ( value : Report.Destination ) => void;
    }
}

export default DestinationInput;
// eof
