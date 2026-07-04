//
import { JSX } from "react";

import { Chip, Tooltip } from "@mui/material";

//
// ErrorChip — the house "error" status chip: an outlined error-colored chip whose (optional) failure reason
// shows in a tooltip on hover. Reuse wherever a failed/error state is displayed (downloads, jobs, items…)
// instead of hand-rolling a Tooltip+Chip pair.
//
export function ErrorChip( props : ErrorChip.Props ) : JSX.Element
{
    const chip : JSX.Element = <Chip size={ props.size ?? "small" } color="error" variant="outlined" label={ props.label ?? "Error" } />;
    // wrap in a tooltip only when there's a reason to show
    return props.message ? <Tooltip title={ props.message }>{ chip }</Tooltip> : chip;
}

export namespace ErrorChip
{
    export interface Props
    {
        message? : string;                       // the failure reason (shown in a tooltip); omit for a bare chip
        label?   : string;                       // chip text (default "Error")
        size?    : "small" | "medium";           // default "small"
    }
}

export default ErrorChip;
// eof
