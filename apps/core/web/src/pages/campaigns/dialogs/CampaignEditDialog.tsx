//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, FormControlLabel, Stack, Switch, Typography } from "@mui/material";

import { Campaign, Account } from '@repo/api';
import { Type } from '@repo/common';

import DialogWindow    from '@widgets/core/DialogWindow';
import TextInput       from '@widgets/core/TextInput';
import CurrencyInput   from '@widgets/core/CurrencyInput';
import SelectMultInput from '@widgets/core/SelectMultInput';
import PaletteEditor   from '@widgets/core/PaletteEditor';
import BrandFontEditor from '@widgets/core/BrandFontEditor';
import BrandSvgEditor  from '@widgets/core/BrandSvgEditor';

// soft-alert threshold choices (percent of the hard cap). Pure constant → module scope.
const ALERT_CHOICES : Array<SelectMultInput.Choice> =
[
    { value: "50", label: "50%" },
    { value: "75", label: "75%" },
    { value: "80", label: "80%" },
    { value: "90", label: "90%" },
    { value: "95", label: "95%" },
];

// the wizard step nav (title + sub-label) — a NUMBERED left rail like the legacy Self-Send editor. Only the
// built sections (Details, Budget) have content today; the rest are placeholders that fill in as they land.
const STEPS : Array<{ title : string; detail : string; ready : boolean }> =
[
    { title: "Details",           detail: "Name, objective, and channels",       ready: true },
    { title: "Budget",            detail: "Spend caps and alert thresholds",     ready: true },
    { title: "Theme",             detail: "Brand colors for content + imagery",  ready: true },
    { title: "Audience",          detail: "Who the campaign targets",            ready: false },
    { title: "Message",           detail: "Content per channel",                 ready: false },
    { title: "Schedule",          detail: "When it sends",                       ready: false },
    { title: "Approvals",         detail: "Review and sign-off",                 ready: false },
];

//
// CampaignEditDialog — create OR edit a campaign. A NUMBERED step nav (left) selects a section; a top bar holds
// the campaign Name, an Advanced toggle, and the status chip — matching the house wizard shell. Only Details +
// Budget are built today; later steps (audience, message, schedule, approvals) slot into the same rail. The
// parent owns open/close + the POST (create) / PATCH (edit) in onSave; this dialog owns its form state.
//
export function CampaignEditDialog( props : CampaignEditDialog.Props ) : JSX.Element
{
    const editing : boolean = props.campaign !== undefined;

    const [section,setSection]     = React.useState< number >( 0 );
    const [advanced,setAdvanced]   = React.useState< boolean >( false );
    const [name,setName]           = React.useState< string >( props.campaign?.name ?? "" );
    const [objective,setObjective] = React.useState< string >( props.campaign?.objective ?? "" );
    const [channels,setChannels]   = React.useState< Array<string> >( ( props.campaign?.channels ?? [] ).filter( ( config : Campaign.ChannelConfig ) : boolean => config.enabled ).map( ( config : Campaign.ChannelConfig ) : string => config.channel ) );
    const [hardCapCents,setHardCap] = React.useState< Type.Cents >( props.campaign?.budget?.hardCapCents ?? 0 );
    const [alertPcts,setAlertPcts] = React.useState< Array<string> >( ( props.campaign?.budget?.alertThresholdPcts ?? [] ).map( ( pct : number ) : string => String( pct ) ) );
    const [palette,setPalette]     = React.useState< Array<string> >( props.campaign?.palette ?? [] );
    const [fonts,setFonts]         = React.useState< Array<Account.BrandFont> >( props.campaign?.fonts ?? [] );
    const [svgs,setSvgs]           = React.useState< Array<Account.BrandSvg> >( props.campaign?.svgs ?? [] );

    // channel picker choices — straight off the model enum (single source)
    const channelChoices : Array<SelectMultInput.Choice> = Object.values( Campaign.Channel )
        .map( ( channel : Campaign.Channel ) : SelectMultInput.Choice => ( { value: channel, label: channel } ) );

    // the campaign's status → the top-bar chip (a new campaign is a Draft)
    const status : string = props.campaign?.status ?? "draft";

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build the channel configs for the selected channels — keep an existing config's strategy/plans, else seed
    // a default blast strategy for a newly-added channel
    function toChannelConfigs() : Array<Campaign.ChannelConfig>
    {
        return channels.map( ( channel : string ) : Campaign.ChannelConfig =>
        {
            const existing : Campaign.ChannelConfig | undefined = ( props.campaign?.channels ?? [] ).find( ( config : Campaign.ChannelConfig ) : boolean => config.channel === channel );
            if( existing ) return { ...existing, enabled: true };
            return { channel: channel as Campaign.Channel, enabled: true, strategy: { cadence: Campaign.Cadence.BLAST }, plans: [] };
        } );
    }

    // assemble the budget (undefined when nothing is set — an uncapped campaign)
    function toBudget() : Campaign.Budget | undefined
    {
        const capCents : Type.Cents | undefined = hardCapCents > 0 ? hardCapCents : undefined;
        const pcts : Array<number> = alertPcts.map( ( pct : string ) : number => Number( pct ) );
        if( capCents === undefined && pcts.length === 0 ) return undefined;
        return { hardCapCents: capCents, alertThresholdPcts: pcts.length > 0 ? pcts : undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        return props.onSave( {
            name:      name.trim(),
            objective: objective.trim() || undefined,
            channels:  toChannelConfigs(),
            budget:    toBudget(),
            palette:   palette,
            fonts:     fonts,
            svgs:      svgs,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one numbered step in the left rail — a circular number badge + title/sub-label; dims a not-yet-built step
    function stepRow( index : number, step : { title : string; detail : string; ready : boolean } ) : JSX.Element
    {
        const selected : boolean = section === index;
        return  <Stack key={ step.title } direction="row" spacing={ 1.25 }
                       onClick={ () : void => setSection( index ) }
                       sx={{ alignItems: "flex-start", p: 1, borderRadius: 1, cursor: "pointer",
                             bgcolor: selected ? "action.selected" : "transparent",
                             "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" } }}>
                    <Box sx={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                               bgcolor: selected ? "primary.main" : "action.disabledBackground",
                               color: selected ? "primary.contrastText" : "text.secondary", fontSize: 13, fontWeight: 600 }}>
                        { index + 1 }
                    </Box>
                    <Stack spacing={ 0 } sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: step.ready ? "text.primary" : "text.disabled" }}>{ step.title }</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{ step.detail }</Typography>
                    </Stack>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="campaign-edit"
                          title={ editing ? "Edit campaign" : "Create campaign" }
                          yesLabel={ editing ? "Save" : "Create campaign" }
                          cancelLabel={"Cancel"}
                          minWidth="md"
                          ready={ name.trim() !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 0 } sx={{ minHeight: 380 }}>

                    {/* top bar — campaign name, Advanced toggle, and the status chip */}
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2, pb: 1 }}>
                        <Box sx={{ flexGrow: 1 }}>
                            <TextInput id="campaign-name" label={"Name"} value={ name } onChange={ setName } maxLength={ 140 } fullWidth placeHolder={"e.g. Summer Sale Blast"} />
                        </Box>
                        <FormControlLabel control={ <Switch checked={ advanced } onChange={ ( _event : React.SyntheticEvent, checked : boolean ) : void => setAdvanced( checked ) } /> } label={"Advanced"} />
                        <Chip size="small" variant="outlined" label={ status } sx={{ textTransform: "capitalize" }} />
                    </Stack>

                    <Stack direction="row" spacing={ 0 } sx={{ flexGrow: 1, borderTop: 1, borderColor: "divider" }}>
                        {/* left rail — numbered step nav */}
                        <Stack spacing={ 0.5 } sx={{ minWidth: 220, p: 1, borderRight: 1, borderColor: "divider" }}>
                            { STEPS.map( ( step : { title : string; detail : string; ready : boolean }, index : number ) : JSX.Element => stepRow( index, step ) ) }
                        </Stack>

                        {/* section content */}
                        <Box sx={{ flexGrow: 1, p: 2, minWidth: 0 }}>
                            {/* ── 1 · Details ─────────────────────────────────────────────────────────── */}
                            { section === 0 &&
                                <Stack spacing={ 2 }>
                                    <TextInput id="campaign-objective" label={"Objective"} value={ objective } onChange={ setObjective } maxLength={ 500 } fullWidth placeHolder={"What this campaign is trying to achieve"} />
                                    <SelectMultInput id="campaign-channels" label={"Channels"} value={ channels } choices={ channelChoices } onChange={ setChannels } minWidth="100%" />
                                </Stack> }

                            {/* ── 2 · Budget ──────────────────────────────────────────────────────────── */}
                            { section === 1 &&
                                <Stack spacing={ 2 }>
                                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{"The cross-channel cost authority — a hard stop plus optional soft-alert thresholds. Leave the cap at 0 for uncapped."}</Typography>
                                    <CurrencyInput id="campaign-budget-cap" label={"Hard cap"} value={ hardCapCents } onChange={ setHardCap } />
                                    <SelectMultInput id="campaign-budget-alerts" label={"Alert thresholds (% of cap)"} value={ alertPcts } choices={ ALERT_CHOICES } onChange={ setAlertPcts } minWidth="100%" />
                                </Stack> }

                            {/* ── 3 · Theme (brand palette) ─────────────────────────────────────────────── */}
                            { section === 2 &&
                                <Stack spacing={ 3 }>
                                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Brand colors, fonts, and graphics for this campaign's content, image editor, and image search."}</Typography>
                                    <PaletteEditor label={"Colors"} value={ palette } onChange={ setPalette } />
                                    <BrandFontEditor label={"Fonts"} value={ fonts } onChange={ setFonts } />
                                    <BrandSvgEditor label={"Graphics"} value={ svgs } onChange={ setSvgs } />
                                </Stack> }

                            {/* ── later steps — placeholders until built ──────────────────────────────── */}
                            { section > 2 &&
                                <Stack sx={{ alignItems: "center", justifyContent: "center", minHeight: 240, textAlign: "center", color: "text.secondary" }}>
                                    <Typography variant="subtitle1">{ STEPS[ section ].title }</Typography>
                                    <Typography variant="body2" sx={{ mt: 0.5, maxWidth: 420 }}>{ `${ STEPS[ section ].detail } — coming soon.` }</Typography>
                                </Stack> }
                        </Box>
                    </Stack>
                </Stack>
            </DialogWindow>;
}

export namespace CampaignEditDialog
{
    /** The editable subset the dialog collects (name required; the rest optional). */
    export interface Draft
    {
        name       : string;
        objective? : string;
        channels   : Array<Campaign.ChannelConfig>;
        budget?    : Campaign.Budget;
        palette    : Array<string>;                // brand color palette (ordered hex values)
        fonts      : Array<Account.BrandFont>;     // brand fonts (public web-font references)
        svgs       : Array<Account.BrandSvg>;      // brand SVG graphics (inline markup)
    }

    export interface Props
    {
        campaign? : Campaign.Entity;                       // present → edit (PATCH); absent → create (POST)
        onSave    : ( draft : Draft ) => Promise<boolean>;
        onClose   : () => void;
    }
}

export default CampaignEditDialog;
