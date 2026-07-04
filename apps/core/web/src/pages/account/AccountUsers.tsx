import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import RefreshOutlinedIcon         from '@mui/icons-material/RefreshOutlined';
import PersonAddAltOutlinedIcon    from '@mui/icons-material/PersonAddAltOutlined';
import BlockOutlinedIcon           from '@mui/icons-material/BlockOutlined';
import LockOpenOutlinedIcon        from '@mui/icons-material/LockOpenOutlined';
import DeleteOutlineOutlinedIcon   from '@mui/icons-material/DeleteOutlineOutlined';
import SendOutlinedIcon            from '@mui/icons-material/SendOutlined';
import CloseOutlinedIcon           from '@mui/icons-material/CloseOutlined';
import ManageAccountsOutlinedIcon  from '@mui/icons-material/ManageAccountsOutlined';
import WorkspacePremiumOutlinedIcon from '@mui/icons-material/WorkspacePremiumOutlined';

import { Access }   from '@repo/system';
import { Account, GetMembers, PatchMember, DeleteMember, GetInvites, PostInvite, PostInviteResend, DeleteInvite, PostOwnerTransfer, GetSession } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage        from '@widgets/app/AuthPage';
import EmailInput      from '@widgets/core/EmailInput';
import SelectInput     from '@widgets/core/SelectInput';
import SnackAlert      from '@widgets/core/SnackAlert';
import TableInput      from '@widgets/core/TableInput';
import ButtonIconDropdown from '@widgets/core/ButtonIconDropdown';
import AlertPrompt     from '@widgets/core/AlertPrompt';
import ChangeOwnerDialog from '@pages/account/dialogs/ChangeOwnerDialog';
import AccountChange   from '@widgets/app/AccountChange';

// TableInput row-action ids — enums so they're referenced by symbol, not retyped string literals
enum MemberAction { ROLE = "role", CHANGE_OWNER = "change_owner", SUSPEND = "suspend", REACTIVATE = "reactivate", REMOVE = "remove" }
enum InviteAction { RESEND = "resend", CANCEL = "cancel" }

// assignable account roles (the ladder minus MINIMUM), most-privileged last
const ROLE_CHOICES : Array<SelectInput.Choice> =
[
    { value: Access.AccountRole.SENDER,  label: "Sender" },
    { value: Access.AccountRole.USER,    label: "User" },
    { value: Access.AccountRole.BILLING, label: "Billing" },
    { value: Access.AccountRole.ACCOUNT, label: "Account Admin" },
];

//
// Account : Users — manage who has access to the acting account, rendered with the house TableInput.
// Admins can change a member's role, suspend / reactivate, remove access, and invite by email. Members
// + invites are shown in two TableInputs; row actions (role / suspend / remove · resend / cancel) go
// through TableInput's action API. Non-admins see a notice — the underlying APIs are ACCOUNT-gated.
//
export function AccountUsers( props : AccountUsers.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const editable : boolean = Access.isAllowed( appmodel.auth.role(), Access.AccountRole.ACCOUNT );

    const [members,setMembers] = React.useState< Array<Account.Member> >( [] );
    const [invites,setInvites] = React.useState< Array<Account.Invite> >( [] );
    const [loading,setLoading] = React.useState< boolean >( true );
    const [busy,setBusy]       = React.useState< boolean >( false );
    const [snack,setSnack]     = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );
    const [confirm,setConfirm] = React.useState< AccountUsers.Confirm | null >( null );   // state-changing action → confirm dialog
    const [changeOwnerOpen,setChangeOwnerOpen] = React.useState< boolean >( false );      // "change owner" picker (from the owner's row)

    // invite form
    const [inviteEmail,setInviteEmail] = React.useState< string >( "" );
    const [inviteRole,setInviteRole]   = React.useState< string >( Access.AccountRole.USER );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { if( editable ) void load(); else setLoading( false ); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        const [ membersReply, invitesReply ] = await Promise.all( [
            appmodel.server.fetch( new GetMembers() ) as Promise<RestfulService.Reply<GetMembers.Response>>,
            appmodel.server.fetch( new GetInvites() ) as Promise<RestfulService.Reply<GetInvites.Response>>,
        ] );
        if( membersReply.ok && membersReply.data ) setMembers( membersReply.data.members );
        if( invitesReply.ok && invitesReply.data ) setInvites( invitesReply.data.invites );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function roleLabel( role? : string ) : string
    {
        return ROLE_CHOICES.find( ( choice ) => choice.value === role )?.label as string ?? ( role ?? "—" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // TableInput custom-cell renderers (display only)
    function memberNameRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        return  <Typography variant="body2">
                    { row.name }
                    { row.owner && <Chip size="small" variant="outlined" label={"Owner"} sx={{ ml: 1 }} /> }
                </Typography>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function memberStatusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const suspended : boolean = row.status === Account.MemberStatus.SUSPENDED;
        return <Chip size="small" variant="outlined" color={ suspended ? "warning" : "success" } label={ suspended ? "Suspended" : "Active" } />;
    }
    ////////////////////////////////////////////////////////////////////////////////////////////
    function inviteStatusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const style : Record<string, { color : "default" | "info" | "success" | "warning" | "error"; label : string }> =
        {
            [ Account.InviteStatus.PENDING ]:   { color: "default", label: "Pending" },
            [ Account.InviteStatus.INVITED ]:   { color: "info",    label: "Invited" },
            [ Account.InviteStatus.ACCEPTED ]:  { color: "success", label: "Accepted" },
            [ Account.InviteStatus.DECLINED ]:  { color: "warning", label: "Declined" },
            [ Account.InviteStatus.CANCELLED ]: { color: "error",   label: "Cancelled" },
        };
        const chip = style[ row.status as string ] ?? { color: "default" as const, label: String( row.status ) };
        return <Chip size="small" variant="outlined" color={ chip.color } label={ chip.label } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── state-changing row actions → open a confirm dialog (the dialog's Yes runs the mutation) ──────
    function who( member : Account.Member ) : string
    { return member.name || member.email || "this user"; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onMemberAction( action : string, row : TableInput.Row, choice? : string ) : void
    {
        const member : Account.Member | undefined = members.find( ( entry ) => entry.userId === row.id );
        if( !member ) return;

        if( action === MemberAction.ROLE && choice && choice !== member.role )
            setConfirm( {
                title: "Change role", yesLabel: "Change role", success: "Role updated.",
                body: `Change ${ who( member ) }'s role to ${ roleLabel( choice ) }?`,
                run: async () => ( await appmodel.server.fetch( new PatchMember( member.userId, { role: choice as Access.Role } ) ) ).ok,
            } );
        else if( action === MemberAction.SUSPEND )
            setConfirm( {
                title: "Suspend access", yesLabel: "Suspend", success: "Access suspended.", destructive: true,
                body: `Suspend ${ who( member ) }'s access? They won't be able to sign in to this account until it's restored.`,
                run: async () => ( await appmodel.server.fetch( new PatchMember( member.userId, { status: Account.MemberStatus.SUSPENDED } ) ) ).ok,
            } );
        else if( action === MemberAction.REACTIVATE )
            setConfirm( {
                title: "Restore access", yesLabel: "Restore", success: "Access restored.",
                body: `Restore ${ who( member ) }'s access to this account?`,
                run: async () => ( await appmodel.server.fetch( new PatchMember( member.userId, { status: Account.MemberStatus.ACTIVE } ) ) ).ok,
            } );
        else if( action === MemberAction.REMOVE )
            setConfirm( {
                title: "Remove access", yesLabel: "Remove", success: "Access removed.", destructive: true,
                body: `Remove ${ who( member ) }'s access to this account? This deletes their membership (not their user account).`,
                run: async () => ( await appmodel.server.fetch( new DeleteMember( member.userId ) ) ).ok,
            } );
        else if( action === MemberAction.CHANGE_OWNER )
            setChangeOwnerOpen( true );   // open the picker (choose the new owner from the members)
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // transfer ownership to the chosen member (from the ChangeOwnerDialog) → snack + reload on success
    async function onChangeOwner( userId : string ) : Promise<boolean>
    {
        const ok : boolean = ( await appmodel.server.fetch( new PostOwnerTransfer( { userId } ) ) ).ok;
        if( ok ) { setSnack( { message: "Ownership transferred.", severity: "success" } ); setChangeOwnerOpen( false ); void load(); }
        else setSnack( { message: "Could not transfer ownership. Please try again.", severity: "error" } );
        return ok;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onInviteAction( action : string, row : TableInput.Row ) : void
    {
        const invite : Account.Invite | undefined = invites.find( ( entry ) => entry.inviteId === row.id );
        if( !invite ) return;

        if( action === InviteAction.RESEND )
            setConfirm( {
                title: "Resend invitation", yesLabel: "Resend", success: "Invitation re-sent.",
                body: `Re-send the invitation email to ${ invite.email }?`,
                run: async () => ( await appmodel.server.fetch( new PostInviteResend( invite.inviteId ) ) ).ok,
            } );
        else if( action === InviteAction.CANCEL )
            setConfirm( {
                title: "Cancel invitation", yesLabel: "Cancel invite", success: "Invitation cancelled.", destructive: true,
                body: `Cancel the invitation to ${ invite.email }?`,
                run: async () => ( await appmodel.server.fetch( new DeleteInvite( invite.inviteId ) ) ).ok,
            } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── invite form (a deliberate submit — its own action; no extra confirm) ─────────────────────
    async function onInvite() : Promise<void>
    {
        if( inviteEmail.trim() === "" ) return;
        setBusy( true );
        const reply = await appmodel.server.fetch( new PostInvite( { email: inviteEmail.trim(), role: inviteRole as Access.Role } ) );
        setBusy( false );
        if( reply.ok ) { setInviteEmail( "" ); setSnack( { message: "Invitation sent", severity: "success" } ); void load(); }
        else setSnack( { message: "Something went wrong. Please try again.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the alert-prompt action: on YES run the mutation (snack + reload on success); any action dismisses
    async function onConfirmAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( !confirm ) return;
        if( action === AlertPrompt.Action.YES )
        {
            const ok : boolean = await confirm.run();
            if( ok ) { setSnack( { message: confirm.success, severity: "success" } ); void load(); }
            else setSnack( { message: "Something went wrong. Please try again.", severity: "error" } );
        }
        setConfirm( null );
    }

    // ── TableInput config: members ───────────────────────────────────────────────────────────────
    const roleDropdownChoices : Array<ButtonIconDropdown.Choice> = ROLE_CHOICES.map( ( choice ) => ( { value: choice.value, label: choice.label as string } ) );

    const memberActions : Array<TableInput.Action> =
    [
        { id: MemberAction.ROLE,         label: "Change role",    icon: <ManageAccountsOutlinedIcon fontSize="small" />, choices: roleDropdownChoices },
        { id: MemberAction.CHANGE_OWNER, label: "Change owner",   icon: <WorkspacePremiumOutlinedIcon fontSize="small" /> },
        { id: MemberAction.SUSPEND,      label: "Suspend access", icon: <BlockOutlinedIcon fontSize="small" /> },
        { id: MemberAction.REACTIVATE, label: "Restore access", icon: <LockOpenOutlinedIcon fontSize="small" /> },
        { id: MemberAction.REMOVE,     label: "Remove access",  icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
    ];

    const memberColumns : Array<TableInput.Column> =
    [
        { field: "name",        label: "User",       type: TableInput.ColumnType.CUSTOM,   renderer: memberNameRenderer },
        { field: "email",       label: "Email",      type: TableInput.ColumnType.EMAIL },
        { field: "roleLabel",   label: "Role",       type: TableInput.ColumnType.STRING },
        { field: "status",      label: "Status",     type: TableInput.ColumnType.CUSTOM,   renderer: memberStatusRenderer },
        { field: "createdAt",   label: "Added",      type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
        { field: "lastLoginAt", label: "Last login", type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
        { field: "actions",     label: "",           type: TableInput.ColumnType.ACTION },
    ];

    // the signed-in user's own profile — used to fill THEIR row when the denormalized name/email is missing
    // (the access token doesn't carry name/email, so the server can't backfill it; the client has it).
    const me      : GetSession.Response | null = appmodel.auth.user;
    const meName  : string = me ? ( `${ me.firstName ?? "" } ${ me.lastName ?? "" }`.trim() || me.displayName || me.email || "" ) : "";
    const meEmail : string = me?.email ?? "";

    const memberRows : Array<TableInput.Row> = members.map( ( member ) =>
    {
        const isMe : boolean = !!me && member.userId === me.id;
        return {
            id:          member.userId,
            name:        member.name || ( isMe ? meName : "" ) || "—",
            owner:       member.owner === true,
            email:       member.email || ( isMe ? meEmail : "" ),
            roleLabel:   roleLabel( member.role ),
            status:      member.status,
            createdAt:   member.createdAt ? new Date( member.createdAt ) : undefined,
            lastLoginAt: member.lastLoginAt ? new Date( member.lastLoginAt ) : undefined,
            actions:     member.owner
                            ? [ MemberAction.CHANGE_OWNER ]   // the owner: only ownership can change (role/status are protected)
                            : member.status === Account.MemberStatus.SUSPENDED
                                ? [ MemberAction.ROLE, MemberAction.REACTIVATE, MemberAction.REMOVE ]
                                : [ MemberAction.ROLE, MemberAction.SUSPEND, MemberAction.REMOVE ],
        };
    } );

    // ── TableInput config: invites ───────────────────────────────────────────────────────────────
    const inviteActions : Array<TableInput.Action> =
    [
        { id: "resend", label: "Resend invite", icon: <SendOutlinedIcon fontSize="small" /> },
        { id: "cancel", label: "Cancel invite", icon: <CloseOutlinedIcon fontSize="small" /> },
    ];

    const inviteColumns : Array<TableInput.Column> =
    [
        { field: "email",     label: "Email",   type: TableInput.ColumnType.EMAIL },
        { field: "roleLabel", label: "Role",    type: TableInput.ColumnType.STRING },
        { field: "status",    label: "Status",  type: TableInput.ColumnType.CUSTOM,   renderer: inviteStatusRenderer },
        { field: "invitedAt", label: "Invited", type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
        { field: "actions",   label: "",        type: TableInput.ColumnType.ACTION },
    ];

    const inviteRows : Array<TableInput.Row> = invites.map( ( invite ) =>
    {
        const active : boolean = invite.status === Account.InviteStatus.PENDING || invite.status === Account.InviteStatus.INVITED;
        return {
            id:        invite.inviteId,
            email:     invite.email,
            roleLabel: roleLabel( invite.role ),
            status:    invite.status,
            invitedAt: invite.invitedAt ? new Date( invite.invitedAt ) : undefined,
            actions:   active ? [ InviteAction.RESEND, InviteAction.CANCEL ] : [],
        };
    } );

    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Account : Users"}>
                <Box sx={{ p: 2, maxWidth: 1000, mx: "auto" }}>

                    { !editable &&
                        <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"Only account admins can manage users."}</Typography> }

                    { editable && loading &&
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }

                    { editable && !loading &&
                        <Stack spacing={ 2 }>

                            {/* ── Members ──────────────────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Members"} subheader={"People with access to this account."}
                                            action={ <Tooltip title={"Refresh"}><span><IconButton size="small" onClick={ () => void load() } disabled={ loading } sx={{ mt: 1, mr: 1 }}><RefreshOutlinedIcon fontSize="small" /></IconButton></span></Tooltip> } />
                                <Divider />
                                <CardContent>
                                    <TableInput id="account-members"
                                                columns={ memberColumns }
                                                data={ memberRows }
                                                actions={ memberActions }
                                                onAction={ onMemberAction }
                                                selectable={ TableInput.Selectable.NONE } />
                                </CardContent>
                            </Card>

                            {/* ── Invite ───────────────────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Invite a user"} subheader={"Existing users are added on their next sign-in; new users get an email to register."} />
                                <Divider />
                                <CardContent>
                                    <Stack direction="row" spacing={ 2 } sx={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                                        <Box sx={{ flexGrow: 1, minWidth: 240 }}>
                                            <EmailInput id="invite-email" label={"Email"} value={ inviteEmail } onChange={ setInviteEmail } sx={{ width: "100%" }} />
                                        </Box>
                                        <SelectInput id="invite-role" label={"Role"} value={ inviteRole } choices={ ROLE_CHOICES } onChange={ setInviteRole } sx={{ width: 180 }} />
                                        <Button variant="contained" startIcon={ <PersonAddAltOutlinedIcon /> } disabled={ busy || inviteEmail.trim() === "" } onClick={ () => void onInvite() }>
                                            {"Invite"}
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>

                            {/* ── Pending invitations ──────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Invitations"} subheader={"Invites and their status."}
                                            action={ <Tooltip title={"Refresh"}><span><IconButton size="small" onClick={ () => void load() } disabled={ loading } sx={{ mt: 1, mr: 1 }}><RefreshOutlinedIcon fontSize="small" /></IconButton></span></Tooltip> } />
                                <Divider />
                                <CardContent>
                                    { invites.length === 0
                                        ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No invitations."}</Typography>
                                        : <TableInput id="account-invites"
                                                      columns={ inviteColumns }
                                                      data={ inviteRows }
                                                      actions={ inviteActions }
                                                      onAction={ onInviteAction }
                                                      selectable={ TableInput.Selectable.NONE } />
                                    }
                                </CardContent>
                            </Card>

                        </Stack>
                    }
                </Box>

                <AccountChange onClear={ () => { setMembers( [] ); setInvites( [] ); } }
                               onRefresh={ () => { if( Access.isAllowed( appmodel.auth.role(), Access.AccountRole.ACCOUNT ) ) void load(); } } />

                { confirm &&
                    <AlertPrompt id="account-users-confirm"
                                 type={ confirm.destructive ? AlertPrompt.Type.WARNING : AlertPrompt.Type.QUESTION }
                                 title={ confirm.title }
                                 message={ confirm.body }
                                 yesText={ confirm.yesLabel }
                                 yesColor={ confirm.destructive ? "error" : "primary" }
                                 cancelText={"Cancel"}
                                 onAction={ onConfirmAction } />
                }

                { changeOwnerOpen &&
                    <ChangeOwnerDialog members={ members.filter( ( m : Account.Member ) => !m.owner && m.status === Account.MemberStatus.ACTIVE && m.role === Access.AccountRole.ACCOUNT ) }
                                       onConfirm={ onChangeOwner }
                                       onClose={ () => setChangeOwnerOpen( false ) } />
                }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace AccountUsers
{
    export interface Props
    {
    }

    /** A pending confirm-dialog for a state-changing action. `run` performs the mutation → success flag. */
    export interface Confirm
    {
        title       : string;
        body        : string;
        yesLabel    : string;
        success     : string;
        destructive? : boolean;
        run         : () => Promise<boolean>;
    }
}

export default AccountUsers;
// eof
