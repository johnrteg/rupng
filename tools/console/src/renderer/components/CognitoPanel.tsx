import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import SaveIcon from "@mui/icons-material/Save";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import DeleteIcon from "@mui/icons-material/DeleteOutline";

import type { CognitoPool, CognitoUser, TargetInfo } from "../../shared/types";
import { TargetKind } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// The Cognito tab (auth) — browse/edit users in the service's user pool. List/search users, edit
// attributes, enable/disable, set a password, delete; create new users. Real AWS is read-only.
//
const READONLY_ATTRS : Set<string> = new Set( [ "sub", "identities" ] );   // not user-editable via UpdateUserAttributes

/**
 * The Cognito tab — list/search and edit users in a service's user pool: edit attributes,
 * enable/disable, set a password, delete, and create users. Read-only on real AWS.
 */
export function CognitoPanel( { service } : { service : string } )
{
    const [ pools, setPools ]   = useState<Array<CognitoPool>>( [] );
    const [ poolId, setPoolId ] = useState<string>( "" );
    const [ loadingPools, setLoadingPools ] = useState<boolean>( true );
    const [ poolsError, setPoolsError ] = useState<string>( "" );

    const [ users, setUsers ]   = useState<Array<CognitoUser>>( [] );
    const [ filter, setFilter ] = useState<string>( "" );
    const [ loadingUsers, setLoadingUsers ] = useState<boolean>( false );

    const [ selected, setSelected ] = useState<CognitoUser | null>( null );
    const [ attrDraft, setAttrDraft ] = useState<string>( "" );
    const [ isNew, setIsNew ]   = useState<boolean>( false );
    const [ newUsername, setNewUsername ] = useState<string>( "" );
    const [ password, setPassword ] = useState<string>( "" );
    const [ saving, setSaving ] = useState<boolean>( false );
    const [ msg, setMsg ]       = useState<{ kind : "ok" | "err"; text : string } | null>( null );

    const [ targetInfo, setTargetInfo ] = useState<TargetInfo | null>( null );
    const readOnly : boolean = targetInfo?.readOnly ?? false;

    useEffect( () => { void api.targetGet().then( setTargetInfo ); }, [] );

    // pools for the service
    useEffect( () =>
    {
        let active : boolean = true;
        setLoadingPools( true ); setPoolsError( "" ); setPools( [] ); setPoolId( "" );
        void api.cognitoPools( service ).then( ( result ) =>
        {
            if ( !active ) return;
            setLoadingPools( false );
            if ( result.error ) { setPoolsError( result.error ); return; }
            setPools( result.pools );
            if ( result.pools.length > 0 ) setPoolId( result.pools[ 0 ].id );
        } );
        return () => { active = false; };
    }, [ service ] );

    // users when the pool changes
    useEffect( () => { if ( poolId ) void loadUsers(); else setUsers( [] ); clearDetail();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ poolId ] );

    /** Fetch users for the current pool, applying the email filter. */
    async function loadUsers() : Promise<void>
    {
        if ( !poolId ) return;
        setLoadingUsers( true );
        const result = await api.cognitoUsers( poolId, filter );
        setLoadingUsers( false );
        if ( result.error ) { setMsg( { kind: "err", text: result.error } ); return; }
        setUsers( result.users );
    }

    /** Reset the detail pane (no selection, no in-progress create). */
    function clearDetail() : void { setSelected( null ); setAttrDraft( "" ); setIsNew( false ); setNewUsername( "" ); setPassword( "" ); setMsg( null ); }

    /** Open a user in the detail pane, loading their attributes into the editor. */
    function openUser( user : CognitoUser ) : void
    {
        setSelected( user ); setIsNew( false ); setPassword( "" ); setMsg( null );
        setAttrDraft( JSON.stringify( user.attributes, null, 2 ) );
    }

    /** Start a new-user form, seeding the attribute editor with common fields. */
    function newUser() : void
    {
        clearDetail(); setIsNew( true );
        setAttrDraft( JSON.stringify( { email: "", email_verified: "true", given_name: "", family_name: "" }, null, 2 ) );
    }

    // Validate the attribute editor: must be a (non-array) JSON object, or a parse-error message.
    const attrError : string | null = useMemo<string | null>( () =>
    {
        if ( attrDraft.trim() === "" ) return null;
        try { const parsed : unknown = JSON.parse( attrDraft ); if ( typeof parsed !== "object" || parsed === null || Array.isArray( parsed ) ) return "must be a JSON object of attributes"; return null; }
        catch ( parseError ) { return ( parseError as Error ).message; }
    }, [ attrDraft ] );

    /** Build the writable attribute map from the editor, dropping read-only attributes and stringifying values. */
    function attrsForWrite() : Record<string, string>
    {
        const parsed : Record<string, unknown> = JSON.parse( attrDraft );
        const writable : Record<string, string> = {};
        Object.entries( parsed ).forEach( ( [ attrName, attrValue ] ) => { if ( !READONLY_ATTRS.has( attrName ) ) writable[ attrName ] = String( attrValue ); } );
        return writable;
    }

    /** Save edited attributes for the selected user. */
    async function onSaveAttrs() : Promise<void>
    {
        if ( !poolId || attrError ) return;
        setSaving( true ); setMsg( null );
        const result = await api.cognitoUpdateUser( poolId, selected!.username, attrsForWrite() );
        setSaving( false );
        if ( !result.ok ) { setMsg( { kind: "err", text: result.error ?? "Update failed" } ); return; }
        setMsg( { kind: "ok", text: "Attributes saved" } );
        void loadUsers();
    }

    /** Create a new user with the entered username, attributes, and optional temp password. */
    async function onCreate() : Promise<void>
    {
        if ( !poolId || attrError || newUsername.trim() === "" ) return;
        setSaving( true ); setMsg( null );
        const result = await api.cognitoCreateUser( poolId, newUsername.trim(), attrsForWrite(), password || undefined );
        setSaving( false );
        if ( !result.ok ) { setMsg( { kind: "err", text: result.error ?? "Create failed" } ); return; }
        clearDetail();
        void loadUsers();
    }

    /** Flip the selected user's enabled state. */
    async function onToggleEnabled() : Promise<void>
    {
        if ( !poolId || !selected ) return;
        setSaving( true ); setMsg( null );
        const result = await api.cognitoSetEnabled( poolId, selected.username, !selected.enabled );
        setSaving( false );
        if ( !result.ok ) { setMsg( { kind: "err", text: result.error ?? "Failed" } ); return; }
        setSelected( { ...selected, enabled: !selected.enabled } );
        void loadUsers();
    }

    /** Set a new permanent password for the selected user. */
    async function onSetPassword() : Promise<void>
    {
        if ( !poolId || !selected || password.trim() === "" ) return;
        setSaving( true ); setMsg( null );
        const result = await api.cognitoSetPassword( poolId, selected.username, password, true );
        setSaving( false );
        if ( !result.ok ) { setMsg( { kind: "err", text: result.error ?? "Failed" } ); return; }
        setPassword( "" );
        setMsg( { kind: "ok", text: "Password set (permanent)" } );
    }

    /** Delete the selected user. */
    async function onDelete() : Promise<void>
    {
        if ( !poolId || !selected ) return;
        setSaving( true ); setMsg( null );
        const result = await api.cognitoDeleteUser( poolId, selected.username );
        setSaving( false );
        if ( !result.ok ) { setMsg( { kind: "err", text: result.error ?? "Delete failed" } ); return; }
        clearDetail();
        void loadUsers();
    }


    // ── render ───────────────────────────────────────────────────────────────────────────────────
    if ( loadingPools )
        return <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1 }}><CircularProgress size={16} /><Typography variant="caption">loading pools…</Typography></Box>;

    if ( poolsError )
        return <Box sx={{ p: 2 }}><Typography variant="body2" sx={{ color: "warning.main" }}>{poolsError}</Typography></Box>;

    if ( pools.length === 0 )
        return <Box sx={{ p: 2 }}><Typography variant="body2" sx={{ color: "text.disabled" }}>“{service}” owns no Cognito user pool (or none is deployed).</Typography></Box>;

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* toolbar */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>pool</Typography>
                <Select size="small" value={poolId} onChange={( event ) => setPoolId( event.target.value )} sx={{ minWidth: 180, fontFamily: MONO, fontSize: 12 }}>
                    {pools.map( ( pool ) => <MenuItem key={pool.id} value={pool.id} sx={{ fontFamily: MONO, fontSize: 12 }}>{pool.name}</MenuItem> )}
                </Select>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, bgcolor: "background.default", borderRadius: 1.5, border: "1px solid", borderColor: "divider" }}>
                    <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
                    <InputBase placeholder="email…" value={filter} onChange={( event ) => setFilter( event.target.value )} onKeyDown={( event ) => { if ( event.key === "Enter" ) void loadUsers(); }} sx={{ fontSize: 12, width: 140, fontFamily: MONO }} />
                </Box>
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title={readOnly ? "Real AWS — editing disabled (switch target to LocalStack)" : "Current AWS target"}>
                    <Chip size="small" variant="outlined" color={readOnly ? "warning" : "default"} label={targetInfo ? ( targetInfo.target.kind === TargetKind.AWS ? `aws · ${targetInfo.target.profile ?? ""}` : "localstack" ) : "…"} sx={{ fontFamily: MONO }} />
                </Tooltip>
                <Tooltip title="Refresh"><IconButton size="small" onClick={() => void loadUsers()}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
                <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={readOnly} onClick={newUser}>New</Button>
            </Box>

            <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                {/* user list */}
                <Box sx={{ width: 280, flexShrink: 0, borderRight: "1px solid", borderColor: "divider", overflow: "auto", bgcolor: "#0a0d12" }}>
                    {loadingUsers && <Box sx={{ p: 1, display: "flex", justifyContent: "center" }}><CircularProgress size={14} /></Box>}
                    {!loadingUsers && users.length === 0 && <Typography variant="caption" sx={{ display: "block", p: 1.5, color: "text.disabled", fontFamily: MONO }}>no users</Typography>}
                    {users.map( ( user ) => (
                        <Box key={user.username} onClick={() => openUser( user )}
                             sx={{ px: 1.25, py: 0.75, borderBottom: "1px solid #161b22", cursor: "pointer", "&:hover": { bgcolor: "#161b22" }, bgcolor: selected?.username === user.username ? "#161b22" : undefined }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.7 }}>
                                <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: user.enabled ? "#3fb950" : "#f85149", flexShrink: 0 }} />
                                <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "#e6edf3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {user.attributes.email || user.username}
                                </Typography>
                            </Box>
                            <Typography sx={{ fontFamily: MONO, fontSize: 10.5, color: "text.disabled", ml: 1.7 }}>{user.status}</Typography>
                        </Box>
                    ) )}
                </Box>

                {/* detail */}
                <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
                    {!selected && !isNew && <Box sx={{ p: 2 }}><Typography variant="caption" sx={{ color: "text.disabled" }}>select a user, or New…</Typography></Box>}

                    {( selected || isNew ) && (
                        <>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                                {isNew
                                    ? <TextField size="small" placeholder="username (email/phone)" value={newUsername} onChange={( event ) => setNewUsername( event.target.value )} sx={{ minWidth: 240 }} />
                                    : <>
                                        <Typography sx={{ fontFamily: MONO, fontSize: 13 }}>{selected!.attributes.email || selected!.username}</Typography>
                                        <Chip size="small" variant="outlined" label={selected!.status} sx={{ fontFamily: MONO }} />
                                        <Chip size="small" color={selected!.enabled ? "success" : "error"} variant="outlined" label={selected!.enabled ? "enabled" : "disabled"} />
                                      </>}
                            </Box>

                            {( msg || attrError ) && (
                                <Box sx={{ px: 1.5, py: 0.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
                                    {attrError
                                        ? <Typography variant="caption" sx={{ color: "#f85149", fontFamily: MONO }}>invalid JSON — {attrError}</Typography>
                                        : <Typography variant="caption" sx={{ color: msg!.kind === "ok" ? "#3fb950" : "#f85149", fontFamily: MONO }}>{msg!.text}</Typography>}
                                </Box>
                            )}

                            <Typography variant="caption" sx={{ color: "text.disabled", px: 1.5, pt: 0.75 }}>attributes</Typography>
                            <Box component="textarea"
                                 value={attrDraft}
                                 spellCheck={false}
                                 readOnly={readOnly}
                                 onChange={( event : React.ChangeEvent<HTMLTextAreaElement> ) => setAttrDraft( event.target.value )}
                                 sx={{ flexGrow: 1, minHeight: 120, width: "100%", boxSizing: "border-box", resize: "none", border: "none", outline: "none",
                                       bgcolor: "#0a0d12", color: "#e6edf3", fontFamily: MONO, fontSize: 13, lineHeight: 1.5, p: 1.5 }} />

                            {/* actions */}
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderTop: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                                {isNew
                                    ? <Button size="small" variant="contained" startIcon={saving ? <CircularProgress size={14} /> : <AddIcon />} disabled={saving || readOnly || !!attrError || newUsername.trim() === ""} onClick={() => void onCreate()}>Create</Button>
                                    : <>
                                        <Button size="small" variant="contained" startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />} disabled={saving || readOnly || !!attrError} onClick={() => void onSaveAttrs()}>Save</Button>
                                        <Button size="small" variant="outlined" disabled={saving || readOnly} onClick={() => void onToggleEnabled()}>{selected!.enabled ? "Disable" : "Enable"}</Button>
                                      </>}
                                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: 1 }}>
                                    <TextField size="small" type="password" placeholder={isNew ? "temp password" : "new password"} value={password} onChange={( event ) => setPassword( event.target.value )} sx={{ width: 150 }} />
                                    {!isNew && <Button size="small" variant="text" disabled={saving || readOnly || password.trim() === ""} onClick={() => void onSetPassword()}>Set</Button>}
                                </Box>
                                <Box sx={{ flexGrow: 1 }} />
                                {!isNew && <Tooltip title="Delete user"><span><IconButton size="small" color="error" disabled={saving || readOnly} onClick={() => void onDelete()}><DeleteIcon fontSize="small" /></IconButton></span></Tooltip>}
                            </Box>
                        </>
                    )}
                </Box>
            </Box>
        </Box>
    );
}
