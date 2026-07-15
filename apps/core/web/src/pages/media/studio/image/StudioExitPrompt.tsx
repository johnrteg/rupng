import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import DialogWindow from '@widgets/core/DialogWindow';

//
// StudioExitPrompt — the unsaved-changes guard shown when the user CANCELS out of editing with pending (unsynced)
// work. Three ways out: SAVE & CLOSE (persist then leave), DISCARD (drop the unsynced changes, reload the last
// saved version, then leave), or KEEP EDITING (stay). The parent owns open/close and supplies the typed actions.
//
export function StudioExitPrompt( props : StudioExitPrompt.Props ) : JSX.Element
{
    return  <DialogWindow id="studio-exit-prompt"
                          title={"Unsaved changes"}
                          yesLabel={"Save & Close"}
                          noLabel={"Discard"}
                          cancelLabel={"Keep Editing"}
                          minWidth="xs"
                          ready={ true }
                          onYes={ props.onSave }
                          onNo={ props.onDiscard }
                          onClose={ props.onClose }>
                <Stack spacing={ 1 } sx={{ p: 2 }}>
                    <Typography variant="body2">{"You have unsaved changes to this image."}</Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Save them before closing, or discard them and reload the last saved version."}</Typography>
                </Stack>
            </DialogWindow>;
}

export namespace StudioExitPrompt
{
    export interface Props
    {
        onSave    : () => Promise<boolean>;   // persist pending work, then close (return true to dismiss)
        onDiscard : () => Promise<boolean>;   // drop unsynced changes + reload saved, then close (return true to dismiss)
        onClose   : () => void;               // keep editing (stay)
    }
}

export default StudioExitPrompt;
// eof
