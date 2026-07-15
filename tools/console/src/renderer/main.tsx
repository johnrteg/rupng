import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";

import { theme } from "./theme";
import { App } from "./App";

//
// Renderer entry point: mount the React tree into #root, wrapped in the shared MUI theme + CssBaseline.
//
createRoot( document.getElementById( "root" )! ).render(
    <StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <App />
        </ThemeProvider>
    </StrictMode>
);
