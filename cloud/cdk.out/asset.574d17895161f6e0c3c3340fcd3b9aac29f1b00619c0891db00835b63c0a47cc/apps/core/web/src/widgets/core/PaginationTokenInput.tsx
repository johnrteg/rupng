//
import React from 'react';
import { JSX } from "react";

import { Box, IconButton } from '@mui/material';

//
import FirstPageOutlinedIcon            from '@mui/icons-material/FirstPageOutlined';
import NavigateBeforeOutlinedIcon       from '@mui/icons-material/NavigateBeforeOutlined';
import NavigateNextOutlinedIcon         from '@mui/icons-material/NavigateNextOutlined';

import TextLabel                        from '@widgets/core/TextLabel';
import { StringUtils } from '@repo/common';

/*
    page 0: ""
    page 1-n: token
    page n: undefined  (on last page since next page is undefined)
*/

export function PaginationTokenInput( props : PaginationTokenInput.Props ) : JSX.Element
{
    const formatter : Intl.NumberFormat = new Intl.NumberFormat( "en-US", { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const [page,setPage]                = React.useState< string >( "" );
    const tokenStack                    = React.useRef< Array<string> >( [""] ); // Start with null (page 0)
    const [nextToken, setNextToken]     = React.useState< string >( "" );

    //
    React.useEffect( tokenAdded, [props.next] );
    React.useEffect( updatePage, [props.size,props.total] );

    /////////////////////////////////////////////////////////////////////////////////////////////////
    function tokenAdded() : void
    {
        //console.log('tokenAdded', tokenStack.current, props.next, props.total, props.size );
        if( props.next === undefined )
        {
            // no more, at the end of the pages
            setNextToken( PaginationTokenInput.Page.LAST );
        }
        else if( props.next === PaginationTokenInput.Page.FIRST )    // first page
        {
            // reset cache
            tokenStack.current = [ PaginationTokenInput.Page.FIRST ];
            updatePage();
        }
        else
        {
            setNextToken( props.next );
        } 
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////
    function onFirstPage() : void
    {
        tokenStack.current = [ PaginationTokenInput.Page.FIRST ];
        props.onChange( tokenStack.current[0] );
        updatePage();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////
    function onPreviousPage() : void
    {
        if( tokenStack.current.length > 1 )  // Can't go back from first page
        {
            // Pop the last token off the stack
            tokenStack.current.pop();

            // return the the last item now since the previous was popped off
            props.onChange( tokenStack.current[tokenStack.current.length-1] );
            updatePage();
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////
    function onNextPage() : void
    {
        if( nextToken )
        {
            // Push current next token onto stack
            tokenStack.current.push( nextToken );
            
            // Request next page
            props.onChange( nextToken );
            updatePage();
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////
    function isFirst() : boolean
    {
        return tokenStack.current.length === 1;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////
    function isLast() : boolean
    {
        return nextToken === PaginationTokenInput.Page.LAST;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////
    function updatePage() : void
    {
        const total_pages : number = props.size > 0 ? Math.ceil( props.total / props.size ) : 0;
        setPage( StringUtils.format( "{0} of {1}", formatter.format( tokenStack.current.length ), formatter.format( total_pages ) ) );
    }

    // ============================================================================================
    return  <Box >
                <IconButton size="medium"
                            disabled={ ( props.disabled ? props.disabled : false  ) || isFirst()} onClick={ onFirstPage } ><FirstPageOutlinedIcon /></IconButton>
                <IconButton size="medium"
                            disabled={ ( props.disabled ? props.disabled : false ) || tokenStack.current.length === 1 }
                            onClick={ onPreviousPage } > <NavigateBeforeOutlinedIcon /></IconButton>
                <IconButton size="medium"
                            disabled={ isLast() || ( props.disabled ? props.disabled : false ) }
                            onClick={ onNextPage } ><NavigateNextOutlinedIcon /></IconButton>
                { props.total > 0 ? <TextLabel variant="body2" padding={ { right: 1, top: 0.7 } } value={ page } /> : null }
            </Box>
}

export namespace PaginationTokenInput
{
    export enum Page
    {
        FIRST = "",
        LAST  = "undefined"
    }
    export interface Props
    {
        id          : string;
        next        : string | undefined;
        size        : number;
        total       : number;
        disabled?   : boolean;
        onChange    : ( value : string ) => void;
    }
}

export default PaginationTokenInput;
// eof