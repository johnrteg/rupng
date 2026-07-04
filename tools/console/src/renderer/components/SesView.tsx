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

import type { SesListing, SesMessage } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// SesView — the Email sub-tab. LocalStack captures every SES send (it never delivers); this lists them
// and renders the body. Auto-refreshes so a registration/verification email shows up as it's sent —
// pull the code straight from here instead of a real inbox. LocalStack-only (real SES has no capture).
//

type BodyMode = "html" | "text" | "raw";

/** Format a message's recipient list as a comma-joined string (or an em-dash when there are none). */
function destOf( message : SesMessage ) : string
{
    const recipients : Array<string> = message.destination?.ToAddresses ?? [];
    return recipients.length ? recipients.join( ", " ) : "—";
}

/** Format a message's timestamp as a local time string, falling back to the raw value if unparseable. */
function timeOf( message : SesMessage ) : string
{
    if ( !message.timestamp ) return "";
    const parsed : number = Date.parse( message.timestamp );
    return Number.isNaN( parsed ) ? message.timestamp : new Date( parsed ).toLocaleTimeString();
}

export function SesView()
{
    const [ listing, setListing ] = useState<SesListing | null>( null );
    const [ selectedId, setSelectedId ] = useState<string | null>( null );
    const [ mode, setMode ] = useState<BodyMode>( "html" );
    const [ auto, setAuto ] = useState<boolean>( true );
    const timer = useRef<ReturnType<typeof setInterval> | null>( null );

    /** Pull the latest captured SES listing from LocalStack into state. */
    async function refresh() : Promise<void> { setListing( await api.sesMessages() ); }
    /** Discard all captured messages, then refresh and drop the current selection. */
    async function clear() : Promise<void> { await api.sesClear(); await refresh(); setSelectedId( null ); }

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

    const messages : Array<SesMessage> = listing?.messages ?? [];
    const selected : SesMessage | undefined = useMemo(
        () => messages.find( ( message ) => message.id === selectedId ) ?? messages[ 0 ],
        [ messages, selectedId ],
    );

    const html : string = selected?.body?.html_part ?? "";
    const text : string = selected?.body?.text_part ?? "";
    const raw  : string = selected?.raw ?? "";
    // Prefer the user-picked mode, but if HTML is selected and absent, fall back to text (then raw).
    const effectiveMode : BodyMode = mode === "html" && !html ? ( text ? "text" : "raw" ) : mode;

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

            {/* toolbar */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="subtitle2" sx={{ fontFamily: MONO }}>SES — captured email</Typography>
                <Chip size="small" variant="outlined"
                      color={listing ? ( listing.ok ? "success" : "error" ) : "default" }
                      label={listing ? ( listing.ok ? `${messages.length} captured` : listing.error ?? "error" ) : "loading…" }
                      sx={{ fontFamily: MONO }} />
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant={auto ? "contained" : "outlined"} onClick={() => setAuto( !auto )}>
                    {auto ? "Auto ⟳" : "Auto off"}
                </Button>
                <Tooltip title="Refresh"><IconButton size="small" onClick={() => void refresh()}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Discard captured messages"><IconButton size="small" onClick={() => void clear()}><DeleteSweepIcon fontSize="small" /></IconButton></Tooltip>
            </Box>

            {/* not-localstack / empty hint */}
            {listing && !listing.ok && (
                <Box sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "warning.main", mb: 0.5 }}>{listing.error}</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>GET {listing.endpoint}</Typography>
                </Box>
            )}

            {listing?.ok && messages.length === 0 && (
                <Box sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>No email captured yet.</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>
                        Trigger a send (e.g. registration / verification) and it'll appear here. Note: Cognito-sent codes surface in the service logs, not SES.
                    </Typography>
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
                                <Typography variant="caption" noWrap sx={{ fontWeight: 600, display: "block" }}>{message.subject || "(no subject)"}</Typography>
                                <Typography variant="caption" noWrap sx={{ color: "text.secondary", fontFamily: MONO, fontSize: 10, display: "block" }}>
                                    → {destOf( message )}
                                </Typography>
                                <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO, fontSize: 10 }}>
                                    {message.source || "—"} · {timeOf( message )}{message.template ? ` · ${message.template}` : ""}
                                </Typography>
                            </Box>
                        ) )}
                    </Box>

                    {/* detail */}
                    <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
                        {selected && (
                            <>
                                <Box sx={{ px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                                    <Typography variant="subtitle2">{selected.subject || "(no subject)"}</Typography>
                                    <Typography variant="caption" sx={{ display: "block", color: "text.secondary", fontFamily: MONO }}>
                                        From {selected.source || "—"} → {destOf( selected )}
                                    </Typography>
                                    <ToggleButtonGroup size="small" exclusive value={effectiveMode} onChange={( _event, value : BodyMode | null ) => { if ( value ) setMode( value ); }} sx={{ mt: 1 }}>
                                        <ToggleButton value="html" disabled={!html} sx={{ fontFamily: MONO, fontSize: 11, py: 0.2 }}>HTML</ToggleButton>
                                        <ToggleButton value="text" disabled={!text} sx={{ fontFamily: MONO, fontSize: 11, py: 0.2 }}>Text</ToggleButton>
                                        <ToggleButton value="raw"  disabled={!raw}  sx={{ fontFamily: MONO, fontSize: 11, py: 0.2 }}>Raw</ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                                <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", bgcolor: "#fff" }}>
                                    {effectiveMode === "html" && html
                                        ? <Box component="iframe" title="email" sandbox="" srcDoc={html} sx={{ width: "100%", height: "100%", border: 0 }} />
                                        : <Box component="pre" sx={{ m: 0, p: 2, fontFamily: MONO, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#111", bgcolor: "#fff" }}>
                                              {effectiveMode === "raw" ? raw : ( text || html || "(empty body)" )}
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

export default SesView;
