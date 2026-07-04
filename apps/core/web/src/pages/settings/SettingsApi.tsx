import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import RefreshOutlinedIcon       from '@mui/icons-material/RefreshOutlined';
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';

import { Access } from '@repo/system';
import { ApiKey, GetApiKeys, PostApiKey, DeleteApiKey } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage    from '@widgets/app/AuthPage';
import TableInput  from '@widgets/core/TableInput';
import SnackAlert  from '@widgets/core/SnackAlert';
import AlertPrompt from '@widgets/core/AlertPrompt';
import AccountChange from '@widgets/app/AccountChange';
import CreateApiKeyDialog from '@pages/settings/dialogs/CreateApiKeyDialog';
import ApiKeySecretDialog from '@pages/settings/dialogs/ApiKeySecretDialog';

// TableInput row-action ids
enum KeyAction { REVOKE = "revoke" }

//
// Settings : API — the developer-API surface. Two parts: (1) developer API keys (this page) and (2) API
// docs (a later part). Keys are account-scoped: an admin creates a named key with a max role (capped at their
// own), sees the full secret ONCE, and can revoke keys here. The list + create/revoke go through the auth
// service's api-keys endpoints. Non-admins see a notice — the endpoints are ACCOUNT-gated.
//
export function SettingsApi( props : SettingsApi.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const editable : boolean = Access.isAllowed( appmodel.auth.role(), Access.AccountRole.ACCOUNT );

    const [keys,setKeys]       = React.useState< Array<ApiKey.View> >( [] );
    const [loading,setLoading] = React.useState< boolean >( true );
    const [createOpen,setCreateOpen] = React.useState< boolean >( false );
    const [revoke,setRevoke]   = React.useState< ApiKey.View | null >( null );        // pending revoke → confirm
    const [secret,setSecret]   = React.useState< { name : string; secret : string } | null >( null );   // show-once reveal
    const [snack,setSnack]     = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { if( editable ) void load(); else setLoading( false ); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the acting account's keys
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetApiKeys.Response> = await appmodel.server.fetch( new GetApiKeys() );
        if( reply.ok && reply.data ) setKeys( reply.data.keys );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // mint a key (from the create dialog) — on success reveal the one-time secret + reload; true closes it
    async function onCreate( name : string, role : Access.Role, expiresInDays? : number ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostApiKey.Response> = await appmodel.server.fetch( new PostApiKey( { name, role, expiresInDays } ) );
        if( reply.ok && reply.data )
        {
            setCreateOpen( false );
            setSecret( { name: reply.data.key.name, secret: reply.data.secret } );   // reveal ONCE
            void load();
            return true;
        }
        setSnack( { message: "Could not create the key. Please try again.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the revoke confirm's action: on YES revoke the pending key (snack + reload); any action dismisses
    async function onRevokeAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( revoke && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<DeleteApiKey.Response> = await appmodel.server.fetch( new DeleteApiKey( revoke.keyId ) );
            if( reply.ok ) { setSnack( { message: "Key revoked.", severity: "success" } ); void load(); }
            else setSnack( { message: "Could not revoke the key. Please try again.", severity: "error" } );
        }
        setRevoke( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a row action → open the revoke confirm for that key
    function onKeyAction( action : string, row : TableInput.Row ) : void
    {
        if( action === KeyAction.REVOKE ) setRevoke( keys.find( ( key : ApiKey.View ) => key.keyId === row.id ) ?? null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // map a role value to its human label (falls back to the raw value)
    function roleLabel( role : Access.Role ) : string
    {
        return CreateApiKeyDialog.ROLE_CHOICES.find( ( choice ) => choice.value === role )?.label as string ?? String( role );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // status cell — active (green) vs revoked (muted)
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const revoked : boolean = row.status === ApiKey.Status.REVOKED;
        return <Chip size="small" variant="outlined" color={ revoked ? "default" : "success" } label={ revoked ? "Revoked" : "Active" } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // key-id cell — show the public prefix `rup_<keyId>` in monospace (the secret half is never stored)
    function keyIdRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        return <Typography variant="body2" sx={{ fontFamily: "monospace", color: "text.secondary" }}>{ `rup_${ row.id }` }</Typography>;
    }

    // ── TableInput config ──────────────────────────────────────────────────────────────────────
    const keyActions : Array<TableInput.Action> =
    [
        { id: KeyAction.REVOKE, label: "Revoke", icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
    ];

    const keyColumns : Array<TableInput.Column> =
    [
        { field: "name",       label: "Name",       type: TableInput.ColumnType.STRING },
        { field: "keyId",      label: "Key",        type: TableInput.ColumnType.CUSTOM,   renderer: keyIdRenderer },
        { field: "roleLabel",  label: "Max role",   type: TableInput.ColumnType.STRING },
        { field: "status",     label: "Status",     type: TableInput.ColumnType.CUSTOM,   renderer: statusRenderer },
        { field: "createdAt",  label: "Created",    type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
        { field: "expiresAt",  label: "Expires",    type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
        { field: "lastUsedAt", label: "Last used",  type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
        { field: "actions",    label: "",           type: TableInput.ColumnType.ACTION },
    ];

    const keyRows : Array<TableInput.Row> = keys.map( ( key : ApiKey.View ) => ( {
        id:         key.keyId,
        name:       key.name,
        roleLabel:  roleLabel( key.role ),
        status:     key.status,
        createdAt:  key.createdAt ? new Date( key.createdAt ) : undefined,
        expiresAt:  key.expiresAt ? new Date( key.expiresAt * 1000 ) : undefined,     // TTL is epoch seconds
        lastUsedAt: key.lastUsedAt ? new Date( key.lastUsedAt ) : undefined,
        actions:    key.status === ApiKey.Status.ACTIVE ? [ KeyAction.REVOKE ] : [],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.ACCOUNT } title={"Settings : API"}>
                <Box sx={{ p: 2, maxWidth: 1000, mx: "auto" }}>

                    { !editable &&
                        <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"Only account admins can manage API keys."}</Typography> }

                    { editable && loading &&
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }

                    { editable && !loading &&
                        <Stack spacing={ 2 }>

                            {/* ── Developer API keys ───────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"API Keys"}
                                            subheader={"Keys authenticate programmatic requests as this account. A key's role caps what it can do. The full key is shown only once, when created."}
                                            action={
                                                <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1 }}>
                                                    <Tooltip title={"Refresh"}><span><IconButton size="small" onClick={ () => void load() } disabled={ loading }><RefreshOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>
                                                    <Button variant="contained" size="small" startIcon={ <AddOutlinedIcon /> } onClick={ () => setCreateOpen( true ) }>{"Create key"}</Button>
                                                </Stack>
                                            } />
                                <Divider />
                                <CardContent>
                                    { keys.length === 0
                                        ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No API keys yet. Create one to start making authenticated API requests."}</Typography>
                                        : <TableInput id="settings-api-keys"
                                                      columns={ keyColumns }
                                                      data={ keyRows }
                                                      actions={ keyActions }
                                                      onAction={ onKeyAction }
                                                      selectable={ TableInput.Selectable.NONE } />
                                    }
                                </CardContent>
                            </Card>

                            {/* ── API documentation (later) ────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"API Documentation"} subheader={"Reference for the public API — endpoints, authentication, and examples."} />
                                <Divider />
                                <CardContent>
                                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                        { "Authenticate requests with the " }
                                        <Box component="span" sx={{ fontFamily: "monospace" }}>{ "Authorization: Bearer rup_<keyId>.<secret>" }</Box>
                                        { " header. Full endpoint documentation is coming soon." }
                                    </Typography>
                                </CardContent>
                            </Card>

                        </Stack>
                    }
                </Box>

                <AccountChange onClear={ () => setKeys( [] ) }
                               onRefresh={ () => { if( Access.isAllowed( appmodel.auth.role(), Access.AccountRole.ACCOUNT ) ) void load(); } } />

                { createOpen &&
                    <CreateApiKeyDialog callerRole={ appmodel.auth.role() }
                                        onCreate={ onCreate }
                                        onClose={ () => setCreateOpen( false ) } /> }

                { secret &&
                    <ApiKeySecretDialog name={ secret.name } secret={ secret.secret } onClose={ () => setSecret( null ) } /> }

                { revoke &&
                    <AlertPrompt id="settings-api-revoke"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Revoke API key"}
                                 message={ `Revoke "${ revoke.name }"? Any request using this key will immediately stop working. This can't be undone.` }
                                 yesText={"Revoke"}
                                 yesColor={"error"}
                                 cancelText={"Cancel"}
                                 onAction={ onRevokeAction } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace SettingsApi
{
    export interface Props
    {
    }
}

export default SettingsApi;
// eof
