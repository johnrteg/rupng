import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Stack from "@mui/material/Stack";

import type { PostAuditLegalHold } from "@repo/api";

//
// LegalHoldDialog — place a NEW litigation/investigation freeze (mode: place) or release an existing
// one by its holdId (mode: release). ROOT only — the panel attaches the staff bearer token; this
// dialog just builds the body. Raw MUI Dialog (Console has no shared DialogWindow — see SettingsDialog).
//
export function LegalHoldDialog( { onPlace, onClose } : { onPlace : ( body : PostAuditLegalHold.Body ) => void; onClose : () => void } )
{
    const [ mode, setMode ]         = useState<"place" | "release">( "place" );
    const [ accountId, setAccountId ] = useState<string>( "" );
    const [ subjectId, setSubjectId ] = useState<string>( "" );
    const [ from, setFrom ]         = useState<string>( "" );
    const [ to, setTo ]             = useState<string>( "" );
    const [ reason, setReason ]     = useState<string>( "" );
    const [ holdId, setHoldId ]     = useState<string>( "" );

    const canSubmit : boolean = mode === "place" ? ( !!accountId && !!reason ) : !!holdId;

    // build the discriminated-union body per the current mode and hand it to the parent
    function submit() : void
    {
        if ( mode === "place" )
            onPlace( { mode: "place", accountId, subjectId: subjectId || undefined, from: from || undefined, to: to || undefined, reason } );
        else
            onPlace( { mode: "release", holdId } );
    }

    return (
        <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontWeight: 700 }}>Legal hold</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <ToggleButtonGroup size="small" value={mode} exclusive onChange={( _e, v ) => v && setMode( v )}>
                        <ToggleButton value="place">Place</ToggleButton>
                        <ToggleButton value="release">Release</ToggleButton>
                    </ToggleButtonGroup>

                    {mode === "place" ? (
                        <>
                            <TextField size="small" label="Account id" required value={accountId} onChange={( e ) => setAccountId( e.target.value )} />
                            <TextField size="small" label="Subject id (optional)" value={subjectId} onChange={( e ) => setSubjectId( e.target.value )} />
                            <TextField size="small" label="From (ISO date-time, optional)" value={from} onChange={( e ) => setFrom( e.target.value )} />
                            <TextField size="small" label="To (ISO date-time, optional)" value={to} onChange={( e ) => setTo( e.target.value )} />
                            <TextField size="small" label="Reason" required multiline minRows={2} value={reason} onChange={( e ) => setReason( e.target.value )} />
                        </>
                    ) : (
                        <TextField size="small" label="Hold id" required value={holdId} onChange={( e ) => setHoldId( e.target.value )} />
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!canSubmit} onClick={submit}>{mode === "place" ? "Place hold" : "Release hold"}</Button>
            </DialogActions>
        </Dialog>
    );
}
