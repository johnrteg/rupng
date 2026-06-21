import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Autocomplete from "@mui/material/Autocomplete";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import DownloadIcon from "@mui/icons-material/Download";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import ScienceIcon from "@mui/icons-material/Science";
import MergeIcon from "@mui/icons-material/CallMerge";
import UploadIcon from "@mui/icons-material/Upload";

import { REPO_ID, type BumpKind, type ClaudeMode, type LogLine, type ProcState, type RepoArea, type RepoBranches, type RepoStatus } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";
import { LogView } from "./LogView";
import { ClaudePanel } from "./ClaudePanel";

//
// The Repo tab — git check-out / check-in.
//   • Check out: pull a chosen branch (AI-assisted conflict resolution) + optional clean reinstall.
//   • Check in: per-area git status with version bumps; pick which impacted areas to test (auto-
//     selected) or run all; tests must pass, then commit/push to a chosen branch and/or open a PR.
//

const KIND_COLOR : Record<RepoArea[ "kind" ], string> = { service: "#3fb950", package: "#58c4ff", cloud: "#b07cff", console: "#d29922", root: "#8b949e" };

/** Project a semver core (x.y.z) for a bump — for the intent display "v1.0.0 → v1.1.0". */
function projectVersion( v : string, kind : BumpKind ) : string
{
    const m : RegExpMatchArray | null = v.match( /^(\d+)\.(\d+)\.(\d+)/ );
    if ( !m ) return v;
    let [ maj, min, pat ] : number[] = [ Number( m[ 1 ] ), Number( m[ 2 ] ), Number( m[ 3 ] ) ];
    if ( kind === "major" ) { maj += 1; min = 0; pat = 0; }
    else if ( kind === "minor" ) { min += 1; pat = 0; }
    else pat += 1;
    return `${maj}.${min}.${pat}`;
}

export function RepoView()
{
    const [ sub, setSub ]           = useState<"checkout" | "checkin">( "checkout" );
    const [ status, setStatus ]     = useState<RepoStatus | null>( null );
    const [ branches, setBranches ] = useState<RepoBranches>( { current: "", branches: [] } );
    const [ lines, setLines ]       = useState<LogLine[]>( [] );
    const [ busy, setBusy ]         = useState<boolean>( false );
    const [ testsPassed, setTestsPassed ] = useState<boolean>( false );
    const [ message, setMessage ]   = useState<string>( "" );
    const [ pullBranch, setPullBranch ]     = useState<string>( "" );
    const [ targetBranch, setTargetBranch ] = useState<string>( "" );
    const [ testSel, setTestSel ]   = useState<Set<string>>( new Set() );
    const [ intents, setIntents ]   = useState<Record<string, BumpKind>>( {} );   // per-area version bump INTENT (applied at commit)
    const [ claudeMode, setClaudeMode ] = useState<ClaudeMode>( "fix" );

    const refresh = useCallback( async () : Promise<void> =>
    {
        const [ s, b ] : [ RepoStatus, RepoBranches ] = await Promise.all( [ api.repoStatus(), api.repoBranches() ] );
        setStatus( s );
        setBranches( b );
        setTestSel( new Set( s.areas.map( ( a ) => a.path ) ) );   // auto-select impacted areas
        setIntents( {} );                                          // version intents reset on refresh
        // both check out and check in default to main (else master, else current)
        const def : string = b.branches.includes( "main" ) ? "main" : b.branches.includes( "master" ) ? "master" : b.current;
        setPullBranch( ( p ) => p || def );
        setTargetBranch( ( p ) => p || def );
    }, [] );
    useEffect( () => { void refresh(); }, [ refresh ] );

    useEffect( () =>
    {
        let active : boolean = true;
        void api.getLog( REPO_ID, "runtime" ).then( ( h : LogLine[] ) => { if ( active ) setLines( h ); } );
        const offLog : () => void = api.onLog( ( l : LogLine ) => { if ( l.service === REPO_ID && l.stream === "runtime" ) setLines( ( p ) => ( p.length > 1500 ? [ ...p.slice( -1500 ), l ] : [ ...p, l ] ) ); } );
        const offProc : () => void = api.onProc( ( p : ProcState ) => { if ( p.service === REPO_ID && p.stream === "runtime" ) setBusy( p.running ); } );
        return () => { active = false; offLog(); offProc(); };
    }, [] );

    const after = async ( p : Promise<unknown> ) : Promise<void> => { await p; await refresh(); };

    const pull       = () : void => { void after( api.repoPull( pullBranch ) ); };
    const reinstall  = () : void => { if ( window.confirm( "Delete every node_modules across the workspace, then npm install + build? This can take a few minutes." ) ) void after( api.repoReinstall() ); };
    const runTests   = ( areas : string[] ) : void => { setTestsPassed( false ); void api.repoTest( areas ).then( ( code : number ) => setTestsPassed( code === 0 ) ); };
    const toggleArea = ( path : string ) : void => setTestSel( ( prev ) => { const n = new Set( prev ); n.has( path ) ? n.delete( path ) : n.add( path ); return n; } );
    const setIntent  = ( path : string, kind : BumpKind ) : void => setIntents( ( prev ) => ( { ...prev, [ path ]: kind } ) );

    // checked, versioned, non-deleted areas must each carry a bump intent before check-in
    const needsIntent : RepoArea[] = ( status?.areas ?? [] ).filter( ( a ) => testSel.has( a.path ) && !!a.version && !a.deleted );
    const intentsReady : boolean = needsIntent.every( ( a ) => intents[ a.path ] !== undefined );

    const isMain : boolean = targetBranch === "main" || targetBranch === "master";
    const canCommit : boolean = testsPassed && intentsReady && message.trim() !== "" && targetBranch.trim() !== "" && !busy;

    /** Apply each selected area's version intent (writes package.json) right before committing. */
    const applyIntents = async () : Promise<void> =>
    {
        for ( const a of needsIntent ) { const k : BumpKind | undefined = intents[ a.path ]; if ( k ) await api.repoBump( a.path, k ); }
    };

    const commitPush = async () : Promise<void> =>
    {
        if ( !canCommit ) return;
        if ( !window.confirm( `Apply the selected version bumps, commit all changes, and push to "${targetBranch}"?` ) ) return;
        await applyIntents();
        await after( api.repoCommitPush( targetBranch.trim(), message.trim() ) );
    };
    const createPR = async () : Promise<void> =>
    {
        if ( !canCommit || isMain ) return;
        if ( !window.confirm( `Apply version bumps, commit, push to "${targetBranch}", and open a pull request:\n\n"${message}"` ) ) return;
        await applyIntents();
        await after( api.repoCreatePR( targetBranch.trim(), message.trim() ) );
    };
    const askClaude = () : void =>
    {
        const files : string = ( status?.conflicts ?? [] ).join( ", " );
        void api.claudeSend( REPO_ID, `Resolve the current git merge conflicts in this repository. Conflicted files: ${files}. Edit each file to a correct merged result (no conflict markers), explain the choices, and stage them with git add.` );
    };

    const conflicts : string[] = status?.conflicts ?? [];

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* sub-tabs + branch */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
                <Tabs value={sub} onChange={( _e, v : "checkout" | "checkin" ) => setSub( v )} sx={{ minHeight: 44, "& .MuiTab-root": { minHeight: 44 } }}>
                    <Tab value="checkout" icon={<DownloadIcon fontSize="small" />} iconPosition="start" label="Check out" />
                    <Tab value="checkin" icon={<MergeIcon fontSize="small" />} iconPosition="start" label="Check in" />
                </Tabs>
                <Box sx={{ flexGrow: 1 }} />
                {branches.current && <Chip size="small" variant="outlined" label={`on ${branches.current}`} sx={{ fontFamily: MONO }} />}
                {busy && <CircularProgress size={16} />}
                <Tooltip title="Refresh git status + branches"><span><Button size="small" startIcon={<RefreshIcon fontSize="small" />} disabled={busy} onClick={() => void refresh()}>Status</Button></span></Tooltip>
            </Box>

            <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                {/* left: the active sub-tab's controls */}
                <Box sx={{ width: "48%", minWidth: 420, flexShrink: 0, overflow: "auto", p: 1.5, borderRight: "1px solid", borderColor: "divider" }}>
                    {sub === "checkout" ? (
                        <>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
                                <Tooltip title="Branch to pull from">
                                    <Select size="small" value={pullBranch} onChange={( e ) => setPullBranch( e.target.value )} sx={{ minWidth: 150 }}>
                                        {branches.branches.map( ( b ) => <MenuItem key={b} value={b}>{b}</MenuItem> )}
                                    </Select>
                                </Tooltip>
                                <Button variant="contained" color="success" startIcon={<DownloadIcon />} disabled={busy} onClick={pull}>Pull</Button>
                                <Button variant="outlined" startIcon={<DeleteSweepIcon />} disabled={busy} onClick={reinstall}>Reinstall + build</Button>
                            </Box>
                            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 1 }}>
                                Pull merges the selected branch (rebase + autostash if it can't fast-forward). "Reinstall + build" wipes every node_modules, then npm install + build.
                            </Typography>

                            {conflicts.length > 0 ? (
                                <Box sx={{ border: "1px solid", borderColor: "error.main", borderRadius: 1.5, p: 1, mb: 1 }}>
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                        <Typography variant="subtitle2" sx={{ color: "error.main", fontWeight: 700, flexGrow: 1 }}>{conflicts.length} merge conflict(s)</Typography>
                                        <Button size="small" variant="contained" color="secondary" onClick={askClaude}>Resolve with Claude</Button>
                                    </Box>
                                    {conflicts.map( ( f ) => <Typography key={f} variant="caption" sx={{ display: "block", color: "text.secondary", fontFamily: MONO }}>{f}</Typography> )}
                                </Box>
                            ) : (
                                <Typography variant="caption" sx={{ color: "success.main" }}>No merge conflicts.</Typography>
                            )}

                            {conflicts.length > 0 && (
                                <Box sx={{ height: 360, mt: 1, border: "1px solid", borderColor: "divider", borderRadius: 1.5, overflow: "hidden" }}>
                                    <ClaudePanel service={REPO_ID} mode={claudeMode} onMode={setClaudeMode} />
                                </Box>
                            )}
                        </>
                    ) : (
                        <>
                            {status?.clean && <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>Working tree is clean — nothing to check in.</Typography>}
                            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 0.75 }}>
                                Changed areas (checked = included in tests):
                            </Typography>
                            {( status?.areas ?? [] ).map( ( a ) =>
                            {
                                const checked : boolean = testSel.has( a.path );
                                const intent : BumpKind | undefined = intents[ a.path ];
                                const needs : boolean = checked && !!a.version && !a.deleted && intent === undefined;   // checked but no intent yet
                                return (
                                    <Box key={a.path} sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5, p: 0.5, pl: 1, border: "1px solid", borderColor: needs ? "warning.main" : "divider", borderRadius: 1.5 }}>
                                        <Checkbox size="small" checked={checked} onChange={() => toggleArea( a.path )} sx={{ p: 0.5 }} />
                                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: KIND_COLOR[ a.kind ], flexShrink: 0 }} />
                                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.name} <Box component="span" sx={{ color: "text.disabled", fontFamily: MONO, fontWeight: 400 }}>{a.path}</Box></Typography>
                                            {a.version && !a.deleted
                                                ? <Typography variant="caption" sx={{ fontFamily: MONO, color: intent ? "success.main" : ( needs ? "warning.main" : "text.disabled" ) }}>
                                                      {a.changed} file(s) · {intent ? `v${a.version} → v${projectVersion( a.version, intent )}` : `v${a.version}${needs ? " — choose a bump" : ""}`}
                                                  </Typography>
                                                : <Typography variant="caption" sx={{ color: "text.disabled" }}>{a.changed} file(s)</Typography>}
                                        </Box>
                                        {a.deleted && <Chip size="small" variant="outlined" color="error" label="deleted" />}
                                        {a.version && !a.deleted && (
                                            <ToggleButtonGroup size="small" exclusive value={intent ?? null} onChange={( _e, v : BumpKind | null ) => v && setIntent( a.path, v )}>
                                                <ToggleButton value="major" sx={{ px: 1, py: 0.1 }}>major</ToggleButton>
                                                <ToggleButton value="minor" sx={{ px: 1, py: 0.1 }}>minor</ToggleButton>
                                                <ToggleButton value="patch" sx={{ px: 1, py: 0.1 }}>patch</ToggleButton>
                                            </ToggleButtonGroup>
                                        )}
                                    </Box>
                                );
                            } )}

                            {/* test gate */}
                            <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
                                    <Button variant="contained" startIcon={<ScienceIcon />} disabled={busy || testSel.size === 0} onClick={() => runTests( [ ...testSel ] )}>Test selected ({testSel.size})</Button>
                                    <Button variant="outlined" startIcon={<ScienceIcon />} disabled={busy} onClick={() => runTests( [] )}>Test all</Button>
                                    <Chip size="small" variant="outlined" color={testsPassed ? "success" : "default"} label={testsPassed ? "tests passed" : "tests required"} />
                                </Box>

                                {/* commit / push / PR */}
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                                    <Autocomplete freeSolo options={branches.branches} inputValue={targetBranch} onInputChange={( _e, v ) => setTargetBranch( v )}
                                                  sx={{ width: 200 }} renderInput={( p ) => <TextField {...p} size="small" label="branch" />} />
                                    <TextField size="small" fullWidth placeholder="commit message / PR title" value={message} onChange={( e ) => setMessage( e.target.value )} disabled={busy} />
                                </Box>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <Tooltip title={!testsPassed ? "Run tests first" : !intentsReady ? "Choose a version bump for every checked area" : `Commit & push to ${targetBranch || "?"}`}>
                                        <span><Button variant="contained" startIcon={<UploadIcon />} disabled={!canCommit} onClick={() => void commitPush()}>Commit &amp; push</Button></span>
                                    </Tooltip>
                                    <Tooltip title={isMain ? "PRs are for non-default branches" : !testsPassed ? "Run tests first" : !intentsReady ? "Choose a version bump for every checked area" : "Commit, push & open a PR"}>
                                        <span><Button variant="contained" color="success" startIcon={<MergeIcon />} disabled={!canCommit || isMain} onClick={() => void createPR()}>Create PR</Button></span>
                                    </Tooltip>
                                </Box>
                                <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 0.5 }}>
                                    Version bumps are an <b>intent</b> — applied only on commit. Tests must pass and every checked area needs a bump selected. Push to <b>{targetBranch || "…"}</b> (type a new name to branch), or open a PR from a non-default branch.
                                </Typography>
                            </Box>
                        </>
                    )}
                </Box>

                {/* right: shared git/npm console */}
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <LogView lines={lines} empty="git / npm output appears here" hideId />
                </Box>
            </Box>
        </Box>
    );
}
