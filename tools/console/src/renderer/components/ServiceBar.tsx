import Box from "@mui/material/Box";

import type { ServiceInfo } from "../../shared/types";
import { ServiceButton, type ServiceDot } from "./ServiceButton";

//
// The top strip of service tiles. Horizontally scrollable so the fleet can grow without wrapping.
//
export function ServiceBar(
    { services, selected, statusOf, onSelect } :
    {
        services : ServiceInfo[];
        selected : string | null;
        statusOf : ( id : string ) => ServiceDot[];
        onSelect : ( id : string ) => void;
    }
)
{
    return (
        <Box
            sx={{
                display      : "flex",
                flexShrink   : 0,          // never compress the bar — it would clip the tiles / force a scroll
                alignItems   : "center",
                gap          : 1,
                px           : 1.5,
                py           : 1.25,
                overflowX    : "auto",
                overflowY    : "hidden",
                borderBottom : "1px solid",
                borderColor  : "divider",
                bgcolor      : "background.default",
                "&::-webkit-scrollbar"      : { height: 8 },
                "&::-webkit-scrollbar-thumb": { background: "#30363d", borderRadius: 4 }
            }}
        >
            {services.map( ( svc ) => (
                <ServiceButton
                    key={svc.id}
                    service={svc}
                    selected={selected === svc.id}
                    dots={statusOf( svc.id )}
                    onSelect={() => onSelect( svc.id )}
                />
            ) )}
        </Box>
    );
}
