//
import React from 'react';
import { JSX } from "react";

//
import Card         from '@mui/material/Card';
import CardContent  from '@mui/material/CardContent';
import Stack        from '@mui/material/Stack';
import Typography   from '@mui/material/Typography';

// icons
import CancelOutlinedIcon               from '@mui/icons-material/CancelOutlined';
import KeyboardArrowDownOutlinedIcon    from '@mui/icons-material/KeyboardArrowDownOutlined';
import KeyboardArrowUpOutlinedIcon      from '@mui/icons-material/KeyboardArrowUpOutlined';

//
import AppModel          from '@model/AppModel';

import ButtonIcon       from '@widgets/core/ButtonIcon';
import Pusher from '../core/Pusher';
import Subscriber from '../core/Subscriber';
import PubSubService from '../../model/service/PubSubService';





enum NotificationSeverity
{
    INFO    = 'info',
    WARNING = 'warning',
    ERROR   = 'error'
}

interface NotificationItem
{
    id          : string;
    title       : string;
    message     : string;
    severity    : NotificationSeverity;
    expanded    : boolean;
}




export function NotificationBar( props : NotificationBar.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const [notifications, setNotifications]     = React.useState< Array<NotificationItem> >( [] );

    React.useEffect( () => componentLoaded(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        update();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function update() : void
    {
         /*
        // get any notifications from server
        let i           : number;
        let n           : number = appmodel.notification.notices.length;
        let new_notices : Array<NotificationItem> = [];
        let severity    : NotificationSeverity;

        for( i=0; i < n; i++ )
        {
       
            if( appmodel.notification.notices[i].show )
            {
                switch( appmodel.notification.notices[i].severity )
                {
                    case Notice.Severity.INFO       : severity = NotificationSeverity.INFO; break;
                    case Notice.Severity.WARNING    : severity = NotificationSeverity.WARNING; break;
                    case Notice.Severity.ERROR      : severity = NotificationSeverity.ERROR; break;
                }
                new_notices.push( { id      : appmodel.notification.notices[i].id,
                                    expanded: false,
                                    title   : appmodel.notification.notices[i].title,
                                    message : appmodel.notification.notices[i].message,
                                    severity: severity } );
            }
            
        }
        setNotifications( new_notices );
        */
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    //function noticesChange( event : PubSub.Event ) : void
    //{
    //    update();
    //}

    ///////////////////////////////////////////////////////////////////////////////////////////
    function closeMessage( id : string ) :  void
    {
        //appmodel.notification.hideNotice( id );
        setNotifications( prev => prev.filter( n => n.id !== id ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function toggleMessage( id : string ) :  void
    {
        setNotifications( prev => prev.map(n => n.id === id ? { ...n, expanded: !n.expanded } : n ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function color( serverity : NotificationSeverity ) :  string
    {
        switch( serverity )
        {
            case NotificationSeverity.INFO   : return "info.main"; break;
            case NotificationSeverity.WARNING: return "warning.main"; break;
            case NotificationSeverity.ERROR  : return "error.main"; break;
        }
        return "primary.main";
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function textColor( serverity : NotificationSeverity ) :  string
    {
        switch( serverity )
        {
            case NotificationSeverity.INFO   : return "info.contrastText"; break;
            case NotificationSeverity.WARNING: return "warning.contrastText"; break;
            case NotificationSeverity.ERROR  : return "error.contrastText"; break;
        }
        return "primary.contrastText";
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function itemRenderer( item : NotificationItem ) :  JSX.Element
    {
        return <Card id={ item.id } key={ item.id } variant="outlined"
                    sx={ {  width: "100%", p: 0, m: 0,
                            boxSizing: "border-box",
                            maxWidth: "100%",
                            backgroundColor : color( item.severity ),
                            color           : textColor( item.severity )  } } >
            <CardContent sx={{ p: "4px 8px !important", m: 0, "&:last-child": { pb: "4px" } }} >
                <Stack direction="row" sx={ { width: "100%", p: 0, m: 0, minHeight: 0, alignItems:"center" } } >
                    <Typography variant="h6"> { item.title } </Typography>
                    <Pusher />
                    <ButtonIcon id="more"
                                label={ "More" }
                                icon={ item.expanded ? <KeyboardArrowUpOutlinedIcon sx={ { color: "common.white" } }/> : <KeyboardArrowDownOutlinedIcon sx={ { color: "common.white" } } /> }
                                onClick={ () => toggleMessage( item.id ) } />
                    <ButtonIcon id="close"
                                label={ appmodel.ui.locale.label( 'common.button.close' ) }
                                icon={ <CancelOutlinedIcon sx={ { color: "common.white" } } /> }
                                onClick={ () => closeMessage( item.id ) } />
                </Stack>
                { item.expanded ? <Typography>{ item.message }</Typography> : null }
            </CardContent>
        </Card>;
    }

    // ============================================================================================
    return  <section>
                <Subscriber event={ PubSubService.Type.NOTICES } onChange={ (evt:PubSubService.Event) => update() } />

                { notifications.length > 0 ?
                <Stack direction="row" spacing={ 0.5 } sx={ { width: "100%", maxWidth: "100%", p: 0 } }>
                    <Stack direction="column" spacing={ 0.5 } sx={ { width: "100%", maxWidth: "100%", p: 0.5 } }>
                        { notifications.map( ( item : NotificationItem ) => { return itemRenderer( item ) } ) }
                    </Stack>
                    
                </Stack>
                : null }
            </section>;

}

export namespace NotificationBar
{
    export interface Props
    {
    }
}



export default NotificationBar;

// eof