import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";

import { settingsStore, useSettings, type HistogramWindowMin, type Settings } from "../settingsStore";

//
// Settings dialog — edits a local draft and commits on Save (persisted to localStorage via the
// settings store). First setting: the container-metrics history window.
//
const WINDOWS : HistogramWindowMin[] = [ 15, 30, 45, 60 ];

export function SettingsDialog( { open, onClose } : { open : boolean; onClose : () => void } )
{
    const saved : Settings = useSettings();
    const [ draft, setDraft ] = useState<Settings>( saved );

    // reset the draft to the saved values each time the dialog opens
    useEffect( () => { if ( open ) setDraft( saved ); }, [ open, saved ] );

    const save = () : void => { settingsStore.save( draft ); onClose(); };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontWeight: 700 }}>Settings</DialogTitle>
            <DialogContent dividers>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                    <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>Container history window</Typography>
                        <Typography variant="caption" sx={{ color: "text.disabled" }}>How far back the CPU / memory charts span.</Typography>
                    </Box>
                    <Select
                        size="small"
                        value={draft.histogramWindowMin}
                        onChange={( e ) => setDraft( { ...draft, histogramWindowMin: e.target.value as HistogramWindowMin } )}
                        sx={{ minWidth: 110 }}
                    >
                        {WINDOWS.map( ( w ) => <MenuItem key={w} value={w}>{w} min</MenuItem> )}
                    </Select>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={save}>Save</Button>
            </DialogActions>
        </Dialog>
    );
}
