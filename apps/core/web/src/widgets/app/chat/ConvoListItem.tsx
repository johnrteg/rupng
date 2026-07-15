//
import React from 'react';
import { JSX } from "react";

//
import Typography       from '@mui/material/Typography';
import Stack            from '@mui/material/Stack';
import ListItemButton   from '@mui/material/ListItemButton';
import Divider          from '@mui/material/Divider';
import { Box, Button }  from '@mui/material';

// icons
import KeyboardDoubleArrowDownOutlinedIcon  from '@mui/icons-material/KeyboardDoubleArrowDownOutlined';
import KeyboardDoubleArrowUpOutlinedIcon    from '@mui/icons-material/KeyboardDoubleArrowUpOutlined';
import FrontHandOutlinedIcon                from '@mui/icons-material/FrontHandOutlined';
import MarkUnreadChatAltOutlinedIcon        from '@mui/icons-material/MarkUnreadChatAltOutlined';
import SpeakerNotesOffOutlinedIcon          from '@mui/icons-material/SpeakerNotesOffOutlined';
import DraftsOutlinedIcon                   from '@mui/icons-material/DraftsOutlined';
import AnnouncementOutlinedIcon             from '@mui/icons-material/AnnouncementOutlined';
import SendOutlinedIcon                     from '@mui/icons-material/SendOutlined';


//
import AppModel                      from "@model/AppModel";
import LocaleService                 from "@model/service/LocaleService";
import TextLabel from '../../core/TextLabel';
import Pusher from '../../core/Pusher';
import ButtonIcon from '../../core/ButtonIcon';
import { StringUtils } from '@repo/common';


//
//
//
export function ConvoListItem( props : ConvoListItem.Props ) : JSX.Element
{
    const appdata : AppModel = AppModel.instance();

    const [read,setRead]        = React.useState< boolean >( props.read );
    const [unread,setUnRead]    = React.useState< boolean >( props.unread );
    const [resend,setResend]    = React.useState< boolean >( props.resend );

    const [errCode,setErrCode]    = React.useState< string >( props.errCode ? props.errCode : "" );

    React.useEffect( propsReadUpdated, [props.read,props.unread,props.resend] );

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function propsReadUpdated() : void
    {
        setRead( props.read );
        setUnRead( props.unread );
        setResend( props.resend );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick() : void
    {
        if( props.onClick )props.onClick( props.id );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function onProjectButton( event : React.MouseEvent<HTMLButtonElement>, id : string ) : void
    {
        event.stopPropagation();
        props.onShowProject( id ) 
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function projectButtons() : JSX.Element
    {
        if( props.projects === undefined || props.projects === null || props.projects.length === 0 )
        {
            return <TextLabel variant="caption" italic={ true } value={ "(No projects)" } />
        }
        else
        {
            return  <Stack direction="row"  spacing={0.5} sx={ { height: "100%", pt: 0.5, alignItems:"center" } } >
                        <TextLabel variant="caption" value={ "Projects:" } />
                        { props.projects.map( ( id : string ) => {
                            return <Button variant="outlined" key={ id }
                                    size="small"
                                    sx={ { height: 20, px: 0.5, py: 0, minWidth: 'unset', fontSize: '0.85rem' } }
                                    onClick={ ( evt : React.MouseEvent<HTMLButtonElement> ) => onProjectButton( evt, id ) }>
                                { "#" + id }
                            </Button>
                        } ) 
                        }
                    </Stack>;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function onMarkAsOptout() : void
    {
        addTag();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    async function addTag( ) : Promise<void>
    {
        //const ok : boolean = await props.onOptOut( props.id, props.projectId, ConvoUtils.OPTOUT_FLAG );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function onMarkAsRead() : void
    {
        //console.log('onMarkAsRead', props.id, props.projectId );
        setAsRead( true );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    async function setAsRead( value : boolean ) : Promise<void>
    {
        const ok : boolean = await props.onMarkRead( props.id, props.projectId );
        if( ok )
        {
            setRead( true );
            setUnRead( false );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function onToggleErrCode() : void
    {
        if( props.errCode )
        {
            setErrCode( errCode === "" ? props.errCode : "" );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    async function onResend( id : string ) : Promise<void>
    {
        if( await props.onResend( props.id ) )
        {
            setResend( false );
        }
    }

  

    // ===================================================================================================================
    return (    <React.Fragment>
                    <ListItemButton key={ props.id }
                                    selected={ props.selected }
                                    alignItems="flex-start"
                                    sx={ { width: "100%", px: 1.5, boxSizing: "border-box" } } //, maxHeight: 220 } }
                                    onClick={ onClick }>
                        <Stack direction="column" sx={ { width: "100%" } }>


                            { /* -------------------------------- first row --------------------------------- */ }
                            <Stack direction="row" sx={ { width: "100%", alignItems:"center" } }>

                                <Box sx={ { pt: 0.30 } }>
                                    { props.inbound ? <KeyboardDoubleArrowDownOutlinedIcon color="success"/> : <KeyboardDoubleArrowUpOutlinedIcon color="warning" />}
                                </Box>
                                
                                <Typography variant="h6" color={ props.selected ? "primary" : "text.primary" } >{ props.name }</Typography>
                                <Pusher />
                                { read              ? <Typography variant="caption" color="success" sx={{ mr: 1 }}>{ "Read" }</Typography> : null }
                                { unread            ? <Typography variant="caption" color="primary" sx={{ mr: 1 }}>{ "Unread" }</Typography> : null }
                                { props.outStatus !== ""    ? <Typography variant="caption" color="error" sx={{ mr: 1 }}>{ props.outStatus }</Typography> : null}
                                { errCode !== ""    ? <Typography variant="caption" color="error" sx={{ mr: 1 }}>{ errCode }</Typography> : null}
                                { resend && props.selected ? <ButtonIcon id="resend" label={"Resend"} icon={<SendOutlinedIcon />} onClick={ () => onResend( props.id ) } /> : null }
                                { props.undelivered ? <AnnouncementOutlinedIcon color="error" fontSize="small" /*onClick={ () => onToggleErrCode() }*/ /> : null }
                                { props.stop        ? <FrontHandOutlinedIcon color="error" fontSize="small"/> : null }
                                { props.recent      ? <MarkUnreadChatAltOutlinedIcon color="success" fontSize="small" /> : null }
                            </Stack>


                            { /* -------------------------------- second row --------------------------------- */ }
                            <Stack direction="row" spacing={ 0 } sx={ { width: "100%", alignItems: "center" } }>

                                <Typography>{ appdata.ui.locale.phone( props.phone ) }</Typography>
                                
                                <Pusher />
                                 
                                { unread        ? <ButtonIcon id="mark"   label={"Mark as Read"}    icon={ <DraftsOutlinedIcon fontSize="small"/> } onClick={ onMarkAsRead } /> : null }
                                { !props.bad    ? <ButtonIcon id="optout" label={"Mark as Opt-out"} icon={ <SpeakerNotesOffOutlinedIcon fontSize="small"/> } onClick={ onMarkAsOptout } /> : null }
                                {/* --- Approve quarantined last message: $parent.rupid()==rupid&&$parent.canResend() */}
                                <Typography variant="caption" color="text.hint">{ props.tag }</Typography>

                            </Stack>

                            { /* -------------------------------- third row --------------------------------- */ }
                            <Stack direction="row" sx={ { width: "100%" } }>
                                { projectButtons() }
                                <Pusher />
                                <Typography variant="caption">{ appdata.ui.locale.dateTime( props.date, LocaleService.Format.MEDIUM ) }</Typography>
                                
                            </Stack>

                            { /* -------------------------------- messsage --------------------------------- */ }
                            <Typography variant="caption" sx={ { mt: 1, whiteSpace: "pre-line" } }>{ StringUtils.truncate( props.message, props.maxLength ) }</Typography>
                        </Stack>
                        
                    </ListItemButton>
                    <Divider component="li" />
                </React.Fragment>
    );
}


export namespace ConvoListItem
{

    export interface Data
    {
        id          : string;
        inbound     : boolean;
        tag         : string;
        name        : string;
        phone       : string;
        projects    : Array<string>;
        date        : Date | null;
        message     : string;
        stop        : boolean;
        recent      : boolean;
        read        : boolean;
        unread      : boolean;
        bad         : boolean;
        outStatus   : string;
        undelivered : boolean;
        projectId?  : string;
        errCode?    : string;
        resend      : boolean;
    }

    //
    //
    export interface Props extends Data
    {
        selected    : boolean;
        maxLength   : number;

        onClick?        : ( id : string ) => void;
        onShowProject   : ( projectId : string ) => void;
        onMarkRead      : ( id : string, projectId : string | undefined ) => Promise<boolean>;
        onOptOut        : ( id : string, projectId : string | undefined, value : string ) => Promise<boolean>;
        onResend        : ( id : string ) => Promise<boolean>;
    }
}

export default ConvoListItem;

// eof
