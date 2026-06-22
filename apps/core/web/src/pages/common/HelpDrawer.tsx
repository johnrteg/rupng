//
import React from 'react';
import { JSX } from "react";
//import ReactGA from "react-ga4";

//
import Stack from '@mui/material/Stack';
import { Drawer, Box, Divider, CircularProgress } from '@mui/material';

// icons
import CancelOutlinedIcon               from '@mui/icons-material/CancelOutlined';
import OpenInNewOutlinedIcon            from '@mui/icons-material/OpenInNewOutlined';
import PanoramaWideAngleOutlinedIcon    from '@mui/icons-material/PanoramaWideAngleOutlined';
import PanoramaHorizontalOutlinedIcon   from '@mui/icons-material/PanoramaHorizontalOutlined';

//import Analytics                        from '@common/utils/Analytics';
import Pusher                           from '@widgets/core/Pusher';
import ButtonIcon                       from '@widgets/core/ButtonIcon';
import TextLabel                        from '@widgets/core/TextLabel';
import Show                             from '@widgets/core/Show';
import HtmlInput                        from '@widgets/core/HtmlInput';
import AppModel from '@model/AppModel';
import PubSubService from '@model/service/PubSubService';
import BrowserUtils from '@utils/BrowserUtils';
import { StringUtils } from '@repo/common';


// api
//import getArticle                       from '@api/support/GetArticle';

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
    const appdata       : AppModel = AppModel.instance();
    
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
        appdata.pubsub.addSubscriber( PubSubService.Type.HELP , onHelpRequest );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function componentUnLoaded() : void
    {
        //window.removeEventListener( 'resize', onWindowResize );
        appdata.pubsub.removeSubscriber( PubSubService.Type.HELP , onHelpRequest );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function openChanged() : void
    {
        openRef.current = open;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onHelpRequest( event : PubSubService.Event ) : void
    {
        if( appdata.cache.tracker )
        {
            //ReactGA.send({ hitType: Analytics.Type.PAGE, page: event });
        }

        //console.log('onHelpRequest', event );
        loadArticle( event );
        
        //setUrl( HelpLinks.HOST + event );
        setOpen( !openRef.current );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    async function loadArticle( id : string ) : Promise<void>
    {
    /*
        const params  : getArticle.Parameters = { id : id };
        const response : RestfulService.Reply = await appdata.server.get( getArticle.PATH, params );
        if( response.ok )
        {
            const article : getArticle.Article = ( response.data ).article;
            //console.log( article );

            setUrl( article.html_url );
            setHtml( BrowserUtils.normalizeHtml( article.body ) );
            setTitle( article.title );
            setUpdated( appdata.ui.locale.dateTime( DateUtils.parse( article.updated_at ), Localize.Format.MEDIUM ) );
        }
        else
        {
            setTitle( appdata.ui.locale.label( 'dialogs.help.not_found' )  );
        }
        */
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
                    slotProps={{ paper: { sx: { zIndex: 20001, width: expanded ? BrowserUtils.isDesktop ? 750 : "100%" : BrowserUtils.isDesktop ? 500 : "100%" } } }}

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
                                    label={ appdata.ui.locale.label( 'dialogs.help.expand' ) }
                                    icon={ expanded ? <PanoramaHorizontalOutlinedIcon /> : <PanoramaWideAngleOutlinedIcon /> } onClick={ onExpand } />
                        <ButtonIcon id="open"
                                    label={ appdata.ui.locale.label( 'common.button.open' ) }
                                    icon={ <OpenInNewOutlinedIcon /> } onClick={ onOpen } />
                        <ButtonIcon id="close"
                                    label={ appdata.ui.locale.label( 'common.button.close' ) }
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
                    
                    <Show show={ updated !== "" }>
                        <TextLabel variant="caption" value={ StringUtils.format( "{0}: {1}", appdata.ui.locale.label( 'dialogs.help.updated' ), updated ) } />
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