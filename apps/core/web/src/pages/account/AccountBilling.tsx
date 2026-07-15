import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Typography } from "@mui/material";
import AddCardOutlinedIcon from '@mui/icons-material/AddCardOutlined';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';

import { Access }   from '@repo/system';
import { Billing, GetBilling, PostBalanceTopup, GetPaymentMethods, PostPaymentMethodSetup, DeletePaymentMethod, PutBillingSettings } from '@repo/api';
import { RestfulService } from '@repo/endpoint';
import { Type } from '@repo/common';

import LocaleService   from '@model/service/LocaleService';
import AuthPage        from '@widgets/app/AuthPage';
import NumericInput    from '@widgets/core/NumericInput';
import DropdownInput   from '@widgets/core/DropdownInput';
import SwitchInput     from '@widgets/core/SwitchInput';
import SnackAlert      from '@widgets/core/SnackAlert';
import AddressInput    from '@widgets/app/AddressInput';
import SaveBar         from '@widgets/app/SaveBar';
import SubAccountNotice from '@widgets/app/SubAccountNotice';
import AccountChange   from '@widgets/app/AccountChange';
import BalanceTopupDialog from '@pages/account/dialogs/BalanceTopupDialog';
import BillingHistory     from '@pages/account/BillingHistory';

//
// Account : Billing — the acting account's billing surface (account/GetBilling, resolved from X-Account).
// SKELETON: Stripe + the plan catalog are not wired yet, so plan/costs/payment-methods/history come back
// empty and top-up simply credits a stored balance. The shapes here are the contract the real flows will
// fill. Split into tabs (Plan · Balance · Payment methods · History · Settings) so nothing requires a long
// scroll. Requires the BILLING account role (enforced by AuthPage + the endpoints' access gate).
//
export function AccountBilling( props : AccountBilling.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [tab,setTab]           = React.useState< number >( 0 );
    const [overview,setOverview] = React.useState< Billing.Overview | null >( null );
    const [methods,setMethods]   = React.useState< Array<Billing.PaymentMethod> >( [] );
    const [loading,setLoading]   = React.useState< boolean >( true );
    const [error,setError]       = React.useState< string >( "" );
    const [snack,setSnack]       = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    // top-up dialog (a state-changing action → confirm dialog); the dialog owns the amount field itself
    const [topupOpen,setTopupOpen] = React.useState< boolean >( false );

    // editable settings form (billing type, auto-reload, billing address) — dirty-tracked, saved via SaveBar
    const [form,setForm]         = React.useState< AccountBilling.Form | null >( null );
    const [original,setOriginal] = React.useState< AccountBilling.Form | null >( null );
    const [saveError,setSaveError] = React.useState< string >( "" );

    const dirty : boolean = !!form && !!original && JSON.stringify( form ) !== JSON.stringify( original );
    const currency : Type.Currency = ( overview?.balance.balance.currency ?? "USD" ) as Type.Currency;

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        setError( "" );
        const overviewReply : RestfulService.Reply<GetBilling.Response> = await appmodel.server.fetch( new GetBilling() );
        const methodsReply  : RestfulService.Reply<GetPaymentMethods.Response> = await appmodel.server.fetch( new GetPaymentMethods() );
        setLoading( false );

        if( overviewReply.ok && overviewReply.data )
        {
            setOverview( overviewReply.data.overview );
            const seeded : AccountBilling.Form = formFrom( overviewReply.data.overview );
            setForm( seeded );
            setOriginal( seeded );
        }
        else setError( "Could not load billing." );

        if( methodsReply.ok && methodsReply.data ) setMethods( methodsReply.data.methods );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // seed the editable form from the overview (money is edited in whole currency units, not minor units)
    function formFrom( source : Billing.Overview ) : AccountBilling.Form
    {
        return  {
                    billingType:        source.settings.billingType,
                    autoReloadEnabled:  source.settings.autoReload.enabled,
                    autoReloadThreshold: source.settings.autoReload.threshold.amountMinor / 100,
                    autoReloadAmount:   source.settings.autoReload.amount.amountMinor / 100,
                    sameAsAccount:      source.settings.billingAddressSameAsAccount,
                    address:            { ...AddressInput.EMPTY, ...( source.billingAddress ?? {} ), country: source.billingAddress?.country || "US" },
                };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function set( patch : Partial<AccountBilling.Form> ) : void
    {
        setSaveError( "" );
        setForm( ( prev : AccountBilling.Form | null ) => prev ? { ...prev, ...patch } : prev );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onReset() : void
    {
        setSaveError( "" );
        setForm( original );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // persist billing settings (rail, auto-reload, billing address) — returns true on success (SaveBar flash)
    async function onSave() : Promise<boolean>
    {
        if( !form ) return false;
        setSaveError( "" );
        const body : PutBillingSettings.Body =
        {
            billingType: form.billingType,
            autoReload:
            {
                enabled:   form.autoReloadEnabled,
                threshold: { amountMinor: Math.round( form.autoReloadThreshold * 100 ), currency },
                amount:    { amountMinor: Math.round( form.autoReloadAmount * 100 ), currency },
            },
            billingAddressSameAsAccount: form.sameAsAccount,
            billingAddress: form.sameAsAccount ? undefined : form.address,
        };
        const reply : RestfulService.Reply<PutBillingSettings.Response> = await appmodel.server.fetch( new PutBillingSettings( body ) );
        if( reply.ok && reply.data )
        {
            setOverview( ( prev : Billing.Overview | null ) => prev ? { ...prev, settings: reply.data!.settings, billingAddress: reply.data!.billingAddress } : prev );
            setOriginal( form );
            return true;
        }
        setSaveError( "Could not save billing settings. Please try again." );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // apply a balance top-up (skeleton: credits the stored balance; real flow charges the card). Called by
    // BalanceTopupDialog with the amount in minor units; returns true on success (the dialog closes + flashes).
    async function onTopup( amountMinor : number ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostBalanceTopup.Response> = await appmodel.server.fetch( new PostBalanceTopup( { amountMinor } ) );
        if( reply.ok && reply.data )
        {
            setOverview( ( prev : Billing.Overview | null ) => prev ? { ...prev, balance: reply.data!.balance } : prev );
            setSnack( { message: "Funds added.", severity: "success" } );
            setTopupOpen( false );
            return true;
        }
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // begin adding a card — skeleton returns an empty client secret (Stripe not wired) so we just inform
    async function onAddMethod() : Promise<void>
    {
        const reply : RestfulService.Reply<PostPaymentMethodSetup.Response> = await appmodel.server.fetch( new PostPaymentMethodSetup() );
        if( reply.ok && reply.data && reply.data.clientSecret !== "" )
        {
            // real flow: confirm the SetupIntent with Stripe.js, then reload methods
            setSnack( { message: "Follow the card prompt to finish adding your card.", severity: "info" } );
        }
        else setSnack( { message: "Card payments aren't enabled yet.", severity: "info" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function money( value? : Billing.Money ) : string
    {
        if( !value ) return "—";
        const formatter : Intl.NumberFormat = new Intl.NumberFormat( undefined, { style: "currency", currency: value.currency || "USD" } );
        return formatter.format( value.amountMinor / 100 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function displayDate( iso? : string ) : string
    {
        return appmodel.ui.locale.dateTime( iso ? new Date( iso ) : null, LocaleService.Format.LONG ) || "—";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function subscriptionColor( status? : Billing.SubscriptionStatus ) : "success" | "warning" | "error" | "info" | "default"
    {
        switch( status )
        {
            case Billing.SubscriptionStatus.ACTIVE:   return "success";
            case Billing.SubscriptionStatus.TRIALING: return "info";
            case Billing.SubscriptionStatus.PAST_DUE: return "warning";
            case Billing.SubscriptionStatus.PAUSED:   return "warning";
            case Billing.SubscriptionStatus.CANCELED: return "error";
            default:                                  return "default";
        }
    }

    const BILLING_TYPE_CHOICES : Array<DropdownInput.Choice> =
    [
        { value: Billing.BillingType.CARD,    label: "Credit card" },
        { value: Billing.BillingType.INVOICE, label: "Invoice (net terms)" },
    ];

    return  <AuthPage minAccess={ Access.AccountRole.BILLING } title={"Account : Billing"}>
                <Box sx={{ p: 2, pb: 12, mx: "auto" }}>

                    { loading && <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                    { !loading && error !== "" && <Typography variant="body2" sx={{ color: "error.main", p: 2 }}>{ error }</Typography> }

                    { !loading && overview && form &&
                        <Stack spacing={ 2 }>

                            <SubAccountNotice detail="Billing may be managed by the parent account." />

                            <Tabs value={ tab } onChange={ ( _event, next : number ) => setTab( next ) } variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: "divider" }}>
                                <Tab label={"Plan"} />
                                <Tab label={"Balance"} />
                                <Tab label={"Payment methods"} />
                                <Tab label={"History"} />
                                <Tab label={"Settings"} />
                            </Tabs>

                            {/* ── Plan & costs ─────────────────────────────────────────────────────── */}
                            <TabPanel index={ 0 } value={ tab }>
                                <Card variant="outlined">
                                    <CardHeader
                                        title={ overview.planName || "No plan yet" }
                                        subheader={"Your current plan and what it includes."}
                                        action={ overview.subscription && <Chip size="small" color={ subscriptionColor( overview.subscription.status ) } variant="outlined" label={ overview.subscription.status } sx={{ mt: 1, mr: 1 }} /> } />
                                    <Divider />
                                    <CardContent>
                                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                            { overview.planName ? "Plan pricing appears here once plans are available." : "Choose a plan to get started. Plans aren't available yet." }
                                        </Typography>
                                    </CardContent>
                                </Card>

                                <Card variant="outlined" sx={{ mt: 2 }}>
                                    <CardHeader title={"Current charges"} subheader={"What's being charged to this account right now."} />
                                    <Divider />
                                    <CardContent>
                                        { overview.costs.length === 0
                                            ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Nothing is currently being charged."}</Typography>
                                            : <TableContainer>
                                                <Table size="small">
                                                    <TableHead><TableRow><TableCell>{"Item"}</TableCell><TableCell>{"Cadence"}</TableCell><TableCell align="right">{"Amount"}</TableCell></TableRow></TableHead>
                                                    <TableBody>
                                                        { overview.costs.map( ( cost : Billing.CostLine, index : number ) =>
                                                            <TableRow key={ index }>
                                                                <TableCell>{ cost.label }{ cost.note ? ` — ${ cost.note }` : "" }</TableCell>
                                                                <TableCell>{ cost.interval ?? "one-time" }</TableCell>
                                                                <TableCell align="right">{ money( cost.amount ) }</TableCell>
                                                            </TableRow> ) }
                                                    </TableBody>
                                                </Table>
                                              </TableContainer>
                                        }
                                    </CardContent>
                                </Card>
                            </TabPanel>

                            {/* ── Balance & auto-reload ────────────────────────────────────────────── */}
                            <TabPanel index={ 1 } value={ tab }>
                                <Card variant="outlined">
                                    <CardHeader title={"Account balance"} subheader={"Prepaid credit, drawn down by usage charges."} />
                                    <Divider />
                                    <CardContent>
                                        <Stack spacing={ 2 }>
                                            <Stack direction="row" spacing={ 2 } sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
                                                <Typography variant="h4">{ money( overview.balance.balance ) }</Typography>
                                                <Button variant="contained" startIcon={ <AddOutlinedIcon /> } onClick={ () => setTopupOpen( true ) }>{"Add funds"}</Button>
                                            </Stack>
                                            <Typography variant="caption" sx={{ color: "text.secondary" }}>{`Last updated ${ displayDate( overview.balance.updatedAt ) }`}</Typography>
                                        </Stack>
                                    </CardContent>
                                </Card>

                                <Card variant="outlined" sx={{ mt: 2 }}>
                                    <CardHeader title={"Auto-reload"} subheader={"Automatically top up when the balance runs low."} />
                                    <Divider />
                                    <CardContent>
                                        <Stack spacing={ 2 }>
                                            <SwitchInput id="billing-autoreload" label={"Enable auto-reload"} value={ form.autoReloadEnabled } onChange={ ( value : boolean ) => set( { autoReloadEnabled: value } ) } />
                                            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
                                                <NumericInput id="billing-autoreload-threshold" label={"When balance falls below"} value={ form.autoReloadThreshold } minValue={ 0 } decimalPlaces={ 2 } startLabel={"$"} disabled={ !form.autoReloadEnabled } onChange={ ( value : number ) => set( { autoReloadThreshold: value } ) } fullWidth />
                                                <NumericInput id="billing-autoreload-amount" label={"Add this amount"} value={ form.autoReloadAmount } minValue={ 0 } decimalPlaces={ 2 } startLabel={"$"} disabled={ !form.autoReloadEnabled } onChange={ ( value : number ) => set( { autoReloadAmount: value } ) } fullWidth />
                                            </Box>
                                        </Stack>
                                    </CardContent>
                                </Card>
                            </TabPanel>

                            {/* ── Payment methods ──────────────────────────────────────────────────── */}
                            <TabPanel index={ 2 } value={ tab }>
                                <Card variant="outlined">
                                    <CardHeader
                                        title={"Payment methods"}
                                        subheader={"Cards on file. Your full card number is stored by our payment processor, never by us."}
                                        action={ <Button variant="outlined" startIcon={ <AddCardOutlinedIcon /> } onClick={ () => void onAddMethod() } sx={{ mt: 1, mr: 1 }}>{"Add payment method"}</Button> } />
                                    <Divider />
                                    <CardContent>
                                        { methods.length === 0
                                            ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No payment methods yet."}</Typography>
                                            : <Stack spacing={ 1 } divider={ <Divider flexItem /> }>
                                                { methods.map( ( method : Billing.PaymentMethod ) =>
                                                    <Stack key={ method.id } direction="row" spacing={ 2 } sx={{ alignItems: "center", justifyContent: "space-between" }}>
                                                        <Typography variant="body2">
                                                            { `${ method.brand ?? method.kind } •••• ${ method.last4 ?? "" }` }
                                                            { method.expMonth && method.expYear ? ` — exp ${ method.expMonth }/${ method.expYear }` : "" }
                                                        </Typography>
                                                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                                                            { method.isDefault && <Chip size="small" variant="outlined" color="success" label={"Default"} /> }
                                                            <Button size="small" color="error" onClick={ () => void onRemoveMethod( method.id ) }>{"Remove"}</Button>
                                                        </Stack>
                                                    </Stack> ) }
                                              </Stack>
                                        }
                                    </CardContent>
                                </Card>
                            </TabPanel>

                            {/* ── History (payments + invoices) ────────────────────────────────────── */}
                            <TabPanel index={ 3 } value={ tab }>
                                <BillingHistory kind="payments" />
                                <Box sx={{ mt: 2 }} />
                                <BillingHistory kind="invoices" />
                            </TabPanel>

                            {/* ── Settings (rail + billing address) ────────────────────────────────── */}
                            <TabPanel index={ 4 } value={ tab }>
                                <Card variant="outlined">
                                    <CardHeader title={"Billing type"} subheader={"How this account is billed."} />
                                    <Divider />
                                    <CardContent>
                                        <DropdownInput id="billing-type" label={"Billing type"} type="select"
                                                       value={ [ form.billingType ] }
                                                       choices={ BILLING_TYPE_CHOICES }
                                                       onChange={ ( ids : Array<string> ) => set( { billingType: ( ids[ 0 ] ?? Billing.BillingType.CARD ) as Billing.BillingType } ) } />
                                    </CardContent>
                                </Card>

                                <Card variant="outlined" sx={{ mt: 2 }}>
                                    <CardHeader title={"Billing address"} subheader={"Where invoices and receipts are addressed."} />
                                    <Divider />
                                    <CardContent>
                                        <Stack spacing={ 2 }>
                                            <SwitchInput id="billing-address-same" label={"Same as account address"} value={ form.sameAsAccount } onChange={ ( value : boolean ) => set( { sameAsAccount: value } ) } />
                                            { form.sameAsAccount
                                                ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{ formatAddress( overview.billingAddress ) }</Typography>
                                                : <AddressInput id="billing-address" value={ form.address } onChange={ ( address : Type.Address ) => set( { address } ) } />
                                            }
                                        </Stack>
                                    </CardContent>
                                </Card>
                            </TabPanel>

                        </Stack>
                    }
                </Box>

                {/* top-up confirm dialog (own component; parent owns open/close, dialog owns the amount) */}
                { topupOpen && <BalanceTopupDialog onConfirm={ onTopup } onClose={ () => setTopupOpen( false ) } /> }

                {/* sticky save bar for settings/auto-reload edits */}
                { !loading && overview &&
                    <SaveBar dirty={ dirty } error={ saveError } onReset={ onReset } onSave={ onSave } />
                }

                <AccountChange onClear={ () => { setOverview( null ); setForm( null ); setOriginal( null ); } }
                               onRefresh={ () => { if( Access.isAllowed( appmodel.auth.role(), Access.AccountRole.BILLING ) ) void load(); } } />

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // detach a stored card (state-changing → immediate here since methods are empty in the skeleton)
    async function onRemoveMethod( methodId : string ) : Promise<void>
    {
        const reply : RestfulService.Reply<DeletePaymentMethod.Response> = await appmodel.server.fetch( new DeletePaymentMethod( methodId ) );
        if( reply.ok && reply.data?.removed )
        {
            setMethods( ( prev : Array<Billing.PaymentMethod> ) => prev.filter( ( method : Billing.PaymentMethod ) => method.id !== methodId ) );
            setSnack( { message: "Payment method removed.", severity: "success" } );
        }
        else setSnack( { message: "Couldn't remove that payment method.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function formatAddress( address? : Type.Address ) : string
    {
        if( !address ) return "Using the account address.";
        const parts : Array<string> = [ address.street1, address.street2, address.city, address.state, address.zip, address.country ].filter( ( part ) => ( part ?? "" ).trim() !== "" );
        return parts.length > 0 ? parts.join( ", " ) : "Using the account address.";
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////
// small presentation-only internal — a single tab's content, mounted only when selected (keeps off-screen
// DateInputs / tables from rendering). Used solely by AccountBilling.
function TabPanel( { index, value, children } : { index : number; value : number; children : React.ReactNode } ) : JSX.Element | null
{
    if( index !== value ) return null;
    return <Box>{ children }</Box>;
}

export namespace AccountBilling
{
    export interface Form
    {
        billingType         : Billing.BillingType;
        autoReloadEnabled   : boolean;
        autoReloadThreshold : number;   // whole currency units (dollars) for the input
        autoReloadAmount    : number;
        sameAsAccount       : boolean;
        address             : Type.Address;
    }

    export interface Props
    {
    }
}

export default AccountBilling;
// eof
