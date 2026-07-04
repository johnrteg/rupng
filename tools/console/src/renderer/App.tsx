import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Backdrop from "@mui/material/Backdrop";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";

import type { LocalStackState } from "../shared/types";
import { api } from "./api";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";

import { AppHeader, type AppView } from "./components/AppHeader";
import { DevelopView } from "./components/DevelopView";
import { CloudView } from "./components/CloudView";
import { KafkaMonitorView } from "./components/KafkaMonitorView";
import { SesView } from "./components/SesView";
import { CognitoCodesView } from "./components/CognitoCodesView";
import { ProcessView } from "./components/ProcessView";
import { RepoView } from "./components/RepoView";
import { DeployView } from "./components/DeployView";

//
// Shell: the two top-level tabs (Develop = build/deploy workspace; Monitor = LocalStack observability)
// + the shared LocalStack lifecycle state in the header. Each view owns its own domain state.
//
export function App()
{
    const [ view, setView ]             = useState<AppView>( "develop" );
    const [ monitorTab, setMonitorTab ] = useState<"cloud" | "events" | "email" | "processes">( "cloud" );
    const [ localstack, setLocalstack ] = useState<LocalStackState>( { status: "unknown", ts: 0 } );
    const [ shuttingDown, setShuttingDown ] = useState<boolean>( false );

    // main signals it's tearing local services down on quit → show a blocking "please wait" overlay
    useEffect( () => api.onShuttingDown( () => setShuttingDown( true ) ), [] );

    // Seed the LocalStack status, subscribe to push updates from main, and poll every 10s as a fallback.
    useEffect( () =>
    {
        void api.localstackStatus().then( setLocalstack );
        const offLocalStack : () => void = api.onLocalStack( ( state : LocalStackState ) => setLocalstack( state ) );
        const pollId : ReturnType<typeof setInterval> = setInterval( () => { void api.localstackStatus().then( setLocalstack ); }, 10000 );
        return () => { offLocalStack(); clearInterval( pollId ); };
    }, [] );

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", bgcolor: "background.default" }}>
            <AppHeader view={view} onView={setView} localstack={localstack} onLocalStack={setLocalstack} />
            <Box sx={{ flexGrow: 1, minHeight: 0, display: view === "develop" ? "block" : "none" }}>
                <DevelopView />
            </Box>
            {view === "monitor" && (
                <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    <Tabs value={monitorTab} onChange={( _event, nextTab : "cloud" | "events" | "email" | "processes" ) => setMonitorTab( nextTab )}
                          sx={{ minHeight: 40, borderBottom: "1px solid", borderColor: "divider", "& .MuiTab-root": { minHeight: 40 } }}>
                        <Tab value="cloud" label="Cloud" />
                        <Tab value="events" label="Events" />
                        <Tab value="email" label="Email" />
                        <Tab value="processes" label="Processes" />
                    </Tabs>
                    <Box sx={{ flexGrow: 1, minHeight: 0, display: monitorTab === "cloud" ? "block" : "none" }}>
                        <CloudView />
                    </Box>
                    {monitorTab === "events" && (
                        <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                            <KafkaMonitorView />
                        </Box>
                    )}
                    {monitorTab === "email" && (
                        <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                            <CognitoCodesView />
                            <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                                <SesView />
                            </Box>
                        </Box>
                    )}
                    {monitorTab === "processes" && (
                        <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                            <ProcessView />
                        </Box>
                    )}
                </Box>
            )}
            {view === "repo" && (
                <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                    <RepoView />
                </Box>
            )}
            {view === "deploy" && (
                <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                    <DeployView />
                </Box>
            )}

            {/* quit overlay — blocks the UI while main runs local services down before exiting */}
            <Backdrop open={shuttingDown} sx={{ zIndex: ( theme ) => theme.zIndex.modal + 10, color: "#fff", flexDirection: "column", gap: 2, backdropFilter: "blur(2px)" }}>
                <CircularProgress color="inherit" />
                <Typography variant="h6">Shutting down…</Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>Stopping local services — please wait.</Typography>
            </Backdrop>
        </Box>
    );
}
