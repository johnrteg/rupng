import ButtonBase from "@mui/material/ButtonBase";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";

import type { ServiceInfo } from "../../shared/types";
import { serviceIcon } from "../icons";
import { StatusDot, type DotState } from "./StatusDot";

//
// A single service tile in the top bar: MUI icon, name underneath, and a running indicator.
// Disabled-looking (faint) when the service is only planned (spec, not yet scaffolded).
//
export function ServiceButton(
    { service, selected, state, onSelect } :
    { service : ServiceInfo; selected : boolean; state : DotState; onSelect : () => void }
)
{
    const Icon    : ReturnType<typeof serviceIcon> = serviceIcon( service.icon );
    const planned : boolean = !service.capabilities.scaffolded;

    return (
        <Tooltip title={`${service.blurb}${planned ? " — planned (not scaffolded yet)" : ""}`} enterDelay={400}>
            <ButtonBase
                onClick={onSelect}
                focusRipple
                sx={{
                    position     : "relative",
                    flexDirection: "column",
                    gap          : 0.4,
                    width        : 78,
                    py           : 0.9,
                    borderRadius : 2,
                    border       : "1px solid",
                    borderColor  : selected ? "primary.main" : "divider",
                    bgcolor      : selected ? "rgba(91,157,255,0.12)" : "background.paper",
                    opacity      : planned ? 0.5 : 1,
                    transition   : "border-color .15s, background-color .15s",
                    "&:hover"    : { borderColor: selected ? "primary.main" : "text.disabled" }
                }}
            >
                <Box sx={{ position: "absolute", top: 5, right: 5 }}>
                    <StatusDot state={state} />
                </Box>
                <Icon sx={{ fontSize: 24, color: selected ? "primary.main" : "text.secondary" }} />
                <Typography
                    variant="caption"
                    noWrap
                    sx={{ maxWidth: 70, fontWeight: selected ? 700 : 500, color: selected ? "text.primary" : "text.secondary" }}
                >
                    {service.label}
                </Typography>
            </ButtonBase>
        </Tooltip>
    );
}
