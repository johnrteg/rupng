import AppModel from "@model/AppModel";
import LocaleService from "@model/service/LocaleService";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import InfoOutlinedIcon    from '@mui/icons-material/InfoOutlined';

import { Print, GetPrintMailpieces, GetPrintMailpieceTracking } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import ButtonIcon   from '@widgets/core/ButtonIcon';
import TableInput   from '@widgets/core/TableInput';
import SelectInput  from '@widgets/core/SelectInput';
import DialogWindow from '@widgets/core/DialogWindow';

// the status filter choices — "" (all) plus every Print.MailpieceStatus
const ALL_STATUS : string = "";
const STATUS_CHOICES : Array<SelectInput.Choice> =
[
    { value: ALL_STATUS, label: "All statuses" },
    ...Object.values( Print.MailpieceStatus ).map( ( value : Print.MailpieceStatus ) : SelectInput.Choice => ( { value, label: value } ) ),
];

// TableInput row-action ids
enum MailpieceAction { INFO = "info" }

//
// SentPrintPanel — the Print tab of Messages : Sent: the account's mailpiece history + current lifecycle
// status, read via GetPrintMailpieces, newest first; a status filter narrows to (e.g.) just returned/
// undeliverable pieces. The Info action opens a mailpiece's USPS tracking-event timeline.
//
export function SentPrintPanel( _props : SentPrintPanel.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [rows,setRows]       = React.useState< Array<Print.Mailpiece> >( [] );
    const [loading,setLoading] = React.useState< boolean >( true );
    const [status,setStatus]   = React.useState< string >( ALL_STATUS );
    const [detail,setDetail]   = React.useState< Print.Mailpiece | null >( null );
    const [events,setEvents]   = React.useState< Array<Print.TrackingEvent> >( [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [ status ] );

    function componentLoaded() : void { void load(); }

    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetPrintMailpieces.Response> = await appmodel.server.fetch(
            new GetPrintMailpieces( status !== ALL_STATUS ? { status: status as Print.MailpieceStatus } : {} ) );
        if( reply.ok && reply.data ) setRows( reply.data.mailpieces );
        setLoading( false );
    }

    function whenIso( iso : string ) : string { return appmodel.ui.locale.dateTime( new Date( iso ), LocaleService.Format.SHORT ) || ""; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a row's Info action → load + open the tracking-timeline dialog for that mailpiece
    async function onRowAction( action : string, row : TableInput.Row ) : Promise<void>
    {
        if( action !== MailpieceAction.INFO ) return;
        const found : Print.Mailpiece | undefined = rows.find( ( item : Print.Mailpiece ) : boolean => item.mailId === row.id );
        if( !found ) return;
        setDetail( found );
        const reply : RestfulService.Reply<GetPrintMailpieceTracking.Response> = await appmodel.server.fetch( new GetPrintMailpieceTracking( found.mailId ) );
        setEvents( reply.ok && reply.data ? reply.data.events : [] );
    }

    // status cell — a colored chip (delivered reads success, failed/undeliverable/returned as error,
    // suppressed as warning, everything else as neutral)
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const value : string = String( row.status );
        const color : "success" | "warning" | "default" | "error" | "info" =
            value === Print.MailpieceStatus.DELIVERED ? "success" :
            value === Print.MailpieceStatus.FAILED || value === Print.MailpieceStatus.UNDELIVERABLE || value === Print.MailpieceStatus.RETURNED ? "error" :
            value === Print.MailpieceStatus.SUPPRESSED ? "warning" : "info";
        return <Chip size="small" variant="outlined" color={ color } label={ value } />;
    }

    const columns : Array<TableInput.Column> =
    [
        { field: "type",      label: "Type",     type: TableInput.ColumnType.STRING },
        { field: "recipient", label: "Recipient", type: TableInput.ColumnType.STRING },
        { field: "status",    label: "Status",   type: TableInput.ColumnType.CUSTOM, renderer: statusRenderer },
        { field: "provider",  label: "Provider", type: TableInput.ColumnType.STRING },
        { field: "created",   label: "Created",  type: TableInput.ColumnType.STRING },
        { field: "actions",   label: "",         type: TableInput.ColumnType.ACTION },
    ];
    const actions : Array<TableInput.Action> =
    [
        { id: MailpieceAction.INFO, label: "Info", icon: <InfoOutlinedIcon fontSize="small" /> },
    ];
    const tableRows : Array<TableInput.Row> = rows.map( ( row : Print.Mailpiece ) : TableInput.Row => ( {
        id: row.mailId, type: row.type, recipient: `${ row.recipient.city }, ${ row.recipient.region }`,
        status: row.status, provider: row.provider, created: whenIso( row.createdAt ), actions: [ MailpieceAction.INFO ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <>
                <Card variant="outlined">
                    <CardHeader title={"Sent"}
                                subheader={"Mailpieces submitted through this account, and their current lifecycle status."}
                                action={
                                    <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1, alignItems: "center" }}>
                                        <Box sx={{ width: 180 }}><SelectInput id="messages-sent-print-status" label={"Status"} value={ status } choices={ STATUS_CHOICES } onChange={ setStatus } /></Box>
                                        <ButtonIcon id="messages-sent-print-refresh" icon={ <RefreshOutlinedIcon /> } label={"Refresh"} onClick={ () => void load() } />
                                    </Stack>
                                } />
                    <Divider />
                    <CardContent>
                        { loading
                            ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                            : tableRows.length === 0
                                ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Nothing submitted yet."}</Typography>
                                : <TableInput id="messages-sent-print" columns={ columns } data={ tableRows } actions={ actions } onAction={ ( action, row ) => void onRowAction( action, row ) } selectable={ TableInput.Selectable.NONE } /> }
                    </CardContent>
                </Card>

                { detail &&
                    <DialogWindow id="print-mailpiece-tracking" title={`Tracking — ${ detail.recipient.city }, ${ detail.recipient.region }`}
                                  yesLabel={"Close"} minWidth="sm" ready onYes={ async () => true } onClose={ () => setDetail( null ) }>
                        <Stack spacing={ 1 } sx={{ p: 2 }}>
                            { events.length === 0
                                ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No tracking events yet."}</Typography>
                                : events.map( ( event : Print.TrackingEvent, index : number ) : JSX.Element =>
                                    <Stack key={ index } direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                                        <Chip size="small" label={ event.status } />
                                        <Typography variant="body2">{ whenIso( event.occurredAt ) }</Typography>
                                    </Stack> ) }
                        </Stack>
                    </DialogWindow> }
            </>;
}

export namespace SentPrintPanel
{
    export interface Props {}
}

export default SentPrintPanel;
// eof
