import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import StopIcon from "@mui/icons-material/Stop";
import BuildIcon from "@mui/icons-material/Build";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";

import { CLAUDE_MODES, type ClaudeApprovalRequest, type ClaudeMessage, type ClaudeMode } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// The in-app Claude panel. A mode dropdown (Off / Diagnose on demand / Real-time / Fix on approval),
// Start/Stop, the streamed transcript, and inline Approve/Reject for tool calls in "fix" mode. The
// mode is global (shared across services); sessions are per-service.
//

const KIND_COLOR = { status: "#8b949e", assistant: "#c9d1d9", tool: "#d29922", tool_result: "#8b949e", result: "#3fb950", error: "#f85149" } as const;

export function ClaudePanel(
    { service, mode, onMode } :
    { service : string; mode : ClaudeMode; onMode : ( m : ClaudeMode ) => void }
)
{
    const [ messages, setMessages ]     = useState<ClaudeMessage[]>( [] );
    const [ running, setRunning ]       = useState<boolean>( false );
    const [ approvals, setApprovals ]   = useState<ClaudeApprovalRequest[]>( [] );
    const endRef = useRef<HTMLDivElement | null>( null );

    // reset transcript when switching services
    useEffect( () => { setMessages( [] ); setApprovals( [] ); }, [ service ] );

    useEffect( () =>
    {
        const offMsg = api.onClaudeMessage( ( m ) => { if ( m.service === service ) setMessages( ( p ) => [ ...p, m ] ); } );
        const offApp = api.onClaudeApproval( ( r ) => { if ( r.service === service ) setApprovals( ( p ) => [ ...p, r ] ); } );
        const offState = api.onClaudeState( ( s ) => { if ( s.service === service ) setRunning( s.running ); } );
        return () => { offMsg(); offApp(); offState(); };
    }, [ service ] );

    useLayoutEffect( () => { endRef.current?.scrollIntoView( { block: "end" } ); }, [ messages, approvals ] );

    const decide = ( req : ClaudeApprovalRequest, allow : boolean ) : void =>
    {
        void api.claudeApprove( req.id, allow );
        setApprovals( ( p ) => p.filter( ( r ) => r.id !== req.id ) );
    };

    const disabled : boolean = mode === "off";

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* controls */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                <AutoAwesomeIcon fontSize="small" sx={{ color: "secondary.main" }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Claude</Typography>

                <Tooltip title={CLAUDE_MODES.find( ( m ) => m.value === mode )?.hint ?? ""}>
                    <Select size="small" value={mode} onChange={( e ) => onMode( e.target.value as ClaudeMode )} sx={{ minWidth: 190 }}>
                        {CLAUDE_MODES.map( ( m ) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem> )}
                    </Select>
                </Tooltip>

                {running
                    ? <Button size="small" color="error" variant="outlined" startIcon={<StopIcon />} onClick={() => void api.claudeStop( service )}>Stop</Button>
                    : <Button size="small" variant="contained" color="secondary" disabled={disabled}
                              startIcon={<AutoAwesomeIcon />} onClick={() => void api.claudeStart( service )}>Diagnose</Button>}

                <Box sx={{ flexGrow: 1 }} />
                {running && <Chip icon={<CircularProgress size={12} />} label="thinking…" />}
            </Box>

            {/* transcript */}
            <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", p: 1.5, bgcolor: "#0a0d12" }}>
                {messages.length === 0 && (
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>
                        {disabled
                            ? "Claude is off. Pick a mode to enable diagnosis."
                            : "No session yet. Claude reads this service's captured logs + code and explains failures. " +
                              ( mode === "fix" ? "In 'fix' mode it can edit/run with your approval." : "Read-only in this mode." )}
                    </Typography>
                )}

                {messages.map( ( m ) => (
                    <Box key={m.id} sx={{ mb: 1 }}>
                        {m.kind === "tool"
                            ? <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
                                  <BuildIcon sx={{ fontSize: 14, color: KIND_COLOR.tool }} />
                                  <Typography component="pre" sx={{ m: 0, fontFamily: MONO, fontSize: 11.5, color: KIND_COLOR.tool, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                      {m.text}
                                  </Typography>
                              </Box>
                            : <Typography
                                  component="div"
                                  sx={{ fontSize: m.kind === "assistant" ? 13 : 12, color: KIND_COLOR[ m.kind ],
                                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                                        fontFamily: m.kind === "assistant" ? "inherit" : MONO }}
                              >
                                  {m.text}
                              </Typography>}
                    </Box>
                ) )}

                {/* pending approvals */}
                {approvals.map( ( req ) => (
                    <Box key={req.id} sx={{ my: 1, p: 1, border: "1px solid", borderColor: "warning.main", borderRadius: 1.5, bgcolor: "rgba(210,153,34,0.08)" }}>
                        <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 700 }}>Claude wants to run: {req.toolName}</Typography>
                        <Typography component="pre" sx={{ m: 0, my: 0.5, fontFamily: MONO, fontSize: 11.5, color: "text.secondary", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {req.summary}
                        </Typography>
                        <Box sx={{ display: "flex", gap: 1 }}>
                            <Button size="small" variant="contained" color="success" startIcon={<CheckIcon />} onClick={() => decide( req, true )}>Approve</Button>
                            <Button size="small" variant="outlined" color="error" startIcon={<CloseIcon />} onClick={() => decide( req, false )}>Reject</Button>
                        </Box>
                    </Box>
                ) )}

                <div ref={endRef} />
            </Box>
        </Box>
    );
}
