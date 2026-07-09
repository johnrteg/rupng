import AppModel from "@model/AppModel";
import LocaleService from "@model/service/LocaleService";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import BlockOutlinedIcon   from '@mui/icons-material/BlockOutlined';

import { Access } from '@repo/system';
import { AuthAction, GetAuthActions, PostAuthActionCancel } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage    from '@widgets/app/AuthPage';
import ButtonIcon  from '@widgets/core/ButtonIcon';
import TableInput  from '@widgets/core/TableInput';
import SelectInput from '@widgets/core/SelectInput';
import AlertPrompt from '@widgets/core/AlertPrompt';
import SnackAlert  from '@widgets/core/SnackAlert';

// the status filter choices
const STATUS_CHOICES : Array<SelectInput.Choice> = Object.values( AuthAction.Status ).map( ( value : AuthAction.Status ) : SelectInput.Choice => ( { value, label: value } ) );

//
// Settings : Actions — the app/root staff view of the pending-action queue (verify / reset / mfa / invite /
// unsubscribe). Shows each request, its status, when it was created + expires, and lets staff REVOKE a pending
// one before it's used. Rows auto-expire via the DDB TTL. Reads `auth_actions` via GetAuthActions.
//
export function SettingsActions( props : SettingsActions.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [rows,setRows]           = React.useState< Array<AuthAction.Entity> >( [] );
    const [loading,setLoading]     = React.useState< boolean >( true );
    const [status,setStatus]       = React.useState< AuthAction.Status >( AuthAction.Status.PENDING );
    const [confirmCancel,setConfirmCancel] = React.useState< string | null >( null );
    const [snack,setSnack]         = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [ status ] );

    // (re)load whenever the status filter changes
    function componentLoaded() : void { void load(); }

    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetAuthActions.Response> = await appmodel.server.fetch( new GetAuthActions( { status } ) );
        if( reply.ok && reply.data ) setRows( reply.data.records );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // revoke a pending action (confirmed) — its landing link stops working
    async function onCancelAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( action === AlertPrompt.Action.YES && confirmCancel !== null )
        {
            const reply : RestfulService.Reply<PostAuthActionCancel.Response> = await appmodel.server.fetch( new PostAuthActionCancel( confirmCancel ) );
            if( reply.ok ) { setSnack( { message: "Request revoked.", severity: "success" } ); void load(); }
            else setSnack( { message: "Could not revoke the request.", severity: "error" } );
        }
        setConfirmCancel( null );
    }

    // a row action → revoke
    function onAction( _action : string, row : TableInput.Row ) : void { setConfirmCancel( row.id ); }

    // format an ISO / epoch-seconds timestamp via the house locale service
    function whenIso( iso : string ) : string { return appmodel.ui.locale.dateTime( new Date( iso ), LocaleService.Format.SHORT ) || ""; }
    function whenEpoch( secs : number ) : string { return appmodel.ui.locale.dateTime( new Date( secs * 1000 ), LocaleService.Format.SHORT ) || ""; }

    // status cell — colored chip
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const value : string = String( row.status );
        const color : "success" | "warning" | "default" | "info" = value === AuthAction.Status.PENDING ? "info" : value === AuthAction.Status.CONSUMED ? "success" : value === AuthAction.Status.EXPIRED ? "warning" : "default";
        return <Chip size="small" variant="outlined" color={ color } label={ value } />;
    }

    const columns : Array<TableInput.Column> =
    [
        { field: "type",    label: "Type",    type: TableInput.ColumnType.STRING },
        { field: "target",  label: "Sent to", type: TableInput.ColumnType.STRING },
        { field: "status",  label: "Status",  type: TableInput.ColumnType.CUSTOM, renderer: statusRenderer },
        { field: "created", label: "Created", type: TableInput.ColumnType.STRING },
        { field: "expires", label: "Expires", type: TableInput.ColumnType.STRING },
        { field: "actions", label: "",        type: TableInput.ColumnType.ACTION },
    ];
    const actions : Array<TableInput.Action> = [ { id: "revoke", label: "Revoke", icon: <BlockOutlinedIcon fontSize="small" /> } ];
    const tableRows : Array<TableInput.Row> = rows.map( ( row : AuthAction.Entity ) : TableInput.Row => ( {
        id: row.actionId, type: row.type, target: row.target, status: row.status,
        created: whenIso( row.createdAt ), expires: whenEpoch( row.expiresAt ),
        actions: row.status === AuthAction.Status.PENDING ? [ "revoke" ] : [],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AppRole.APPLICATION } title={"Settings : Actions"}>
                <Box sx={{ p: 2 }}>
                    <Card variant="outlined">
                        <CardHeader title={"Pending actions"}
                                    subheader={"Email verification / password reset / MFA / invite / unsubscribe requests — see their status and revoke a pending one before it's used. Expired requests fade off automatically."}
                                    action={
                                        <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1, alignItems: "center" }}>
                                            <Box sx={{ width: 180 }}><SelectInput id="actions-status" label={"Status"} value={ status } choices={ STATUS_CHOICES } onChange={ ( value : string ) : void => setStatus( value as AuthAction.Status ) } /></Box>
                                        </Stack>
                                    } />
                        <Divider />
                        <CardContent>
                            { loading
                                ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                                : tableRows.length === 0
                                    ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No requests with this status."}</Typography>
                                    : <TableInput id="auth-actions" columns={ columns } data={ tableRows } actions={ actions } onAction={ onAction } selectable={ TableInput.Selectable.NONE } /> }
                        </CardContent>
                    </Card>
                </Box>

                { confirmCancel !== null &&
                    <AlertPrompt id="action-cancel" type={ AlertPrompt.Type.WARNING } title={"Revoke request"}
                                 message={"Revoke this pending request? Its link will stop working."}
                                 yesText={"Revoke"} yesColor={"error"} cancelText={"Cancel"} onAction={ onCancelAction } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace SettingsActions
{
    export interface Props
    {
    }
}

export default SettingsActions;
// eof
