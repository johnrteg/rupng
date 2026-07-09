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
        setStatus( ( s ) => ( { ...s, [ secret.arn ]: result.ok ? "deleted ✓" : ( result.error ?? "delete failed" ) } ) );
        if( result.ok ) { setDraft( ( d ) => ( { ...d, [ secret.arn ]: "" } ) ); void load(); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // read one field of a multi-field (JSON) secret out of the draft
    function fieldValue( arn : string, name : string ) : string
    {
        try { const obj : Record<string, unknown> = JSON.parse( draft[ arn ] ?? "{}" ) as Record<string, unknown>; return String( obj?.[ name ] ?? "" ); }
        catch { return ""; }
    }

    // update one field of a multi-field (JSON) secret in the draft (re-serializing the object)
    function setField( arn : string, name : string, val : string ) : void
    {
        setDraft( ( d ) =>
        {
            let obj : Record<string, unknown> = {};
            try { obj = JSON.parse( d[ arn ] ?? "{}" ) as Record<string, unknown>; } catch { obj = {}; }
            return { ...d, [ arn ]: JSON.stringify( { ...obj, [ name ]: val } ) };
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one provider/secret row — label + key, status, reveal/delete, and the value editor (single or per-field)
    function row( secret : SecretSummary ) : ReactElement
    {
        const isShown : boolean = shown[ secret.arn ] ?? false;
        const value : string = draft[ secret.arn ] ?? "";
        const isBusy : boolean = busy[ secret.arn ] ?? false;
        const note : string = status[ secret.arn ] ?? "";

        return  <Box key={ secret.arn } sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1.5, mb: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{ secret.label ?? secret.key }</Typography>
                        <Typography sx={{ fontFamily: MONO, fontSize: 11, color: "text.disabled" }}>{ secret.key }</Typography>
                        { !secret.exists
                            ? <Chip size="small" color="warning" variant="outlined" label="no key yet" />
                          : secret.hasValue
                            ? <Chip size="small" color="success" variant="outlined" label="set" />
                            : <Chip size="small" color="warning" variant="outlined" label="not set" /> }
                        <Box sx={{ flexGrow: 1 }} />
                        { secret.exists &&
                            <Tooltip title={ isShown ? "Hide value" : "Reveal / edit value" }>
                                <span><IconButton size="small" onClick={ () => void toggleReveal( secret ) } disabled={ isBusy }>
                                    { isShown ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" /> }
                                </IconButton></span>
                            </Tooltip> }
                        <Tooltip title={ secret.hasValue ? "Delete secret" : "Nothing to delete" }>
                            <span><IconButton size="small" color="error" onClick={ () => void clear( secret ) } disabled={ readOnly || isBusy || !secret.exists || !secret.hasValue }>
                                <DeleteOutlineIcon fontSize="small" />
                            </IconButton></span>
                        </Tooltip>
                    </Box>

                    { secret.keyHint &&
                        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>{ secret.keyHint }</Typography> }
                    { secret.docsUrl &&
                        <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO, display: "block" }}>{ `Get key: ${ secret.docsUrl }` }</Typography> }

                    {/* the value editor — shown for a not-yet-created secret (add its key) or a revealed one.
                        Multi-field providers (Twilio SID+token, Unsplash, Stripe) render one input per field
                        and store a JSON object; single-key providers render one input. */}
                    { ( isShown || !secret.exists ) &&
                        <Box sx={{ mt: 1 }}>
                            { secret.fields
                                ? secret.fields.map( ( field ) => (
                                    <TextField key={ field.name } label={ field.label }
                                               value={ fieldValue( secret.arn, field.name ) }
                                               onChange={ ( e ) => setField( secret.arn, field.name, e.target.value ) }
                                               fullWidth size="small" sx={{ mb: 1 }} disabled={ readOnly || isBusy }
                                               slotProps={{ input: { sx: { fontFamily: MONO, fontSize: 12 } } }} />
                                  ) )
                                : <TextField
                                      value={ value }
                                      onChange={ ( e ) => setDraft( ( d ) => ( { ...d, [ secret.arn ]: e.target.value } ) ) }
                                      fullWidth size="small" disabled={ readOnly || isBusy }
                                      slotProps={{ input: { sx: { fontFamily: MONO, fontSize: 12 } } }}
                                      placeholder={ secret.keyHint ?? "secret value" }
                                  /> }
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                                <Button size="small" variant="contained" startIcon={ <SaveIcon /> }
                                        disabled={ readOnly || isBusy || value.trim() === "" } onClick={ () => void save( secret ) }>
                                    { isBusy ? "Saving…" : secret.exists ? "Save" : "Add key" }
                                </Button>
                                { note && <Typography variant="caption" sx={{ color: note.includes( "✓" ) ? "success.main" : "error.main" }}>{ note }</Typography> }
                            </Box>
                        </Box> }
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( loading ) return <Box sx={{ p: 2 }}><CircularProgress size={ 20 } /></Box>;

    const secrets : Array<SecretSummary> = list?.secrets ?? [];

    // group by PROVIDER CATEGORY (from the registry); uncatalogued secrets fall under "other"
    const CATEGORY_LABELS : Record<string, string> =
        { ai: "AI providers (platform)", browse: "Browse / stock media", email: "Email providers", texting: "Texting / SMS", payments: "Payments", other: "Other secrets" };
    const CATEGORY_ORDER : Array<string> = [ "ai", "browse", "email", "texting", "payments", "other" ];
    const byCategory : Map<string, Array<SecretSummary>> = new Map<string, Array<SecretSummary>>();
    for( const secret of secrets )
    {
        const category : string = secret.category ?? "other";
        const bucket : Array<SecretSummary> = byCategory.get( category ) ?? [];
        bucket.push( secret );
        byCategory.set( category, bucket );
    }
    const categories : Array<string> = CATEGORY_ORDER.filter( ( category ) => byCategory.has( category ) );

    return  <Box sx={{ height: "100%", overflow: "auto", p: 1.5 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2">{"Providers & keys"}</Typography>
                    <Box sx={{ flexGrow: 1 }} />
                    { readOnly && <Chip size="small" color="warning" variant="outlined" label="read-only (AWS target)" /> }
                    <Tooltip title="Reload"><IconButton size="small" onClick={ () => void load() }><RefreshIcon fontSize="small" /></IconButton></Tooltip>
                </Box>

                { list?.error && <Typography variant="caption" sx={{ color: "error.main" }}>{ list.error }</Typography> }

                { secrets.length === 0 && !list?.error &&
                    <Typography variant="body2" sx={{ color: "text.secondary", p: 1 }}>
                        {"No providers declared for this service."}
                    </Typography> }

                { categories.map( ( category : string, index : number ) => (
                    <Box key={ category } sx={{ mb: 2 }}>
                        { index > 0 && <Divider sx={{ mb: 1 }} /> }
                        <Typography variant="caption" sx={{ color: "text.disabled", textTransform: "uppercase", letterSpacing: 0.5 }}>{ CATEGORY_LABELS[ category ] ?? category }</Typography>
                        <Box sx={{ mt: 0.5 }}>{ byCategory.get( category )!.map( row ) }</Box>
                    </Box>
                ) ) }
            </Box>;
}
