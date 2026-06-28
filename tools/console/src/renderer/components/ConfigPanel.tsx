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
import SaveIcon from "@mui/icons-material/Save";
import RefreshIcon from "@mui/icons-material/Refresh";
import DataObjectIcon from "@mui/icons-material/DataObject";

import { ConfigSchema } from "@repo/api";

import type { ConfigContent, ConfigSaveResult, ServiceConfigTree, TargetInfo } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";
import { JsonEditor } from "./JsonEditor";

// Indentation used everywhere this panel pretty-prints (load + the Format button) — keep them in sync.
const JSON_INDENT : number = 2;

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
        void api.configProfiles( service ).then( ( t : ServiceConfigTree ) =>
        {
            if ( !active ) return;
            setTree( t );
            setLoadingTree( false );
            // default selections: prefer the "settings" profile, then "default" env
            const firstProfile : string = ( t.profiles.find( ( p ) => p.name === "settings" ) ?? t.profiles[ 0 ] )?.id ?? "";
            const firstEnv : string = ( t.environments.find( ( e ) => e.name === "default" ) ?? t.environments[ 0 ] )?.id ?? "";
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
        void api.configGet( tree.applicationId, profileId ).then( ( c : ConfigContent ) =>
        {
            if ( !active ) return;
            setLoadingDoc( false );
            if ( c.error ) { setMsg( { kind: "err", text: c.error } ); return; }
            // AppConfig stores JSON minified (one line); pretty-print on load so it's readable/editable.
            // Set content + original to the SAME formatted text so the editor doesn't open "dirty".
            const ctype : string = c.contentType || "application/json";
            const text : string = prettyJson( c.content, ctype );
            setContent( text );
            setOriginal( text );
            setVersion( c.version );
            setContentType( ctype );
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
        catch ( err ) { return ( err as Error ).message; }
    }, [ content, contentType ] );

    const profiles : ServiceConfigTree[ "profiles" ] = tree?.profiles ?? [];
    const environments : ServiceConfigTree[ "environments" ] = tree?.environments ?? [];

    // The schema only applies to the service's `settings` profile (the typed config). Other profiles
    // (feature flags, etc.) are edited as plain JSON. Comes from @repo/api so it's the SAME contract the
    // service validates against.
    const profileName : string = profiles.find( ( p ) => p.id === profileId )?.name ?? "";
    const schema : object | undefined = useMemo<object | undefined>(
        () => ( profileName === "settings" ? ConfigSchema.forService( service ) : undefined ),
        [ profileName, service ],
    );

    // Schema validation (only when JSON parses + a schema applies) → inline issues + a save guard, using
    // the config's own compiled validator from @repo/api.
    const schemaIssues : Array<string> = useMemo<Array<string>>( () =>
    {
        if ( !schema || jsonError || content.trim() === "" ) return [];
        const validator = ConfigSchema.validatorFor( service );
        if ( !validator ) return [];
        try
        {
            const result = validator( JSON.parse( content ) );
            return result.valid ? [] : result.issues.map( ( i ) => `${i.path || "(root)"}: ${i.message}` );
        }
        catch { return []; }
    }, [ schema, service, content, jsonError ] );

    function onFormat() : void
    {
        try { setContent( JSON.stringify( JSON.parse( content ), null, JSON_INDENT ) ); setMsg( null ); }
        catch ( err ) { setMsg( { kind: "err", text: `Can't format — ${( err as Error ).message}` } ); }
    }

    function onReload() : void
    {
        setContent( original );
        setMsg( null );
    }

    async function onSave() : Promise<void>
    {
        if ( !tree?.applicationId || !profileId || !envId ) return;
        setSaving( true );
        setMsg( null );
        const res : ConfigSaveResult = await api.configSave( tree.applicationId, profileId, envId, content, contentType );
        setSaving( false );
        if ( !res.ok ) { setMsg( { kind: "err", text: res.error ?? "Save failed" } ); return; }
        setOriginal( content );
        setVersion( res.version );
        setMsg( { kind: "ok", text: `Deployed v${res.version} (deployment #${res.deployment ?? "?"})` } );
    }

    const targetChip = ( ) : string =>
        targetInfo ? ( targetInfo.target.kind === "aws" ? `aws · ${targetInfo.target.profile ?? ""}` : "localstack" ) : "…";


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
                <Select size="small" value={profileId} onChange={( e ) => setProfileId( e.target.value )} sx={{ minWidth: 150, fontFamily: MONO, fontSize: 13 }}>
                    {profiles.map( ( p ) => (
                        <MenuItem key={p.id} value={p.id} sx={{ fontFamily: MONO, fontSize: 13 }}>
                            {p.name}{p.type.includes( "FeatureFlags" ) ? " ⚑" : ""}
                        </MenuItem>
                    ) )}
                </Select>

                <Typography variant="caption" sx={{ color: "text.disabled", ml: 1 }}>env</Typography>
                <Select size="small" value={envId} onChange={( e ) => setEnvId( e.target.value )} sx={{ minWidth: 110, fontFamily: MONO, fontSize: 13 }}>
                    {environments.map( ( en ) => (
                        <MenuItem key={en.id} value={en.id} sx={{ fontFamily: MONO, fontSize: 13 }}>{en.name}</MenuItem>
                    ) )}
                </Select>

                <Box sx={{ flexGrow: 1 }} />

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

            {/* status / validation line — parse error → schema errors → save message */}
            {( msg || jsonError || schemaIssues.length > 0 ) && (
                <Box sx={{ px: 1.5, py: 0.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
                    {jsonError
                        ? <Typography variant="caption" sx={{ color: "#f85149", fontFamily: MONO }}>invalid JSON — {jsonError}</Typography>
                        : schemaIssues.length > 0
                            ? <Typography variant="caption" sx={{ color: "#f85149", fontFamily: MONO }}>
                                  schema — {schemaIssues.slice( 0, 3 ).join( " · " )}{schemaIssues.length > 3 ? ` (+${schemaIssues.length - 3} more)` : ""}
                              </Typography>
                            : <Typography variant="caption" sx={{ color: msg!.kind === "ok" ? "#3fb950" : "#f85149", fontFamily: MONO }}>{msg!.text}</Typography>}
                </Box>
            )}

            {/* editor */}
            <Box sx={{ position: "relative", flexGrow: 1, minHeight: 0 }}>
                {loadingDoc && (
                    <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "rgba(0,0,0,0.3)", zIndex: 1 }}>
                        <CircularProgress size={18} />
                    </Box>
                )}
                <JsonEditor
                    value={content}
                    onChange={setContent}
                    readOnly={readOnly}
                    schema={schema}
                />
            </Box>
        </Box>
    );
}
