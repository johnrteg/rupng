import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import StopIcon from "@mui/icons-material/Stop";
import BuildIcon from "@mui/icons-material/Build";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import PersonIcon from "@mui/icons-material/Person";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

import { CLAUDE_MODES, type ClaudeApprovalRequest, type ClaudeMessage, type ClaudeMode } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// The in-app Claude panel. A mode dropdown (Off / Diagnose on demand / Real-time / Fix on approval),
// Start/Stop, the streamed transcript, inline Approve/Reject for tool calls in "fix" mode, and a
// chat box to ask follow-up questions / reply when Claude asks something. The mode is global
// (shared across services); sessions are per-service and stay open between turns.
//

const KIND_COLOR = { status: "#8b949e", user: "#58c4ff", assistant: "#c9d1d9", tool: "#d29922", tool_result: "#8b949e", result: "#3fb950", error: "#f85149" } as const;

/** In-app Claude chat for a single service: mode select, streamed transcript, inline tool approvals, and a follow-up input. */
export function ClaudePanel(
    { service, mode, onMode } :
    { service : string; mode : ClaudeMode; onMode : ( m : ClaudeMode ) => void }
)
{
    const [ messages, setMessages ]     = useState<Array<ClaudeMessage>>( [] );
    const [ running, setRunning ]       = useState<boolean>( false );
    const [ thinking, setThinking ]     = useState<boolean>( false );
    const [ approvals, setApprovals ]   = useState<Array<ClaudeApprovalRequest>>( [] );
    const [ draft, setDraft ]           = useState<string>( "" );
    const [ confirmClear, setConfirmClear ] = useState<boolean>( false );
    const endRef = useRef<HTMLDivElement | null>( null );

    // load the committed transcript (and reset transient state) when switching services
    useEffect( () =>
    {
        setApprovals( [] );
        setDraft( "" );
        let alive : boolean = true;
        void api.claudeHistory( service ).then( ( history : Array<ClaudeMessage> ) => { if ( alive ) setMessages( history ); } );
        return () => { alive = false; };
    }, [ service ] );

    // subscribe to the live streams for this service: transcript messages, approval requests, run/think state
    useEffect( () =>
    {
        const offMsg : () => void = api.onClaudeMessage( ( msg : ClaudeMessage ) => { if ( msg.service === service ) setMessages( ( prev ) => [ ...prev, msg ] ); } );
        const offApp : () => void = api.onClaudeApproval( ( req : ClaudeApprovalRequest ) => { if ( req.service === service ) setApprovals( ( prev ) => [ ...prev, req ] ); } );
        const offState : () => void = api.onClaudeState( ( state ) => { if ( state.service === service ) { setRunning( state.running ); setThinking( !!state.thinking ); } } );
        return () => { offMsg(); offApp(); offState(); };
    }, [ service ] );

    useLayoutEffect( () => { endRef.current?.scrollIntoView( { block: "end" } ); }, [ messages, approvals ] );

    /** Approve or reject a pending tool-call request and drop it from the list. */
    const decide = ( req : ClaudeApprovalRequest, allow : boolean ) : void =>
    {
        void api.claudeApprove( req.id, allow );
        setApprovals( ( prev ) => prev.filter( ( pending ) => pending.id !== req.id ) );
    };

    const disabled : boolean = mode === "off";

    /** Send the trimmed draft to Claude (starts a session if none is running) and clear the input. */
    const submit = () : void =>
    {
        const text : string = draft.trim();
        if ( text === "" || disabled ) return;
        void api.claudeSend( service, text );
        setDraft( "" );
    };

    /** Enter sends; Shift+Enter inserts a newline. */
    const onKeyDown = ( e : KeyboardEvent<HTMLDivElement> ) : void =>
    {
        if ( e.key === "Enter" && !e.shiftKey ) { e.preventDefault(); submit(); }
    };

    /** Delete this service's saved conversation and reset the local view. */
    const clearConversation = () : void =>
    {
        void api.claudeClear( service );
        setMessages( [] );
        setConfirmClear( false );
    };

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* controls */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                <AutoAwesomeIcon fontSize="small" sx={{ color: "secondary.main" }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Claude</Typography>

                <Tooltip title={CLAUDE_MODES.find( ( option ) => option.value === mode )?.hint ?? ""}>
                    <Select size="small" value={mode} onChange={( e ) => onMode( e.target.value as ClaudeMode )} sx={{ minWidth: 190 }}>
                        {CLAUDE_MODES.map( ( option ) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem> )}
                    </Select>
                </Tooltip>

                {running
                    ? <Button size="small" color="error" variant="outlined" startIcon={<StopIcon />} onClick={() => void api.claudeStop( service )}>Stop</Button>
                    : <Button size="small" variant="contained" color="secondary" disabled={disabled}
                              startIcon={<AutoAwesomeIcon />} onClick={() => void api.claudeStart( service )}>Diagnose</Button>}

                <Box sx={{ flexGrow: 1 }} />
                {thinking
                    ? <Chip icon={<CircularProgress size={12} />} label="thinking…" />
                    : running && <Chip size="small" variant="outlined" color="success" label="ready for your message" />}

                <Tooltip title="Clear this service's saved conversation">
                    <span>
                        <IconButton size="small" disabled={messages.length === 0} onClick={() => setConfirmClear( true )}>
                            <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
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

                {messages.map( ( msg ) => (
                    <Box key={msg.id} sx={{ mb: 1 }}>
                        {msg.kind === "tool"
                            ? <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
                                  <BuildIcon sx={{ fontSize: 14, color: KIND_COLOR.tool }} />
                                  <Typography component="pre" sx={{ m: 0, fontFamily: MONO, fontSize: 11.5, color: KIND_COLOR.tool, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                      {msg.text}
                                  </Typography>
                              </Box>
                            : msg.kind === "user"
                            ? <Box sx={{ display: "flex", gap: 0.8, p: 1, borderRadius: 1.5, bgcolor: "rgba(88,196,255,0.08)", border: "1px solid", borderColor: "rgba(88,196,255,0.3)" }}>
                                  <PersonIcon sx={{ fontSize: 16, color: KIND_COLOR.user, mt: 0.1 }} />
                                  <Typography component="div" sx={{ fontSize: 13, color: KIND_COLOR.user, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                      {msg.text}
                                  </Typography>
                              </Box>
                            : <Typography
                                  component="div"
                                  sx={{ fontSize: msg.kind === "assistant" ? 13 : 12, color: KIND_COLOR[ msg.kind ],
                                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                                        fontFamily: msg.kind === "assistant" ? "inherit" : MONO }}
                              >
                                  {msg.text}
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

            {/* chat input — ask a question or reply to Claude */}
            <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1, p: 1, borderTop: "1px solid", borderColor: "divider" }}>
                <TextField
                    fullWidth
                    multiline
                    maxRows={6}
                    size="small"
                    value={draft}
                    disabled={disabled}
                    onChange={( e ) => setDraft( e.target.value )}
                    onKeyDown={onKeyDown}
                    placeholder={disabled
                        ? "Pick a mode to chat with Claude…"
                        : running ? "Reply to Claude or ask a follow-up…  (Enter to send, Shift+Enter for newline)"
                                  : "Ask Claude about this service…  (Enter to send)"}
                />
                <Tooltip title={running ? "Send (Enter)" : "Start a session with this question (Enter)"}>
                    <span>
                        <IconButton color="secondary" disabled={disabled || draft.trim() === ""} onClick={submit}>
                            <SendIcon />
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>

            {/* clear-conversation confirmation */}
            <Dialog open={confirmClear} onClose={() => setConfirmClear( false )}>
                <DialogTitle>Clear conversation?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        This permanently deletes the saved conversation for <b>{service}</b> (apps/core/{service}/claude-conversation.json),
                        which is committed to the repo and shared with the team, and forgets the local resume session so the next
                        chat starts fresh. This can't be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmClear( false )}>Cancel</Button>
                    <Button color="error" variant="contained" startIcon={<DeleteOutlineIcon />} onClick={clearConversation}>Clear</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
