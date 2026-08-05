import { JSX } from "react";

import { Box, Typography } from "@mui/material";

//
// SendVoicePanel — the Voice tab of Messages : Send. The voice channel isn't wired yet (see apps/core/voice
// SPECS — planned); this is a placeholder until a PostVoiceSend lands, at which point it mirrors
// SendEmailPanel's compose-and-enqueue shape.
//
export function SendVoicePanel( _props : SendVoicePanel.Props ) : JSX.Element
{
    return  <Box sx={{ p: 4, mx: "auto", maxWidth: 720, textAlign: "center" }}>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {"Voice isn't available yet. Ad-hoc voice send will appear here once the voice channel ships."}
                </Typography>
            </Box>;
}

export namespace SendVoicePanel
{
    export interface Props {}
}

export default SendVoicePanel;
// eof
