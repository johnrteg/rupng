import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, Divider, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useTheme, Theme } from "@mui/material/styles";
import ChevronLeftIcon      from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon     from '@mui/icons-material/ChevronRight';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import SmsOutlinedIcon      from '@mui/icons-material/SmsOutlined';
import EmailOutlinedIcon    from '@mui/icons-material/EmailOutlined';
import PrintOutlinedIcon    from '@mui/icons-material/PrintOutlined';
import RecordVoiceOverOutlinedIcon from '@mui/icons-material/RecordVoiceOverOutlined';
import ShareOutlinedIcon    from '@mui/icons-material/ShareOutlined';
import { Tooltip } from "@mui/material";

import { DayPilotCalendar, DayPilotMonth, DayPilot } from "@daypilot/daypilot-lite-react";

import { Access }   from '@repo/system';
import { DateUtils } from '@repo/common';
import { Campaign as CampaignModel } from '@repo/api';   // single-source campaign Status + Channel enums
import AuthPage     from '@widgets/app/AuthPage';
import SelectInput  from '@widgets/core/SelectInput';
import LocaleService from '@model/service/LocaleService';

//
// Schedule — the launch calendar. A card lists campaigns launching soon, and below it a DayPilot calendar
// (month / week views) plots the same launches. STUB: the campaign data is hard-coded here — no API yet —
// so this is the UI shell the real "scheduled campaigns" feed will plug into. Views are limited to month +
// week for now (DayPilot Lite).
//
export function Schedule( props : Schedule.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const theme    : Theme = useTheme();

    const [view,setView]     = React.useState< Schedule.View >( Schedule.View.MONTH );
    const [anchor,setAnchor] = React.useState< Date >( () => new Date() );
    const [weeks,setWeeks]   = React.useState< number >( 2 );   // "launching soon" look-ahead window

    ////////////////////////////////////////////////////////////////////////////////////////////
    // STUB upcoming campaigns (no API yet) — dated relative to today so the calendar always has content
    const campaigns : Array<Schedule.Campaign> = React.useMemo( () => buildStubCampaigns(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build a few placeholder campaigns launching over the next few weeks
    function buildStubCampaigns() : Array<Schedule.Campaign>
    {
        const at : ( days : number ) => Date = ( days : number ) : Date =>
        {
            const date : Date = new Date();
            date.setDate( date.getDate() + days );
            date.setHours( 9, 0, 0, 0 );
            return date;
        };
        const list : Array<Schedule.Campaign> =
        [
            { id: "c1", name: "Summer Sale Blast",    launchAt: at( 1 ),  status: CampaignModel.Status.SCHEDULED, channels: randomChannels() },
            { id: "c2", name: "Back-to-School SMS",   launchAt: at( 4 ),  status: CampaignModel.Status.SCHEDULED, channels: randomChannels() },
            { id: "c3", name: "VIP Early Access",     launchAt: at( 8 ),  status: CampaignModel.Status.IN_REVIEW, channels: randomChannels() },
            { id: "c4", name: "Fall Launch Teaser",   launchAt: at( 15 ), status: CampaignModel.Status.DRAFT,     channels: randomChannels() },
            { id: "c5", name: "Loyalty Rewards Drop", launchAt: at( 23 ), status: CampaignModel.Status.SCHEDULED, channels: randomChannels() },
        ];
        return list.sort( ( a : Schedule.Campaign, b : Schedule.Campaign ) => a.launchAt.getTime() - b.launchAt.getTime() );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // STUB: a random non-empty subset of channels for a campaign (placeholder until the API supplies them)
    function randomChannels() : Array<CampaignModel.Channel>
    {
        const all : Array<CampaignModel.Channel> = [ CampaignModel.Channel.EMAIL, CampaignModel.Channel.TEXTING, CampaignModel.Channel.PRINT, CampaignModel.Channel.VOICE ];
        const picked : Array<CampaignModel.Channel> = all.filter( () => Math.random() < 0.5 );
        return picked.length > 0 ? picked : [ CampaignModel.Channel.EMAIL ];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the MUI icon representing a campaign channel (with a tooltip label)
    function channelIcon( channel : CampaignModel.Channel ) : JSX.Element
    {
        const icon : JSX.Element =
              channel === CampaignModel.Channel.EMAIL   ? <EmailOutlinedIcon fontSize="small" />
            : channel === CampaignModel.Channel.TEXTING ? <SmsOutlinedIcon fontSize="small" />
            : channel === CampaignModel.Channel.PRINT   ? <PrintOutlinedIcon fontSize="small" />
            : channel === CampaignModel.Channel.SOCIAL  ? <ShareOutlinedIcon fontSize="small" />
            :                                             <RecordVoiceOverOutlinedIcon fontSize="small" />;
        return  <Tooltip key={ channel } title={ channel }>
                    <Box sx={{ display: "inline-flex", color: "text.secondary" }}>{ icon }</Box>
                </Tooltip>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a theme color for a campaign status (DayPilot needs a real color string — pull it from the theme)
    function statusColor( status : CampaignModel.Status ) : string
    {
        switch( status )
        {
            case CampaignModel.Status.SCHEDULED: return theme.palette.primary.main;
            case CampaignModel.Status.SENDING:   return theme.palette.info.main;
            case CampaignModel.Status.SENT:      return theme.palette.success.main;
            case CampaignModel.Status.IN_REVIEW:
            case CampaignModel.Status.APPROVED:  return theme.palette.warning.main;
            default:                             return theme.palette.text.disabled;   // draft / paused / canceled / failed / archived / partially_sent
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a MUI Chip color for a campaign status
    function statusChipColor( status : CampaignModel.Status ) : "primary" | "warning" | "success" | "default"
    {
        switch( status )
        {
            case CampaignModel.Status.SCHEDULED:
            case CampaignModel.Status.APPROVED:  return "primary";
            case CampaignModel.Status.IN_REVIEW: return "warning";
            case CampaignModel.Status.SENT:      return "success";
            default:                             return "default";
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // local ISO (no timezone suffix so DayPilot plots the wall-clock time we set)
    function toIso( date : Date ) : string
    {
        const pad : ( n : number ) => string = ( n : number ) : string => String( n ).padStart( 2, "0" );
        return `${ date.getFullYear() }-${ pad( date.getMonth() + 1 ) }-${ pad( date.getDate() ) }T${ pad( date.getHours() ) }:${ pad( date.getMinutes() ) }:00`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function displayDate( date : Date ) : string
    {
        return appmodel.ui.locale.dateTime( date, LocaleService.Format.LONG ) || "";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // move the calendar window: by month in the month view, by week in the week view
    function shift( direction : number ) : void
    {
        setAnchor( ( prev : Date ) =>
        {
            const next : Date = new Date( prev );
            if( view === Schedule.View.MONTH ) next.setMonth( next.getMonth() + direction );
            else                   next.setDate( next.getDate() + direction * 7 );
            return next;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the DayPilot events for the launches (one per campaign, a 1-hour block at its launch time)
    const events : Array<DayPilot.EventData> = campaigns.map( ( campaign : Schedule.Campaign ) =>
    {
        const end : Date = new Date( campaign.launchAt.getTime() + 60 * 60 * 1000 );
        return {
            id:        campaign.id,
            text:      campaign.name,
            start:     toIso( campaign.launchAt ),
            end:       toIso( end ),
            backColor: statusColor( campaign.status ),
            barColor:  statusColor( campaign.status ),
        };
    } );

    const startDate : string = toIso( anchor ).slice( 0, 10 );   // YYYY-MM-DD

    // "launching soon" cutoff — end-of-day, `weeks` weeks out (composed from the shared DateUtils helpers)
    function horizon() : number
    {
        return DateUtils.endOfDay( DateUtils.addDays( new Date(), weeks * 7 ) ).getTime();
    }
    const upcoming : Array<Schedule.Campaign> = campaigns.filter( ( campaign : Schedule.Campaign ) => campaign.launchAt.getTime() <= horizon() );

    const windowChoices : Array<SelectInput.Choice> =
    [
        { value: "1", label: "1 week" },
        { value: "2", label: "2 weeks" },
        { value: "4", label: "4 weeks" },
        { value: "8", label: "8 weeks" },
    ];

    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Schedule"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Stack spacing={ 2 }>

                        {/* ── Launching soon ───────────────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader
                                title={"Launching soon"}
                                subheader={"Campaigns scheduled to go out within the selected window."}
                                action={ <Box sx={{ mt: 1, mr: 1 }}>
                                             <SelectInput id="soon-window" label={"Window"} value={ String( weeks ) } choices={ windowChoices }
                                                          onChange={ ( value : string ) => setWeeks( Number( value ) ) } sx={{ width: 140 }} />
                                         </Box> } />
                            <Divider />
                            <CardContent>
                                { upcoming.length === 0
                                    ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No campaigns launching in this window."}</Typography>
                                    : <Stack spacing={ 1 } divider={ <Divider flexItem /> }>
                                        { upcoming.map( ( campaign : Schedule.Campaign ) =>
                                            <Stack key={ campaign.id } direction="row" spacing={ 2 } sx={{ alignItems: "center", justifyContent: "space-between" }}>
                                                <Stack direction="row" spacing={ 1.5 } sx={{ alignItems: "center", minWidth: 0 }}>
                                                    <CampaignOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
                                                    <Typography variant="body2" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ campaign.name }</Typography>
                                                </Stack>
                                                <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center", flexShrink: 0 }}>
                                                    <Stack direction="row" spacing={ 0.5 } sx={{ alignItems: "center" }}>
                                                        { campaign.channels.map( ( channel : CampaignModel.Channel ) => channelIcon( channel ) ) }
                                                    </Stack>
                                                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{ displayDate( campaign.launchAt ) }</Typography>
                                                    <Chip size="small" variant="outlined" color={ statusChipColor( campaign.status ) } label={ campaign.status } />
                                                </Stack>
                                            </Stack> ) }
                                      </Stack>
                                }
                            </CardContent>
                        </Card>

                        {/* ── Calendar (month / week) ──────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader
                                title={"Calendar"}
                                action={
                                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", mt: 1, mr: 1 }}>
                                        <Button size="small" onClick={ () => shift( -1 ) } startIcon={ <ChevronLeftIcon /> }>{"Prev"}</Button>
                                        <Button size="small" onClick={ () => setAnchor( new Date() ) }>{"Today"}</Button>
                                        <Button size="small" onClick={ () => shift( 1 ) } endIcon={ <ChevronRightIcon /> }>{"Next"}</Button>
                                        <ToggleButtonGroup size="small" exclusive value={ view }
                                                           onChange={ ( _event, next : Schedule.View | null ) => { if( next ) setView( next ); } }>
                                            <ToggleButton value={ Schedule.View.MONTH }>{"Month"}</ToggleButton>
                                            <ToggleButton value={ Schedule.View.WEEK }>{"Week"}</ToggleButton>
                                        </ToggleButtonGroup>
                                    </Stack>
                                } />
                            <Divider />
                            <CardContent>
                                { view === Schedule.View.MONTH
                                    ? <DayPilotMonth
                                                    startDate={ startDate }
                                                    events={ events }
                                                    eventBarVisible={ false } />
                                    : <DayPilotCalendar viewType="Week"
                                                    startDate={ startDate }
                                                    events={ events }
                                                    headerHeight={ 30 }
                                                    cellHeight={ 24 } /> }
                            </CardContent>
                        </Card>

                    </Stack>
                </Box>
            </AuthPage>;
}

export namespace Schedule
{
    /** Calendar view mode — a pure UI toggle (not a model concept). */
    export enum View { MONTH = "month", WEEK = "week" }

    export interface Campaign
    {
        id       : string;
        name     : string;
        launchAt : Date;
        status   : CampaignModel.Status;          // the campaign lifecycle enum (single source, @repo/api)
        channels : Array<CampaignModel.Channel>;  // the campaign channel enum (single source, @repo/api)
    }

    export interface Props
    {
    }
}

export default Schedule;
// eof
