import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';

import { Access }   from '@repo/system';
import { Account, GetAccount, GetSubAccounts, PostSubAccount, PostSubAccountStatus } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage        from '@widgets/app/AuthPage';
import SnackAlert      from '@widgets/core/SnackAlert';
import AddSubAccountDialog from '@pages/account/dialogs/AddSubAccountDialog';
import AlertPrompt     from '@widgets/core/AlertPrompt';
import SubAccountTree  from '@pages/account/SubAccountTree';
import AccountChange   from '@widgets/app/AccountChange';

// row-action ids — enums so they're referenced by symbol, not retyped string literals
enum SubAccountAction { SWITCH = "switch", SUSPEND = "suspend", REACTIVATE = "reactivate" }

//
// Account : Sub-Accounts — the acting account's direct children (account-2 hierarchy). Account admins
// (Access.AccountRole.ACCOUNT, enforced by AuthPage + the endpoints) can view the list and create a new
// sub-account; the creator becomes that sub-account's owner + admin. Creation is capped by the service's
// configured hierarchy policy (maxDepth / maxSubAccountsPerParent) — the server rejects over-cap creates and
// the message is surfaced here. New sub-accounts also appear in the account switcher (the creator is a member).
//
export function AccountSubAccounts( props : AccountSubAccounts.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [subAccounts,setSubAccounts] = React.useState< Array<Account.SubAccount> >( [] );
    const [parentOrg,setParentOrg]     = React.useState< Account.Organization | undefined >( undefined );
    const [loading,setLoading]         = React.useState< boolean >( true );
    const [error,setError]             = React.useState< string >( "" );
    const [snack,setSnack]             = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );
    const [addOpen,setAddOpen]         = React.useState< boolean >( false );
    const [confirm,setConfirm]         = React.useState< AccountSubAccounts.Confirm | null >( null );   // state-changing action → confirm dialog

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        setError( "" );
        // the acting account supplies the parent org (the sub-account org default) + is the carry-over source
        const subsReply    : RestfulService.Reply<GetSubAccounts.Response> = await appmodel.server.fetch( new GetSubAccounts() );
        const parentReply  : RestfulService.Reply<GetAccount.Response> = await appmodel.server.fetch( new GetAccount() );
        setLoading( false );
        if( subsReply.ok && subsReply.data ) setSubAccounts( subsReply.data.subAccounts );
        else setError( "Could not load sub-accounts." );
        if( parentReply.ok && parentReply.data ) setParentOrg( parentReply.data.organization );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // create a sub-account (the AddSubAccountDialog collects name + organization). Returns true on success so
    // the dialog closes; on failure (incl. an over-cap 409) surfaces the server's message.
    async function onCreate( input : { name : string; organization? : Account.Organization; carryOver? : PostSubAccount.CarryOver } ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostSubAccount.Response> = await appmodel.server.fetch( new PostSubAccount( input ) );
        if( reply.ok && reply.data )
        {
            setSubAccounts( ( prev : Array<Account.SubAccount> ) => [ reply.data!.account, ...prev ] );
            // refresh the user's memberships so the new sub-account appears in the account switcher
            // (load() re-fetches + broadcasts ACCOUNT, which the switcher's <Subscriber> listens for)
            void appmodel.account.load();
            setSnack( { message: "Sub-account created.", severity: "success" } );
            setAddOpen( false );
            return true;
        }
        setSnack( { message: RestfulService.error( reply, "Could not create the sub-account." ), severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // suspend / reactivate / switch — a node from the tree (state-changing ones open a confirm dialog)
    function onAction( action : string, sub : Account.SubAccount ) : void
    {
        if( action === SubAccountAction.SWITCH )
            void switchToSub( sub );
        else if( action === SubAccountAction.SUSPEND )
            setConfirm( {
                title: "Suspend sub-account", yesLabel: "Suspend", success: "Sub-account suspended.",
                body: `Suspend "${ sub.name }"? Every account nested beneath it is suspended too. Independently-suspended children stay suspended when you restore this one.`,
                run: async () => ( await appmodel.server.fetch( new PostSubAccountStatus( sub.id, { status: Account.Status.SUSPENDED } ) ) ).ok,
            } );
        else if( action === SubAccountAction.REACTIVATE )
            setConfirm( {
                title: "Restore sub-account", yesLabel: "Restore", success: "Sub-account restored.",
                body: `Restore "${ sub.name }"? Accounts beneath it that were suspended by this suspension are restored too.`,
                run: async () => ( await appmodel.server.fetch( new PostSubAccountStatus( sub.id, { status: Account.Status.ACTIVE } ) ) ).ok,
            } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // switch the acting account to this sub-account. Switching is membership-based, so refresh memberships
    // first (a just-created sub may not be in the in-memory list yet); guard when the user isn't a member.
    async function switchToSub( sub : Account.SubAccount ) : Promise<void>
    {
        await appmodel.account.load();
        const isMember : boolean = appmodel.account.accounts.some( ( m ) => m.accountId === sub.id );
        if( !isMember ) { setSnack( { message: `You're not a member of "${ sub.name }".`, severity: "error" } ); return; }
        appmodel.account.switchTo( sub.id );   // updates X-Account + re-scopes to that account's dashboard
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

    ////////////////////////////////////////////////////////////////////////////////////////////
    // which actions apply to a node: ACTIVE → Switch + Suspend; SUSPENDED → Restore; other states → none
    function actionsFor( sub : Account.SubAccount ) : Array<SubAccountTree.Action>
    {
        if( sub.status === Account.Status.ACTIVE )    return [ { id: SubAccountAction.SWITCH, label: "Switch to" }, { id: SubAccountAction.SUSPEND, label: "Suspend" } ];
        if( sub.status === Account.Status.SUSPENDED ) return [ { id: SubAccountAction.REACTIVATE, label: "Restore" } ];
        return [];
    }

    return  <AuthPage minAccess={ Access.AccountRole.ACCOUNT } title={"Account : Sub-Accounts"}>
                <Box sx={{ p: 2, maxWidth: 1000, mx: "auto" }}>

                    { loading &&
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }

                    { !loading && error !== "" && <Typography variant="body2" sx={{ color: "error.main", p: 2 }}>{ error }</Typography> }

                    { !loading && error === "" &&
                        <Card variant="outlined">
                            <CardHeader
                                title={"Sub-Accounts"}
                                subheader={"Accounts nested under this one — expand a row to see its sub-accounts. You'll own and administer any you create."}
                                action={ <Button variant="contained" startIcon={ <AddOutlinedIcon /> } onClick={ () => setAddOpen( true ) } sx={{ mt: 1, mr: 1 }}>{"Add sub-account"}</Button> } />
                            <Divider />
                            <CardContent>
                                { subAccounts.length === 0
                                    ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No sub-accounts yet."}</Typography>
                                    : <SubAccountTree nodes={ subAccounts } actionsFor={ actionsFor } onAction={ onAction } />
                                }
                            </CardContent>
                        </Card>
                    }
                </Box>

                <AccountChange onClear={ () => { setSubAccounts( [] ); setParentOrg( undefined ); } }
                               onRefresh={ () => { if( Access.isAllowed( appmodel.auth.role(), Access.AccountRole.ACCOUNT ) ) void load(); } } />

                { addOpen && <AddSubAccountDialog parentOrganization={ parentOrg } onConfirm={ onCreate } onClose={ () => setAddOpen( false ) } /> }

                { confirm &&
                    <AlertPrompt id="account-sub-confirm"
                                 type={ AlertPrompt.Type.QUESTION }
                                 title={ confirm.title }
                                 message={ confirm.body }
                                 yesText={ confirm.yesLabel }
                                 cancelText={"Cancel"}
                                 onAction={ onConfirmAction } />
                }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace AccountSubAccounts
{
    export interface Props
    {
    }

    /** A pending confirm-dialog for a state-changing action. `run` performs the mutation → success flag. */
    export interface Confirm
    {
        title    : string;
        body     : string;
        yesLabel : string;
        success  : string;
        run      : () => Promise<boolean>;
    }
}

export default AccountSubAccounts;
// eof
