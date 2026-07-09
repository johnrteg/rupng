import { useEffect, useState } from "react";

import { Box, Button, Chip, IconButton, MenuItem, Select, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import RefreshIcon      from "@mui/icons-material/Refresh";
import BlockIcon        from "@mui/icons-material/Block";

import type { AuthActionsListing, AuthActionRow } from "../../shared/types";
import { api } from "../api";

const MONO : string = "ui-monospace, SFMono-Regular, Menlo, monospace";
const STATUSES : Array<string> = [ "pending", "consumed", "cancelled", "expired" ];

// a local time string for an ISO timestamp (or the raw value when unparseable)
function timeIso( iso : string ) : string { const t : number = Date.parse( iso ); return Number.isNaN( t ) ? iso : new Date( t ).toLocaleString(); }
// a local time string for an epoch-SECONDS timestamp
function timeEpoch( secs : number ) : string { return new Date( secs * 1000 ).toLocaleString(); }

// the chip color for a status
function statusColor( status : string ) : "info" | "success" | "warning" | "default"
{
    if( status === "pending" ) return "info";
    if( status === "consumed" ) return "success";
    if( status === "expired" ) return "warning";
    return "default";
}

//
// ActionsView — the Console's app-wide view of the auth pending-action queue (verify / reset / mfa / invite /
// unsubscribe). Reads via the auth service's dev control routes; shows each request + status + created/expiry
// and lets staff REVOKE a pending one. Rows auto-expire (DDB TTL) so old ones fade off on their own.
//
export function ActionsView()
{
    const [status,setStatus]   = useState<string>( "pending" );
    const [listing,setListing] = useState<AuthActionsListing | null>( null );
    const [auto,setAuto]       = useState<boolean>( true );

    ////////////////////////////////////////////////////////////////////////////////////////////
    useEffect( onStatusChanged, [ status ] );

    // (re)load whenever the status filter changes
    function onStatusChanged() : void { void refresh(); }

    // poll while auto-refresh is on
    useEffect( onAutoChanged, [ auto, status ] );
    function onAutoChanged() : ( () => void ) | void
    {
        if( !auto ) return;
        const handle : ReturnType<typeof setInterval> = setInterval( () => void refresh(), 4000 );
        return () : void => clearInterval( handle );
    }

    async function refresh() : Promise<void> { setListing( await api.authActionsList( status ) ); }
    async function revoke( actionId : string ) : Promise<void> { await api.authActionsCancel( actionId ); await refresh(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const rows : Array<AuthActionRow> = listing?.records ?? [];

    return <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
            <Typography variant="subtitle2">{"Actions"}</Typography>
            <Select size="small" value={ status } onChange={( event ) => setStatus( String( event.target.value ) )} sx={{ fontFamily: MONO, fontSize: 12, height: 30 }}>
                { STATUSES.map( ( option : string ) => <MenuItem key={ option } value={ option } sx={{ fontFamily: MONO, fontSize: 12 }}>{ option }</MenuItem> ) }
            </Select>
            <Chip size="small" variant="outlined" label={ listing ? ( listing.ok ? `${ rows.length } ${ status }` : listing.error ?? "error" ) : "loading…" } />
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" variant={ auto ? "contained" : "outlined" } onClick={() => setAuto( !auto )}>{ auto ? "Auto" : "Manual" }</Button>
            <Tooltip title="Refresh"><IconButton size="small" onClick={() => void refresh()}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
        </Box>

        {/* body */}
        { listing && !listing.ok && <Box sx={{ p: 2 }}><Typography variant="body2" color="error">{ listing.error }</Typography></Box> }
        { listing?.ok && rows.length === 0 && <Box sx={{ p: 2 }}><Typography variant="body2" sx={{ color: "text.secondary" }}>{"No requests with this status."}</Typography></Box> }
        { listing?.ok && rows.length > 0 && (
            <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontFamily: MONO }}>Type</TableCell>
                            <TableCell sx={{ fontFamily: MONO }}>Sent to</TableCell>
                            <TableCell sx={{ fontFamily: MONO }}>Status</TableCell>
                            <TableCell sx={{ fontFamily: MONO }}>Created</TableCell>
                            <TableCell sx={{ fontFamily: MONO }}>Expires</TableCell>
                            <TableCell sx={{ fontFamily: MONO }} align="right">Revoke</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        { rows.map( ( row : AuthActionRow ) => (
                            <TableRow key={ row.actionId } hover>
                                <TableCell sx={{ fontFamily: MONO, fontSize: 12 }}>{ row.type }</TableCell>
                                <TableCell sx={{ fontFamily: MONO, fontSize: 12 }}>{ row.target }</TableCell>
                                <TableCell><Chip size="small" variant="outlined" color={ statusColor( row.status ) } label={ row.status } sx={{ fontFamily: MONO, fontSize: 10 }} /></TableCell>
                                <TableCell sx={{ fontFamily: MONO, fontSize: 11, color: "text.secondary" }}>{ timeIso( row.createdAt ) }</TableCell>
                                <TableCell sx={{ fontFamily: MONO, fontSize: 11, color: "text.secondary" }}>{ timeEpoch( row.expiresAt ) }</TableCell>
                                <TableCell align="right">{ row.status === "pending" && <Tooltip title="Revoke"><IconButton size="small" onClick={() => void revoke( row.actionId )}><BlockIcon fontSize="small" /></IconButton></Tooltip> }</TableCell>
                            </TableRow>
                        ) ) }
                    </TableBody>
                </Table>
            </Box>
        ) }
    </Box>;
}

export default ActionsView;
