//
import React from 'react';
import { JSX } from "react";

//
import Stack from '@mui/material/Stack';
import { Drawer, Box, Divider, CircularProgress } from '@mui/material';

// icons
import CancelOutlinedIcon               from '@mui/icons-material/CancelOutlined';
import OpenInNewOutlinedIcon            from '@mui/icons-material/OpenInNewOutlined';
import PanoramaWideAngleOutlinedIcon    from '@mui/icons-material/PanoramaWideAngleOutlined';
import PanoramaHorizontalOutlinedIcon   from '@mui/icons-material/PanoramaHorizontalOutlined';


// api
import { GetArticle } from '@repo/api';
import { useIsDesktop } from '../../utils/useBreakpoint';
import AppModel from '../../model/AppModel';
import LocaleService from '../../model/service/LocaleService';
import { RestfulService } from '@repo/endpoint';
import { DateUtils, StringUtils } from '@repo/common';
import BrowserUtils from '../../utils/BrowserUtils';
import Pusher from '../core/Pusher';
import ButtonIcon from '../core/ButtonIcon';
import TextLabel from '../core/TextLabel';
import HtmlInput from '../core/HtmlInput';
import Show from '../core/Show';
import PubSubService from '../../model/service/PubSubService';

declare global
{
    interface Window
    {
        zE?: any;
    }
}


//
export function HelpDrawer( props : HelpDrawer.Props ) : JSX.Element
{
    const appmodel       : AppModel = AppModel.instance();
    const isDesktop      : boolean = useIsDesktop();
    
    const [open,setOpen]            = React.useState< boolean >( false );
    const [url,setUrl]              = React.useState< string >( "" );
    const [title,setTitle]          = React.useState< string >( "" );
    const [html,setHtml]            = React.useState< string >( "" );
    const [updated,setUpdated]      = React.useState< string >( "" );
    const [expanded,setExpanded]    = React.useState< boolean >( false );

    const openRef                   = React.useRef<boolean>(open);
    //const newTicket                 = React.useRef<string>( Rup.Constants.NEWTICKET_URL );

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( () => ()=> componentUnLoaded(), [] );
    React.useEffect( openChanged, [open] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        // can't use <Subscribere since it is not rendereed when the drawer is closed
        // have to manage it the old fashion way
        appmodel.pubsub.addSubscriber( PubSubService.Type.HELP , onHelpRequest );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function componentUnLoaded() : void
    {
        //window.removeEventListener( 'resize', onWindowResize );
        appmodel.pubsub.removeSubscriber( PubSubService.Type.HELP , onHelpRequest );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function openChanged() : void
    {
        openRef.current = open;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onHelpRequest( event : PubSubService.Event ) : void
    {

        //console.log('onHelpRequest', event );
        loadArticle( event );
        
        //setUrl( HelpLinks.HOST + event );
        setOpen( !openRef.current );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    async function loadArticle( id : string ) : Promise<void>
    {
        const reply : RestfulService.Reply<GetArticle.Response> = await appmodel.server.fetch( new GetArticle( id ) );
        const article : GetArticle.Article | undefined = reply.ok ? reply.data?.article : undefined;
        if( article )
        {
            setUrl( article.html_url );
            setHtml( article.body );
            setTitle( article.title );
            setUpdated( appmodel.ui.locale.dateTime( DateUtils.parse( article.updated_at ), LocaleService.Format.MEDIUM ) );
        }
        else
        {
            setTitle( appmodel.label( 'dialogs.help.not_found' ) );
            // for testing
            //setHtml( "<p>The <strong>Dashboard</strong> is the first page you see when you log into your account. It serves as your central hub, giving you a high-level overview of your account's messaging performance, recent activity, and vital account metrics.</p><p><img src=\"https://rumbleup.zendesk.com/hc/article_attachments/50330579770132\" width=\"2048\" height=\"1156\"></p><h2 id=\"h_01KV6Y327PSQF9DJE2J8TY1HW5\"> </h2><h2 id=\"h_01KV6Y3C1A2A9TC8AQSGJ52XXB\"><strong>Top Navigation &amp; Customization</strong></h2><p>The top section of the Dashboard features controls that allow you to customize your view and filter data:</p><ul>\n<li data-list-item-id=\"e94a8a9a209dbbc07f58c0ea9c23e6948\">\n<strong>Project Filter Dropdown:</strong> Located at the top left of the workspace, this allows you to select a specific Project. Selecting a project will filter and update the data shown <em>only</em> in the following tiles: Sent Messages, Replied Messages, Opt-out Messages, Delivered Messages, and Recent Replies. Other tiles remain account-wide.</li>\n<li data-list-item-id=\"ebb46f7e28c86e82888f8e7e4204e6530\">\n<strong>Project Status Filter <img class=\"wysiwyg-image-resized\" style=\"aspect-ratio: 150/150; width: 3.45%;\" src=\"https://rumbleup.zendesk.com/hc/article_attachments/50373114179476\" alt=\"filter icon.svg\" width=\"150\" height=\"150\">:</strong> Located in the top right corner, this button allows you to select which Projects' data are being displayed based on the status of the Project.</li>\n<li data-list-item-id=\"e3cdf4af8a75201cd1828c7e1de09cdac\">\n<strong>Edit Dashboard <img class=\"wysiwyg-image-resized\" style=\"aspect-ratio: 150/150; width: 3.48%;\" src=\"https://rumbleup.zendesk.com/hc/article_attachments/50373114179732\" alt=\"pencil icon.svg\" width=\"150\" height=\"150\">:</strong> Toggles on <strong>Edit Mode</strong>. While in Edit Mode, you can fully customize your layout by rearranging the location of tiles, expanding or contracting their size, or removing tiles completely.</li>\n</ul><h2 id=\"h_01KV6Y327T1ETN8SKZ2R06SYXY\"> </h2><h2 id=\"h_01KV6Y3F3MW5SR3TG78DRY89S7\"><strong>Key Performance Indicators (KPIs)</strong></h2><p>The top row of tiles displays critical messaging metrics. These tiles are strictly informational and are not clickable:</p><div><figure class=\"wysiwyg-table\" style=\"width: 100%;\"><table class=\"wysiwyg-table-resized\">\n<colgroup>\n<col style=\"width: 50%;\">\n<col style=\"width: 50%;\">\n</colgroup>\n<thead><tr>\n<th scope=\"col\"><strong>KPI Tile</strong></th>\n<th scope=\"col\">\n<p><strong>Description</strong></p>\n<p> </p>\n</th>\n</tr></thead>\n<tbody>\n<tr>\n<td><strong>Sent Messages</strong></td>\n<td>The total number of outbound messages sent from the account (or selected Project).</td>\n</tr>\n<tr>\n<td><strong>Replied Messages</strong></td>\n<td>The total number of inbound responses received.</td>\n</tr>\n<tr>\n<td><strong>Opt-out Messages</strong></td>\n<td>The total number of contacts who have opted out of messaging.</td>\n</tr>\n<tr>\n<td><strong>Delivered Messages</strong></td>\n<td>The percentage of messages successfully delivered. This is calculated by dividing total delivered messages by total sent messages (no delivery errors are excluded from this calculation).</td>\n</tr>\n<tr>\n<td><strong>Balance</strong></td>\n<td>Your current available messaging balance. You can add funds to this balance at any time by navigating to the <strong>Billing</strong> page of the account.</td>\n</tr>\n</tbody>\n</table></figure></div><h2 id=\"h_01KV6Y327XBTVW34R1G0J17HZS\"> </h2><h2 id=\"h_01KV6Y3H8J4V0H69P8Y61N9A7E\"><strong>Analytics &amp; Visualizations</strong></h2><h3 id=\"h_01KV6Y327Y7M9YQZQ1QFYN26BH\"><strong>Messages &amp; Replies</strong></h3><p>This bar graph displays your messaging volume, tracking both Sent (blue) and Replied (red) messages.</p><ul>\n<li data-list-item-id=\"e52299e2b4721302ce6a21f6a5089106b\">\n<strong>Timeframe:</strong> This graph is locked to display data from the <strong>previous 7 days</strong>.</li>\n<li data-list-item-id=\"ea67e0b2b043324422c125fd0ed6efc3a\">\n<strong>Interactivity:</strong> Hovering your mouse over any individual day's bar will reveal a popup with the exact counts for sent and replied messages for that day.</li>\n</ul><h3 id=\"h_01KV6Y327YC1KVTAXEA08RJ7DV\"><strong>Messages Type</strong></h3><p>This breakdown chart displays the distribution of your message types across three categories:</p><ul>\n<li data-list-item-id=\"e1d8df953bb698706c3b498189055cb43\">\n<strong>SMS:</strong> Standard text messaging.</li>\n<li data-list-item-id=\"ea0b3c704373935c6aac01d688275c1c2\">\n<strong>MMS:</strong> Multimedia messaging (images, GIFs, audio).</li>\n<li data-list-item-id=\"efed3c85eda25219d491ef9a8994dc565\">\n<strong>EVT:</strong> Enhanced Video Texting.</li>\n</ul><h2 id=\"h_01KV6Y327ZSF2582RFAKEGHZ9R\"> </h2><h2 id=\"h_01KV6Y3KAYZHCBS0JGS88Z3QRP\"><strong>Actionable Widgets</strong></h2><h3 id=\"h_01KV6Y3280EB4VPYX47PE2CTPC\"><strong>Onboarding</strong></h3><p>A checklist designed to help you quickly set up and launch your messaging campaigns. Clicking the buttons next to each task will take you directly to that functional area of the platform:</p><ul>\n<li data-list-item-id=\"ee63251f33cd6489266517206d72a5190\">\n<strong>Import:</strong> Takes you to the contact list import page.</li>\n<li data-list-item-id=\"e8c9a220511b4b95ca275eed204e5d6cc\">\n<strong>Create:</strong> Opens the new Project creation wizard.</li>\n<li data-list-item-id=\"ee407a64196b9a12cb5bf24658319bb9b\">\n<strong>Test:</strong> Directs you to the message testing tool.</li>\n<li data-list-item-id=\"e84108778813096586aa807d22f2091a1\">\n<strong>Review:</strong> Brings you to the account review page.</li>\n</ul><h3 id=\"h_01KV6Y3281YW9CP0C9JE9TKTP8\"><strong>Recent Replies</strong></h3><p>Displays a live feed of the latest incoming responses from your contacts, including the contact's name, project ID, and message timestamp.</p><ul><li data-list-item-id=\"e3eedc504ba15eed91ac4969ff3fd931d\">\n<strong>Interactivity:</strong> Clicking on any specific reply in this list will take you directly to that conversation thread on the <strong>Conversations</strong> page of the account.</li></ul><h3 id=\"h_01KV6Y328175KGTDVQ7SR1BWEJ\"><strong>Texting Tip</strong></h3><p>Provides helpful best practices and platform tips. The content in this section automatically cycles through a pre-set list of tips.</p><h3 id=\"h_01KV6Y3281H82W46345965TP8D\"><strong>Tag Tracking</strong></h3><p>Allows you to monitor specific segments of your audience directly from the main page. You can customize this tile by selecting specific tags from your existing contact tags list to update the information being displayed on the Dashboard.</p>" );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onClose() : void
    {
        setOpen( false );

        setUrl( "" );
        setTitle( "" );
        setHtml( "" );
        setUpdated( "" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onOpen() : void
    {
        BrowserUtils.open( url );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    //function onHelp() : void
    //{
    //    setTicket( !ticket );
    //}

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onExpand() : void
    {
        setExpanded( !expanded );
    }

    // ============================================================================================
    return  <Drawer open={ open }
                    anchor="left"
                    hideBackdrop={true}
                    ModalProps={{
                            disablePortal: true
                        }}
                    sx={{ zIndex: 20000 }} // set on root
                    slotProps={{ paper: { sx: { zIndex: 20001, width: expanded ? isDesktop ? 750 : "100%" : isDesktop ? 500 : "100%" } } }}

                    onClose={ () => onClose() } >

                
                <Stack direction="column" spacing={0} sx={ { pt: 1, pl: 1, pr: 1, pb: 1 } } >
                    <Stack direction="row">
                        <Pusher />

                        {/*}
                        <ButtonIcon id="help"
                                    label={ "Submit Help Desk Ticket" }
                                    icon={ <SupportOutlinedIcon /> } onClick={ onHelp } />
                        */}

                        <ButtonIcon id="expand"
                                    label={ appmodel.label( 'dialogs.help.expand' ) }
                                    icon={ expanded ? <PanoramaHorizontalOutlinedIcon /> : <PanoramaWideAngleOutlinedIcon /> } onClick={ onExpand } />
                        <ButtonIcon id="open"
                                    label={ appmodel.label( 'common.button.open' ) }
                                    icon={ <OpenInNewOutlinedIcon /> } onClick={ onOpen } />
                        <ButtonIcon id="close"
                                    label={ appmodel.label( 'common.button.close' ) }
                                    icon={ <CancelOutlinedIcon /> } onClick={ onClose } />
                    </Stack>

                    <TextLabel variant="h6" value={ title } />
                    <Divider component="li" />

                    <Show show={ html !== "" }>
                        <HtmlInput id="html" value={ html }/>                                   
                    </Show>
                    
                    <Show show={ html === "" }>
                        <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%', py: 2 }}>
                            <CircularProgress />
                        </Box>
                    </Show>
                    
                    <Divider />
                    
                    <Show show={ updated !== "" }>
                        <TextLabel variant="caption" value={ StringUtils.format( "{0}: {1}", appmodel.label( 'dialogs.help.updated' ), updated ) } />
                    </Show>

                </Stack>
            </Drawer>;

}

////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Help drawer displayed to the left when the user selects a help button.  This is an application wide compoent and would never be used individually. 
 *
 */
export namespace HelpDrawer
{
    export interface Props
    {
    }
}

export default HelpDrawer;
// eof