//
import React from 'react';
import { JSX } from "react";

import HideImageOutlinedIcon from '@mui/icons-material/HideImageOutlined';

//
import Box          from '@mui/material/Box';
import Divider      from '@mui/material/Divider';
import List         from '@mui/material/List';
import ListItem     from '@mui/material/ListItem';
import Typography   from '@mui/material/Typography';
import Stack        from '@mui/material/Stack';
import { Pagination, Theme, TypographyVariant, useTheme } from '@mui/material';

// icons

import AppModel          from '@model/AppModel';

//
import ButtonIcon           from './ButtonIcon';
import TableInput           from './TableInput';
import ButtonIconDropdown   from './ButtonIconDropdown';
import PaginationTokenInput from './PaginationTokenInput';
import ImageInput           from './ImageInput';
import LocaleService from '../../model/service/LocaleService';
import { ByteUtils, PhoneUtils, StringUtils } from '@repo/common';



//
//
//
function MobileListInputRow( props : MobileListInputRow.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const theme : Theme = useTheme();
    
    const [dragX, setDragX]         = React.useState<number>( 0 );
    const startX                    = React.useRef<number | null>( null );
    const startY                    = React.useRef<number | null>( null );
    const [dragging, setDragging]   = React.useState<boolean>(false);

    const [isPointerOver, setIsPointerOver] = React.useState(false);
    const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);



    // horizontal threshold before the top screen begins to drag
    // helpful when the user is scrolling vertically and the x begins to increment
    // based on the arc swiping of the thumb
    const MOVE_THRESHOLD : number = 25;

    ////////////////////////////////////////////////////////////////////////////////
    function onMouseEnter() : void
    {
        setIsPointerOver(true);
        if (closeTimer.current)
        {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    }
    ////////////////////////////////////////////////////////////////////////////////
    function onMouseLeave() : void
    {
        setIsPointerOver(false);
        if (!dragging && dragX !== 0)
        {
            closeTimer.current = setTimeout(() => setDragX(0), 2000);
        }
    }

    ////////////////////////////////////////////////////////////////////////////////
    function onDragStart( e: React.MouseEvent ) : void
    {
        beingStart( e.clientX );
        document.addEventListener( 'mousemove', onDragMove );
        document.addEventListener( 'mouseup', onDragEnd );
    }
    ////////////////////////////////////////////////////////////////////////////////
    function onTouchStart( e: React.TouchEvent ) : void
    {
        setIsPointerOver( true );
        const touch : any = e.touches[0];
        startY.current = touch.clientY;
        beingStart( touch.clientX );

        document.addEventListener( 'touchmove', onTouchMove, { passive: false } );
        document.addEventListener( 'touchend', onTouchEnd );
    }

    /////////////////////////////////////////////////////////////////////////////////
    function beingStart( offset : number ) : void
    {
        setDragging( true );
        startX.current = offset - dragX;
    }

    /////////////////////////////////////////////////////////////////////////////////
    function onDragMove( e: MouseEvent) : void
    {
        e.preventDefault();
        const x : number = e.clientX - ( startX.current ?? 0 );
        limitDrag( x );
    }
    /////////////////////////////////////////////////////////////////////////////////////
    function onTouchMove( e: TouchEvent ) : void
    {
        if( e.touches.length > 0 && startX.current !== null && startY.current !== null )
        {
            const touch = e.touches[0];
            const deltaX = Math.abs( touch.clientX - startX.current );
            const deltaY = Math.abs( touch.clientY - startY.current );

            // Only preventDefault if horizontal drag is dominant
            if( deltaX > deltaY )
            {
                if( e.cancelable )e.preventDefault();
            }
            const x : number = touch.clientX - ( startX.current ?? 0 );
            if( Math.abs( x ) > MOVE_THRESHOLD )limitDrag( x );
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////
    function limitDrag( x : number ) : void
    {
        // x < 0 means the user is dragging to the left and exposing the right
        // x > 0 means the user is dragging to the right and exposing the left
        if( ( x < 0 && x > -props.maxRight ) || ( x > 0 && x < props.maxLeft ) )
        {
            setDragX( x );
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////
    function onDragEnd() : void
    {
        setIsPointerOver( false );
        document.removeEventListener( 'mousemove', onDragMove );
        document.removeEventListener( 'mouseup', onDragEnd );
        doneEnd();
    }
    //////////////////////////////////////////////////////////////////////////////////////
    function onTouchEnd() : void
    {
        setIsPointerOver( false );
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        doneEnd();
    }

    //////////////////////////////////////////////////////////////////////////////////////
    function doneEnd() : void
    {
        startX.current = null;
        setDragging( false );
        //setTimeout( () => setDragX( 0 ), 2000 );
        if (!isPointerOver && dragX !== 0)
        {
            closeTimer.current = setTimeout(() => setDragX(0), 2000);
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderActionButton( action : TableInput.Action ) : JSX.Element
    {
        if( action.choices !== undefined && action.choices.length > 0 )
        {
            return <ButtonIconDropdown  id={ action.id }
                                        key={ action.id }
                                        icon={ action.icon }
                                        label={ action.label }
                                        choices={ action.choices }  // fields map
                                        onChange={ ( value : string ) => props.onAction( action.id, props.row, value ) } />;
        }
        else
        {
            return <ButtonIcon
                    key={ action.id }
                    id={ action.id }
                    icon={ action.icon }
                    label={ action.label }
                    onClick={ () => props.onAction( action.id, props.row ) }
                />;
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderActions() : JSX.Element | null
    {
        if( props.actions === undefined )return null;
        let btns : Array<JSX.Element> = [];
        props.actions.forEach( ( action : TableInput.Action, index : number ) => {
            if( props.row.actions?.includes( action.id ) )btns.push( renderActionButton( action ) );
        } );
        return <Stack direction="row" sx={ { p:0 } }>{ btns }</Stack>;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function text( text : string, col : TableInput.Column ) : JSX.Element
    {
        //return <TextLabel variant={ col.options && col.options.variant ? col.options.variant as TypographyVariant : "body1" } padding={ { top : 0.5 } } value={ text } />;

        return <Typography  color="text.primary"
                            variant={ col.options && col.options.variant ? col.options.variant as TypographyVariant : "body1" }
                            sx={ { mt: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }
                            component="span">
                    { text }
                </Typography>;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function renderString( col : TableInput.Column ) : JSX.Element
    {
        return text( props.row[ col.field ], col );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////
    function rendererUrl( col : TableInput.Column ) : JSX.Element
    {
        return text( props.row[ col.field ], col );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////
    function renderPassword( col : TableInput.Column ) : JSX.Element
    {
        return text( "****", col );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////
    function renderPhone( col : TableInput.Column ) : JSX.Element
    {
        return text( PhoneUtils.format( props.row[ col.field ] ), col );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////
    function renderBoolean( col : TableInput.Column ) : JSX.Element
    {
        return text( Boolean( props.row[ col.field ] )  ? appmodel.ui.locale.label( 'common.button.yes' ) : appmodel.ui.locale.label( 'common.button.no' ), col );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////
    function rendererVerified( col : TableInput.Column ) : JSX.Element
    {
        return text( Boolean( props.row[ col.field ] )  ? "Verified" : "", col );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////
    function renderDate( col : TableInput.Column ) : JSX.Element
    {
        return text( props.appmodel.ui.locale.date( props.row[ col.field ], LocaleService.Format.SHORT ), col );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderDateTime( col : TableInput.Column ) : JSX.Element
    {
        return text( props.appmodel.ui.locale.dateTime( props.row[ col.field ], LocaleService.Format.SHORT ), col );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderNumber( col : TableInput.Column ) : JSX.Element
    {
        return text( props.appmodel.ui.locale.number( props.row[ col.field ], col.options && col.options.decimals ? col.options.decimals : 0 ), col );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function rendererBytes( col : TableInput.Column ) : JSX.Element
    {
        return text( ByteUtils.toString( props.row[ col.field ] ), col );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderCurrency( col : TableInput.Column ) : JSX.Element
    {
        return text( props.appmodel.ui.locale.currency( props.row[ col.field ], col.options && col.options.decimals ? col.options.decimals : 0 ), col );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderPercent( col : TableInput.Column ) : JSX.Element
    {
        return text( props.appmodel.ui.locale.number( props.row[ col.field ], ( col.options && col.options.decimals ? col.options.decimals : 0 ) ) + "%", col );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderImage( col : TableInput.Column ) : JSX.Element
    {
        return props.row[ col.field ] !== "" ? <ImageInput  id={ col.field }
                            value={ props.row[ col.field ] }
                            maxHeight={ col.width }
                            maxWidth={ col.width } /> : <HideImageOutlinedIcon color="error"/>;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderCell( col : TableInput.Column ) : JSX.Element | undefined
    {
        if( props.row[ col.field ] !== undefined )
        {
            switch( col.type )
            {
                case TableInput.ColumnType.IMAGE     : return renderImage( col ); break;
                case TableInput.ColumnType.STRING    : return renderString( col ); break;
                case TableInput.ColumnType.URL       : return rendererUrl( col ); break;
                case TableInput.ColumnType.PASSWORD  : return renderPassword( col ); break;
                case TableInput.ColumnType.EMAIL     : return renderString( col ); break;
                case TableInput.ColumnType.PHONE     : return renderPhone( col ); break;
                case TableInput.ColumnType.BOOLEAN   : return renderBoolean( col ); break;
                case TableInput.ColumnType.VERIFIED  : return rendererVerified( col ); break;
                case TableInput.ColumnType.DATE      : return renderDate( col ); break;
                case TableInput.ColumnType.DATETIME  : return renderDateTime( col ); break;
                case TableInput.ColumnType.NUMBER    : return renderNumber( col ); break;
                case TableInput.ColumnType.BYTES     : return rendererBytes( col ); break;
                case TableInput.ColumnType.CURRENCY  : return renderCurrency( col ); break;
                case TableInput.ColumnType.PERCENT   : return renderPercent( col ); break;
                //case TableInput.ColumnType.ACTION    : return rendererActions( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.CUSTOM    : return col.renderer ? col.renderer( col, props.row, props.row[ col.field ] ) : renderString( col ); break;
            }
         }
            
        return undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderPrimaryUpper() : JSX.Element | undefined
    {
        return props.primary && props.primary.upper ? renderCell( props.primary.upper ) : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderPrimaryLower() : JSX.Element | undefined
    {
        return props.primary && props.primary.lower ? renderCell( props.primary.lower ) : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderSecondaryUpper() : JSX.Element | undefined
    {
        return props.secondary !== undefined && props.secondary.upper ? renderCell( props.secondary.upper ) : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderSecondaryLower() : JSX.Element | undefined
    {
        return props.secondary !== undefined && props.secondary.lower ? renderCell( props.secondary.lower ) : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderPrimaryRight() : JSX.Element | undefined
    {
        return props.primary && props.primary.right ? renderCell( props.primary.right ) : undefined;
    }



    // ========================================================================================================
    //
    return  <React.Fragment key={ props.row.id }>
                <ListItem   key={ props.row.id }
                            sx={ { m:0, p:0, position: 'relative', height: 62 } }
                            disablePadding={ false }
                            secondaryAction={ renderActions() }
                >
                    { /* ----------------------- bottom item items -------------------------  */ }
                    <Stack direction="column" sx={ { pl: 2 } }>
                        { renderSecondaryUpper() }
                        { renderSecondaryLower() }
                    </Stack>


                    { /* ----------------------- slider on top of list items -------------------------  */ }
                    <Box    sx={ { position: 'absolute',
                                    top: 0,
                                    left: dragX,
                                    width: '100%',
                                    height: '100%',
                                    backgroundColor: theme.palette.background.paper,   // change to theme
                                    zIndex: 10,
                                    cursor: 'grab',
                                    pointerEvents: 'auto',
                                    transition: dragging ? 'none' : 'left 0.3s cubic-bezier(0.4,0,0.2,1)'
                                } }
                                onMouseEnter={onMouseEnter}
                                onMouseLeave={onMouseLeave}
                                onMouseDown={ onDragStart }
                                onTouchStart={ onTouchStart } >

                        <Stack  direction="row"
                                sx={ { height: '100%', px: 2, alignItems:"center", justifyContent:"space-between" } }>

                            <Stack direction="column" spacing={ 0 }  >
                                { renderPrimaryUpper() }
                                { renderPrimaryLower() }
                            </Stack>

                            { props.primary.right ? <Box sx={{ display: 'flex', alignItems: 'center' }}>{ renderPrimaryRight() }</Box> : null }
                        </Stack>
                        
                    </Box>
                   

                </ListItem>

                <Divider component="li" />

            </React.Fragment>;
}

// =======================================================================================================================
//
//
export function MobileListInput( props : MobileListInput.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    
    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderListItem( row : TableInput.Row ) : JSX.Element
    {
        return  <MobileListInputRow key={ row.id }
                                    row={ row }
                                    appmodel={ appmodel }
                                    //columns={ props.columns }
                                    maxLeft={ props.maxLeft }
                                    primary={ props.primary }
                                    secondary={ props.secondary }
                                    maxRight={ props.actions && props.actions.length > 0 ? ( 20 + ( 45 * props.actions.length ) ) : 0 }
                                    actions={ props.actions }
                                    onAction={ onAction }/>;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function onAction( action : string, row : TableInput.Row, choice? : string) : void
    {
        if( props.onAction )props.onAction( action, row, choice );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onPageChange( event: React.ChangeEvent<unknown>, page: number ) : void
    {
        //console.log('onPageChange', page );
        if( props.onOffset && props.offset !== undefined && props.count !== undefined )
        {
            props.onOffset( ( page - 1 ) * props.count );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderFooter() : JSX.Element | null
    {
        // --------------------------------------- offset based paging ---------------------------------------
        if( ( props.paging === undefined || props.paging == TableInput.Paging.OFFSET )
                                    && props.count !== undefined
                                    && props.offset !== undefined
                                    && props.total !== undefined )
            return <Pagination
                    variant="outlined"
                    disabled={ props.disabled !== undefined ? props.disabled : false }
                    showFirstButton={ true }
                    showLastButton={ true }
                    count={ Math.ceil( props.total / props.count ) }    // number of pages
                    page={ Math.floor( props.offset / props.count ) + 1 }
                    onChange={ onPageChange }
            />;

        // --------------------------------------- next token based paging --------------------------------------- 
        else if( props.paging !== undefined
            && props.onNext !== undefined
            && props.count !== undefined
            && props.total !== undefined
            && props.paging === TableInput.Paging.TOKEN )
                return <Box sx={ { 
                                    display: 'flex', 
                                    justifyContent: 'center', 
                                    alignItems: 'center',
                                    pt: 2 
                                } }>
                    <PaginationTokenInput   id="pager"
                                            next={ props.next }
                                            size={ props.count }
                                            total={ props.total }
                                            disabled={ props.disabled !== undefined ? props.disabled : false }
                                            onChange={ props.onNext } />
                </Box>;
             
        else
            return null;


    }

    // ============================================================================================
    return  <Stack direction="column">
                <Box sx={ { p:0, m:0,
                        width: '100%',
                        overflowX: 'hidden' } }>                            
                    <List id={ props.id } sx={{ width: '100%', p: 0, m: 0 }} >
                        <Divider component="li" />
                        { props.data.map( ( item : TableInput.Row ) => renderListItem( item ) ) }
                    </List>
                </Box>
                { renderFooter() }
            </Stack>;

}

export namespace MobileListInput
{
    export interface Props
    {
        id          : string;

        data        : Array<TableInput.Row>;

        maxLeft     : number;

        disabled? : boolean;

        // field mapping
        primary     : { upper? : TableInput.Column, lower? : TableInput.Column; right? : TableInput.Column };
        secondary?  : { upper? : TableInput.Column, lower? : TableInput.Column };

        // pagination
        paging?         : TableInput.Paging;
        offset?         : number;   // 0 offset
        count?          : number;   // number to display on a page
        total?          : number;   // total possible
        next?           : string;

        // actions
        actions?    : Array<TableInput.Action>;  
        onAction?   : TableInput.onActionCallback;
        onOffset?   : TableInput.onOffsetCallback;
        onNext?     : TableInput.onNextCallback;
    }

    
}

namespace MobileListInputRow
{
    export interface Props
    {
        appmodel : AppModel;

        maxLeft     : number;
        maxRight    : number;

        primary     : { upper? : TableInput.Column, lower? : TableInput.Column; right? : TableInput.Column };
        secondary?  : { upper? : TableInput.Column, lower? : TableInput.Column };

        row         : TableInput.Row;

        actions?    : Array<TableInput.Action>; 
        onAction    : TableInput.onActionCallback;
    }
}

export default MobileListInput;

// eof