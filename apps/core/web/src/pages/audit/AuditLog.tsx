import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';

import { Access, Events } from '@repo/system';
import { Audit, GetAuditEvents, Paging } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage      from '@widgets/app/AuthPage';
import SearchInput   from '@widgets/core/SearchInput';
import SelectInput    from '@widgets/core/SelectInput';
import DateInput      from '@widgets/core/DateInput';
import ButtonIcon    from '@widgets/core/ButtonIcon';
import ChipStatus    from '@widgets/core/ChipStatus';
import TableInput    from '@widgets/core/TableInput';
import Colors        from '@utils/Colors';
import AccountChange from '@widgets/app/AccountChange';
import AuditEventDetailDialog from '@pages/audit/dialogs/AuditEventDetailDialog';

// TableInput row-action ids
enum AuditAction { VIEW = "view" }

//
// AuditLog — the acting account's own audit trail (audit-5.1): who did what, to what, when, and
// whether it succeeded. Read-only (the trail is write-once via the platform audit queue — there is no
// create/edit/delete here). Filters (action/actor free-text, outcome, date range) are server-side —
// GetAuditEvents.getMappings() maps them onto real query params.
//
export function AuditLog( _props : AuditLog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [events,setEvents]     = React.useState< Array<Audit.EventView> >( [] );
    const [page,setPage]         = React.useState< Paging.Page | null >( null );
    const [loading,setLoading]   = React.useState< boolean >( true );
    const [action,setAction]     = React.useState< string >( "" );
    const [actorId,setActorId]   = React.useState< string >( "" );
    const [outcome,setOutcome]   = React.useState< string >( "" );
    const [from,setFrom]         = React.useState< Date | null >( null );
    const [to,setTo]             = React.useState< Date | null >( null );
    const [detail,setDetail]     = React.useState< Audit.EventView | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load a page of the acting account's audit trail (token paging — TableInput drives next via onNext)
    async function load( token? : string ) : Promise<void>
    {
        setLoading( true );
        const query : GetAuditEvents.Query =
        {
            start:   token,
            action:  ( action || undefined ) as Events.Action | undefined,
            actorId: actorId || undefined,
            outcome: ( outcome || undefined ) as Events.Outcome | undefined,
            from:    from ? from.toISOString() : undefined,
            to:      to ? to.toISOString() : undefined,
        };
        const reply : RestfulService.Reply<GetAuditEvents.Response> = await appmodel.server.fetch( new GetAuditEvents( query ) );
        if( reply.ok && reply.data ) { setEvents( reply.data.records ); setPage( reply.data.page ); }
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a row action → open the detail dialog for that event
    function onRowAction( action_ : string, row : TableInput.Row ) : void
    {
        if( action_ !== AuditAction.VIEW ) return;
        const found : Audit.EventView | undefined = events.find( ( entry : Audit.EventView ) => String( entry.seq ) === row.id );
        if( found ) setDetail( found );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // map an outcome → a central color status
    function outcomeColor( value : Events.Outcome ) : Colors.Status
    {
        switch( value )
        {
            case Events.Outcome.SUCCESS: return Colors.Status.ACTIVE;
            case Events.Outcome.DENIED:  return Colors.Status.PENDING;
            default:                     return Colors.Status.ERROR;   // FAILURE
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // outcome cell — a uniform status chip (central Colors.Status → theme color)
    function outcomeRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        return <ChipStatus size="small" label={ String( row.outcome ) } status={ outcomeColor( row.outcome as Events.Outcome ) } />;
    }

    // ── TableInput config ──────────────────────────────────────────────────────────────────────
    const auditActions : Array<TableInput.Action> =
    [
        { id: AuditAction.VIEW, label: "View", icon: <VisibilityOutlinedIcon fontSize="small" /> },
    ];

    const auditColumns : Array<TableInput.Column> =
    [
        { field: "occurredAt", label: "When",   type: TableInput.ColumnType.DATETIME },
        { field: "action",     label: "Action", type: TableInput.ColumnType.STRING },
        { field: "actor",      label: "Actor",  type: TableInput.ColumnType.STRING },
        { field: "target",     label: "Target", type: TableInput.ColumnType.STRING },
        { field: "outcome",    label: "Outcome", type: TableInput.ColumnType.CUSTOM, renderer: outcomeRenderer },
        { field: "actions",    label: "",       type: TableInput.ColumnType.ACTION },
    ];

    const auditRows : Array<TableInput.Row> = events.map( ( event : Audit.EventView ) => ( {
        id:         String( event.seq ),
        occurredAt: event.occurredAt,
        action:     event.action,
        actor:      `${ event.actor.kind }:${ event.actor.id }`,
        target:     `${ event.target.type }:${ event.target.id }`,
        outcome:    event.outcome,
        actions:    [ AuditAction.VIEW ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.ACCOUNT } title={"Audit Log"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Audit Log"}
                                    subheader={"Who did what, to what, when, and whether it succeeded — this account's immutable action trail."}
                                    action={
                                        <ButtonIcon id="audit-refresh" label={"Refresh"} size="small" disabled={ loading } icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void load() } />
                                    } />
                        <Divider />
                        <CardContent>
                            <Stack direction="row" spacing={ 1 } sx={{ mb: 2, flexWrap: "wrap" }}>
                                <SearchInput id="audit-action" label={"Action"} value={ action } onChange={ setAction } sx={{ width: 200 }} />
                                <SearchInput id="audit-actor" label={"Actor id"} value={ actorId } onChange={ setActorId } sx={{ width: 160 }} />
                                <SelectInput id="audit-outcome" label={"Outcome"} value={ outcome }
                                             choices={ [ { value: "", label: "Any" }, ...SelectInput.enumToChoices( Events.Outcome ) ] }
                                             onChange={ setOutcome } sx={{ width: 140 }} />
                                <DateInput id="audit-from" label={"From"} value={ from } onChange={ setFrom } clearable width={ 160 } />
                                <DateInput id="audit-to" label={"To"} value={ to } onChange={ setTo } clearable width={ 160 } />
                                <ButtonIcon id="audit-apply" label={"Apply filters"} size="small" disabled={ loading } icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void load() } />
                            </Stack>
                            { loading &&
                                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 1 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                            { !loading && events.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No audit events match these filters."}</Typography> }
                            { !loading && events.length > 0 &&
                                <TableInput id="audit-log"
                                            columns={ auditColumns }
                                            data={ auditRows }
                                            actions={ auditActions }
                                            onAction={ onRowAction }
                                            selectable={ TableInput.Selectable.NONE }
                                            paging={ TableInput.Paging.TOKEN }
                                            total={ page?.total }
                                            next={ page?.next }
                                            onNext={ ( token : string ) : void => void load( token ) } /> }
                        </CardContent>
                    </Card>
                </Box>

                <AccountChange onClear={ () => setEvents( [] ) } onRefresh={ () => void load() } />

                { detail && <AuditEventDetailDialog event={ detail } onClose={ () => setDetail( null ) } /> }
            </AuthPage>;
}

export namespace AuditLog
{
    export interface Props
    {
    }
}

export default AuditLog;
