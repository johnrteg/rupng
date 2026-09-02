import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";

import { GetStaffAuditEvents, PostAuditLegalHold, Audit, Paging } from "@repo/api";
import type { ApiResponse, ServiceRole } from "../../../shared/types";
import { api } from "../../api";
import { LegalHoldDialog } from "./LegalHoldDialog";

//
// AuditPanel — the audit service's tab (registered only for `service === "audit"` in ConsoleView.tsx):
// a cross-tenant staff/auditor view of the trail (GetStaffAuditEvents) + placing/releasing legal holds
// (PostAuditLegalHold). Both are REAL, gateway-authenticated endpoints (Access.APPLICATION / ROOT) —
// unlike every other Console panel, there's no dev bypass, so this panel asks for a staff bearer token
// up front and attaches it as `Authorization: Bearer <token>` on every call via the SAME `api.apiSend`
// bridge the generic "API" tab already uses (no new IPC/main-process plumbing).
//
export function AuditPanel( { roles } : { service : string; roles : Array<ServiceRole> } )
{
    const port : number = useMemo<number>( () => roles.find( ( r ) => r.role === "main" )?.port ?? roles[ 0 ]?.port ?? 8290, [ roles ] );

    const [ token, setToken ]       = useState<string>( "" );
    const [ accountId, setAccountId ] = useState<string>( "" );
    const [ actorId, setActorId ]   = useState<string>( "" );
    const [ action, setAction ]     = useState<string>( "" );
    const [ events, setEvents ]     = useState<Array<Audit.EventView>>( [] );
    const [ page, setPage ]         = useState<Paging.Page | null>( null );
    const [ loading, setLoading ]   = useState<boolean>( false );
    const [ error, setError ]       = useState<string | null>( null );
    const [ holdOpen, setHoldOpen ] = useState<boolean>( false );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build the query string for GetStaffAuditEvents from the current filter fields + a paging token
    function query( start? : string ) : string
    {
        const params : URLSearchParams = new URLSearchParams();
        if ( accountId ) params.set( "accountId", accountId );
        if ( actorId )   params.set( "actorId", actorId );
        if ( action )    params.set( "action", action );
        if ( start )     params.set( "start", start );
        const qs : string = params.toString();
        return qs ? `?${qs}` : "";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the FIRST page (replaces the current list) — call on "Load" or after changing a filter
    async function load() : Promise<void>
    {
        setLoading( true ); setError( null );
        const resp : ApiResponse = await api.apiSend( {
            method: "GET",
            url: `http://localhost:${port}${GetStaffAuditEvents.URI}${query()}`,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        } );
        applyResponse( resp, false );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the NEXT page and APPEND it (Console's first Paging.Result cursor consumer — a simple
    // "Load more" append, not apps/core/web's TableInput token-paging widget)
    async function loadMore() : Promise<void>
    {
        if ( !page?.next ) return;
        setLoading( true ); setError( null );
        const resp : ApiResponse = await api.apiSend( {
            method: "GET",
            url: `http://localhost:${port}${GetStaffAuditEvents.URI}${query( page.next )}`,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        } );
        applyResponse( resp, true );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // parse a GetStaffAuditEvents response — replace or append to the current list
    function applyResponse( resp : ApiResponse, append : boolean ) : void
    {
        if ( !resp.ok ) { setError( `${resp.status} ${resp.statusText || resp.error || ""}`.trim() ); return; }
        try
        {
            const body : Paging.Result<Audit.EventView> = JSON.parse( resp.body );
            setEvents( ( prev ) => append ? [ ...prev, ...body.records ] : body.records );
            setPage( body.page );
        }
        catch { setError( "could not parse response body" ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // place or release a legal hold (from the dialog), then close it — no auto-reload (holds don't affect events)
    async function onSubmitHold( body : PostAuditLegalHold.Body ) : Promise<void>
    {
        setError( null );
        const resp : ApiResponse = await api.apiSend( {
            method: "POST",
            url: `http://localhost:${port}${PostAuditLegalHold.URI}`,
            headers: { "Content-Type": "application/json", ...( token ? { Authorization: `Bearer ${token}` } : {} ) },
            body: JSON.stringify( body ),
        } );
        if ( !resp.ok ) { setError( `${resp.status} ${resp.statusText || resp.error || ""}`.trim() ); return; }
        setHoldOpen( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return (
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5, height: "100%", overflow: "auto" }}>
            <TextField
                size="small" type="password" label="Staff bearer token"
                helperText="Pasted per session — never persisted to disk. Sent as Authorization: Bearer <token> on every call."
                value={token} onChange={( e ) => setToken( e.target.value )}
            />

            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                <TextField size="small" label="Account id" value={accountId} onChange={( e ) => setAccountId( e.target.value )} sx={{ width: 180 }} />
                <TextField size="small" label="Actor id" value={actorId} onChange={( e ) => setActorId( e.target.value )} sx={{ width: 160 }} />
                <TextField size="small" label="Action" value={action} onChange={( e ) => setAction( e.target.value )} sx={{ width: 200 }} />
                <Button variant="contained" size="small" onClick={() => void load()} disabled={loading}>Load</Button>
                <Button variant="outlined" size="small" onClick={() => setHoldOpen( true )}>Legal hold</Button>
            </Stack>

            {loading && <CircularProgress size={18} />}
            {error && <Typography variant="caption" sx={{ color: "error.main" }}>{error}</Typography>}

            {events.length > 0 && (
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>When</TableCell>
                            <TableCell>Account</TableCell>
                            <TableCell>Action</TableCell>
                            <TableCell>Actor</TableCell>
                            <TableCell>Target</TableCell>
                            <TableCell>Outcome</TableCell>
                            <TableCell>Legal hold</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {events.map( ( row ) => (
                            <TableRow key={row.eventId}>
                                <TableCell>{row.occurredAt}</TableCell>
                                <TableCell>{row.accountId}</TableCell>
                                <TableCell>{row.action}</TableCell>
                                <TableCell>{row.actor.kind}:{row.actor.id}</TableCell>
                                <TableCell>{row.target.type}:{row.target.id}</TableCell>
                                <TableCell>{row.outcome}</TableCell>
                                <TableCell>{row.legalHold ? <Chip size="small" color="warning" label="held" /> : null}</TableCell>
                            </TableRow>
                        ) )}
                    </TableBody>
                </Table>
            )}

            {page?.next && <Button size="small" onClick={() => void loadMore()} disabled={loading} sx={{ alignSelf: "flex-start" }}>Load more</Button>}

            {holdOpen && <LegalHoldDialog onPlace={onSubmitHold} onClose={() => setHoldOpen( false )} />}
        </Box>
    );
}
