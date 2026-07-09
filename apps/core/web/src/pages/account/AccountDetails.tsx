import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';

import { Access }   from '@repo/system';
import { Account, GetAccount, PutAccount, Contact } from '@repo/api';
import { RestfulService } from '@repo/endpoint';
import { Type } from '@repo/common';

import BrowserUtils    from '@utils/BrowserUtils';
import LocaleService   from '@model/service/LocaleService';
import AuthPage        from '@widgets/app/AuthPage';
import ButtonIcon      from '@widgets/core/ButtonIcon';
import TextInput       from '@widgets/core/TextInput';
import EmailInput      from '@widgets/core/EmailInput';
import UrlInput        from '@widgets/core/UrlInput';
import TimezoneInput   from '@widgets/core/TimezoneInput';
import SnackAlert      from '@widgets/core/SnackAlert';
import OrganizationInput from '@widgets/app/OrganizationInput';
import AddressInput    from '@widgets/app/AddressInput';
import SelectMultInput from '@widgets/core/SelectMultInput';
import SaveBar         from '@widgets/app/SaveBar';
import SubAccountNotice from '@widgets/app/SubAccountNotice';
import AccountChange   from '@widgets/app/AccountChange';

//
// Account : Details — the acting account's record (account/GetAccount, resolved from the X-Account header).
// Account ADMINS (Access.AccountRole.ACCOUNT — the owner + admins) can edit the mutable fields (name,
// organization, primary contact, address, time zone, website) and Save via PutAccount; everyone else sees
// a read-only view. Identity/lifecycle fields (id, status, join code, dates) are never editable.
//
export function AccountDetails( props : AccountDetails.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    // owner/admin of the CURRENT account → may edit (role resolved into auth on account switch)
    const editable : boolean = Access.isAllowed( appmodel.auth.role(), Access.AccountRole.ACCOUNT );

    const [account,setAccount]   = React.useState< Account.Entity | null >( null );
    const [loading,setLoading]   = React.useState< boolean >( true );
    const [error,setError]       = React.useState< string >( "" );

    const [form,setForm]         = React.useState< AccountDetails.Form | null >( null );
    const [original,setOriginal] = React.useState< AccountDetails.Form | null >( null );
    const [saveError,setSaveError] = React.useState< string >( "" );   // shown in the save bar on a failed save
    const [snack,setSnack]       = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );   // copy-to-clipboard confirmation (null = hidden)

    const dirty : boolean = !!form && !!original && JSON.stringify( form ) !== JSON.stringify( original );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        setError( "" );
        const reply : RestfulService.Reply<GetAccount.Response> = await appmodel.server.fetch( new GetAccount() );
        setLoading( false );
        if( reply.ok && reply.data )
        {
            setAccount( reply.data );
            const seeded : AccountDetails.Form = formFrom( reply.data );
            setForm( seeded );
            setOriginal( seeded );
        }
        else setError( "Could not load the account." );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function formFrom( entity : Account.Entity ) : AccountDetails.Form
    {
        return  {
                    name:       entity.name ?? "",
                    orgType:    entity.organization?.type ?? Account.OrganizationType.OTHER,
                    orgSubType: entity.organization?.subType ?? "",
                    pocName:    entity.poc?.name ?? "",
                    pocEmail:   entity.poc?.email ?? "",
                    website:    entity.website ?? "",
                    timezone:   entity.timezone ?? "",
                    // seed the address; default the country to US when unset
                    address:    { ...AddressInput.EMPTY, ...( entity.address ?? {} ), country: entity.address?.country || "US" },
                    channels:   entity.channels ?? Object.values( Contact.Channel ),
                };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function set( patch : Partial<AccountDetails.Form> ) : void
    {
        setSaveError( "" );
        setForm( ( prev : AccountDetails.Form | null ) => prev ? { ...prev, ...patch } : prev );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onReset() : void
    {
        setSaveError( "" );
        setForm( original );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // returns true on success (SaveBar flashes the green "Saved" chip); false shows the error text
    async function onSave() : Promise<boolean>
    {
        if( !form ) return false;
        setSaveError( "" );
        const update : Account.Update =
        {
            name:         form.name,
            organization: { type: form.orgType, subType: form.orgSubType || undefined },
            poc:          { name: form.pocName, email: form.pocEmail },
            website:      form.website || undefined,
            timezone:     form.timezone || undefined,
            address:      form.address,
            channels:     form.channels,
        };
        const reply : RestfulService.Reply<PutAccount.Response> = await appmodel.server.fetch( new PutAccount( update ) );
        if( reply.ok && reply.data )
        {
            setAccount( reply.data );
            setOriginal( form );
            // a name change must reflect in the account switcher — refresh memberships (re-fetches + broadcasts
            // ACCOUNT, which the switcher's <Subscriber> listens for)
            void appmodel.account.load();
            return true;
        }
        setSaveError( "Could not save the account. Please try again." );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // copy a value to the clipboard + confirm via a snackbar
    function onCopy( value : string ) : void
    {
        void BrowserUtils.copyToClipboard( value ).then( ( ok : boolean ) => setSnack( ok ? { message: "Copied to clipboard.", severity: "success" } : { message: "Couldn't copy to clipboard.", severity: "error" } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function displayDate( iso? : string ) : string
    {
        return appmodel.ui.locale.dateTime( iso ? new Date( iso ) : null, LocaleService.Format.LONG ) || "—";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function statusColor( accountStatus? : Account.Status ) : "success" | "warning" | "error" | "default"
    {
        switch( accountStatus )
        {
            case Account.Status.ACTIVE:                                  return "success";
            case Account.Status.PENDING: case Account.Status.REVIEW:     return "warning";
            case Account.Status.SUSPENDED: case Account.Status.DISABLED:
            case Account.Status.CANCELLED: case Account.Status.DELETED:  return "error";
            default:                                                     return "default";
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function formatAddress( address? : Account.Entity[ "address" ] ) : string
    {
        if( !address ) return "—";
        const parts : Array<string> = [ address.street1, address.street2, address.city, address.state, address.zip, address.country ].filter( ( part ) => ( part ?? "" ).trim() !== "" );
        return parts.length > 0 ? parts.join( ", " ) : "—";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function organizationText( org? : Account.Organization ) : string
    {
        if( !org ) return "—";
        return org.subType ? `${ org.type } · ${ org.subType }` : org.type;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // two-column responsive field grid (stacks to one column on narrow content)
    function grid( children : React.ReactNode ) : JSX.Element
    {
        return <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>{ children }</Box>;
    }

    const owned : boolean = !!account?.ownerId && account.ownerId === appmodel.auth.user?.id;

    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Account : Details"}>
                <Box sx={{ p: 2, pb: editable ? 12 : 2, mx: "auto" }}>

                    { loading && <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                    { !loading && error !== "" && <Typography variant="body2" sx={{ color: "error.main", p: 2 }}>{ error }</Typography> }

                    { !loading && account && form &&
                        <Stack spacing={ 2 }>

                            <SubAccountNotice />

                            {/* ── Overview ─────────────────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader
                                    title={"Overview"}
                                    subheader={ owned ? "You own this account." : ( editable ? "You can edit this account." : "" ) }
                                    action={ <Chip size="small" color={ statusColor( account.status ) } variant="outlined" label={ account.status } sx={{ mt: 1, mr: 1 }} /> } />
                                <Divider />
                                <CardContent>
                                    <Stack spacing={ 2 }>
                                        {/* Account ID — always read-only */}
                                        <ReadRow label={"Account ID"} value={ account.id || "—" } mono copy onCopy={ onCopy } />

                                        { editable
                                            ? <>
                                                <TextInput id="acct-name" label={"Account name"} value={ form.name } onChange={ ( value ) => set( { name: value } ) } fullWidth />
                                                <OrganizationInput id="acct-org"
                                                                   value={ { type: form.orgType, subType: form.orgSubType || undefined } }
                                                                   onChange={ ( org ) => set( { orgType: org.type, orgSubType: org.subType ?? "" } ) } />
                                              </>
                                            : <>
                                                <ReadRow label={"Account name"} value={ account.name || "—" } />
                                                <ReadRow label={"Organization"} value={ organizationText( account.organization ) } />
                                              </>
                                        }

                                        <ReadRow label={"Created"} value={ displayDate( account.createdAt ) } />
                                        <ReadRow label={"Last modified"} value={ displayDate( account.modifiedAt ) } />
                                    </Stack>
                                </CardContent>
                            </Card>

                            {/* ── Primary contact ──────────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Primary contact"} subheader={"Who we reach about this account."} />
                                <Divider />
                                <CardContent>
                                    { editable
                                        ? grid( <>
                                            <TextInput id="acct-poc-name" label={"Contact name"} value={ form.pocName } onChange={ ( value ) => set( { pocName: value } ) } fullWidth />
                                            <EmailInput id="acct-poc-email" label={"Contact email"} value={ form.pocEmail } onChange={ ( value ) => set( { pocEmail: value } ) } sx={{ width: "100%" }} />
                                        </> )
                                        : <Stack spacing={ 2 }>
                                            <ReadRow label={"Name"} value={ account.poc?.name || "—" } />
                                            <ReadRow label={"Email"} value={ account.poc?.email || "—" } />
                                          </Stack>
                                    }
                                </CardContent>
                            </Card>

                            {/* ── Location & locale ────────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Location & locale"} subheader={"Address, time zone, and website."} />
                                <Divider />
                                <CardContent>
                                    { editable
                                        ? <Stack spacing={ 2 }>
                                            <AddressInput id="acct-address" value={ form.address } onChange={ ( address ) => set( { address } ) } />
                                            <TimezoneInput id="acct-timezone" label={"Time zone"}
                                                           value={ form.timezone ? [ form.timezone ] : [] }
                                                           valueType={ TimezoneInput.ValueType.CITY }
                                                           labelType={ TimezoneInput.LabelType.CITY }
                                                           onChange={ ( zones ) => set( { timezone: zones[ 0 ] ?? "" } ) } />
                                            <UrlInput id="acct-website" label={"Website"} value={ form.website } onChange={ ( value ) => set( { website: value } ) } />
                                          </Stack>
                                        : <Stack spacing={ 2 }>
                                            <ReadRow label={"Address"} value={ formatAddress( account.address ) } />
                                            <ReadRow label={"Time zone"} value={ account.timezone || "—" } />
                                            { account.website && <ReadRow label={"Website"} value={ account.website } /> }
                                          </Stack>
                                    }
                                </CardContent>
                            </Card>

                            {/* ── Outreach channels ────────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Outreach"} subheader={"The channels this account is allowed to use."} />
                                <Divider />
                                <CardContent>
                                    { editable
                                        ? <SelectMultInput id="acct-channels" label={"Allowed channels"}
                                                           value={ form.channels }
                                                           choices={ Object.values( Contact.Channel ).map( ( channel : Contact.Channel ) : SelectMultInput.Choice => ( { value: channel, label: channel.toUpperCase() } ) ) }
                                                           onChange={ ( values : Array<string> ) : void => set( { channels: values as Array<Contact.Channel> } ) } />
                                        : <ReadRow label={"Allowed channels"} value={ ( account.channels ?? Object.values( Contact.Channel ) ).map( ( channel : Contact.Channel ) : string => channel.toUpperCase() ).join( ", " ) } />
                                    }
                                </CardContent>
                            </Card>

                            {/* ── Sharing (read-only) ──────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Sharing"} subheader={"How others join or act in this account."} />
                                <Divider />
                                <CardContent>
                                    <Stack spacing={ 2 }>
                                        <ReadRow label={"Join code"} value={ account.joinCode || "—" } mono copy onCopy={ onCopy } />
                                        <ReadRow label={"Parent access"} value={ account.parentAccess } />
                                        { account.tags.length > 0 && <ReadRow label={"Tags"} value={ account.tags.join( ", " ) } /> }
                                    </Stack>
                                </CardContent>
                            </Card>

                        </Stack>
                    }
                </Box>

                {/* sticky save bar (admins only) */}
                { editable && !loading && account &&
                    <SaveBar dirty={ dirty } error={ saveError } onReset={ onReset } onSave={ onSave } />
                }

                <AccountChange onClear={ () => { setAccount( null ); setForm( null ); setOriginal( null ); } }
                               onRefresh={ () => { if( Access.isAllowed( appmodel.auth.role(), Access.AccountRole.USER ) ) void load(); } } />

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

////////////////////////////////////////////////////////////////////////////////////////////////////
// a labelled read-only key/value row (left label, right value). `copy` adds a copy-to-clipboard button
// (the parent's `onCopy` handles the clipboard write + the snackbar).
function ReadRow( { label, value, mono, copy, onCopy } : { label : string; value : string; mono? : boolean; copy? : boolean; onCopy? : ( value : string ) => void } ) : JSX.Element
{
    const canCopy : boolean = copy === true && value !== "" && value !== "—";
    return  <Stack direction="row" spacing={ 2 } sx={{ justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>{ label }</Typography>
                <Stack direction="row" spacing={ 0.5 } sx={{ alignItems: "center", minWidth: 0 }}>
                    <Typography variant="body2" sx={{ textAlign: "right", fontFamily: mono ? "monospace" : undefined, wordBreak: "break-all" }}>{ value }</Typography>
                    { canCopy &&
                        <ButtonIcon id="readrow-copy" label={"Copy"} size="small" sx={{ p: 0.25 }}
                                    icon={ <ContentCopyOutlinedIcon sx={{ fontSize: 15 }} /> }
                                    onClick={ () => onCopy?.( value ) } />
                    }
                </Stack>
            </Stack>;
}

export namespace AccountDetails
{
    export interface Form
    {
        name       : string;
        orgType    : Account.OrganizationType;
        orgSubType : string;
        pocName    : string;
        pocEmail   : string;
        website    : string;
        timezone   : string;
        address    : Type.Address;
        channels   : Array<Contact.Channel>;   // allowed outreach channels
    }

    export interface Props
    {
    }
}

export default AccountDetails;
// eof
