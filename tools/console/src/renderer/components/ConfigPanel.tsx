import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ToggleButton from "@mui/material/ToggleButton";
import { alpha } from "@mui/material/styles";
import SaveIcon from "@mui/icons-material/Save";
import RefreshIcon from "@mui/icons-material/Refresh";
import DataObjectIcon from "@mui/icons-material/DataObject";
import TuneIcon from "@mui/icons-material/Tune";
import CodeIcon from "@mui/icons-material/Code";

import { ConfigSchema, MediaConfig } from "@repo/api";

import type { ConfigContent, ConfigSaveResult, ServiceConfigTree, TargetInfo } from "../../shared/types";
import { TargetKind } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";
import { JsonEditor } from "./JsonEditor";
import { MediaConfigForm } from "./mediaConfig/MediaConfigForm";
import { EmailConfigForm } from "./emailConfig/EmailConfigForm";
import { VoiceConfigForm } from "./voiceConfig/VoiceConfigForm";
import { SocialConfigForm } from "./socialConfig/SocialConfigForm";
import { MonitorConfigForm } from "./monitorConfig/MonitorConfigForm";
import { AccountConfigForm } from "./accountConfig/AccountConfigForm";
import { AuthConfigForm } from "./authConfig/AuthConfigForm";
import { AppBootstrapForm } from "./appConfig/AppBootstrapForm";
import { AppServiceConfigForm } from "./appServiceConfig/AppServiceConfigForm";
import { ReportConfigForm } from "./reportConfig/ReportConfigForm";
import { RegistrationConfigForm } from "./registrationConfig/RegistrationConfigForm";

// Indentation used everywhere this panel pretty-prints (load + the Format button) — keep them in sync.
const JSON_INDENT : number = 2;

/** Which surface edits the profile's content — the raw JSON text, or a service's smart form. */
type EditorMode = "json" | "smart";

/** Shared props every smart (form-based) config editor takes — the SAME `content` string the JSON editor
 *  edits, so ConfigPanel can swap which one renders without splitting the source of truth. */
interface SmartEditorProps { content : string; onChange : ( content : string ) => void; readOnly : boolean; }

/** service name → profile key → its smart editor component. Most services have exactly one profile
 *  (`"settings"`); `app` has two (`"web"` and `"settings"`), each with its OWN smart editor. Add an entry
 *  here when a new service/profile gets one — see CLAUDE.md's "Models & closed sets" note on keeping a
 *  Config model's smart editor (AND its ConfigSchema.ts registration) in sync. */
const SMART_EDITORS : Record<string, Record<string, React.ComponentType<SmartEditorProps>>> =
{
    media:   { settings: MediaConfigForm },
    email:   { settings: EmailConfigForm },
    voice:   { settings: VoiceConfigForm },
    social:  { settings: SocialConfigForm },
    monitor: { settings: MonitorConfigForm },
    account: { settings: AccountConfigForm },
    auth:    { settings: AuthConfigForm },
    app:     { web: AppBootstrapForm, settings: AppServiceConfigForm },
    report:  { settings: ReportConfigForm },
    registration: { settings: RegistrationConfigForm },
};

/** Pretty-print JSON content; non-JSON (or unparseable) content is returned unchanged. */
function prettyJson( raw : string, contentType : string ) : string
{
    if ( !contentType.includes( "json" ) || raw.trim() === "" ) return raw;
    try { return JSON.stringify( JSON.parse( raw ), null, JSON_INDENT ); }
    catch { return raw; }   // leave invalid JSON as-is so the user can see/fix it
}

//
// The Config tab — view/edit a service's AppConfig. A service is one AppConfig application; each
// profile is a sub-config (settings = the service config, web, flags, sms-provider, …). Pick a
// sub-config + environment, edit the JSON, and "Save & Deploy" creates a new hosted version and
// deploys it (AllAtOnce) — the live value the service reads. Targets LocalStack or real AWS via the
// shared Monitor target; real AWS is read-only here.
//

/**
 * The Config tab — view/edit one service's AppConfig profile JSON, then "Save & Deploy"
 * to publish a new hosted version. Read-only when the target is real AWS.
 */
export function ConfigPanel( { service } : { service : string } )
{
    const [ tree, setTree ]       = useState<ServiceConfigTree | null>( null );
    const [ loadingTree, setLoadingTree ] = useState<boolean>( true );

    const [ profileId, setProfileId ] = useState<string>( "" );
    const [ envId, setEnvId ]         = useState<string>( "" );

    const [ content, setContent ]   = useState<string>( "" );
    const [ original, setOriginal ] = useState<string>( "" );
    const [ version, setVersion ]   = useState<number | undefined>( undefined );
    const [ contentType, setContentType ] = useState<string>( "application/json" );
    const [ loadingDoc, setLoadingDoc ]   = useState<boolean>( false );

    const [ saving, setSaving ]     = useState<boolean>( false );
    const [ msg, setMsg ]           = useState<{ kind : "ok" | "err"; text : string } | null>( null );

    const [ targetInfo, setTargetInfo ] = useState<TargetInfo | null>( null );
    const [ editorMode, setEditorMode ] = useState<EditorMode>( "json" );

    // current target (localstack vs real aws) → read-only flag + chip
    useEffect( () => { void api.targetGet().then( setTargetInfo ); }, [] );

    // load the config tree for the service
    useEffect( () =>
    {
        let active : boolean = true;
        setLoadingTree( true );
        setTree( null );
        setProfileId( "" );
        setEnvId( "" );
        void api.configProfiles( service ).then( ( configTree : ServiceConfigTree ) =>
        {
            if ( !active ) return;
            setTree( configTree );
            setLoadingTree( false );
            // default selections: prefer this service's registered editable profile (usually "settings",
            // but e.g. "web" for app — see ConfigSchema.profileFor), then "default" env
            const preferredProfile : string = ConfigSchema.profileFor( service );
            const firstProfile : string = ( configTree.profiles.find( ( profile ) => profile.name === preferredProfile ) ?? configTree.profiles[ 0 ] )?.id ?? "";
            const firstEnv : string = ( configTree.environments.find( ( environment ) => environment.name === "default" ) ?? configTree.environments[ 0 ] )?.id ?? "";
            setProfileId( firstProfile );
            setEnvId( firstEnv );
        } );
        return () => { active = false; };
    }, [ service ] );

    // load the selected profile's content
    useEffect( () =>
    {
        if ( !tree?.applicationId || !profileId ) { setContent( "" ); setOriginal( "" ); setVersion( undefined ); return; }
        let active : boolean = true;
        setLoadingDoc( true );
        setMsg( null );
        void api.configGet( tree.applicationId, profileId ).then( ( doc : ConfigContent ) =>
        {
            if ( !active ) return;
            setLoadingDoc( false );
            if ( doc.error ) { setMsg( { kind: "err", text: doc.error } ); return; }
            // AppConfig stores JSON minified (one line); pretty-print on load so it's readable/editable.
            // Set content + original to the SAME formatted text so the editor doesn't open "dirty".
            const docContentType : string = doc.contentType || "application/json";
            const formatted : string = prettyJson( doc.content, docContentType );
            setContent( formatted );
            setOriginal( formatted );
            setVersion( doc.version );
            setContentType( docContentType );
        } );
        return () => { active = false; };
    }, [ tree, profileId ] );

    const dirty : boolean = content !== original;
    const readOnly : boolean = targetInfo?.readOnly ?? false;

    // JSON validity (only for json content types) → inline error + Save guard
    const jsonError : string | null = useMemo<string | null>( () =>
    {
        if ( !contentType.includes( "json" ) || content.trim() === "" ) return null;
        try { JSON.parse( content ); return null; }
        catch ( parseError ) { return ( parseError as Error ).message; }
    }, [ content, contentType ] );

    const profiles : ServiceConfigTree[ "profiles" ] = tree?.profiles ?? [];
    const environments : ServiceConfigTree[ "environments" ] = tree?.environments ?? [];

    // The schema applies to WHICHEVER of a service's profiles is currently selected, if that (service,
    // profile) pair is registered (most services register only "settings"; app registers BOTH "web" and
    // "settings"). Other profiles (feature flags, etc.) are edited as plain JSON. Comes from @repo/api so
    // it's the SAME contract the service validates against.
    const profileName : string = profiles.find( ( profile ) => profile.id === profileId )?.name ?? "";
    const schema : object | undefined = useMemo<object | undefined>(
        () => ConfigSchema.forService( service, profileName ),
        [ profileName, service ],
    );

    // Schema validation (only when JSON parses + a schema applies) → inline issues + a save guard, using
    // the config's own compiled validator from @repo/api.
    const schemaIssues : Array<string> = useMemo<Array<string>>( () =>
    {
        if ( !schema || jsonError || content.trim() === "" ) return [];
        const validator = ConfigSchema.validatorFor( service, profileName );
        if ( !validator ) return [];
        try
        {
            const validation = validator( JSON.parse( content ) );
            return validation.valid ? [] : validation.issues.map( ( issue ) => `${issue.path || "(root)"}: ${issue.message}` );
        }
        catch { return []; }
    }, [ schema, service, profileName, content, jsonError ] );

    // ── Smart editor gate ────────────────────────────────────────────────────────────────────────────
    // The toggle between the raw JSON editor and a field-by-field smart form is only offered when the
    // CURRENTLY SELECTED (service, profile) pair has one registered in SMART_EDITORS.
    const SmartEditor : React.ComponentType<SmartEditorProps> | undefined = SMART_EDITORS[ service ]?.[ profileName ];
    const hasSmartEditor : boolean = !!SmartEditor && contentType.includes( "json" );

    // fall back to the JSON editor whenever the smart editor no longer applies (switched service/profile)
    useEffect( () => { if ( !hasSmartEditor ) setEditorMode( "json" ); }, [ hasSmartEditor ] );

    // ── Malware-scan engine quick-picker (media `settings`, JSON mode only) ─────────────────────────
    // A typed dropdown over the settings profile's `scan.provider`, so an operator doesn't have to hand-edit
    // the JSON to switch engines. It reads from + writes to the SAME JSON content (single source of truth).
    // The smart editor's own Scan section supersedes this, so it's shown only in JSON mode.
    const isMediaSettings : boolean = service === "media" && profileName === "settings" && contentType.includes( "json" );
    const isScanConfig : boolean = isMediaSettings && editorMode === "json";

    // the current scan.provider parsed out of the editor content (empty when the JSON doesn't parse)
    const scanProvider : string = useMemo<string>( () =>
    {
        if ( !isScanConfig || jsonError ) return "";
        try { return String( ( JSON.parse( content ) as { scan? : { provider? : string } } ).scan?.provider ?? "" ); }
        catch { return ""; }
    }, [ isScanConfig, content, jsonError ] );

    /** Set `scan.provider` (and toggle `scan.enabled` accordingly) in the editor JSON from the dropdown. */
    function onScanProviderChange( provider : string ) : void
    {
        try
        {
            const parsed : Record<string, unknown> = JSON.parse( content ) as Record<string, unknown>;
            const currentScan : Record<string, unknown> = ( parsed.scan as Record<string, unknown> ) ?? {};
            // picking a real engine enables scanning; picking "none" disables it (the pass-through stub)
            parsed.scan = { ...currentScan, provider, enabled: provider !== MediaConfig.ScanProvider.NONE };
            setContent( JSON.stringify( parsed, null, JSON_INDENT ) );
        }
        catch { /* invalid JSON — the dropdown is disabled in that state, so this shouldn't run */ }
    }

    /** Pretty-print the current editor content (Format button); surfaces a message on parse failure. */
    function onFormat() : void
    {
        try { setContent( JSON.stringify( JSON.parse( content ), null, JSON_INDENT ) ); setMsg( null ); }
        catch ( formatError ) { setMsg( { kind: "err", text: `Can't format — ${( formatError as Error ).message}` } ); }
    }

    /** Discard unsaved edits, restoring the last loaded/saved content. */
    function onReload() : void
    {
        setContent( original );
        setMsg( null );
    }

    /** Save & Deploy: publish the edited content as a new hosted version and deploy it. */
    async function onSave() : Promise<void>
    {
        if ( !tree?.applicationId || !profileId || !envId ) return;
        setSaving( true );
        setMsg( null );
        const saveResult : ConfigSaveResult = await api.configSave( tree.applicationId, profileId, envId, content, contentType );
        setSaving( false );
        if ( !saveResult.ok ) { setMsg( { kind: "err", text: saveResult.error ?? "Save failed" } ); return; }
        setOriginal( content );
        setVersion( saveResult.version );
        setMsg( { kind: "ok", text: `Deployed v${saveResult.version} (deployment #${saveResult.deployment ?? "?"})` } );
    }

    /** Short label for the current AWS target (aws · profile, or localstack). */
    const targetChip = ( ) : string =>
        targetInfo ? ( targetInfo.target.kind === TargetKind.AWS ? `aws · ${targetInfo.target.profile ?? ""}` : "localstack" ) : "…";


    // ── render ───────────────────────────────────────────────────────────────────────────────────
    if ( loadingTree )
        return <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1 }}><CircularProgress size={16} /><Typography variant="caption">loading config…</Typography></Box>;

    if ( tree?.error || profiles.length === 0 )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "warning.main", mb: 0.5 }}>No editable config for “{service}”.</Typography>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>
                    {tree?.error ?? "This service has no AppConfig profiles. They're created by the /cloud build — deploy the service, then reload."}
                </Typography>
            </Box>
        );

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

            {/* toolbar: sub-config · environment · target/version · actions */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>sub-config</Typography>
                <Select size="small" value={profileId} onChange={( event ) => setProfileId( event.target.value )} sx={{ minWidth: 150, fontFamily: MONO, fontSize: 13 }}>
                    {profiles.map( ( profile ) => (
                        <MenuItem key={profile.id} value={profile.id} sx={{ fontFamily: MONO, fontSize: 13 }}>
                            {profile.name}{profile.type.includes( "FeatureFlags" ) ? " ⚑" : ""}
                        </MenuItem>
                    ) )}
                </Select>

                <Typography variant="caption" sx={{ color: "text.disabled", ml: 1 }}>env</Typography>
                <Select size="small" value={envId} onChange={( event ) => setEnvId( event.target.value )} sx={{ minWidth: 110, fontFamily: MONO, fontSize: 13 }}>
                    {environments.map( ( environment ) => (
                        <MenuItem key={environment.id} value={environment.id} sx={{ fontFamily: MONO, fontSize: 13 }}>{environment.name}</MenuItem>
                    ) )}
                </Select>

                <Box sx={{ flexGrow: 1 }} />

                {hasSmartEditor && (
                    <ToggleButtonGroup
                        size="small" exclusive value={editorMode}
                        onChange={( _event : React.MouseEvent<HTMLElement>, next : EditorMode | null ) => { if ( next ) setEditorMode( next ); }}
                    >
                        <ToggleButton value="smart"><TuneIcon fontSize="small" sx={{ mr: 0.5 }} />Smart</ToggleButton>
                        <ToggleButton value="json"><CodeIcon fontSize="small" sx={{ mr: 0.5 }} />JSON</ToggleButton>
                    </ToggleButtonGroup>
                )}

                <Tooltip title={readOnly ? "Real AWS account — editing disabled (switch target to LocalStack in Monitor)" : "Current AWS target"}>
                    <Chip size="small" variant="outlined" color={readOnly ? "warning" : "default"} label={targetChip()} sx={{ fontFamily: MONO }} />
                </Tooltip>
                {version !== undefined && <Chip size="small" variant="outlined" label={`v${version}`} sx={{ fontFamily: MONO }} />}

                <Tooltip title="Pretty-print JSON"><span><IconButton size="small" onClick={onFormat} disabled={!!jsonError}><DataObjectIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title="Discard edits (reload last saved)"><span><IconButton size="small" onClick={onReload} disabled={!dirty}><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>
                <Button
                    size="small" variant="contained" startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />}
                    disabled={saving || !dirty || readOnly || !!jsonError || schemaIssues.length > 0 || !envId}
                    onClick={() => void onSave()}
                >
                    Save &amp; Deploy
                </Button>
            </Box>

            {/* malware-scan engine picker — media `settings` only; reads/writes scan.provider in the JSON */}
            {isScanConfig && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>malware scan engine</Typography>
                    <Select
                        size="small"
                        value={scanProvider}
                        disabled={readOnly || !!jsonError}
                        onChange={( event ) => onScanProviderChange( String( event.target.value ) )}
                        sx={{ minWidth: 160, fontFamily: MONO, fontSize: 13 }}
                    >
                        {Object.values( MediaConfig.ScanProvider ).map( ( provider ) => (
                            <MenuItem key={provider} value={provider} sx={{ fontFamily: MONO, fontSize: 13 }}>{provider}</MenuItem>
                        ) )}
                    </Select>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>
                        sets <code>scan.provider</code> + <code>scan.enabled</code> — Save &amp; Deploy to apply
                    </Typography>
                </Box>
            )}

            {/* status / validation line — parse error → schema errors → save message */}
            {( msg || jsonError || schemaIssues.length > 0 ) && (
                <Box sx={{ px: 1.5, py: 0.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
                    {jsonError
                        ? <Typography variant="caption" sx={{ color: "error.main", fontFamily: MONO }}>invalid JSON — {jsonError}</Typography>
                        : schemaIssues.length > 0
                            ? <Typography variant="caption" sx={{ color: "error.main", fontFamily: MONO }}>
                                  schema — {schemaIssues.slice( 0, 3 ).join( " · " )}{schemaIssues.length > 3 ? ` (+${schemaIssues.length - 3} more)` : ""}
                              </Typography>
                            : <Typography variant="caption" sx={{ color: msg!.kind === "ok" ? "success.main" : "error.main", fontFamily: MONO }}>{msg!.text}</Typography>}
                </Box>
            )}

            {/* editor */}
            <Box sx={{ position: "relative", flexGrow: 1, minHeight: 0 }}>
                {loadingDoc && (
                    <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: ( theme ) => alpha( theme.palette.common.black, 0.3 ), zIndex: 1 }}>
                        <CircularProgress size={18} />
                    </Box>
                )}
                {hasSmartEditor && editorMode === "smart" && SmartEditor
                    ? <SmartEditor content={content} onChange={setContent} readOnly={readOnly} />
                    : <JsonEditor value={content} onChange={setContent} readOnly={readOnly} schema={schema} />}
            </Box>
        </Box>
    );
}
