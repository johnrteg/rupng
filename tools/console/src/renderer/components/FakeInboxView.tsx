import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";

import type { FakeEmailListing, FakeEmailMessage } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// FakeInboxView — the Fake → Email Inbox. Lists the messages the fake-email service captured (it never
// delivers) and renders each so you can verify field merges + formatting. Auto-refreshes like the SES viewer;
// reads the fake service's own in-memory store (not LocalStack). Requires the fake-email service to be running.
//

type BodyMode = "html" | "text" | "raw";

/** The rendered payload the fake stored for a message (from/subject/html/text/headers). */
interface FakePayload { from? : string; to? : Array<string>; subject? : string; html? : string; text? : string; headers? : Record<string, string>; }

/** The chip color for a delivery outcome — green delivered, red bounces/complaints, amber otherwise. */
function deliveryColor( delivery : string ) : "success" | "error" | "warning" | "default"
{
    if ( delivery === "delivered" ) return "success";
    if ( delivery === "hard-bounce" || delivery === "complaint" || delivery === "invalid" ) return "error";
    if ( delivery === "soft-bounce" || delivery === "deferred" ) return "warning";
    return "default";
}

/** Format a message's ISO timestamp as a local time string (or the raw value if unparseable). */
function timeOf( message : FakeEmailMessage ) : string
{
    const parsed : number = Date.parse( message.at );
    return Number.isNaN( parsed ) ? message.at : new Date( parsed ).toLocaleTimeString();
}

/** Compose an RFC822-style RAW source view from the stored payload — headers, a blank line, then the body. */
function rawSource( payload : FakePayload, message : FakeEmailMessage ) : string
{
    const lines : Array<string> = [];
    lines.push( `From: ${ payload.from ?? "" }` );
    lines.push( `To: ${ ( payload.to ?? message.to ).join( ", " ) }` );
    lines.push( `Subject: ${ payload.subject ?? message.summary ?? "" }` );
    for ( const [ name, value ] of Object.entries( payload.headers ?? {} ) ) lines.push( `${ name }: ${ value }` );
    lines.push( `Content-Type: ${ payload.html ? "text/html" : "text/plain" }; charset=utf-8` );
    lines.push( "" );
    lines.push( payload.html ?? payload.text ?? "" );
    return lines.join( "\n" );
}

export function FakeInboxView()
{
    const [ listing, setListing ] = useState<FakeEmailListing | null>( null );
    const [ selectedId, setSelectedId ] = useState<string | null>( null );
    const [ mode, setMode ] = useState<BodyMode>( "html" );
    const [ auto, setAuto ] = useState<boolean>( true );
    const timer = useRef<ReturnType<typeof setInterval> | null>( null );

    /** Pull the latest fake inbox listing into state. */
    async function refresh() : Promise<void> { setListing( await api.fakeInbox() ); }
    /** Clear the fake inbox, then refresh and drop the current selection. */
    async function clear() : Promise<void> { await api.fakeClear(); await refresh(); setSelectedId( null ); }

    useEffect( () =>
    {
        void refresh();
        return () => { if ( timer.current ) clearInterval( timer.current ); };
    }, [] );

    useEffect( () =>
    {
        if ( timer.current ) { clearInterval( timer.current ); timer.current = null; }
        if ( auto ) timer.current = setInterval( () => { void refresh(); }, 3000 );
        return () => { if ( timer.current ) clearInterval( timer.current ); };
    }, [ auto ] );

    const messages : Array<FakeEmailMessage> = listing?.messages ?? [];
    const selected : FakeEmailMessage | undefined = useMemo(
        () => messages.find( ( message ) => message.id === selectedId ) ?? messages[ 0 ],
        [ messages, selectedId ],
    );

    const payload : FakePayload = ( selected?.payload ?? {} ) as FakePayload;
    const html : string = payload.html ?? "";
    const text : string = payload.text ?? "";
    const effectiveMode : BodyMode = mode === "html" && !html ? "text" : mode;

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

            {/* toolbar */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="subtitle2" sx={{ fontFamily: MONO }}>Fake ESP — captured email</Typography>
                <Chip size="small" variant="outlined"
                      color={listing ? ( listing.ok ? "success" : "error" ) : "default" }
                      label={listing ? ( listing.ok ? `${messages.length} captured` : listing.error ?? "error" ) : "loading…" }
                      sx={{ fontFamily: MONO }} />
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant={auto ? "contained" : "outlined"} onClick={() => setAuto( !auto )}>
                    {auto ? "Auto ⟳" : "Auto off"}
                </Button>
                <Tooltip title="Refresh"><IconButton size="small" onClick={() => void refresh()}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Clear the fake inbox"><IconButton size="small" onClick={() => void clear()}><DeleteSweepIcon fontSize="small" /></IconButton></Tooltip>
            </Box>

            {/* service-down hint */}
            {listing && !listing.ok && (
                <Box sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "warning.main", mb: 0.5 }}>{listing.error}</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>Start the fake-email service (port 9100) from the Develop tab.</Typography>
                </Box>
            )}

            {listing?.ok && messages.length === 0 && (
                <Box sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>No email captured yet.</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Send through the fake provider and it'll appear here.</Typography>
                </Box>
            )}

            {/* list + detail */}
            {listing?.ok && messages.length > 0 && (
                <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                    {/* message list */}
                    <Box sx={{ width: 320, flexShrink: 0, borderRight: "1px solid", borderColor: "divider", overflow: "auto" }}>
                        {messages.map( ( message ) => (
                            <Box key={message.id} onClick={() => setSelectedId( message.id )}
                                 sx={{ px: 1.5, py: 1, cursor: "pointer", borderBottom: "1px solid", borderColor: "divider",
                                       bgcolor: ( selected?.id === message.id ) ? "action.selected" : "transparent", "&:hover": { bgcolor: "action.hover" } }}>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                    <Typography variant="caption" noWrap sx={{ fontWeight: 600, flexGrow: 1 }}>{message.summary || "(no subject)"}</Typography>
                                    <Chip size="small" variant="outlined" color={deliveryColor( message.delivery )} label={message.delivery} sx={{ fontFamily: MONO, fontSize: 9, height: 16 }} />
                                </Box>
                                <Typography variant="caption" noWrap sx={{ color: "text.secondary", fontFamily: MONO, fontSize: 10, display: "block" }}>
                                    → {message.to.join( ", " ) || "—"}
                                </Typography>
                                <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO, fontSize: 10 }}>{timeOf( message )}</Typography>
                            </Box>
                        ) )}
                    </Box>

                    {/* detail */}
                    <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
                        {selected && (
                            <>
                                <Box sx={{ px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                                    <Typography variant="subtitle2">{selected.summary || "(no subject)"}</Typography>
                                    <Typography variant="caption" sx={{ display: "block", color: "text.secondary", fontFamily: MONO }}>
                                        From {payload.from || "—"} → {selected.to.join( ", " ) || "—"}
                                    </Typography>
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
                                        <ToggleButtonGroup size="small" exclusive value={effectiveMode} onChange={( _event, value : BodyMode | null ) => { if ( value ) setMode( value ); }}>
                                            <ToggleButton value="html" disabled={!html} sx={{ fontFamily: MONO, fontSize: 11, py: 0.2 }}>HTML</ToggleButton>
                                            <ToggleButton value="text" disabled={!text} sx={{ fontFamily: MONO, fontSize: 11, py: 0.2 }}>Text</ToggleButton>
                                            <ToggleButton value="raw" sx={{ fontFamily: MONO, fontSize: 11, py: 0.2 }}>Raw</ToggleButton>
                                        </ToggleButtonGroup>
                                        {selected.events.map( ( event, index ) => (
                                            <Chip key={index} size="small" variant="outlined" label={event.type} sx={{ fontFamily: MONO, fontSize: 9, height: 18 }} />
                                        ) )}
                                    </Box>
                                </Box>
                                <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", bgcolor: "#fff" }}>
                                    {effectiveMode === "html" && html
                                        ? <Box component="iframe" title="email" sandbox="" srcDoc={html} sx={{ width: "100%", height: "100%", border: 0 }} />
                                        : <Box component="pre" sx={{ m: 0, p: 2, fontFamily: MONO, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#111", bgcolor: "#fff" }}>
                                              {effectiveMode === "raw" ? ( selected.raw ?? rawSource( payload, selected ) ) : ( text || html || "(empty body)" )}
                                          </Box>}
                                </Box>
                            </>
                        )}
                    </Box>
                </Box>
            )}
        </Box>
    );
}

export default FakeInboxView;
