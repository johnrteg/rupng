import { useEffect, useState } from "react";
import Box from "@mui/material/Box";

import type { LocalStackState } from "../shared/types";
import { api } from "./api";
import { AppHeader, type AppView } from "./components/AppHeader";
import { DevelopView } from "./components/DevelopView";
import { CloudView } from "./components/CloudView";
import { RepoView } from "./components/RepoView";
import { DeployView } from "./components/DeployView";

//
// Shell: the two top-level tabs (Develop = build/deploy workspace; Monitor = LocalStack observability)
// + the shared LocalStack lifecycle state in the header. Each view owns its own domain state.
//
export function App()
{
    const [ view, setView ]             = useState<AppView>( "develop" );
    const [ localstack, setLocalstack ] = useState<LocalStackState>( { status: "unknown", ts: 0 } );

    useEffect( () =>
    {
        void api.localstackStatus().then( setLocalstack );
        const offLs : () => void = api.onLocalStack( ( s : LocalStackState ) => setLocalstack( s ) );
        const id : ReturnType<typeof setInterval> = setInterval( () => { void api.localstackStatus().then( setLocalstack ); }, 10000 );
        return () => { offLs(); clearInterval( id ); };
    }, [] );

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", bgcolor: "background.default" }}>
            <AppHeader view={view} onView={setView} localstack={localstack} onLocalStack={setLocalstack} />
            <Box sx={{ flexGrow: 1, minHeight: 0, display: view === "develop" ? "block" : "none" }}>
                <DevelopView />
            </Box>
            {view === "monitor" && (
                <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                    <CloudView />
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
        </Box>
    );
}
