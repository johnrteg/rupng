import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import VerifiedOutlinedIcon    from '@mui/icons-material/VerifiedOutlined';
import VisibilityOutlinedIcon  from '@mui/icons-material/VisibilityOutlined';
import RequestQuoteOutlinedIcon from '@mui/icons-material/RequestQuoteOutlined';

import { Print, GetPrintTemplates, PostPrintProof, PostPrintAddressVerify, PostPrintCostPreview } from '@repo/api';
import type { Type } from '@repo/common';
import { RestfulService } from '@repo/endpoint';

import SnackAlert  from '@widgets/core/SnackAlert';
import SelectInput from '@widgets/core/SelectInput';
import TextInput   from '@widgets/core/TextInput';
import AddressInput from '@widgets/app/AddressInput';

// a blank Type.Address for the recipient form's initial state
const BLANK_ADDRESS : Type.Address = { street1: "", street2: "", city: "", state: "", zip: "", country: "US" };

//
// SendPrintPanel — the Print tab of Messages : Send. Print's SPECS.md is explicit that mailpiece SUBMISSION is
// S2S only (campaign/workflow's `send` node enqueues) — there is no ad-hoc "send one postcard" route, unlike
// the other channels' test-send panels. What IS user-facing is the AUTHORING surface: verify a recipient
// address, render a proof PDF, and preview a run's cost + lead time — so this panel exposes exactly those three
// tools rather than a compose-and-send form.
//
export function SendPrintPanel( _props : SendPrintPanel.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [templates,setTemplates] = React.useState< Array<Print.Template> >( [] );
    const [templateId,setTemplateId] = React.useState< string >( "" );
    const [address,setAddress]     = React.useState< Type.Address >( BLANK_ADDRESS );
    const [verifyResult,setVerifyResult] = React.useState< Print.AddressVerifyResult | null >( null );
    const [verifying,setVerifying] = React.useState< boolean >( false );
    const [rendering,setRendering] = React.useState< boolean >( false );

    const [type,setType]           = React.useState< string >( Print.MailpieceType.POSTCARD );
    const [mailClass,setMailClass] = React.useState< string >( Print.MailClass.MARKETING );
    const [recipients,setRecipients] = React.useState< string >( "1000" );
    const [costResult,setCostResult] = React.useState< Print.CostPreviewResult | null >( null );
    const [pricing,setPricing]     = React.useState< boolean >( false );

    const [snack,setSnack] = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [] );

    function componentLoaded() : void { void loadTemplates(); }

    async function loadTemplates() : Promise<void>
    {
        const reply : RestfulService.Reply<GetPrintTemplates.Response> = await appmodel.server.fetch( new GetPrintTemplates() );
        if( !reply.ok || !reply.data ) return;
        setTemplates( reply.data.templates );
        if( reply.data.templates.length > 0 ) setTemplateId( reply.data.templates[ 0 ].id );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Type.Address (street1/state/zip) → Print.Address (line1/region/postalCode) — the two channel-agnostic
    // vs print-specific address shapes this panel bridges.
    function toPrintAddress( value : Type.Address ) : Print.Address
    {
        return { line1: value.street1, line2: value.street2 || undefined, city: value.city, region: value.state, postalCode: value.zip, country: value.country };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onVerify() : Promise<void>
    {
        setVerifying( true );
        const reply : RestfulService.Reply<PostPrintAddressVerify.Response> = await appmodel.server.fetch( new PostPrintAddressVerify( { address: toPrintAddress( address ) } ) );
        setVerifying( false );
        if( !reply.ok || !reply.data ) { setSnack( { message: RestfulService.error( reply, "Could not verify the address" ), severity: "error" } ); return; }
        setVerifyResult( reply.data );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onRenderProof() : Promise<void>
    {
        if( !templateId ) { setSnack( { message: "Pick a template first.", severity: "warning" } ); return; }
        setRendering( true );
        const reply : RestfulService.Reply<PostPrintProof.Response> = await appmodel.server.fetch( new PostPrintProof( { templateId } ) );
        setRendering( false );
        if( !reply.ok || !reply.data ) { setSnack( { message: RestfulService.error( reply, "Could not render the proof" ), severity: "error" } ); return; }
        window.open( reply.data.proofUrl, "_blank" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onCostPreview() : Promise<void>
    {
        const count : number = Number( recipients ) || 0;
        if( count <= 0 ) { setSnack( { message: "Enter a recipient count.", severity: "warning" } ); return; }
        setPricing( true );
        const reply : RestfulService.Reply<PostPrintCostPreview.Response> = await appmodel.server.fetch(
            new PostPrintCostPreview( { type: type as Print.MailpieceType, mailClass: mailClass as Print.MailClass, recipients: count } ) );
        setPricing( false );
        if( !reply.ok || !reply.data ) { setSnack( { message: RestfulService.error( reply, "Could not estimate cost" ), severity: "error" } ); return; }
        setCostResult( reply.data );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const templateChoices : Array<SelectInput.Choice> = templates.map( ( template : Print.Template ) : SelectInput.Choice => ( { value: template.id, label: template.name } ) );
    const typeChoices : Array<SelectInput.Choice> = Object.values( Print.MailpieceType ).map( ( value : Print.MailpieceType ) : SelectInput.Choice => ( { value, label: value } ) );
    const mailClassChoices : Array<SelectInput.Choice> = Object.values( Print.MailClass ).map( ( value : Print.MailClass ) : SelectInput.Choice => ( { value, label: value } ) );
    const deliverabilityColor : "success" | "error" | "warning" = verifyResult?.verification.deliverability === Print.Deliverability.DELIVERABLE ? "success"
        : verifyResult?.verification.deliverability === Print.Deliverability.UNDELIVERABLE ? "error" : "warning";

    return  <>
                <Box sx={{ p: 2, mx: "auto", maxWidth: 720, display: "flex", flexDirection: "column", gap: 2 }}>

                    {/* ── Address verification (print-2) ─────────────────────────────────────── */}
                    <Card variant="outlined">
                        <CardHeader title={"Verify a recipient address"} subheader={"CASS-standardize + score deliverability before mailing"} />
                        <Divider />
                        <CardContent>
                            <Stack spacing={ 2 }>
                                <AddressInput id="print-send-address" value={ address } onChange={ setAddress } />
                                <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center", justifyContent: "space-between" }}>
                                    <Button variant="contained" startIcon={ verifying ? <CircularProgress size={ 16 } color="inherit" /> : <VerifiedOutlinedIcon /> }
                                            disabled={ verifying } onClick={ () => void onVerify() }>
                                        { verifying ? "Verifying…" : "Verify address" }
                                    </Button>
                                    { verifyResult &&
                                        <Stack direction="row" spacing={ 1 }>
                                            <Chip size="small" color={ deliverabilityColor } label={ verifyResult.verification.deliverability } />
                                            { verifyResult.cacheHit && <Chip size="small" variant="outlined" label={"cache hit"} /> }
                                            { verifyResult.charged && <Chip size="small" variant="outlined" label={"charged"} /> }
                                        </Stack> }
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>

                    {/* ── Proof preview (print-1.4) ───────────────────────────────────────────── */}
                    <Card variant="outlined">
                        <CardHeader title={"Render a proof"} subheader={"Preview a template's print-ready PDF (bleed/safe-zone checked)"} />
                        <Divider />
                        <CardContent>
                            <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center" }}>
                                <SelectInput id="print-send-template" label={"Template"} value={ templateId } choices={ templateChoices }
                                             disabled={ templateChoices.length === 0 } onChange={ setTemplateId } sx={{ width: 260 } } />
                                <Button variant="outlined" startIcon={ rendering ? <CircularProgress size={ 16 } /> : <VisibilityOutlinedIcon /> }
                                        disabled={ rendering || !templateId } onClick={ () => void onRenderProof() }>
                                    { rendering ? "Rendering…" : "Render proof" }
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>

                    {/* ── Cost + lead-time preview (print-6.2/6.3) ────────────────────────────── */}
                    <Card variant="outlined">
                        <CardHeader title={"Estimate cost + lead time"} subheader={"Per-piece × recipients, before a run"} />
                        <Divider />
                        <CardContent>
                            <Stack spacing={ 2 }>
                                <Stack direction="row" spacing={ 2 }>
                                    <SelectInput id="print-send-type" label={"Type"} value={ type } choices={ typeChoices } onChange={ setType } sx={{ flex: 1 }} />
                                    <SelectInput id="print-send-mailclass" label={"Mail class"} value={ mailClass } choices={ mailClassChoices } onChange={ setMailClass } sx={{ flex: 1 }} />
                                    <TextInput id="print-send-recipients" label={"Recipients"} value={ recipients } onChange={ setRecipients } />
                                </Stack>
                                <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center", justifyContent: "space-between" }}>
                                    <Button variant="contained" startIcon={ pricing ? <CircularProgress size={ 16 } color="inherit" /> : <RequestQuoteOutlinedIcon /> }
                                            disabled={ pricing } onClick={ () => void onCostPreview() }>
                                        { pricing ? "Estimating…" : "Estimate" }
                                    </Button>
                                    { costResult &&
                                        <Typography variant="body2">
                                            { appmodel.ui.locale.currency( costResult.totalCents / 100, 2 ) }
                                            {` total (${ appmodel.ui.locale.currency( costResult.perPieceCents / 100, 2 ) }/piece) — arrives in ~${ costResult.leadTimeDays } days` }
                                        </Typography> }
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                </Box>

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </>;
}

export namespace SendPrintPanel
{
    export interface Props {}
}

export default SendPrintPanel;
// eof
