import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';

import { Access } from '@repo/system';
import {
    Registration, PhoneNumber, Texting,
    GetRegistrationMyBrand, PostRegistrationBrand,
    GetRegistrationCampaigns, PostRegistrationCampaign, PatchRegistrationCampaign,
    GetRegistrationNumbers, PostRegistrationNumberSearch, PostRegistrationNumberOrder, PostRegistrationNumberRelease, PostRegistrationTollFreeVerification,
    GetRegistrationShortCodeApplications, PostRegistrationShortCodeApplication,
} from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage    from '@widgets/app/AuthPage';
import TableInput  from '@widgets/core/TableInput';
import SnackAlert  from '@widgets/core/SnackAlert';
import BrandFormDialog from '@pages/settings/dialogs/BrandFormDialog';
import CampaignFormDialog from '@pages/settings/dialogs/CampaignFormDialog';
import NumberOrderDialog from '@pages/settings/dialogs/NumberOrderDialog';
import TollFreeVerificationDialog from '@pages/settings/dialogs/TollFreeVerificationDialog';
import ShortCodeApplicationDialog from '@pages/settings/dialogs/ShortCodeApplicationDialog';
import NumberSelectionDialog from '@pages/settings/dialogs/NumberSelectionDialog';

// which campaign statuses count as "approved enough to order a long-code number against"
const APPROVED_CAMPAIGN_STATUSES : Array<Registration.CampaignStatus> =
[ Registration.CampaignStatus.APPROVED, Registration.CampaignStatus.NUMBER_ASSOCIATED, Registration.CampaignStatus.ACTIVE ];

// TableInput row-action ids
enum NumberAction { VERIFY = "verify", RELEASE = "release" }
enum CampaignAction { ROUTING = "routing" }

//
// Settings : Registration — end-to-end phone-number registration per account (registration-4.x): register a
// TCR brand + campaign, then search/order 10DLC (long code) and toll-free numbers, submit toll-free
// verification, and request a short code. ACCOUNT-scoped — this is the account's own registration state, not
// a staff view (see the Console for cross-account brand/campaign ops).
//
export function SettingsRegistration( props : SettingsRegistration.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [loading,setLoading]     = React.useState< boolean >( true );
    const [brand,setBrand]         = React.useState< Registration.Brand | undefined >( undefined );
    const [campaigns,setCampaigns] = React.useState< Array<Registration.Campaign> >( [] );
    const [numbers,setNumbers]     = React.useState< Array<PhoneNumber.PhoneNumber> >( [] );
    const [shortCodes,setShortCodes] = React.useState< Array<PhoneNumber.ShortCodeApplication> >( [] );

    const [brandDialogOpen,setBrandDialogOpen] = React.useState< boolean >( false );
    const [campaignDialogOpen,setCampaignDialogOpen] = React.useState< boolean >( false );
    const [orderDialog,setOrderDialog] = React.useState< { numberType : Texting.NumberType.LONG_CODE | Texting.NumberType.TOLL_FREE } | null >( null );
    const [tfvTarget,setTfvTarget]     = React.useState< PhoneNumber.PhoneNumber | null >( null );
    const [shortCodeDialogOpen,setShortCodeDialogOpen] = React.useState< boolean >( false );
    const [routingTarget,setRoutingTarget] = React.useState< Registration.Campaign | null >( null );
    const [snack,setSnack] = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    const approvedCampaigns : Array<Registration.Campaign> = campaigns.filter( ( campaign : Registration.Campaign ) : boolean => APPROVED_CAMPAIGN_STATUSES.includes( campaign.status ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [] );
    function componentLoaded() : void { void load(); }

    async function load() : Promise<void>
    {
        setLoading( true );
        const brandReply : RestfulService.Reply<GetRegistrationMyBrand.Response> = await appmodel.server.fetch( new GetRegistrationMyBrand() );
        if( brandReply.ok && brandReply.data ) setBrand( brandReply.data.brand );

        const campaignsReply : RestfulService.Reply<GetRegistrationCampaigns.Response> = await appmodel.server.fetch( new GetRegistrationCampaigns( { count: 200 } ) );
        if( campaignsReply.ok && campaignsReply.data ) setCampaigns( campaignsReply.data.records );

        const numbersReply : RestfulService.Reply<GetRegistrationNumbers.Response> = await appmodel.server.fetch( new GetRegistrationNumbers( { count: 200 } ) );
        if( numbersReply.ok && numbersReply.data ) setNumbers( numbersReply.data.records );

        const shortCodesReply : RestfulService.Reply<GetRegistrationShortCodeApplications.Response> = await appmodel.server.fetch( new GetRegistrationShortCodeApplications( { count: 200 } ) );
        if( shortCodesReply.ok && shortCodesReply.data ) setShortCodes( shortCodesReply.data.records );

        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onSaveBrand( draft : BrandFormDialog.Draft ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostRegistrationBrand.Response> = await appmodel.server.fetch( new PostRegistrationBrand( draft ) );
        if( reply.ok && reply.data ) { setBrand( reply.data ); setSnack( { message: "Brand created — pending TCR review.", severity: "success" } ); return true; }
        setSnack( { message: "Could not create the brand.", severity: "error" } );
        return false;
    }

    async function onSaveCampaign( draft : CampaignFormDialog.Draft ) : Promise<boolean>
    {
        if( !brand?.brandId ) return false;
        const reply : RestfulService.Reply<PostRegistrationCampaign.Response> = await appmodel.server.fetch( new PostRegistrationCampaign( { brandId: brand.brandId, subUsecases: [], ...draft } ) );
        if( reply.ok && reply.data ) { void load(); setSnack( { message: "Campaign created — pending TCR review.", severity: "success" } ); return true; }
        setSnack( { message: "Could not create the campaign.", severity: "error" } );
        return false;
    }

    async function onSearchNumbers( numberType : Texting.NumberType.LONG_CODE | Texting.NumberType.TOLL_FREE, criteria : { carrier : Registration.CarrierProvider; areaCode? : string } ) : Promise<Array<NumberOrderDialog.AvailableNumber>>
    {
        const reply : RestfulService.Reply<PostRegistrationNumberSearch.Response> = await appmodel.server.fetch( new PostRegistrationNumberSearch( { numberType, ...criteria } ) );
        if( !reply.ok || !reply.data ) { setSnack( { message: "Number search failed.", severity: "error" } ); return []; }
        return reply.data.results.map( ( result : PostRegistrationNumberSearch.AvailableNumber ) : NumberOrderDialog.AvailableNumber => ( { number: result.number, monthlyPriceCents: result.monthlyPriceCents } ) );
    }

    async function onOrderNumber( numberType : Texting.NumberType.LONG_CODE | Texting.NumberType.TOLL_FREE, input : { number : string; carrier : Registration.CarrierProvider; campaignId? : string } ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostRegistrationNumberOrder.Response> = await appmodel.server.fetch( new PostRegistrationNumberOrder( { numberType, ...input } ) );
        if( reply.ok && reply.data ) { void load(); setSnack( { message: "Number ordered.", severity: "success" } ); return true; }
        setSnack( { message: "Could not order that number.", severity: "error" } );
        return false;
    }

    async function onSubmitTfv( draft : TollFreeVerificationDialog.Draft ) : Promise<boolean>
    {
        if( !tfvTarget ) return false;
        const reply : RestfulService.Reply<PostRegistrationTollFreeVerification.Response> = await appmodel.server.fetch( new PostRegistrationTollFreeVerification( { id: tfvTarget.id, ...draft } ) );
        if( reply.ok && reply.data ) { void load(); setSnack( { message: "Submitted for toll-free verification.", severity: "success" } ); return true; }
        setSnack( { message: "Could not submit toll-free verification.", severity: "error" } );
        return false;
    }

    async function onReleaseNumber( id : string ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostRegistrationNumberRelease.Response> = await appmodel.server.fetch( new PostRegistrationNumberRelease( { id } ) );
        if( reply.ok ) { void load(); setSnack( { message: "Number released.", severity: "success" } ); }
        else setSnack( { message: "Could not release the number.", severity: "error" } );
    }

    async function onSubmitShortCode( draft : ShortCodeApplicationDialog.Draft ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostRegistrationShortCodeApplication.Response> = await appmodel.server.fetch( new PostRegistrationShortCodeApplication( draft ) );
        if( reply.ok && reply.data ) { void load(); setSnack( { message: "Short-code request submitted.", severity: "success" } ); return true; }
        setSnack( { message: "Could not submit the short-code request.", severity: "error" } );
        return false;
    }

    async function onSaveNumberSelection( selection : Texting.NumberSelection ) : Promise<boolean>
    {
        if( !routingTarget?.campaignId ) return false;
        const reply : RestfulService.Reply<PatchRegistrationCampaign.Response> = await appmodel.server.fetch(
            new PatchRegistrationCampaign( routingTarget.campaignId, { numberSelection: selection } ) );
        if( reply.ok && reply.data ) { void load(); setSnack( { message: "Number routing updated.", severity: "success" } ); return true; }
        setSnack( { message: "Could not update number routing.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onNumberAction( action : string, row : TableInput.Row ) : void
    {
        const number : PhoneNumber.PhoneNumber | undefined = numbers.find( ( item : PhoneNumber.PhoneNumber ) : boolean => item.id === row.id );
        if( !number ) return;
        if( action === NumberAction.VERIFY ) setTfvTarget( number );
        else if( action === NumberAction.RELEASE ) void onReleaseNumber( number.id );
    }

    function onCampaignAction( action : string, row : TableInput.Row ) : void
    {
        const campaign : Registration.Campaign | undefined = campaigns.find( ( item : Registration.Campaign ) : boolean => item.campaignId === row.id );
        if( !campaign ) return;
        if( action === CampaignAction.ROUTING ) setRoutingTarget( campaign );
    }

    const numberColumns : Array<TableInput.Column> =
    [
        { field: "number",   label: "Number",  type: TableInput.ColumnType.STRING },
        { field: "type",     label: "Type",    type: TableInput.ColumnType.STRING },
        { field: "carrier",  label: "Carrier", type: TableInput.ColumnType.STRING },
        { field: "status",   label: "Status",  type: TableInput.ColumnType.STRING },
        { field: "tfv",      label: "TFV",     type: TableInput.ColumnType.STRING },
        { field: "actions",  label: "",        type: TableInput.ColumnType.ACTION },
    ];
    const numberActions : Array<TableInput.Action> =
    [
        { id: NumberAction.VERIFY,  label: "Verify (TFV)", icon: <VerifiedOutlinedIcon fontSize="small" />,
          filter: ( _value : string, row : TableInput.Row ) : boolean => row.type === Texting.NumberType.TOLL_FREE && row.tfv !== PhoneNumber.TfvStatus.VERIFIED },
        { id: NumberAction.RELEASE, label: "Release", icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
    ];
    const numberRows : Array<TableInput.Row> = numbers.map( ( number : PhoneNumber.PhoneNumber ) : TableInput.Row => ( {
        id: number.id, number: number.number ?? "(pending)", type: number.numberType, carrier: number.carrier,
        status: number.status, tfv: number.tollFreeVerification?.status ?? PhoneNumber.TfvStatus.NOT_STARTED,
        actions: [ NumberAction.VERIFY, NumberAction.RELEASE ],
    } ) );

    const campaignColumns : Array<TableInput.Column> =
    [
        { field: "usecase",     label: "Use case", type: TableInput.ColumnType.STRING },
        { field: "description", label: "Description", type: TableInput.ColumnType.STRING },
        { field: "status",      label: "Status", type: TableInput.ColumnType.STRING },
        { field: "numbers",     label: "Numbers", type: TableInput.ColumnType.NUMBER },
        { field: "routing",     label: "Number routing", type: TableInput.ColumnType.STRING },
        { field: "actions",     label: "",        type: TableInput.ColumnType.ACTION },
    ];
    const campaignActions : Array<TableInput.Action> =
    [
        { id: CampaignAction.ROUTING, label: "Number routing", icon: <TuneOutlinedIcon fontSize="small" /> },
    ];
    // this campaign's OWN owned+active lines (the standalone PhoneNumber set, not the legacy bulk array) —
    // what the routing dialog's SINGLE picker offers.
    function campaignNumbers( campaignId : string | undefined ) : Array<PhoneNumber.PhoneNumber>
    {
        return numbers.filter( ( number : PhoneNumber.PhoneNumber ) : boolean => number.campaignId === campaignId && number.status === PhoneNumber.OrderStatus.ACTIVE );
    }
    const campaignRows : Array<TableInput.Row> = campaigns.map( ( campaign : Registration.Campaign ) : TableInput.Row => ( {
        id: campaign.campaignId ?? "", usecase: campaign.usecase, description: campaign.description.slice( 0, 80 ),
        status: campaign.status, numbers: campaign.phoneNumbers.length,
        routing: campaign.numberSelection?.mode ?? "(not set — falls back to placeholder)",
        actions: [ CampaignAction.ROUTING ],
    } ) );

    const shortCodeColumns : Array<TableInput.Column> =
    [
        { field: "preference", label: "Preference", type: TableInput.ColumnType.STRING },
        { field: "useCase",    label: "Use case", type: TableInput.ColumnType.STRING },
        { field: "status",     label: "Status", type: TableInput.ColumnType.STRING },
        { field: "shortCode",  label: "Short code", type: TableInput.ColumnType.STRING },
    ];
    const shortCodeRows : Array<TableInput.Row> = shortCodes.map( ( application : PhoneNumber.ShortCodeApplication ) : TableInput.Row => ( {
        id: application.id, preference: application.preference, useCase: application.useCase.slice( 0, 80 ),
        status: application.status, shortCode: application.shortCode ?? "—",
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.ACCOUNT } title={"Settings : Registration"}>
                { loading
                    ? <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>
                    : <Stack spacing={ 3 }>

                        <Card>
                            <CardHeader title={"Brand"} subheader={"Your TCR 10DLC brand — required before any long-code campaign can be approved."} />
                            <CardContent>
                                { brand
                                    ? <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center" }}>
                                        <Typography>{ brand.companyName ?? `${ brand.firstName } ${ brand.lastName }` }</Typography>
                                        <Chip label={ brand.status } size="small" />
                                      </Stack>
                                    : <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center" }}>
                                        <Typography color="text.secondary">No brand registered yet.</Typography>
                                        <Button startIcon={ <AddOutlinedIcon /> } onClick={ () => setBrandDialogOpen( true ) }>Register brand</Button>
                                      </Stack> }
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader title={"Campaigns"}
                                       action={ brand?.status === Registration.BrandStatus.APPROVED &&
                                           <Button startIcon={ <AddOutlinedIcon /> } onClick={ () => setCampaignDialogOpen( true ) }>Create campaign</Button> } />
                            <CardContent>
                                <TableInput id="registration-campaigns" columns={ campaignColumns } data={ campaignRows } actions={ campaignActions }
                                           onAction={ onCampaignAction } selectable={ TableInput.Selectable.NONE } />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader title={"Numbers"}
                                       action={ <Stack direction="row" spacing={ 1 }>
                                           <Button startIcon={ <AddOutlinedIcon /> } onClick={ () => setOrderDialog( { numberType: Texting.NumberType.LONG_CODE } ) }>Order long code</Button>
                                           <Button startIcon={ <AddOutlinedIcon /> } onClick={ () => setOrderDialog( { numberType: Texting.NumberType.TOLL_FREE } ) }>Order toll-free</Button>
                                       </Stack> } />
                            <CardContent>
                                <TableInput id="registration-numbers" columns={ numberColumns } data={ numberRows } actions={ numberActions }
                                           onAction={ onNumberAction } selectable={ TableInput.Selectable.NONE } />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader title={"Short codes"}
                                       action={ <Button startIcon={ <AddOutlinedIcon /> } onClick={ () => setShortCodeDialogOpen( true ) }>Request short code</Button> } />
                            <CardContent>
                                <TableInput id="registration-shortcodes" columns={ shortCodeColumns } data={ shortCodeRows } selectable={ TableInput.Selectable.NONE } />
                            </CardContent>
                        </Card>

                    </Stack> }

                { brandDialogOpen && <BrandFormDialog onSave={ onSaveBrand } onClose={ () => setBrandDialogOpen( false ) } /> }
                { campaignDialogOpen && brand?.brandId &&
                    <CampaignFormDialog brandId={ brand.brandId } onSave={ onSaveCampaign } onClose={ () => setCampaignDialogOpen( false ) } /> }
                { orderDialog &&
                    <NumberOrderDialog numberType={ orderDialog.numberType } campaigns={ approvedCampaigns }
                                       onSearch={ ( criteria ) => onSearchNumbers( orderDialog.numberType, criteria ) }
                                       onOrder={ ( input ) => onOrderNumber( orderDialog.numberType, input ) }
                                       onClose={ () => setOrderDialog( null ) } /> }
                { tfvTarget &&
                    <TollFreeVerificationDialog number={ tfvTarget.number ?? "" } onSubmit={ onSubmitTfv } onClose={ () => setTfvTarget( null ) } /> }
                { shortCodeDialogOpen &&
                    <ShortCodeApplicationDialog campaigns={ approvedCampaigns } onSubmit={ onSubmitShortCode } onClose={ () => setShortCodeDialogOpen( false ) } /> }
                { routingTarget &&
                    <NumberSelectionDialog current={ routingTarget.numberSelection } numbers={ campaignNumbers( routingTarget.campaignId ) }
                                           onSave={ onSaveNumberSelection } onClose={ () => setRoutingTarget( null ) } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace SettingsRegistration
{
    export interface Props
    {
    }
}

export default SettingsRegistration;
// eof
