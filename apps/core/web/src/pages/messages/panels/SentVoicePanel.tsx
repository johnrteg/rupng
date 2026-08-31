import AppModel from "@model/AppModel";
import LocaleService from "@model/service/LocaleService";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import InfoOutlinedIcon    from '@mui/icons-material/InfoOutlined';

import { Voice, GetVoiceCallsLog } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import ButtonIcon  from '@widgets/core/ButtonIcon';
import TableInput  from '@widgets/core/TableInput';
import SelectInput from '@widgets/core/SelectInput';
import VoiceCallDetailDialog from '@pages/messages/dialogs/VoiceCallDetailDialog';

// the status filter choices — "" (all) plus every Voice.Status
const ALL_STATUS : string = "";
const STATUS_CHOICES : Array<SelectInput.Choice> =
[
    { value: ALL_STATUS, label: "All statuses" },
    ...Object.values( Voice.Status ).map( ( value : Voice.Status ) : SelectInput.Choice => ( { value, label: value } ) ),
];

// TableInput row-action ids
enum CallLogAction { INFO = "info" }

//
// SentVoicePanel — the Voice tab of Messages : Sent: the account's placed-call history + per-call outcome,
// read via GetVoiceCallsLog, newest first; a status filter narrows to (e.g.) just voicemail drops.
//
export function SentVoicePanel( _props : SentVoicePanel.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [rows,setRows]       = React.useState< Array<Voice.CallLog> >( [] );
    const [loading,setLoading] = React.useState< boolean >( true );
    const [status,setStatus]   = React.useState< string >( ALL_STATUS );
    const [detail,setDetail]   = React.useState< Voice.CallLog | null >( null );   // Info dialog (null closed)

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [ status ] );

    // (re)load whenever the status filter changes
    function componentLoaded() : void { void load(); }

    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetVoiceCallsLog.Response> = await appmodel.server.fetch( new GetVoiceCallsLog( status !== ALL_STATUS ? { status: status as Voice.Status } : {} ) );
        if( reply.ok && reply.data ) setRows( reply.data.records );
        setLoading( false );
    }

    // format an ISO timestamp via the house locale service
    function whenIso( iso : string ) : string { return appmodel.ui.locale.dateTime( new Date( iso ), LocaleService.Format.SHORT ) || ""; }

    // a row's Info action → open the detail dialog for that call
    function onRowAction( action : string, row : TableInput.Row ) : void
    {
        if( action !== CallLogAction.INFO ) return;
        const found : Voice.CallLog | undefined = rows.find( ( item : Voice.CallLog ) : boolean => item.callId === row.id );
        if( found ) setDetail( found );
    }

    // status cell — a colored chip (answered reads success, failed/opted-out as error, no-answer/busy/
    // suppressed as warning, everything else (queued/ringing/voicemail) as neutral)
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const value : string = String( row.status );
        const color : "success" | "warning" | "default" | "error" | "info" =
            value === Voice.Status.ANSWERED ? "success" :
            value === Voice.Status.FAILED || value === Voice.Status.OPTED_OUT ? "error" :
            value === Voice.Status.NO_ANSWER || value === Voice.Status.BUSY || value === Voice.Status.SUPPRESSED ? "warning" : "info";
        return <Chip size="small" variant="outlined" color={ color } label={ value } />;
    }

    const columns : Array<TableInput.Column> =
    [
        { field: "to",       label: "To",       type: TableInput.ColumnType.PHONE },
        { field: "callerId", label: "Caller ID", type: TableInput.ColumnType.PHONE },
        { field: "status",   label: "Status",   type: TableInput.ColumnType.CUSTOM, renderer: statusRenderer },
        { field: "provider", label: "Provider", type: TableInput.ColumnType.STRING },
        { field: "duration", label: "Duration", type: TableInput.ColumnType.STRING },
        { field: "placed",   label: "Placed",   type: TableInput.ColumnType.STRING },
        { field: "actions",  label: "",         type: TableInput.ColumnType.ACTION },
    ];
    const actions : Array<TableInput.Action> =
    [
        { id: CallLogAction.INFO, label: "Info", icon: <InfoOutlinedIcon fontSize="small" /> },
    ];
    const tableRows : Array<TableInput.Row> = rows.map( ( row : Voice.CallLog ) : TableInput.Row => ( {
        id: row.callId, to: row.to, callerId: row.callerId, status: row.status, provider: row.provider,
        duration: row.durationSec !== undefined ? `${ row.durationSec }s` : "", placed: whenIso( row.createdAt ),
        actions: [ CallLogAction.INFO ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <>
                <Card variant="outlined">
                    <CardHeader title={"Sent"}
                                subheader={"Calls placed through this account, and their current outcome."}
                                action={
                                    <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1, alignItems: "center" }}>
                                        <Box sx={{ width: 180 }}><SelectInput id="messages-sent-voice-status" label={"Status"} value={ status } choices={ STATUS_CHOICES } onChange={ setStatus } /></Box>
                                        <ButtonIcon id="messages-sent-voice-refresh" icon={ <RefreshOutlinedIcon /> } label={"Refresh"} onClick={ () => void load() } />
                                    </Stack>
                                } />
                    <Divider />
                    <CardContent>
                        { loading
                            ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                            : tableRows.length === 0
                                ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Nothing placed yet."}</Typography>
                                : <TableInput id="messages-sent-voice" columns={ columns } data={ tableRows } actions={ actions } onAction={ onRowAction } selectable={ TableInput.Selectable.NONE } /> }
                    </CardContent>
                </Card>

                { detail && <VoiceCallDetailDialog record={ detail } onClose={ () => setDetail( null ) } /> }
            </>;
}

export namespace SentVoicePanel
{
    export interface Props {}
}

export default SentVoicePanel;
// eof
