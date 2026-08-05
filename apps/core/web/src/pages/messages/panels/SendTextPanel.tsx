import { JSX } from "react";

import { Box, Typography } from "@mui/material";

//
// SendTextPanel — the Text tab of Messages : Send. The texting channel isn't wired yet (see apps/core/texting
// SPECS — planned); this is a placeholder until PostTextSend lands, at which point it mirrors SendEmailPanel's
// compose-and-enqueue shape.
//
export function SendTextPanel( _props : SendTextPanel.Props ) : JSX.Element
{
    return  <Box sx={{ p: 4, mx: "auto", maxWidth: 720, textAlign: "center" }}>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {"Texting isn't available yet. Ad-hoc SMS send will appear here once the texting channel ships."}
                </Typography>
            </Box>;
}

export namespace SendTextPanel
{
    export interface Props {}
}

export default SendTextPanel;
// eof
