//
import * as React from 'react';
import { JSX } from "react";

import { Button, List } from '@mui/material';

import { DateUtils } from '@repo/common';

//


import ChatListItem     from './ChatListItem';
import AppModel from '../../../model/AppModel';
import Timer from '../../core/Timer';



//
//
//
export function ChatList( props : ChatList.Props ) : JSX.Element
{
    const appdata : AppModel = AppModel.instance();
    
    const [messages,setMessages]        = React.useState< Array<ChatListItem.Message> >( props.messages );
    const [updateTime,setUpdateTime]    = React.useState< boolean >( false );
    const [scroll,setScroll]            = React.useState< boolean >( false );

    const listRef                       = React.useRef< HTMLUListElement >( null );
    const initScroll                    = React.useRef< boolean >( false );

    //
    React.useEffect( messagesChanged, [messages] );
    React.useEffect( messagesUpdated, [props.messages] );


    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function scrollToEnd() : void
    {
        if( listRef.current )
        {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
        initScroll.current = false;
        setScroll( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function refresh() : void
    {
        //console.log('refresh' );
        setMessages( [...props.messages] );   // force refresh
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function messagesUpdated() : void
    {
        //console.log('messagesUpdated' );

        // a load-more prepends older messages above the current list: the list grows and the
        // bottom ( last ) message is unchanged. in that case leave the scroll position as-is
        // rather than jumping to the bottom.
        const isPrepend : boolean = messages.length > 0
                            && props.messages.length > messages.length
                            && props.messages[ props.messages.length - 1 ]?.id === messages[ messages.length - 1 ]?.id;

        initScroll.current = true;
        setMessages( props.messages );
        setScroll( !isPrepend && initScroll.current && messages.length > 0 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function messagesChanged() : void
    {
        //console.log('messagesChanged', initScroll.current, messages.length );
        setUpdateTime( messages.length > 0 && ( props.updateTime === undefined || props.updateTime === true ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onLoadMore() : void
    {
        if( props.nextToken && props.onLoadMore )
        {
            props.onLoadMore( props.nextToken );
        }
        
    }

    // ========================================================================================== 
    return (    <>
                <Timer run={updateTime} interval={ 30 * DateUtils.Time.SECONDS_TO_MS } onChange={ refresh } />
                <Timer run={scroll} interval={ 0.1 * DateUtils.Time.SECONDS_TO_MS } onChange={ scrollToEnd } />
                <List   ref={ listRef }
                        sx={ {  width       : "100%",
                                bgcolor     : "FFFFFF",
                                px          : 0,
                                flex        : 1,
                                minHeight   : 0,
                                maxHeight   : props.maxHeight ? props.maxHeight : undefined, 
                                height      : props.height ? props.height : 300, 

                                // temp border to help position
                                //border: 1,
                                //borderColor: 'divider',
                                color: props.onWhiteBg ? "#FFFFFF" : "transparent",

                                overflowY   : "auto",
                                overflowX   : "hidden",
                                display     : "flex",
                                flexDirection: "column" }}>

                    { props.nextToken && props.onLoadMore ? <Button variant="outlined" sx={ { mx: 1 } } onClick={ () => onLoadMore() } >{"Load More"}</Button> : null }

                    { messages?.map( ( msg : ChatListItem.Message ) =>
                            {
                                return <ChatListItem    key={ msg.id + "-key" }
                                                        onWhiteBg={ props.onWhiteBg }
                                                        hideInfo={ props.hideInfo }
                                                        maxMediaWidth={ props.maxMediaWidth }
                                                        { ...msg } />
                            } ) }
                </List>
                </>
    );
}

export namespace ChatList
{

    export interface Props
    {
        id              : string;
        height?         : number;
        maxHeight?      : number;
        fontSize?       : number;
        onWhiteBg       : boolean;
        updateTime?     : boolean;
        maxMediaWidth?  : string;
        hideInfo?       : boolean;
        nextToken?      : string;
        messages        : Array<ChatListItem.Message>;
        onLoadMore?     : ( token : string ) => void;
    }
}

export default ChatList;
// eof
