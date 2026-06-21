import type { ReactElement } from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { keyframes } from "@mui/material/styles";

export type DotState = "running" | "busy" | "stopped" | "error" | "planned";

const COLOR : Record<DotState, string> =
{
    running : "#3fb950",
    busy    : "#d29922",
    stopped : "#6e7681",
    error   : "#f85149",
    planned : "#30363d"
};

const pulse = keyframes`
    0%   { box-shadow: 0 0 0 0 rgba(210,153,34,0.7); }
    70%  { box-shadow: 0 0 0 6px rgba(210,153,34,0); }
    100% { box-shadow: 0 0 0 0 rgba(210,153,34,0); }
`;

//
// The running indicator on each service button. Green = up, amber (pulsing) = a stage is running,
// grey = stopped, red = last action failed, faint = planned/not scaffolded.
//
export function StatusDot( { state, title, size = 9 } : { state : DotState; title? : string; size? : number } )
{
    const dot : ReactElement = (
        <Box
            sx={{
                width        : size,
                height       : size,
                borderRadius : "50%",
                bgcolor      : COLOR[ state ],
                flexShrink   : 0,
                animation    : state === "busy" ? `${pulse} 1.4s infinite` : "none"
            }}
        />
    );

    return title ? <Tooltip title={title}>{dot}</Tooltip> : dot;
}
