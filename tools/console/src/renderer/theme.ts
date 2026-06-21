import { createTheme } from "@mui/material/styles";

//
// Dark, dense theme tuned for an ops console — lots of small controls + a big monospace log pane.
//
export const theme = createTheme( {
    palette:
    {
        mode      : "dark",
        primary   : { main: "#5b9dff" },
        secondary : { main: "#b07cff" },
        success   : { main: "#3fb950" },
        warning   : { main: "#d29922" },
        error     : { main: "#f85149" },
        background : { default: "#0e1116", paper: "#161b22" },
        divider    : "#30363d"
    },
    shape       : { borderRadius: 8 },
    typography  :
    {
        fontFamily : "'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif",
        fontSize   : 13,
        button     : { textTransform: "none", fontWeight: 600 }
    },
    components:
    {
        MuiTooltip : { defaultProps: { arrow: true } },
        MuiButton  : { defaultProps: { size: "small", disableElevation: true } },
        MuiChip    : { defaultProps: { size: "small" } }
    }
} );

/** The monospace stack used by the log viewer + code-ish surfaces. */
export const MONO = "'SF Mono', 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace";
