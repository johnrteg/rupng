import ButtonBase from "@mui/material/ButtonBase";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";

import type { ServiceInfo } from "../../shared/types";
import { serviceIcon } from "../icons";
import { StatusDot, type DotState } from "./StatusDot";

/** One indicator dot on a tile (a pipeline step). Backends show Build · Container · Deploy/Run; a
 *  frontend (web) has no image, so it shows Build · Deploy/Run. */
export interface ServiceDot { key : string; label : string; state : DotState; }

//
// A single service tile in the top bar: indicator dots on top, MUI icon, name underneath. Each dot is
// a pipeline step — green done/running · yellow in process · red failed · grey idle · faint planned.
//
export function ServiceButton(
    { service, selected, dots, onSelect } :
    { service : ServiceInfo; selected : boolean; dots : ServiceDot[]; onSelect : () => void }
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
                    flexDirection : "column",
                    alignItems    : "center",
                    justifyContent: "center",
                    gap           : 0.3,
                    flexShrink    : 0,
                    width         : 78,
                    height        : 66,            // fixed → the row never collapses / drops the label
                    py            : 0.6,
                    borderRadius  : 2,
                    border        : "1px solid",
                    borderColor   : selected ? "primary.main" : "divider",
                    bgcolor       : selected ? "rgba(91,157,255,0.12)" : "background.paper",
                    opacity       : planned ? 0.5 : 1,
                    transition    : "border-color .15s, background-color .15s",
                    "&:hover"     : { borderColor: selected ? "primary.main" : "text.disabled" }
                }}
            >
                {/* one dot per pipeline step, centered above the icon (in flow → never crowds the label) */}
                <Box sx={{ display: "flex", justifyContent: "center", gap: 0.75, mb: 0.5 }}>
                    {dots.map( ( d ) => <StatusDot key={d.key} state={d.state} title={d.label} size={8} /> )}
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
