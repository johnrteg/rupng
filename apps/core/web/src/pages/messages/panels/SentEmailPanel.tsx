import AppModel from "@model/AppModel";
import LocaleService from "@model/service/LocaleService";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import InfoOutlinedIcon    from '@mui/icons-material/InfoOutlined';

import { Email, GetEmailLog } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import ButtonIcon   from '@widgets/core/ButtonIcon';
import TableInput   from '@widgets/core/TableInput';
import SelectInput  from '@widgets/core/SelectInput';
import SendLogDetailDialog from '@pages/messages/dialogs/SendLogDetailDialog';

// the status filter choices — "" (all) plus every Email.Status
const ALL_STATUS : string = "";
const STATUS_CHOICES : Array<SelectInput.Choice> =
[
    { value: ALL_STATUS, label: "All statuses" },
    ...Object.values( Email.Status ).map( ( value : Email.Status ) : SelectInput.Choice => ( { value, label: value } ) ),
];

// TableInput row-action ids
enum SendLogAction { INFO = "info" }

//
// SentEmailPanel — the Email tab of Messages : Sent (email-8.1): the account's email send history + per-message
// delivery status, read via GetEmailLog, newest first; a status filter narrows to (e.g.) just bounces.
//
export function SentEmailPanel( _props : SentEmailPanel.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [rows,setRows]       = React.useState< Array<Email.SendLog> >( [] );
    const [loading,setLoading] = React.useState< boolean >( true );
    const [status,setStatus]   = React.useState< string >( ALL_STATUS );
    const [detail,setDetail]   = React.useState< Email.SendLog | null >( null );   // Info dialog (null closed)

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [ status ] );

    // (re)load whenever the status filter changes
    function componentLoaded() : void { void load(); }

    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetEmailLog.Response> = await appmodel.server.fetch( new GetEmailLog( status !== ALL_STATUS ? { status: status as Email.Status } : {} ) );
        if( reply.ok && reply.data ) setRows( reply.data.records );
        setLoading( false );
    }

    // format an ISO timestamp via the house locale service
    function whenIso( iso : string ) : string { return appmodel.ui.locale.dateTime( new Date( iso ), LocaleService.Format.SHORT ) || ""; }

    // a row's Info action → open the detail dialog for that message
    function onRowAction( action : string, row : TableInput.Row ) : void
    {
        if( action !== SendLogAction.INFO ) return;
        const found : Email.SendLog | undefined = rows.find( ( item : Email.SendLog ) : boolean => item.messageId === row.id );
        if( found ) setDetail( found );
    }

    // status cell — a colored chip (delivered/opened/clicked read as success, bounced/complained/failed as
    // error, queued/sent/suppressed as neutral/warning)
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const value : string = String( row.status );
        const color : "success" | "warning" | "default" | "error" | "info" =
            value === Email.Status.DELIVERED || value === Email.Status.OPENED || value === Email.Status.CLICKED ? "success" :
            value === Email.Status.BOUNCED || value === Email.Status.COMPLAINED || value === Email.Status.FAILED ? "error" :
            value === Email.Status.SUPPRESSED ? "warning" : "info";
        return <Chip size="small" variant="outlined" color={ color } label={ value } />;
    }

    const columns : Array<TableInput.Column> =
    [
        { field: "to",       label: "To",       type: TableInput.ColumnType.EMAIL },
        { field: "from",     label: "From",     type: TableInput.ColumnType.STRING },
        { field: "subject",  label: "Subject",  type: TableInput.ColumnType.STRING },
        { field: "status",   label: "Status",   type: TableInput.ColumnType.CUSTOM, renderer: statusRenderer },
        { field: "provider", label: "Provider", type: TableInput.ColumnType.STRING },
        { field: "sent",     label: "Sent",     type: TableInput.ColumnType.STRING },
        { field: "actions",  label: "",         type: TableInput.ColumnType.ACTION },
    ];
    const actions : Array<TableInput.Action> =
    [
        { id: SendLogAction.INFO, label: "Info", icon: <InfoOutlinedIcon fontSize="small" /> },
    ];
    const tableRows : Array<TableInput.Row> = rows.map( ( row : Email.SendLog ) : TableInput.Row => ( {
        id: row.messageId, to: row.to, from: row.from ?? "", subject: row.subject, status: row.status,
        provider: row.provider ?? "", sent: whenIso( row.createdAt ), actions: [ SendLogAction.INFO ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <>
                <Card variant="outlined">
                    <CardHeader title={"Sent"}
                                subheader={"Messages sent through this account, and their current delivery status."}
                                action={
                                    <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1, alignItems: "center" }}>
                                        <Box sx={{ width: 180 }}><SelectInput id="messages-sent-email-status" label={"Status"} value={ status } choices={ STATUS_CHOICES } onChange={ setStatus } /></Box>
                                        <ButtonIcon id="messages-sent-email-refresh" icon={ <RefreshOutlinedIcon /> } label={"Refresh"} onClick={ () => void load() } />
                                    </Stack>
                                } />
                    <Divider />
                    <CardContent>
                        { loading
                            ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                            : tableRows.length === 0
                                ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Nothing sent yet."}</Typography>
                                : <TableInput id="messages-sent-email" columns={ columns } data={ tableRows } actions={ actions } onAction={ onRowAction } selectable={ TableInput.Selectable.NONE } /> }
                    </CardContent>
                </Card>

                { detail && <SendLogDetailDialog record={ detail } onClose={ () => setDetail( null ) } /> }
            </>;
}

export namespace SentEmailPanel
{
    export interface Props {}
}

export default SentEmailPanel;
// eof
