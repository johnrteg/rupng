//
import React from 'react';
import { JSX } from "react";

//
import Typography   from '@mui/material/Typography';
import ListItem     from '@mui/material/ListItem';
import Stack        from '@mui/material/Stack';
import Card         from '@mui/material/Card';
import CardContent  from '@mui/material/CardContent';
import Box          from '@mui/material/Box';
import { Theme, useTheme } from '@mui/material';


// icons
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import BrowserUtils from '../../../utils/BrowserUtils';
import AppModel from '../../../model/AppModel';
import { FileUtils, StringUtils } from '@repo/common';
import MediaInput from '../../core/MediaInput';
import HtmlInput from '../../core/HtmlInput';
import ButtonIcon from '../../core/ButtonIcon';



//

//
//
//
export function ChatListItem( props : ChatListItem.Props ) : JSX.Element
{
    const appdata   : AppModel = AppModel.instance();
    const theme     : Theme = useTheme();
    
    const [message,setMessage]      = React.useState< string >( "" );
    const [showMore,setShowMore]    = React.useState< boolean >( false );

    React.useEffect( componentLoaded, [props.message] );

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        let clean_message : string = props.message;

        //console.log("ChatListItem", clean_message );
        // if plain, convert to html for display
        if( !BrowserUtils.isHtml( props.message ) )
        {
            clean_message = BrowserUtils.toHtml( props.message );
        }
        setMessage( BrowserUtils.normalizeHtml( clean_message ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onMoreInfo() : void
    {
        setShowMore( !showMore );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderStatus() : Array<JSX.Element> | null
    {
        const TEXTER_STATUSES : Array<string> = ["sent", "received"];
        //const visibleStatuses : Array<string> = appdata.auth.isTexter()  ? props.status.filter( ( status : string ) => TEXTER_STATUSES.includes( status.toLowerCase() ) ) : props.status;

/*
        if( visibleStatuses.length > 0 )
        {
            let elements : Array<JSX.Element> = [];
            visibleStatuses.forEach( ( str : string, index : number ) =>
            {
                //index === 0 ? theme.palette.primary.main : theme.palette.text.primary  } } >
                elements.push( <Typography variant="caption"
                                            key={ index.toString() }
                                            sx={  { pr    : index === visibleStatuses.length - 1 ? 1 : 0,
                                                    color : theme.palette.text.secondary } } >
                                    { str }
                                </Typography> );
                
                // add vertical bar if not the last one 
                if( index < visibleStatuses.length - 1 )
                {
                    elements.push( <Typography variant="caption"
                                                key={ "bar-" + index.toString() }
                                                sx={{color:"text.secondary"}}>{ "|" }</Typography> );
                }
            } );
            return elements;
        }
        else
        {
            return null;
        }  
        */
        return null;                              
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function showInfo() : JSX.Element | null
    {
        if( props.info !== undefined )
        {
            let elements : Array<JSX.Element> = [];
            let keys     : Array<string> = Object.keys( props.info );

            keys.forEach( ( key : string ) =>
            {
                if( props.info[key] === undefined ) return;
                elements.push( <Typography key={ key }
                                sx={ { color: theme.palette.warning.contrastText, fontSize: props.fontSize !== undefined ? props.fontSize : 14 } }
                                id={ props.id + "-" + key  }>{ StringUtils.toMixedCase( key ) + ": " + props.info[key] }</Typography> )
            } );
       
            return  <Stack direction="row" sx={{ width: "100%", justifyContent: "center" }}>
                        
                        <Card   variant="outlined"
                                sx={ { width: "75%", p: 0, backgroundColor: theme.palette.warning.light } } >

                            { /* note: the "&:last-child": { pb: 1 } removes/sets padding on list item in the card */ }
                            <CardContent sx={ { pt: 1.2, px: 1.5, pb: 0, m: 0, "&:last-child": { pb: 1 } } }>
                                { elements }
                            </CardContent>
                        </Card>


                    </Stack>;
        }
        else
        {
            return null;
        }
        
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function body() : JSX.Element
    {
        //console.log('body', props );

        // see if mesage is an image url
        if( BrowserUtils.isImageUrl( props.message ) )
        {
            return <MediaInput  id={'image'}
                                value={ { path: props.message, mime: FileUtils.parseMime( props.message ), size: FileUtils.UNKNONW_FILE_SIZE } }
                            />
        }
        else
        {

            return <Stack direction="column" spacing={ 0 } sx={ { p : 0, width: "100%", boxSizing: "border-box" } } >

                        { /* --------------------------- optional media -----------------------------  */ }
                        { props.media ?
                        <Box sx={{ display: "flex", justifyContent: "center" }}>
                            <MediaInput id={'image'}
                                        value={ props.media }
                                        thumbnail={ props.thumbnail }
                                        sx={ { p : 1, maxWidth: props.maxMediaWidth !== undefined ? props.maxMediaWidth : "100%", boxSizing: "border-box" } }/>
                        </Box> : null }

                    { /* ------------------------------ body text --------------------------------  */ }
                    <HtmlInput id="html"
                                textColor={ props.side === ChatListItem.Side.RIGHT ? theme.palette.primary.contrastText : theme.palette.text.primary }
                                value={ message }/>

                </Stack>;
        }
    }

    // ================================================================================================================================  

    let color : string = props.side === ChatListItem.Side.RIGHT ? theme.palette.primary.main : theme.palette.background.default;
    if( props.disabled !== undefined && props.disabled === true )color = theme.palette.grey[500];

    return (    <section>
                <ListItem key={ props.id } sx={ { width: "100%", px: 0, boxSizing: "border-box" } } >

                    <Stack direction="column" spacing={0.5} sx={ { width: "100%" } }>

                        { /* ----------------------------- above the message ------------------------------ */ }
                        
                        { props.from !== undefined ?
                        <Stack  direction="row"
                                spacing={1}
                                sx={ {  px: 2,
                                        justifyContent: props.side === ChatListItem.Side.RIGHT ? "flex-end" : "flex-start" } }>
                            <Typography sx={ { color: props.onWhiteBg ? "#000000" : theme.palette.text.secondary } }>{ props.from }</Typography>
                        </Stack>
                        : null }
                        
                        

                        { /* --------------------------------- the message -------------------------------- */ }
                        <Stack  direction="row"
                                spacing={0}
                                sx={ { width: "100%", alignItems: "flex-start", justifyContent: props.side === ChatListItem.Side.RIGHT ? "flex-end" : "flex-start"} }>

                            { /* --------------------------------- left arrow -------------------------------- */ }
                            { props.side === ChatListItem.Side.LEFT ?
                                <Box    sx={{
                                                width: 12,
                                                height: 0,
                                                borderTop: "10px solid transparent",
                                                borderBottom: "10px solid transparent",
                                                borderRight: "12px solid " + color,
                                                position: "relative",
                                                left: -12,
                                                mt: 1.2,
                                                zIndex: 1,
                                             }}
                                /> : null
                            }
                    
                            <Card   variant="outlined"
                                    sx={ {  width           : props.width ? props.width : "80%",
                                            p               : 0,
                                            backgroundColor : color,
                                            position        : "relative",
                                            border          : "none",
                                            boxShadow       : "none",
                                            borderRadius    : 2,
                                            right           : props.side === ChatListItem.Side.RIGHT ? -12 : 12 } } >

                                { /* note: the "&:last-child": { pb: 1 } removes/sets padding on list item in the card */ }
                                <CardContent sx={ { pt: 1.2, px: 1.5, pb: 0, "&:last-child": { pb: 1 } } }>
                                    { body() }
                                </CardContent>
                            </Card>

                            { /* --------------------------------- right arrow -------------------------------- */ }
                            { props.side === ChatListItem.Side.RIGHT ?
                                <Box
                                    sx={{
                                        width: 12,
                                        height: 0,
                                        borderTop: "10px solid transparent",
                                        borderBottom: "10px solid transparent",
                                        borderLeft: "12px solid",
                                        borderLeftColor: color,
                                        position: "relative",
                                        right: -12,
                                        mt: 1.2,
                                        zIndex: 1,
                                    }}
                                /> : null }

                        </Stack>

                        { /* ----------------------------- more info ------------------------------ */ }
                        { showMore ? showInfo() : null }

                        { /* ----------------------------- below the message ------------------------------ */ }
                        
                        <Stack  direction="row"
                                spacing={1}
                                sx={ {  width           : "100%",
                                        alignItems      : "center",
                                        pl              : props.side === ChatListItem.Side.RIGHT ? 0 : 2,
                                        justifyContent  : props.side === ChatListItem.Side.RIGHT ? "flex-end" : "flex-start" } }>

                                { props.statusIcon ? props.statusIcon : null }
                                { renderStatus() }
                                    
                                { props.info !== undefined && ( props.hideInfo === undefined || props.hideInfo === false ) ?
                                        <ButtonIcon id={ props.id + "-info" }
                                                    icon={ <InfoOutlinedIcon color="primary" /> }
                                                    label={ "More Information" + StringUtils.ELLIPSE }
                                                    size="small"
                                                    onClick={ onMoreInfo } /> : null }


                                    { props.date ?
                                        <section>
                                        <Typography variant="caption" sx={ { color: theme.palette.text.secondary } }>{ appdata.ui.locale.date_time_normal.format( props.date ) }</Typography>
                                        <Typography variant="caption" sx={ { pr : 2, color: theme.palette.text.secondary } }>{ StringUtils.format( " ( {0} )", StringUtils.getRelativeTime( props.date ) ) }</Typography>
                                        </section>
                                    : null }
                                
                        </Stack>

                    </Stack>
                        
                </ListItem>

                { /* -------------------------------------------- popups ---------------------------------------------- 
                { showImageViewer ? <ImageViewer label={"Image"} value={ showImageViewer } onClose={ () => setShowImageViewer( undefined ) } /> : null } */ }
            
            
            </section>
    );
}

export namespace ChatListItem
{
    export enum Side
    {
        LEFT = "left",
        RIGHT = "right"
    }

    //
    //
    export interface Message
    {
        id              : string;
        from?           : string;
        date            : Date | null;
        media?          : FileUtils.File;
        disabled?       : boolean;
        thumbnail?      : string;
        message         : string;       // can be a url to image
        status          : Array<string>;
        statusIcon?     : JSX.Element;
        info?           : any;
        fontSize?       : number;
        maxMediaWidth?  : string;
        side            : ChatListItem.Side;
        width?          : string;
        hideInfo?       : boolean;
    }

    export interface Props extends Message
    {
        onWhiteBg   : boolean;
    }
}


export default ChatListItem;

// eof
