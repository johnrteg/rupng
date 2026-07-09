import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";

import { Box, Button, Checkbox, Chip, FormControlLabel, List, ListItemButton, ListItemText, Tab, Tabs, Tooltip, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon      from "@mui/icons-material/Stop";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CircleIcon    from "@mui/icons-material/Circle";

import type { ProcState } from "../../shared/types";
import { SIMULATORS, type SimulatorDef, type SimulatorView } from "../simulators/registry";
import { api } from "../api";

// persisted "auto-run simulators on Console launch" preference
const AUTO_RUN_KEY : string = "rup.simulators.autorun";
const loadAutoRun = () : boolean => { try { return localStorage.getItem( AUTO_RUN_KEY ) === "1"; } catch { return false; } };
const saveAutoRun = ( on : boolean ) : void => { try { localStorage.setItem( AUTO_RUN_KEY, on ? "1" : "0" ); } catch { /* ignore */ } };

// fire the auto-start at most ONCE per Console session (not on every visit to the Simulators tab)
let autoStartedThisSession : boolean = false;

//
// SimulatorsView — the Console's consolidated DEV-SIMULATOR surface. Left: the registered simulators (a fake
// ESP now; SMS/voice later) with a live run indicator. Right: the selected simulator's RUN/STOP control + its
// inspector views (inbox/config/…). Lifecycle reuses the SAME process IPC as the Develop tab (devStart /
// devStop), so run/stop lives right next to the views instead of being split across two tabs. A simulator is
// "running" when its `runtime` process stream is up.
//
export function SimulatorsView()
{
    const [selectedId, setSelectedId] = useState<string>( SIMULATORS[ 0 ]?.id ?? "" );
    const [viewId, setViewId]         = useState<string>( SIMULATORS[ 0 ]?.views[ 0 ]?.id ?? "" );
    const [running, setRunning]       = useState<Record<string, boolean>>( {} );
    const [autoRun, setAutoRun]       = useState<boolean>( loadAutoRun );

    ////////////////////////////////////////////////////////////////////////////////////////////
    useEffect( componentMounted, [] );

    // seed the run state, subscribe to live updates, and (once per session) auto-start simulators if enabled
    function componentMounted() : () => void
    {
        void refreshStates();
        if( loadAutoRun() && !autoStartedThisSession ) { autoStartedThisSession = true; void autoStart(); }
        const offProc : () => void = api.onProc( onProcState );
        return offProc;
    }

    // start every simulator that isn't already running (used by the auto-run-on-launch option)
    async function autoStart() : Promise<void>
    {
        const states : Array<ProcState> = await api.getProcStates();
        const live : Array<ProcState> = states.filter( ( state : ProcState ) : boolean => state.stream === "runtime" && state.running );
        const liveIds : Set<string> = new Set( live.map( ( state : ProcState ) : string => state.service ) );
        for( const sim of SIMULATORS )
            if( !liveIds.has( sim.id ) ) await api.devStart( sim.id );
    }

    // toggle the auto-run preference (persisted; takes effect next Console launch)
    function onToggleAutoRun( checked : boolean ) : void
    {
        setAutoRun( checked );
        saveAutoRun( checked );
    }

    // read the current process states and fold them into a running-by-simulator map (runtime stream only)
    async function refreshStates() : Promise<void>
    {
        const states : Array<ProcState> = await api.getProcStates();
        const next : Record<string, boolean> = {};
        for( const state of states )
            if( state.stream === "runtime" && state.running ) next[ state.service ] = true;
        setRunning( next );
    }

    // apply a single live process update (ignore non-runtime streams like build/deploy)
    function onProcState( state : ProcState ) : void
    {
        if( state.stream !== "runtime" ) return;
        setRunning( ( prev : Record<string, boolean> ) : Record<string, boolean> => ( { ...prev, [ state.service ]: state.running } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const selected : SimulatorDef | undefined = SIMULATORS.find( ( sim : SimulatorDef ) : boolean => sim.id === selectedId );
    const isRunning : boolean = selected ? running[ selected.id ] === true : false;
    const activeView : SimulatorView | undefined = selected
        ? ( selected.views.find( ( view : SimulatorView ) : boolean => view.id === viewId ) ?? selected.views[ 0 ] )
        : undefined;

    // select a simulator in the left rail + reset to its first view
    function selectSimulator( sim : SimulatorDef ) : void
    {
        setSelectedId( sim.id );
        setViewId( sim.views[ 0 ]?.id ?? "" );
    }

    // lifecycle — the same IPC the Develop tab drives (start/stop the local `npm run dev` process)
    function runSelected() : void { if( selected ) void api.devStart( selected.id ); }
    function stopSelected() : void { if( selected ) void api.devStop( selected.id ); }
    function openSelected() : void { if( selected ) void api.openExternal( `http://localhost:${ selected.port }` ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <Box sx={{ display: "flex", height: "100%", minHeight: 0 }}>
        {/* left rail — the registered simulators, each with a live run dot */}
        <Box sx={{ width: 220, flexShrink: 0, borderRight: "1px solid", borderColor: "divider", overflow: "auto" }}>
            <Typography variant="subtitle2" sx={{ px: 2, py: 1.5 }}>{"Simulators"}</Typography>
            <List dense disablePadding>
                { SIMULATORS.map( ( sim : SimulatorDef ) => (
                    <ListItemButton key={ sim.id } selected={ sim.id === selectedId } onClick={ () => selectSimulator( sim ) }>
                        <CircleIcon sx={{ fontSize: 10, mr: 1, color: running[ sim.id ] ? "success.main" : "text.disabled" }} />
                        <ListItemText primary={ sim.label } primaryTypographyProps={{ variant: "body2" }} />
                    </ListItemButton>
                ) ) }
            </List>
            <Box sx={{ px: 1.5, pt: 1, mt: 1, borderTop: "1px solid", borderColor: "divider" }}>
                <FormControlLabel
                    control={ <Checkbox size="small" checked={ autoRun } onChange={ ( event ) => onToggleAutoRun( event.target.checked ) } sx={{ p: 0.5 }} /> }
                    label={ <Typography variant="caption">{"Auto-run on launch"}</Typography> } />
            </Box>
        </Box>

        {/* right — the selected simulator: run/stop toolbar + inspector views */}
        { !selected || !activeView
            ? <Box sx={{ p: 3 }}><Typography variant="body2" sx={{ color: "text.secondary" }}>{"No simulators registered."}</Typography></Box>
            : <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
                {/* toolbar — status + run/stop + open-in-browser */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                    <Typography variant="subtitle1">{ selected.label }</Typography>
                    <Chip size="small" variant="outlined" color={ isRunning ? "success" : "default" } label={ isRunning ? `running · :${ selected.port }` : "stopped" } />
                    <Box sx={{ flexGrow: 1 }} />
                    { isRunning
                        ? <Button size="small" color="error" variant="outlined" startIcon={ <StopIcon /> } onClick={ stopSelected }>{"Stop"}</Button>
                        : <Button size="small" variant="contained" startIcon={ <PlayArrowIcon /> } onClick={ runSelected }>{"Run"}</Button> }
                    <Tooltip title={ `Open http://localhost:${ selected.port }` }>
                        <span>
                            <Button size="small" variant="outlined" startIcon={ <OpenInNewIcon /> } disabled={ !isRunning } onClick={ openSelected }>{ `:${ selected.port }` }</Button>
                        </span>
                    </Tooltip>
                </Box>

                {/* blurb */}
                <Typography variant="caption" sx={{ px: 2, pt: 0.75, color: "text.secondary" }}>{ selected.blurb }</Typography>

                {/* view tabs */}
                <Tabs value={ viewId }
                      onChange={ ( _event : SyntheticEvent, next : string ) : void => setViewId( next ) }
                      sx={{ minHeight: 40, borderBottom: "1px solid", borderColor: "divider", "& .MuiTab-root": { minHeight: 40 } }}>
                    { selected.views.map( ( view : SimulatorView ) => <Tab key={ view.id } value={ view.id } label={ view.label } /> ) }
                </Tabs>

                {/* active view */}
                <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    { activeView.render() }
                </Box>
            </Box>
        }
    </Box>;
}

export default SimulatorsView;
