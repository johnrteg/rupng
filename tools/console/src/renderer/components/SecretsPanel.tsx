import { useEffect, useState, useCallback, type ReactElement } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import SaveIcon from "@mui/icons-material/Save";
import RefreshIcon from "@mui/icons-material/Refresh";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

import type { SecretList, SecretSummary } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// The Secrets tab — view/edit a service's Secrets Manager secrets: its OWN (e.g. media's browse-pexels /
// browse-unsplash) and the PLATFORM-shared AI provider keys (ai-openai/…) every service reads. Reveal a
// value on demand, edit it, and Save (PutSecretValue). Targets LocalStack or real AWS via the shared
// Monitor target; real AWS is read-only here (edit in the AWS console). Values are never listed up front —
// each is fetched only when revealed.
//

/** The Secrets tab for one service — its own + the platform-shared AI keys, with reveal/edit/save. */
export function SecretsPanel( { service } : { service : string } )
{
    const [ list, setList ]       = useState<SecretList | null>( null );
    const [ loading, setLoading ] = useState<boolean>( true );
    const [ readOnly, setReadOnly ] = useState<boolean>( false );

    // per-secret UI state, keyed by ARN: the revealed/edited value, whether it's shown, busy + status flags
    const [ shown, setShown ]     = useState<Record<string, boolean>>( {} );
    const [ draft, setDraft ]     = useState<Record<string, string>>( {} );
    const [ busy, setBusy ]       = useState<Record<string, boolean>>( {} );
    const [ status, setStatus ]   = useState<Record<string, string>>( {} );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the service's + platform secrets (+ the target's read-only flag)
    const load = useCallback( async () : Promise<void> =>
    {
        setLoading( true );
        const [ secrets, target ] = await Promise.all( [ api.secretsList( service ), api.targetGet() ] );
        setList( secrets );
        setReadOnly( target.readOnly );
        setShown( {} ); setDraft( {} ); setStatus( {} );
        setLoading( false );
    }, [ service ] );

    useEffect( () => { void load(); }, [ load ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // reveal a secret's value (fetch on demand) or hide it again
    async function toggleReveal( secret : SecretSummary ) : Promise<void>
    {
        if( shown[ secret.arn ] ) { setShown( ( s ) => ( { ...s, [ secret.arn ]: false } ) ); return; }
        setBusy( ( b ) => ( { ...b, [ secret.arn ]: true } ) );
        const result = await api.secretsGet( secret.arn );
        setBusy( ( b ) => ( { ...b, [ secret.arn ]: false } ) );
        if( result.error ) { setStatus( ( s ) => ( { ...s, [ secret.arn ]: result.error ?? "load failed" } ) ); return; }
        setDraft( ( d ) => ( { ...d, [ secret.arn ]: result.value } ) );
        setShown( ( s ) => ( { ...s, [ secret.arn ]: true } ) );
        setStatus( ( s ) => ( { ...s, [ secret.arn ]: "" } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // set/update a secret's value
    async function save( secret : SecretSummary ) : Promise<void>
    {
        setBusy( ( b ) => ( { ...b, [ secret.arn ]: true } ) );
        const result = await api.secretsSave( secret.arn, draft[ secret.arn ] ?? "" );
        setBusy( ( b ) => ( { ...b, [ secret.arn ]: false } ) );
        setStatus( ( s ) => ( { ...s, [ secret.arn ]: result.ok ? "saved ✓" : ( result.error ?? "save failed" ) } ) );
        if( result.ok ) void load();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // clear a secret's value → unset, so the app treats the provider/key as not configured (e.g. an
    // auto-generated placeholder value that was never really set)
    async function clear( secret : SecretSummary ) : Promise<void>
    {
        setBusy( ( b ) => ( { ...b, [ secret.arn ]: true } ) );
        const result = await api.secretsClear( secret.arn );
        setBusy( ( b ) => ( { ...b, [ secret.arn ]: false } ) );
        setStatus( ( s ) => ( { ...s, [ secret.arn ]: result.ok ? "cleared ✓" : ( result.error ?? "clear failed" ) } ) );
        if( result.ok ) { setDraft( ( d ) => ( { ...d, [ secret.arn ]: "" } ) ); void load(); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one secret row — name/scope/description, reveal toggle, editable value, save
    function row( secret : SecretSummary ) : ReactElement
    {
        const isShown : boolean = shown[ secret.arn ] ?? false;
        const value : string = draft[ secret.arn ] ?? "";
        const isBusy : boolean = busy[ secret.arn ] ?? false;
        const note : string = status[ secret.arn ] ?? "";
        const multiline : boolean = value.trim().startsWith( "{" );

        return  <Box key={ secret.arn } sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1.5, mb: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Typography sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>{ secret.key }</Typography>
                        <Chip size="small" variant="outlined" color={ secret.scope === "platform" ? "secondary" : "default" }
                              label={ secret.scope === "platform" ? "platform" : service } />
                        { secret.hasValue
                            ? <Chip size="small" color="success" variant="outlined" label="set" />
                            : <Chip size="small" color="warning" variant="outlined" label="not set" /> }
                        <Box sx={{ flexGrow: 1 }} />
                        <Tooltip title={ isShown ? "Hide value" : "Reveal value" }>
                            <span><IconButton size="small" onClick={ () => void toggleReveal( secret ) } disabled={ isBusy }>
                                { isShown ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" /> }
                            </IconButton></span>
                        </Tooltip>
                        <Tooltip title={ secret.hasValue ? "Clear value (unset)" : "Nothing to clear" }>
                            <span><IconButton size="small" color="error" onClick={ () => void clear( secret ) } disabled={ readOnly || isBusy || !secret.hasValue }>
                                <DeleteOutlineIcon fontSize="small" />
                            </IconButton></span>
                        </Tooltip>
                    </Box>

                    { secret.description &&
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{ secret.description }</Typography> }

                    { isShown &&
                        <Box sx={{ mt: 1 }}>
                            <TextField
                                value={ value }
                                onChange={ ( e ) => setDraft( ( d ) => ( { ...d, [ secret.arn ]: e.target.value } ) ) }
                                fullWidth multiline={ multiline } minRows={ multiline ? 4 : 1 } size="small"
                                disabled={ readOnly || isBusy }
                                slotProps={{ input: { sx: { fontFamily: MONO, fontSize: 12 } } }}
                                placeholder={ multiline ? '{ "appId": "…", "accessKey": "…" }' : "secret value" }
                            />
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                                <Button size="small" variant="contained" startIcon={ <SaveIcon /> }
                                        disabled={ readOnly || isBusy } onClick={ () => void save( secret ) }>
                                    { isBusy ? "Saving…" : "Save" }
                                </Button>
                                { note && <Typography variant="caption" sx={{ color: note.includes( "✓" ) ? "success.main" : "error.main" }}>{ note }</Typography> }
                            </Box>
                        </Box> }
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( loading ) return <Box sx={{ p: 2 }}><CircularProgress size={ 20 } /></Box>;

    const secrets : Array<SecretSummary> = list?.secrets ?? [];
    const platform : Array<SecretSummary> = secrets.filter( ( s ) => s.scope === "platform" );
    const owned : Array<SecretSummary> = secrets.filter( ( s ) => s.scope === "service" );

    return  <Box sx={{ height: "100%", overflow: "auto", p: 1.5 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2">{"Secrets Manager"}</Typography>
                    <Box sx={{ flexGrow: 1 }} />
                    { readOnly && <Chip size="small" color="warning" variant="outlined" label="read-only (AWS target)" /> }
                    <Tooltip title="Reload"><IconButton size="small" onClick={ () => void load() }><RefreshIcon fontSize="small" /></IconButton></Tooltip>
                </Box>

                { list?.error && <Typography variant="caption" sx={{ color: "error.main" }}>{ list.error }</Typography> }

                { secrets.length === 0 && !list?.error &&
                    <Typography variant="body2" sx={{ color: "text.secondary", p: 1 }}>
                        {"No secrets — deploy the service (its secret shells are created by the /cloud build)."}
                    </Typography> }

                { owned.length > 0 &&
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" sx={{ color: "text.disabled", textTransform: "uppercase", letterSpacing: 0.5 }}>{"Service secrets"}</Typography>
                        <Box sx={{ mt: 0.5 }}>{ owned.map( row ) }</Box>
                    </Box> }

                { platform.length > 0 &&
                    <Box>
                        <Divider sx={{ mb: 1 }} />
                        <Typography variant="caption" sx={{ color: "text.disabled", textTransform: "uppercase", letterSpacing: 0.5 }}>{"Platform-shared AI keys (all services)"}</Typography>
                        <Box sx={{ mt: 0.5 }}>{ platform.map( row ) }</Box>
                    </Box> }
            </Box>;
}
