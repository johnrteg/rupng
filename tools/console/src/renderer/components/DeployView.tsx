import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import ListSubheader from "@mui/material/ListSubheader";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import DifferenceIcon from "@mui/icons-material/Difference";
import RefreshIcon from "@mui/icons-material/Refresh";
import TuneIcon from "@mui/icons-material/Tune";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import GridViewIcon from "@mui/icons-material/GridView";

import { DEPLOY_ID, DEPLOY_ENVS, type DeployEnvName, type DeployEnvConfig, type DeployRequest, type DeployMap, type DeployState,
         type ClaudeMode, type LogLine, type ProcState, type ServiceInfo } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";
import { LogView } from "./LogView";
import { ClaudePanel } from "./ClaudePanel";

//
// The Deploy tab — promote a specific COMMITTED version (a release/X.Y line, or a vX.Y.Z tag for
// rollback) to a real AWS environment, enforcing the release model in RELEASE.md:
//   • environments.json records what's deployed where (the Map reads it; deploys update it).
//   • production requires a named approver + change ticket, and is auto-tagged vX.Y.Z (immutable).
//   • every deploy appends a signed entry to deploy-audit.jsonl.
// Local code only ever goes to LocalStack (the per-service Develop pipeline), never here.
//

const ENV_COLOR : Record<DeployEnvName, string> = { dev: "#58c4ff", staging: "#d29922", production: "#f85149" };
const ENV_LABEL : Record<DeployEnvName, string> = { dev: "Dev", staging: "Staging", production: "PRODUCTION" };

const STORE_KEY = "rup.deploy.envs";

const DEFAULT_CONFIGS : Record<DeployEnvName, DeployEnvConfig> =
{
    dev        : { profile: "rupng-dev",        region: "us-east-1" },
    staging    : { profile: "rupng-staging",    region: "us-east-1" },
    production : { profile: "rupng-production", region: "us-east-1" }
};

/** Load per-env AWS configs from localStorage, falling back to the defaults for missing fields. */
function loadConfigs() : Record<DeployEnvName, DeployEnvConfig>
{
    try
    {
        const raw : string | null = localStorage.getItem( STORE_KEY );
        if ( !raw ) return DEFAULT_CONFIGS;
        const saved = JSON.parse( raw ) as Partial<Record<DeployEnvName, Partial<DeployEnvConfig>>>;
        const merged = { ...DEFAULT_CONFIGS };
        for ( const envName of DEPLOY_ENVS ) merged[ envName ] = { ...DEFAULT_CONFIGS[ envName ], ...( saved[ envName ] ?? {} ) };
        return merged;
    }
    catch { return DEFAULT_CONFIGS; }
}

/** Signature of the current selection — production deploy requires a diff previewed for this exact set. */
function signature( env : DeployEnvName, ref : string, sel : Set<string>, platform : boolean ) : string
{
    return `${env}|${ref}|${platform ? "P+" : ""}${[ ...sel ].sort().join( "," )}`;
}

/** True for a release line branch ("release/X.Y"). */
const isRelease = ( branch : string ) : boolean => /^release\//.test( branch );

export function DeployView()
{
    const [ env, setEnv ]           = useState<DeployEnvName>( "dev" );
    const [ ref, setRef ]           = useState<string>( "" );
    const [ refs, setRefs ]         = useState<{ branches : Array<string>; tags : Array<string>; current : string }>( { branches: [], tags: [], current: "" } );
    const [ services, setServices ] = useState<Array<ServiceInfo>>( [] );
    const [ sel, setSel ]           = useState<Set<string>>( new Set() );
    const [ platform, setPlatform ] = useState<boolean>( false );
    const [ configs, setConfigs ]   = useState<Record<DeployEnvName, DeployEnvConfig>>( loadConfigs );
    const [ gitVer, setGitVer ]     = useState<Record<string, string>>( {} );
    const [ depVer, setDepVer ]     = useState<Record<string, string>>( {} );
    const [ verNote, setVerNote ]   = useState<string>( "" );
    const [ lines, setLines ]       = useState<Array<LogLine>>( [] );
    const [ busy, setBusy ]         = useState<boolean>( false );
    const [ showCfg, setShowCfg ]   = useState<boolean>( false );
    const [ confirmOpen, setConfirmOpen ] = useState<boolean>( false );
    const [ confirmText, setConfirmText ] = useState<string>( "" );
    const [ lastDiff, setLastDiff ] = useState<string>( "" );
    const [ claudeMode, setClaudeMode ] = useState<ClaudeMode>( "ondemand" );
    const [ sub, setSub ]           = useState<"map" | "deploy">( "map" );
    const [ map, setMap ]           = useState<DeployMap | null>( null );
    const [ mapLoading, setMapLoading ] = useState<boolean>( false );
    const [ dstate, setDstate ]     = useState<DeployState | null>( null );
    // production change-control inputs
    const [ tagInput, setTagInput ] = useState<string>( "" );
    const [ approver, setApprover ] = useState<string>( "" );
    const [ ticket, setTicket ]     = useState<string>( "" );
    const [ emergency, setEmergency ] = useState<boolean>( false );

    const cfg : DeployEnvConfig = configs[ env ];
    const isProd : boolean = env === "production";
    const color : string = ENV_COLOR[ env ];
    const sig : string = signature( env, ref, sel, platform );

    // default ref for an env = its currently-deployed ref (environments.json), else newest release line, else main/current
    const pickDefaultRef = useCallback( ( envName : DeployEnvName, refData : { branches : Array<string>; current : string }, state : DeployState | null ) : string =>
    {
        const deployedRef : string | undefined = state?.[ envName ]?.ref;
        if ( deployedRef ) return deployedRef;
        const releaseLines : Array<string> = refData.branches.filter( isRelease ).sort().reverse();
        if ( releaseLines.length ) return releaseLines[ 0 ];
        return refData.branches.includes( "main" ) ? "main" : refData.branches.includes( "master" ) ? "master" : refData.current;
    }, [] );

    // ── load services + refs + state once ───────────────────────────────────────────────────────
    useEffect( () =>
    {
        void api.listServices().then( setServices );
        void Promise.all( [ api.deployRefs(), api.deployState() ] ).then( ( [ loadedRefs, loadedState ] ) =>
        {
            setRefs( loadedRefs ); setDstate( loadedState );
            setRef( ( prev ) => prev || pickDefaultRef( env, loadedRefs, loadedState ) );
        } );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [] );

    // switching env (via the toggle) re-points the ref to that env's current/default
    const selectEnv = ( envName : DeployEnvName ) : void => { setEnv( envName ); setRef( pickDefaultRef( envName, refs, dstate ) ); };

    // ── stream the deploy console ──────────────────────────────────────────────────────────────────
    useEffect( () =>
    {
        let active : boolean = true;
        void api.getLog( DEPLOY_ID, "deploy" ).then( ( history : Array<LogLine> ) => { if ( active ) setLines( history ); } );
        const offLog : () => void = api.onLog( ( line : LogLine ) => { if ( line.service === DEPLOY_ID && line.stream === "deploy" ) setLines( ( prev ) => ( prev.length > 1500 ? [ ...prev.slice( -1500 ), line ] : [ ...prev, line ] ) ); } );
        const offProc : () => void = api.onProc( ( proc : ProcState ) =>
        {
            if ( proc.service === DEPLOY_ID && proc.stream === "deploy" )
            {
                setBusy( proc.running );
                if ( !proc.running ) { void api.deployState().then( setDstate ); }   // refresh pointers when a deploy finishes
            }
        } );
        return () => { active = false; offLog(); offProc(); };
    }, [] );

    const serviceIds : Array<string> = useMemo( () => services.map( ( service ) => service.id ), [ services ] );

    /** Load the git-committed version of each service at the selected ref. */
    const loadGit = useCallback( () => { if ( ref && serviceIds.length ) void api.deployGitVersions( ref, serviceIds ).then( setGitVer ); }, [ ref, serviceIds ] );
    /** Load the live deployed version of each service in the current env's account. */
    const loadDeployed = useCallback( () =>
    {
        if ( !cfg.profile.trim() ) { setDepVer( {} ); setVerNote( "set an AWS profile in env settings to read deployed versions" ); return; }
        void api.deployedVersions( cfg ).then( ( result ) => { setDepVer( result.deployed ); setVerNote( result.error ?? "" ); } );
    }, [ cfg ] );
    useEffect( () => { loadGit(); }, [ loadGit ] );
    useEffect( () => { loadDeployed(); }, [ loadDeployed ] );

    // propose the production tag whenever the prod ref changes
    useEffect( () =>
    {
        if ( !isProd || !ref ) { return; }
        void api.deployProposeTag( ref ).then( ( proposedTag ) => setTagInput( proposedTag ?? "" ) );
    }, [ isProd, ref ] );

    // map (service × environment)
    /** Load the service × environment map (live + at-ref versions across all envs). */
    const loadMap = useCallback( () => { setMapLoading( true ); void api.deployMap( configs ).then( setMap ).finally( () => setMapLoading( false ) ); }, [ configs ] );
    useEffect( () => { if ( sub === "map" ) loadMap(); }, [ sub, loadMap ] );

    /** Merge a config patch into the current env's settings and persist all configs. */
    const saveCfg = ( patch : Partial<DeployEnvConfig> ) : void =>
        setConfigs( ( prev ) =>
        {
            const next = { ...prev, [ env ]: { ...prev[ env ], ...patch } };
            try { localStorage.setItem( STORE_KEY, JSON.stringify( next ) ); } catch { /* ignore */ }
            return next;
        } );

    /** Toggle a service id in/out of the deploy selection set. */
    const toggle = ( id : string ) : void => setSel( ( prev ) => { const next = new Set( prev ); next.has( id ) ? next.delete( id ) : next.add( id ); return next; } );

    /** Build the deploy/diff request payload from the current form state (prod fields only when prod). */
    const request = ( mode : "diff" | "deploy" ) : DeployRequest => ( {
        env, services: [ ...sel ], platform, ref, mode, config: cfg,
        tag      : isProd ? ( tagInput.trim() || undefined ) : undefined,
        approver : isProd ? ( approver.trim() || undefined ) : undefined,
        ticket   : isProd ? ( ticket.trim() || undefined ) : undefined,
        emergency: isProd ? emergency : undefined,
    } );

    const nothingSelected : boolean = sel.size === 0 && !platform;
    const prodFieldsOk : boolean = !isProd || ( !!approver.trim() && !!ticket.trim() && !!tagInput.trim() );
    const canAct : boolean = !busy && !!ref && !!cfg.profile.trim() && !nothingSelected && prodFieldsOk;
    const prodReady : boolean = !isProd || lastDiff === sig;   // prod requires a diff previewed for this exact selection

    // ── promotion / rollback: pre-fill the Deploy form (gates still apply) and switch to it ─────────
    /** Pre-fill the Deploy form to promote the `from` env's ref to the `to` env. */
    const promote = ( from : DeployEnvName, to : DeployEnvName ) : void =>
    {
        const fromRef : string | undefined = map?.envs[ from ]?.ref || dstate?.[ from ]?.ref;
        if ( !fromRef ) return;
        setEnv( to ); setRef( fromRef ); setSel( new Set( serviceIds ) ); setPlatform( false ); setLastDiff( "" ); setSub( "deploy" );
    };
    /** Pre-fill the Deploy form to redeploy the most recent non-current tag to production. */
    const rollback = () : void =>
    {
        const currentProdTag : string | undefined = map?.envs.production?.tag ?? dstate?.production?.tag;
        const previousTag : string | undefined = refs.tags.find( ( tag ) => tag !== currentProdTag );   // most recent tag that isn't current
        setEnv( "production" ); setRef( previousTag ?? "" ); setSel( new Set( serviceIds ) ); setPlatform( false ); setLastDiff( "" ); setSub( "deploy" );
    };
    /** Cut the next release/X.Y line from the newest one, push it, and refresh refs. */
    const openLine = () : void =>
    {
        if ( busy || !window.confirm( "Create the next release/X.Y line from the newest one and push it?" ) ) return;
        void api.deployOpenLine().then( ( result ) =>
        {
            void api.deployRefs().then( setRefs );
            window.alert( result.line ? `Opened ${result.line}. Deploy it to Dev from the Deploy tab to start the next version.` : ( result.error ?? "could not open the next line" ) );
        } );
    };

    /** Preview the CloudFormation diff and record the signature so a prod deploy can be unlocked. */
    const runDiff = () : void => { if ( !canAct ) return; setLastDiff( sig ); void api.deployRun( request( "diff" ) ); };
    /** Open the deploy confirmation dialog (clearing any prior typed confirmation). */
    const askDeploy = () : void => { if ( !canAct ) return; setConfirmText( "" ); setConfirmOpen( true ); };
    /** Close the dialog and fire the actual deploy. */
    const doDeploy = () : void => { setConfirmOpen( false ); void api.deployRun( request( "deploy" ) ); };
    /** Clear the deploy console log. */
    const clearLog = () : void => { void api.clearLog( DEPLOY_ID, "deploy" ).then( () => setLines( [] ) ); };

    // CloudFormation stacks this deploy will touch: platform-<env> (optional) + each selected service
    const stacks : Array<string> = [ ...( platform ? [ `platform-${env}` ] : [] ), ...[ ...sel ].sort().map( ( serviceId ) => `${serviceId}-${env}` ) ];
    const confirmOk : boolean = !isProd || confirmText.trim() === "production";
    const current : string | undefined = dstate?.[ env ]?.ref;
    const currentTag : string | undefined = dstate?.[ env ]?.tag;

    const releaseBranches : Array<string> = refs.branches.filter( isRelease );
    const otherBranches : Array<string> = refs.branches.filter( ( branch ) => !isRelease( branch ) );

    // ── per-service version cell (deploy panel): git@ref vs live in this env ────────────────────────
    /** Render the git@ref version over the live version for one service, color-coded by match/drift. */
    const verCell = ( id : string ) =>
    {
        const gitVersion : string | undefined = gitVer[ id ];
        const liveVersion : string | undefined = depVer[ id ];
        const match : boolean = !!gitVersion && !!liveVersion && gitVersion === liveVersion;
        const diff : boolean = !!gitVersion && !!liveVersion && gitVersion !== liveVersion;
        return (
            <Box sx={{ textAlign: "right", fontFamily: MONO, fontSize: 12, lineHeight: 1.3 }}>
                <Box component="span" sx={{ color: "text.disabled" }}>git </Box>
                <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>{gitVersion ?? "—"}</Box>
                <Box sx={{ color: match ? "success.main" : diff ? "warning.main" : "text.disabled" }}>live {liveVersion ?? "—"} {match ? "✓" : diff ? "≠" : ""}</Box>
            </Box>
        );
    };

    const deployPanel = (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* env selector + ref + refresh */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <ToggleButtonGroup size="small" exclusive value={env} onChange={( _event, nextEnv : DeployEnvName | null ) => nextEnv && selectEnv( nextEnv )}>
                    {DEPLOY_ENVS.map( ( envName ) => (
                        <ToggleButton key={envName} value={envName} sx={{ px: 1.5, fontWeight: 700, color: ENV_COLOR[ envName ], "&.Mui-selected": { color: "#fff", bgcolor: ENV_COLOR[ envName ], "&:hover": { bgcolor: ENV_COLOR[ envName ] } } }}>
                            {ENV_LABEL[ envName ]}
                        </ToggleButton>
                    ) )}
                </ToggleButtonGroup>

                <Tooltip title="Version to deploy — a release/X.Y line, or a vX.Y.Z tag (rollback)">
                    <Select size="small" value={ref} onChange={( event ) => setRef( event.target.value )} sx={{ minWidth: 200, fontFamily: MONO }}>
                        {releaseBranches.length > 0 && <ListSubheader>release lines</ListSubheader>}
                        {releaseBranches.map( ( branch ) => <MenuItem key={`r-${branch}`} value={branch} sx={{ fontFamily: MONO }}>{branch}</MenuItem> )}
                        {refs.tags.length > 0 && <ListSubheader>tags (rollback)</ListSubheader>}
                        {refs.tags.map( ( tag ) => <MenuItem key={`t-${tag}`} value={tag} sx={{ fontFamily: MONO }}>{tag}</MenuItem> )}
                        {otherBranches.length > 0 && <ListSubheader>other branches</ListSubheader>}
                        {otherBranches.map( ( branch ) => <MenuItem key={`b-${branch}`} value={branch} sx={{ fontFamily: MONO }}>{branch}</MenuItem> )}
                    </Select>
                </Tooltip>

                {current && <Chip size="small" variant="outlined" sx={{ fontFamily: MONO }} label={`live: ${currentTag ?? current}`} />}

                <Tooltip title="Env AWS settings (profile / region)"><IconButton size="small" onClick={() => setShowCfg( ( shown ) => !shown )} color={showCfg ? "primary" : "default"}><TuneIcon fontSize="small" /></IconButton></Tooltip>
                <Box sx={{ flexGrow: 1 }} />
                {busy && <CircularProgress size={16} />}
                <Tooltip title="Refresh refs + versions"><span><Button size="small" startIcon={<RefreshIcon fontSize="small" />} disabled={busy} onClick={() => { void api.deployRefs().then( setRefs ); void api.deployState().then( setDstate ); loadGit(); loadDeployed(); }}>Refresh</Button></span></Tooltip>
            </Box>

            {isProd && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 0.75, bgcolor: ENV_COLOR.production, color: "#fff" }}>
                    <WarningAmberIcon fontSize="small" />
                    <Typography variant="body2" sx={{ fontWeight: 800, letterSpacing: 0.5 }}>PRODUCTION — requires a diff preview, an approver + ticket, and a typed confirmation. The deploy is auto-tagged and audited.</Typography>
                </Box>
            )}

            <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                {/* left: config + (prod change-control) + service picker + actions */}
                <Box sx={{ width: "48%", minWidth: 460, flexShrink: 0, overflow: "auto", p: 1.5, borderRight: "1px solid", borderColor: "divider" }}>
                    <Collapse in={showCfg}>
                        <Box sx={{ display: "flex", gap: 1, mb: 1.5, p: 1, border: "1px solid", borderColor: "divider", borderRadius: 1.5, flexWrap: "wrap" }}>
                            <TextField size="small" label={`${ENV_LABEL[ env ]} AWS profile`} value={cfg.profile} onChange={( event ) => saveCfg( { profile: event.target.value } )} sx={{ width: 200 }} />
                            <TextField size="small" label="region" value={cfg.region} onChange={( event ) => saveCfg( { region: event.target.value } )} sx={{ width: 140 }} />
                            <Typography variant="caption" sx={{ color: "text.disabled", alignSelf: "center", flexGrow: 1 }}>Live versions are read by discovering each service's API Gateway /version in this account.</Typography>
                        </Box>
                    </Collapse>

                    {isProd && (
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1.5, p: 1, border: "1px solid", borderColor: ENV_COLOR.production, borderRadius: 1.5 }}>
                            <Typography variant="caption" sx={{ color: ENV_COLOR.production, fontWeight: 700 }}>Production change control</Typography>
                            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                                <TextField size="small" label="tag (auto)" value={tagInput} onChange={( event ) => setTagInput( event.target.value )} sx={{ width: 130, fontFamily: MONO }} />
                                <TextField size="small" label="approver (≠ you)" value={approver} onChange={( event ) => setApprover( event.target.value )} sx={{ width: 150 }} />
                                <TextField size="small" label="ticket" value={ticket} onChange={( event ) => setTicket( event.target.value )} placeholder="RUP-123" sx={{ width: 120 }} />
                            </Box>
                            <FormControlLabel control={<Checkbox size="small" checked={emergency} onChange={( event ) => setEmergency( event.target.checked )} />}
                                label={<Typography variant="caption">Emergency change (skip-staging hotfix) — flagged for retroactive review</Typography>} />
                        </Box>
                    )}

                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                        <Typography variant="caption" sx={{ color: "text.disabled", flexGrow: 1 }}>Services to deploy — git@<b>{ref || "…"}</b> vs live in <b style={{ color }}>{ENV_LABEL[ env ]}</b>:</Typography>
                        <Button size="small" sx={{ minWidth: 0 }} onClick={() => setSel( new Set( serviceIds ) )}>all</Button>
                        <Button size="small" sx={{ minWidth: 0 }} onClick={() => setSel( new Set() )}>none</Button>
                    </Box>

                    {services.map( ( service ) => (
                        <Box key={service.id} sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5, p: 0.5, pl: 1, border: "1px solid", borderColor: sel.has( service.id ) ? color : "divider", borderRadius: 1.5 }}>
                            <Checkbox size="small" checked={sel.has( service.id )} onChange={() => toggle( service.id )} sx={{ p: 0.5 }} />
                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{service.label} <Box component="span" sx={{ color: "text.disabled", fontFamily: MONO, fontWeight: 400 }}>{service.id}-{env}</Box></Typography>
                            </Box>
                            {verCell( service.id )}
                        </Box>
                    ) )}

                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 1, p: 0.5, pl: 1, border: "1px dashed", borderColor: platform ? color : "divider", borderRadius: 1.5 }}>
                        <Checkbox size="small" checked={platform} onChange={() => setPlatform( ( on ) => !on )} sx={{ p: 0.5 }} />
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>Platform <Box component="span" sx={{ color: "text.disabled", fontFamily: MONO, fontWeight: 400 }}>platform-{env}</Box></Typography>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>shared VPC / Kafka / OpenSearch — only when infra changed</Typography>
                        </Box>
                    </Box>

                    {verNote && <Typography variant="caption" sx={{ display: "block", mt: 1, color: "warning.main" }}>{verNote}</Typography>}

                    <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Tooltip title="Preview the CloudFormation changes (cdk diff) without applying">
                            <span><Button variant="outlined" startIcon={<DifferenceIcon />} disabled={!canAct} onClick={runDiff}>Preview diff</Button></span>
                        </Tooltip>
                        <Tooltip title={!canAct ? ( isProd ? "Pick a ref + profile + service, and fill the tag, approver, and ticket" : "Pick a ref, profile, and at least one service" ) : isProd && !prodReady ? "Run a diff preview for this exact selection first" : `Deploy to ${ENV_LABEL[ env ]}`}>
                            <span><Button variant="contained" startIcon={<RocketLaunchIcon />} sx={{ bgcolor: color, "&:hover": { bgcolor: color, filter: "brightness(0.9)" } }} disabled={!canAct || !prodReady} onClick={askDeploy}>Deploy {ENV_LABEL[ env ]}</Button></span>
                        </Tooltip>
                    </Box>
                    <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>
                        Deploys <b>{ref || "…"}</b> via an isolated worktree → <code>cdk {isProd ? "deploy" : "diff/deploy"} {stacks.join( " " ) || "…"}</code> (profile <b>{cfg.profile || "—"}</b>){isProd && tagInput ? <>, auto-tags <b style={{ fontFamily: MONO }}>{tagInput}</b></> : null}, updates <code>environments.json</code> + the audit log.
                    </Typography>
                </Box>

                <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <Box sx={{ flexGrow: 1, minHeight: 0 }}><LogView lines={lines} empty="cdk / build output appears here" hideId onClear={clearLog} /></Box>
                    <Box sx={{ height: "42%", minHeight: 220, flexShrink: 0, borderTop: "1px solid", borderColor: "divider" }}><ClaudePanel service={DEPLOY_ID} mode={claudeMode} onMode={setClaudeMode} /></Box>
                </Box>
            </Box>

            <Dialog open={confirmOpen} onClose={() => setConfirmOpen( false )} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ color, fontWeight: 800 }}>Deploy to {ENV_LABEL[ env ]}?</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 1 }}>Ref <b style={{ fontFamily: MONO }}>{ref}</b> · profile <b style={{ fontFamily: MONO }}>{cfg.profile}</b> ({cfg.region})</Typography>
                    {isProd && <Typography variant="body2" sx={{ mb: 1 }}>Tag <b style={{ fontFamily: MONO }}>{tagInput}</b> · approver <b>{approver}</b> · ticket <b>{ticket}</b>{emergency ? " · EMERGENCY" : ""}</Typography>}
                    <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>Stacks:</Typography>
                    {stacks.map( ( stackName ) => <Typography key={stackName} variant="caption" sx={{ display: "block", fontFamily: MONO }}>{stackName}</Typography> )}
                    {isProd && (
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="body2" sx={{ color: ENV_COLOR.production, fontWeight: 700, mb: 0.5 }}>This is PRODUCTION. Type <code>production</code> to confirm.</Typography>
                            <TextField size="small" fullWidth autoFocus value={confirmText} onChange={( event ) => setConfirmText( event.target.value )} placeholder="production" />
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmOpen( false )}>Cancel</Button>
                    <Button variant="contained" sx={{ bgcolor: color, "&:hover": { bgcolor: color } }} disabled={!confirmOk} onClick={doDeploy}>Deploy</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );

    // ── map cell: live version (bold) over the version committed at the env's deployed ref ──────────
    /** Render one service × env cell: live version over the version committed at that env's ref. */
    const mapCell = ( envName : DeployEnvName, id : string ) =>
    {
        const column = map?.envs[ envName ];
        const live : string | undefined = column?.liveVersions[ id ];
        const atRef : string | undefined = column?.branchVersions[ id ];
        const sync : boolean = !!live && !!atRef && live === atRef;
        const drift : boolean = !!live && !!atRef && live !== atRef;
        const liveColor : string = sync ? "success.main" : drift ? "warning.main" : "text.disabled";
        return (
            <Box sx={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.35 }}>
                <Box sx={{ fontWeight: 700, color: liveColor }}>{live ?? "—"} {sync ? "✓" : drift ? "≠" : ""}</Box>
                <Box sx={{ color: "text.disabled" }}>ref {atRef ?? "—"}{atRef && !live ? " ↑" : ""}</Box>
            </Box>
        );
    };

    /** Chip showing how many commits an env is behind its upstream env (dev→staging, staging→prod). */
    const pendingChip = ( envName : DeployEnvName ) =>
    {
        const count : number | undefined = envName === "staging" ? map?.pending.devAheadOfStaging : envName === "production" ? map?.pending.stagingAheadOfProduction : undefined;
        if ( !count ) return null;
        const from : string = envName === "staging" ? "dev" : "staging";
        return <Chip size="small" color="warning" variant="outlined" label={`↑ ${count} from ${from}`} sx={{ mt: 0.5, height: 18, fontSize: 10 }} />;
    };

    const COLS = "1.4fr 1fr 1fr 1fr";
    const mapPanel = (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Service map</Typography>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>live version (from /version) vs the version committed at each env's deployed ref</Typography>
                <Box sx={{ flexGrow: 1 }} />
                {mapLoading && <CircularProgress size={16} />}
                <Button size="small" startIcon={<RefreshIcon fontSize="small" />} disabled={mapLoading} onClick={loadMap}>Refresh</Button>
            </Box>
            {/* promotion / rollback toolbar — each prepares the Deploy form (diff + confirm still required) */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Button size="small" variant="outlined" onClick={openLine} disabled={busy}>Open next line</Button>
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title="Deploy Dev's ref to Staging">
                    <span><Button size="small" variant="outlined" disabled={!map?.envs.dev?.ref} onClick={() => promote( "dev", "staging" )} sx={{ color: ENV_COLOR.staging, borderColor: ENV_COLOR.staging }}>Promote Dev → Staging</Button></span>
                </Tooltip>
                <Tooltip title="Deploy Staging's ref to Production (approval + tag required)">
                    <span><Button size="small" variant="outlined" disabled={!map?.envs.staging?.ref} onClick={() => promote( "staging", "production" )} sx={{ color: ENV_COLOR.production, borderColor: ENV_COLOR.production }}>Promote Staging → Prod</Button></span>
                </Tooltip>
                <Tooltip title="Redeploy a previous tag to Production">
                    <span><Button size="small" variant="outlined" disabled={refs.tags.length === 0} onClick={rollback}>Rollback Prod</Button></span>
                </Tooltip>
            </Box>
            <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", p: 1.5 }}>
                <Box sx={{ display: "grid", gridTemplateColumns: COLS, gap: 1, alignItems: "end", pb: 1, borderBottom: "1px solid", borderColor: "divider", position: "sticky", top: 0, bgcolor: "background.default", zIndex: 1 }}>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Service</Typography>
                    {DEPLOY_ENVS.map( ( envName ) => (
                        <Box key={envName}>
                            <Typography variant="body2" sx={{ fontWeight: 800, color: ENV_COLOR[ envName ] }}>{ENV_LABEL[ envName ]}</Typography>
                            <Typography variant="caption" sx={{ fontFamily: MONO, color: "text.disabled", display: "block" }}>{map?.envs[ envName ]?.tag ?? map?.envs[ envName ]?.ref ?? "(none)"}</Typography>
                            {pendingChip( envName )}
                        </Box>
                    ) )}
                </Box>
                {services.map( ( service ) => (
                    <Box key={service.id} sx={{ display: "grid", gridTemplateColumns: COLS, gap: 1, alignItems: "center", py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}>
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{service.label}</Typography>
                            <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>{service.id}</Typography>
                        </Box>
                        {DEPLOY_ENVS.map( ( envName ) => <Box key={envName}>{mapCell( envName, service.id )}</Box> )}
                    </Box>
                ) )}
                {DEPLOY_ENVS.map( ( envName ) => map?.envs[ envName ]?.liveError
                    ? <Typography key={envName} variant="caption" sx={{ display: "block", mt: 0.5, color: "text.disabled" }}><b style={{ color: ENV_COLOR[ envName ] }}>{ENV_LABEL[ envName ]}</b>: {map.envs[ envName ].liveError}</Typography>
                    : null ) }
                <Box sx={{ display: "flex", gap: 2, mt: 1.5, flexWrap: "wrap" }}>
                    <Typography variant="caption" sx={{ color: "success.main" }}>✓ live = ref</Typography>
                    <Typography variant="caption" sx={{ color: "warning.main" }}>≠ live differs from ref</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>↑ committed at ref, not yet live · "ref" = version at the deployed ref</Typography>
                </Box>
            </Box>
        </Box>
    );

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", px: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
                <Tabs value={sub} onChange={( _event, nextSub : "map" | "deploy" ) => setSub( nextSub )} sx={{ minHeight: 44, "& .MuiTab-root": { minHeight: 44 } }}>
                    <Tab value="map" icon={<GridViewIcon fontSize="small" />} iconPosition="start" label="Map" />
                    <Tab value="deploy" icon={<RocketLaunchIcon fontSize="small" />} iconPosition="start" label="Deploy" />
                </Tabs>
            </Box>
            <Box sx={{ flexGrow: 1, minHeight: 0 }}>{sub === "map" ? mapPanel : deployPanel}</Box>
        </Box>
    );
}
