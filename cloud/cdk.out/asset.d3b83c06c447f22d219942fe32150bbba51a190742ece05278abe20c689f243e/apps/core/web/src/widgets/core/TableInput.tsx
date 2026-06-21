//
import React from 'react';
import { JSX } from "react";

//
import { Box, Button, Checkbox, Chip, Divider, IconButton, Pagination, Paper, Radio, Stack, Table, TableBody, TableCell, TableContainer,
            TableHead, TableRow, TableSortLabel, Theme, Typography, TypographyVariant, useTheme } from '@mui/material';
import { visuallyHidden } from '@mui/utils';

//
import HideImageOutlinedIcon from '@mui/icons-material/HideImageOutlined';

// icons
import ContentCopyOutlinedIcon          from '@mui/icons-material/ContentCopyOutlined';
import CheckCircleOutlinedIcon          from '@mui/icons-material/CheckCircleOutlined';
import LaunchOutlinedIcon               from '@mui/icons-material/LaunchOutlined';
import KeyboardArrowDownIcon            from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon              from '@mui/icons-material/KeyboardArrowUp';
import TableChartOutlinedIcon           from '@mui/icons-material/TableChartOutlined';
import CheckBoxOutlinedIcon             from '@mui/icons-material/CheckBoxOutlined';
import CheckBoxOutlineBlankOutlinedIcon from '@mui/icons-material/CheckBoxOutlineBlankOutlined';

//
import BrowserUtils             from '@utils/BrowserUtils';
import AppModel                  from '@model/AppModel';

//
import ButtonIcon               from './ButtonIcon';
import ButtonIconDropdown       from './ButtonIconDropdown';
import Pusher                   from './Pusher';
import PaginationTokenInput     from './PaginationTokenInput';
import { ArrayUtils, ByteUtils, PhoneUtils, StringUtils }           from "@repo/common";
import ImageInput               from './ImageInput';
import LocaleService            from '@model/service/LocaleService';



enum SpecialColumn
{
    EXPANDED = "__EXPANDED",
    SELECTION = "__SELECTION",
}


// --------------------------------------------------------------------------------------------------------------
interface TableInputRowProps
{
    row                 : TableInput.Row;
    columns             : Array<TableInput.Column>;

    expandedRenderer?   : TableInput.ExpandedRenderer;
    selected?           : boolean;
    selectable?         : TableInput.Selectable;

    theme : Theme;

    actions?            : Array<TableInput.Action>;
    onAction?           : TableInput.onActionCallback;
    onSelected          : ( id : string, flag : boolean, exclusive : boolean ) => void;
    onDoubleClick?      : ( row : TableInput.Row ) => void;
}

function TableInputRow( props : TableInputRowProps ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const timer             = React.useRef< ReturnType<typeof setTimeout> | null >( null );
    const double_timer      = React.useRef< ReturnType<typeof setTimeout> | null >( null );
    
    const [open, setOpen]   = React.useState< boolean >( false );
    const [tags, setTags]   = React.useState< boolean >( false );
 
    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderText( text : string, options? : TableInput.ColumnOptions ) : JSX.Element
    {
        const noWrap : boolean = options !== undefined && options.noWrap !== undefined && options.maxWidth !== undefined ? options.noWrap : false;
        const sx : any = noWrap ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: options ? options.maxWidth : 350 } : undefined;
        return <Typography  variant={ options && options.variant ? options.variant as TypographyVariant : TableInput.TEXT_STYLE }
                            noWrap={ noWrap }
                            sx={ sx }>
                { text }
                </Typography>;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderString( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        // move to generic place??
        if( value !== null && typeof value === "object" )
        {
            return value as JSX.Element;
        }
        else
        {
            return renderText( value, col.options );
        }
        
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderPassword( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return renderText( StringUtils.mask( value, "*" ), col.options );
    }
    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderEmail( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return  <Stack direction="row">
                    <Typography sx={ { mt: 0.85 } }
                                noWrap={ col.options !== undefined && col.options.noWrap !== undefined ? col.options.noWrap : false }
                                variant={ TableInput.TEXT_STYLE }
                            >
                        { value }
                    </Typography>
                        { value !== "" ? <ButtonIcon id={ 'copy-' + row.id }
                                                    icon={<ContentCopyOutlinedIcon fontSize="small"/>}
                                                    label={ 'Copy' }
                                                    onClick={ () => BrowserUtils.copyToClipboard( value ) } /> : null }
                </Stack>;
    }
    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderPhone( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return renderText( phoneFormat( value ), col.options  );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderBoolean( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return renderText( Boolean( value ) ? appmodel.ui.locale.label( 'common.button.yes' ) : appmodel.ui.locale.label( 'common.button.no' ), col.options  );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderImage( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return value !== "" ? <ImageInput  id={ col.field }
                            value={ value }
                            maxHeight={ col.width }
                            maxWidth={ col.width } /> : <HideImageOutlinedIcon color="error"/>;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function rendererVerified( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return Boolean( value ) ? <CheckCircleOutlinedIcon/> : <section></section>;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function rendererBytes( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return renderText( value > 0 ? ByteUtils.toString( value ): "-", col.options );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function rendererUrl( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return  <Stack direction="row" sx={{ p : 0, alignItems:"center" }}  >
                    <Typography variant={ col.options && col.options.variant ? col.options.variant as TypographyVariant : TableInput.TEXT_STYLE }
                                noWrap sx={ { pt: 0.5 } }>{ col.options && col.options.maxWidth ? StringUtils.truncate( value, col.options.maxWidth ) : value }</Typography>
                    <ButtonIcon id={ "link_"+ row.id }
                                        icon={ <LaunchOutlinedIcon fontSize="small" /> }
                                        label={ "Open To" }
                                        onClick={ () => BrowserUtils.open( value ) } />
                    { col.options !== undefined && col.options.copy !== undefined && col.options.copy === true ? <ButtonIcon id={ "copy_"+ row.id }
                                        icon={ <ContentCopyOutlinedIcon fontSize="small" /> }
                                        label={ "Copy" }
                                        onClick={ () => BrowserUtils.copyToClipboard( value ) } /> : null }
                </Stack>;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderDate( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return renderText( dateFormat( col, value ), col.options );
    }
    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderDateTime( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return renderText( dateTimeFormat( col, value ), col.options );
    }
    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderTime( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return renderText( timeFormat( col, value ), col.options );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderNumber( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return renderText( numberFormat( col, value ), col.options );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderPercent( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return renderText( numberFormat( col, value ) + "%", col.options );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderCurrency( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return renderText( currencyFormat( col, value ), col.options );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function rendererActions( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        return actionButtons( row.id, row, value );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onToggleTags( evt : React.MouseEvent<HTMLButtonElement> ) : void
    {
        evt.stopPropagation()
        setTags( !tags );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderTags( col : TableInput.Column, row : TableInput.Row, value : any ) : JSX.Element
    {
        let label : string;
        let eltags : Array<JSX.Element> = [];
        let i : number;

        for( i=0; i < value.length; i++ )
        {
            if( i < 4 || tags )
            {
                label = value[i];
                if( col.labels !== undefined )label = col.labels( value[i] );
                eltags.push( <Chip  key={ 'tag-' + i + '-' + row.id }
                                    label={ label }
                                    size="small"
                                    sx={{   backgroundColor: props.theme.palette.primary.light, // or any custom color
                                            color: props.theme.palette.primary.contrastText }}
                                    /> );
            }
            else
            {
                // more
                eltags.push( <Button key={'more-' + i } onClick={ onToggleTags } >{ <Typography variant="caption">{ "more" }</Typography> }</Button>);
                break;
            }
        }

        // less button
        if( value.length >= 4 && tags )
        {
            eltags.push( <Button key={'less-' + i } onClick={ onToggleTags } >{ <Typography variant="caption">{ "less" }</Typography> }</Button>);
        }


        return <Stack   key={ 'type_' + row.id }
                        direction="row"
                        spacing={ 0.5 }
                        sx={{ flexWrap: "wrap", alignItems:"center", justifyContent:"flex-start", height:"100%", width:"100%" }}
                         >
                    { eltags } 
                </Stack>;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function actionButtons( id: string, row : TableInput.Row, actions: Array<string> ) : JSX.Element
    {
        let elems : Array<JSX.Element> = [ ];
        let btn   : JSX.Element;
    
        // only add in actions that this row wants
        props.actions?.forEach( ( action : TableInput.Action, index : number ) =>
        {
                if( actions && actions.includes( action.id ) )
                {
                    let filtered_choices : Array<ButtonIconDropdown.Choice> | undefined = action.choices;
                    if( filtered_choices !== undefined && action.filter !== undefined )
                    {
                        filtered_choices = filtered_choices.filter( ( choice: ButtonIconDropdown.Choice ) => action.filter!( choice.value, row ) );
                    }

                    if( filtered_choices?.length )
                    {
                        btn = <ButtonIconDropdown   id={ action.id + '-'+ id }
                                                    key={ action.id + '-'+ id }
                                                    icon={ action.icon }
                                                    label={ action.label }
                                                    choices={ filtered_choices }  // fields map
                                                    onChange={ ( value : string ) => onAction( action.id, row, value ) } />;
                    }
                    else
                    {
                        btn = <ButtonIcon id={ action.id + '-'+ id }
                                            key={ action.id + '-'+ id }
                                            icon={ action.icon }
                                            label={ action.label }
                                            onClick={ () => onAction( action.id, row ) } />;
                    }
                    elems.push( btn );  // add button
                }
        } );
    
        return <Stack direction="row" sx={{ height:"100%", width:"100"}} >
                { elems }
            </Stack>;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onAction( action: string, row : TableInput.Row, choice? : string ) : void
    {
        if( props.onAction )props.onAction( action, row, choice );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderExpansion( col : TableInput.Column, row : TableInput.Row, value : any  ) : JSX.Element
    {
        return <IconButton
                aria-label="expand row"
                size="small"
                onClick={ ( event: React.MouseEvent<HTMLButtonElement> ) => onExpand( event )}
            >
                { open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            </IconButton>;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onExpand( event: React.MouseEvent<HTMLButtonElement> ) : void
    {
        event.stopPropagation();
        setOpen( !open )
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderSelected( col : TableInput.Column, row : TableInput.Row, value : any  ) : JSX.Element
    {
        if( props.selectable !== undefined && props.selectable === TableInput.Selectable.MULTIPLE )
        {
            return <Box>
                <Checkbox checked={ props.selected } onChange={ (event: React.ChangeEvent<HTMLInputElement>) => props.onSelected( props.row.id, event.target.checked, false ) } />
            </Box>;
        }
        else if( props.selectable !== undefined && props.selectable === TableInput.Selectable.SINGLE )
        {
            return <Box>
                <Radio  checked={ props.selected } onChange={ (event: React.ChangeEvent<HTMLInputElement>) => props.onSelected( props.row.id, event.target.checked, false ) } />
            </Box>;
        }
        else
        {
            return <Box></Box>;
        }
        
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function renderCell( row : TableInput.Row, col : TableInput.Column ) : JSX.Element | null
    {
        // spacial cases
        if( col.field === SpecialColumn.EXPANDED && props.expandedRenderer !== undefined )
        {
            return renderExpansion( col, row, row[ col.field ] );
        }
        else if( col.field === SpecialColumn.SELECTION )
        {
            return renderSelected( col, row, row[ col.field ] );
        }
        else if( row[ col.field ] !== undefined )
        {
            //console.log("renderCell", row, col, row[ col.field ] );
            switch( col.type )
            {
                case TableInput.ColumnType.STRING    : return renderString( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.TAGS      : return renderTags( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.URL       : return rendererUrl( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.PASSWORD  : return renderPassword( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.EMAIL     : return renderEmail( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.PHONE     : return renderPhone( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.BOOLEAN   : return renderBoolean( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.IMAGE     : return renderImage( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.VERIFIED  : return rendererVerified( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.DATE      : return renderDate( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.DATETIME  : return renderDateTime( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.TIME      : return renderTime( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.NUMBER    : return renderNumber( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.BYTES     : return rendererBytes( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.CURRENCY  : return renderCurrency( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.PERCENT   : return renderPercent( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.ACTION    : return rendererActions( col, row, row[ col.field ] ); break;
                case TableInput.ColumnType.CUSTOM    : return col.renderer ? col.renderer( col, row, row[ col.field ] ) : renderString( col, row, row[ col.field ] ); break;
            }
        }
        
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    function phoneFormat( phone : string ) : string
    {
        return PhoneUtils.format( phone );
        //const phoneNumber : PhoneNumber | undefined = parsePhoneNumberWithError( phone , 'US' );
        //return phoneNumber ? phoneNumber.formatNational() : phone;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function numberFormat( col : TableInput.Column, value : any ) : string
    {
        if( value === null )return "";

        let decimals : number = 0; // default one
        
        if( col.options !== undefined
            && col.options.decimals !== undefined )
        {
            decimals = col.options.decimals;
        }

        return appmodel.ui.locale.number( value as number, decimals );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function currencyFormat( col : TableInput.Column, value : any ) : string
    {
        if( value === null )return "";

        let decimals : number = 0; // default one
        if( col.options !== undefined && col.options.decimals !== undefined )
        {
            decimals = col.options.decimals;
        }
        return appmodel.ui.locale.currency( value as number, decimals );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function dateFormat( col : TableInput.Column, value : any ) : string
    {
        if( value === null )return "";

        let style : "short" | "medium" | "long" | "full" = "medium";
        if( col.options !== undefined && col.options.style !== undefined )
        {
            style = col.options.style;
        }
        let fmt : LocaleService.Format = LocaleService.Format.MEDIUM;
        switch( style )
        {
            case "short"    : fmt = LocaleService.Format.SHORT; break;
            case "medium"   : fmt = LocaleService.Format.MEDIUM; break;
            case "long"     : fmt = LocaleService.Format.LONG; break;
        }

        return appmodel.ui.locale.date( value, fmt );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function dateTimeFormat( col : TableInput.Column, value : any ) : string
    {
        let style : "short" | "medium" | "long" | "full" = "medium";
        if( col.options !== undefined && col.options.style !== undefined )
        {
            style = col.options.style;
        }
        let fmt : LocaleService.Format = LocaleService.Format.MEDIUM;
        switch( style )
        {
            case "short"    : fmt = LocaleService.Format.SHORT; break;
            case "medium"   : fmt = LocaleService.Format.MEDIUM; break;
            case "long"     : fmt = LocaleService.Format.LONG; break;
        }

        return appmodel.ui.locale.dateTime( value, fmt );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function timeFormat( col : TableInput.Column, value : any ) : string
    {
        let style : "short" | "medium" | "long" | "full" = "short";
        if( col.options !== undefined && col.options.style !== undefined )
        {
            style = col.options.style;
        }
        let fmt : LocaleService.Format = LocaleService.Format.MEDIUM;
        switch( style )
        {
            case "short"    : fmt = LocaleService.Format.SHORT; break;
            case "medium"   : fmt = LocaleService.Format.MEDIUM; break;
            case "long"     : fmt = LocaleService.Format.LONG; break;
        }

        return appmodel.ui.locale.time( value, fmt );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function columnJustification( col : TableInput.Column ) : "center" | "left" | "right" | "inherit" | "justify"
    {
        // overrride
        if( col.justify !== undefined )
            return col.justify;

        // enforce standards
        else if( col.type === TableInput.ColumnType.NUMBER
                || col.type === TableInput.ColumnType.BYTES
                || col.type === TableInput.ColumnType.CURRENCY
                || col.type === TableInput.ColumnType.PERCENT )
            return "right";

        // default
        else
            return "left";
            
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick( event : React.MouseEvent<HTMLTableRowElement> ) : void
    {
        // delay the click on tables with double click defined
        if( props.onDoubleClick !== undefined )
        {
            if( timer.current )
            {
                clearTimeout( timer.current );
                timer.current = null;
            }
            timer.current = setTimeout( doClick, 240 );
        }
        else    // do immediately
        {
            props.onSelected( props.row.id, !props.selected, false );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function doClick() : void
    {
        timer.current = null;
        props.onSelected( props.row.id, !props.selected, false );

        // prevent any nearby doubleclick
        if( props.onDoubleClick !== undefined )
        {
            double_timer.current = setTimeout( doneClick, 400 );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function doneClick() : void
    {
        double_timer.current = null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function onDoubleClick( event : React.MouseEvent<HTMLTableRowElement> ) : void
    {
        if( props.onDoubleClick !== undefined && double_timer.current === null )
        {
            if( timer.current )
            {
                clearTimeout( timer.current );
                timer.current = null;
            }
    
            event.stopPropagation();
            props.onSelected( props.row.id, true, true );
            props.onDoubleClick( props.row );
        }
    }

    //
    //
    //
    return  <React.Fragment>
                <TableRow   key={ props.row.id }
                            hover={ props.selectable !== TableInput.Selectable.NONE }
                            selected={ props.selected }
                            onClick={ props.selectable !== TableInput.Selectable.NONE ? onClick : undefined }
                            onDoubleClick={ props.onDoubleClick !== undefined ? onDoubleClick : undefined }
                            sx={{ '&:last-child td, &:last-child th': { border: 0 }, cursor: props.selectable ? 'pointer' : 'default' }} >
                            { props.columns.map( ( col : TableInput.Column, idx: number  ) =>
                                {
                                    if( col.hidden === undefined || !col.hidden )
                                    {
                                        return  <TableCell  key={ props.row.id + col.field }
                                                            align={ columnJustification( col ) }
                                                            padding={ col.field === SpecialColumn.SELECTION || col.field === SpecialColumn.EXPANDED ? "none" : "normal" }>
                                                    { renderCell( props.row, col ) }
                                                </TableCell>
                                    }
                                }
                                ) }
                </TableRow>

                {/* ------------------------------------ expandable section ----------------------------------------- */}
                { open ?
                <TableRow>
                    <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={ props.columns.length + 1 }>
                        { props.expandedRenderer !== undefined ? props.expandedRenderer( props.row ) : null }
                    </TableCell>
                </TableRow>
                : null }
            </React.Fragment>;
}

//
// --------------------------------------------------------------------------------------------------------------
//
export function TableInput( props: TableInput.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const theme : Theme = useTheme();
    
    const [columns, setColumns]                 = React.useState< Array<TableInput.Column> >( props.columns) ;
    const [rows, setRows]                       = React.useState< Array<TableInput.Row> >( props.data );
    const [selections, setSelections]           = React.useState< Array<string> >( props.selected ? props.selected : [] );
    const [hiddenColumns, setHiddenColumns]     = React.useState< Array<ButtonIconDropdown.Choice> >( [] );

    const [page, setPage]                       = React.useState< number >( 0 ) ;

    //
    React.useEffect( dataChanged, [props.columns,props.data] );
    React.useEffect( selectionChanged, [selections] );
    React.useEffect( hiddenColumnMenu, [columns] );
    React.useEffect( selectionUpdated, [props.selected] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function selectionUpdated() : void
    {
        if( props.selected && !ArrayUtils.isSame( selections, props.selected ) )setSelections( props.selected );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function selectionChanged() : void
    {
        if( props.onSelected && ( props.selected === undefined || !ArrayUtils.isSame( selections, props.selected ) ) )props.onSelected( selections );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function dataChanged() : void
    {
        // Reset token pagination when data becomes empty (likely due to filter changes)
        /*
        if( props.paging === TableInput.Paging.TOKEN && props.data.length === 0 && tokenStack.current.length > 1 )
        {
            tokenStack.current = [null];
            setNextToken( undefined );
        }
        */

        // any of the data is expandable?
        let new_columns : Array<TableInput.Column> = [];

        if( props.data.length > 0 && props.expandedRenderer !== undefined )
        {
            new_columns.push( { field    : SpecialColumn.EXPANDED,
                                label    : "",
                                type     : TableInput.ColumnType.CUSTOM,
                                width    : 10,
                                justify  : "center" } );
        }

        // selectable
        if( props.selectable && props.selectable !== TableInput.Selectable.NONE )
        {
            new_columns.push( { field    : SpecialColumn.SELECTION,
                                label    : "x",
                                type     : TableInput.ColumnType.CUSTOM,
                                width    : 10,
                                justify  : "center" } );
        }

        if( new_columns.length > 0 )
        {
            // add new columns
            setColumns( [  ...new_columns,  ...props.columns ] );
        }
        else
        {
            setColumns( props.columns );
        }

        setRows( props.data );
    }



    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function hiddenColumnMenu() : void
    {
        let hidden_choices : Array<ButtonIconDropdown.Choice> = [];
        columns.forEach( ( col : TableInput.Column ) =>
        {
            if( col.hideable !== undefined && col.hideable === true )
            {
                hidden_choices.push( { value : col.field, label : col.label, icon : col.hidden ? <CheckBoxOutlineBlankOutlinedIcon fontSize="small" /> : <CheckBoxOutlinedIcon fontSize="small" /> } );
            }
        } );
        setHiddenColumns( hidden_choices );
    }

    
    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function onSelected( id : string, flag : boolean, exclusive : boolean ) : void
    {
        if( props.selectable === TableInput.Selectable.SINGLE )
        {
            setSelections( flag ? [id] : [] );
        }
        else
        {
            if( exclusive )
            {
                setSelections( flag ? [id] : [] );
            }
            else
                setSelections(prev =>
                    flag
                        ? prev.includes(id) ? prev : [...prev, id] // add if not present
                        : prev.filter(selId => selId !== id)       // remove if present
                );
        }
        
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderRow( row : TableInput.Row, index : number ) : JSX.Element
    {
        //console.log('renderRow', row.id, selections.includes( row.id ) );
        return <TableInputRow   key={ row.id }
                                columns={ columns }
                                theme={ theme }
                                expandedRenderer={ props.expandedRenderer }
                                row={ row }
                                selectable={ props.selectable }
                                selected={ selections.includes( row.id ) }
                                actions={ props.actions }
                                onAction={ props.onAction }
                                onSelected={ onSelected }
                                onDoubleClick={ props.onDoubleClick }
                                 />;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function selectAllNone( event: React.ChangeEvent<HTMLInputElement> ) : void
    {
        if( event.target.checked )
        {
            setSelections( rows.map( row => row.id ) ); // add all the row ids
        }
        else
        {
            setSelections( [] );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function allSelected() : boolean
    {
        return( selections.length === rows.length );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function someSelected() : boolean
    {
        return( selections.length > 0 && selections.length !== rows.length );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onShowColumns( field : string ) : void
    {
        // Compute updated columns
        const updatedColumns : Array<TableInput.Column> = columns.map(col =>
            col.field === field
                ? { ...col, hidden: !(col.hidden ?? false) }
                : col
        );

        // toggle column hidden flag
        setColumns( updatedColumns );

        // inform parent component that there is a change of what is hidden
        if( props.onHiddenChanged !== undefined )
        {
            let fields : Array<string> = [];
            updatedColumns.forEach( ( col : TableInput.Column ) => { if( col.hidden )fields.push( col.field ) } );
            props.onHiddenChanged( fields );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function countHideableColumns() : number
    {
        let count : number = 0;
        props.columns.forEach( ( col : TableInput.Column ) => { if( col.hideable !== undefined && col.hideable === true )count++; } );
        return count;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderColumns() : Array<JSX.Element>
    {
        let cols : Array<JSX.Element> = [];
        let cell : JSX.Element;
        let cellSx : any;

        //console.log('renderColumns',columns.length );

        //let count : number = 0;
        columns.forEach( ( col : TableInput.Column, index : number ) =>
            {
                if( col.hidden === undefined || !col.hidden )
                {
                    const isLast : boolean = index === columns.length-1;
                    const isFirst : boolean = index === 0;

                    //console.log('col', columns.length, index, isLast, col.field );

                    // styling with possible vertical border edge to the right
                    cellSx = !isLast ? { borderRight: '1px solid ' + theme.palette.divider } : {};

                    // add in optional column width
                    if( col.width !== undefined )cellSx['width'] = col.width;

                    if( col.field === SpecialColumn.SELECTION )
                    {
                        cell = <TableCell   key={ "hdr-" + index }
                                            align={ col.justify ? col.justify : "left" }
                                            sx={cellSx}
                                            padding={ "none" }
                                            {...(isFirst && { component: "th", scope: "row" })}
                                        >
                                    {   props.selectable !== undefined
                                        && props.selectable === TableInput.Selectable.MULTIPLE ?
                                    <Checkbox checked={ allSelected() }
                                            indeterminate={ someSelected() }
                                            disabled={ props.data.length === 0 }
                                            onChange={ selectAllNone } />
                                    : null }
                                </TableCell>
                    }
                    else
                    {
                        cell = <TableCell   key={ "hdr-" + index }
                                            align={ col.justify ? col.justify : "left"}
                                            sx={cellSx}
                                            {...(isFirst && { component: "th", scope: "row" })}
                                        >

                                    { /* -------- add in sort elements ---- */ }
                                    { props.sort !== undefined && col.sortable !== undefined && col.sortable ?
                                        <TableSortLabel
                                            active={ props.sort.field === col.field }
                                            direction={ props.sort.direction }
                                            onClick={ () => onChangeSort( col.field ) }
                                        >
                                            { /* -------- direction when right justified ---- */ }
                                            { col.justify === "right" && props.sort.field === col.field  ?
                                            <Box component="span" sx={visuallyHidden}>
                                            { props.sort.direction === 'desc' ? 'sorted descending' : 'sorted ascending'}
                                            </Box> : null }


                                            { col.label }


                                            { /* -------- direction when left | centered justified ---- */ }
                                            { col.justify !== "right" && props.sort.field === col.field  ?
                                                <Box component="span" sx={ visuallyHidden }>
                                                { props.sort.direction === 'desc' ? 'sorted descending' : 'sorted ascending'}
                                                </Box>
                                            : null}

                                        </TableSortLabel>
                                    :
                                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                            <span>{col.label}</span>
                                            {isLast && countHideableColumns() > 0 ? (
                                                <ButtonIconDropdown
                                                        id="columns"
                                                        label={ "Columns" }
                                                        icon={<TableChartOutlinedIcon fontSize="small" />}
                                                        choices={ hiddenColumns }
                                                        onChange={ onShowColumns }
                                                        />
                                            ) : null}
                                        </Box>
                                        
                                    }

                                </TableCell>;
                    }

                    cols.push( cell );
                    //count++;

                } // endif hidden
            }
        );
        
        return cols;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChangeSort( field : string ) : void
    {
        //console.log('onChangeSort', field );
        if( props.onSort && props.sort )
        {
            props.onSort( { field: field,
                            // if same field, toggle direction
                            // else keep same direction
                            direction: props.sort.field === field ? ( props.sort.direction === "asc" ? "desc" : "asc" ) : props.sort.direction } );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onPageChange( event: React.ChangeEvent<unknown>, newPage: number ) : void
    {
        //console.log('onPageChange', page );
        if( props.onOffset && props.offset !== undefined && props.count !== undefined )
        {
            props.onOffset( ( newPage - 1 ) * props.count );
        }
    }


    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function renderFooter() : JSX.Element | null
    {
        //console.log( props.count, props.offset, props.total,
        //            props.offset !== undefined && props.count !== undefined ? Math.floor( props.offset / props.count ) + 1 : "none");  // 15 0 10

        if( props.total !== undefined )
        {
            return  <section>
                    
                        <Divider />

                        <Stack direction="row" sx={ { pl : 2, py: 0.5 } }>
                            { selections.length > 0 ? <Typography variant="body2" sx={ { pt: 0.75 } }>
                                                    { selections.length + " item" + ( selections.length === 1 ? "" : "s" ) + " selected" }
                                                    </Typography>: null }
                            { selections.length > 0 && props.total !== undefined && props.total > 0 ? <Divider sx={ { mx: 2 } } orientation="vertical" flexItem /> : null }
                            { props.total !== undefined && props.total > 0 ? <Typography variant="body2" sx={ { pt: 0.75 } }>{ appmodel.ui.locale.number( props.total, 0 ) + " Total" }</Typography> : null }
                            <Pusher />

                            { /* --------------------------------------- offset based paging --------------------------------------- */ }
                            { ( props.paging === undefined || props.paging == TableInput.Paging.OFFSET )
                                    && props.count !== undefined
                                    && props.offset !== undefined
                                    && props.total !== undefined ?
                                <Pagination
                                        variant="outlined"
                                        disabled={ props.disabled !== undefined ? props.disabled : false }
                                        showFirstButton={ true }
                                        showLastButton={ true }
                                        count={ Math.ceil( props.total / props.count ) }    // number of pages
                                        page={ page + 1 }
                                        onChange={ onPageChange }
                                    /> : null }

                            { /* --------------------------------------- next token based paging --------------------------------------- */ }

                            { props.paging !== undefined
                                && props.onNext !== undefined
                                && props.count !== undefined
                                && props.total !== undefined
                                && props.paging === TableInput.Paging.TOKEN ?
                                <Box sx={ { pr: 1 } }>
                                    <PaginationTokenInput   id="pager"
                                                            next={ props.next }
                                                            size={ props.count }
                                                            total={ props.total }
                                                            disabled={ props.disabled !== undefined ? props.disabled : false }
                                                            onChange={ props.onNext } />
                                </Box>
                                
                                 : null }
                        </Stack>
                    
                    </section>
        }
        else
        {
            return null;
        }
    }


    //
    //
    //
    return  <Paper sx={{ width: 'auto', overflow: 'hidden',
                        m: props.sx && props.sx.m ? props.sx.m : undefined,
                        mx: props.sx && props.sx.mx ? props.sx.mx : undefined,
                        mb: props.sx && props.sx.mb ? props.sx.mb : undefined
                     }}>

                <TableContainer key={ props.id }
                            sx={ { maxHeight : props.sx && props.sx.maxHeight !== undefined ? props.sx.maxHeight : "100%",
                            height  : props.sx && props.sx.height !== undefined ? props.sx.height : "100hv", } }>

                    <Table  sx={{ minWidth: props.sx && props.sx.minWidth !== undefined ? props.sx.minWidth : "100%" }}
                            size={ props.dense !== undefined ? ( props.dense ? "small" : "medium" ) : "small" }
                            stickyHeader={ props.stickyHeader !== undefined ? props.stickyHeader : true }  >

                        <TableHead>
                            <TableRow key="header">
                                { renderColumns () }
                            </TableRow>
                        </TableHead>

                        <TableBody>
                            { props.data.map( ( row : TableInput.Row, index : number ) => { return renderRow( row, index ) } ) }
                        </TableBody>
                    </Table>
                </TableContainer>

                { renderFooter() }

            </Paper>;
}

//
//
//
export namespace TableInput
{
    export const TEXT_STYLE : TypographyVariant = "body2";

    export enum ColumnType
    {
        STRING      = "string",
        TAGS        = "tags",
        NUMBER      = "number",
        PERCENT     = "percent",
        CURRENCY    = "currency",
        DATE        = "date",
        DATETIME    = "datetime",
        TIME        = "time",
        PASSWORD    = 'password',
        PHONE       = 'phone',
        EMAIL       = 'email',
        BOOLEAN     = "boolean",
        VERIFIED    = "verified",
        BYTES       = 'bytes',
        URL         = 'url',
        CUSTOM      = "custom",
        IMAGE       = "image",
        ACTION      = "action"
    }

    export interface ColumnOptions
    {
        decimals?   : number;
        currency?   : string;  // USD
        style?      : "short" | "medium" | "long" | "full";
        noWrap?     : boolean;
        maxWidth?   : number;
        variant?    : "body1" | "body2" | "caption" | "subtitle" | "subtitle1";
        copy?       : boolean;
    }

    export interface Row
    {
        id              : string;
        [key: string]   : any;
        expandable?     : boolean;
        actions?        : Array<string>;
    }

    export interface Column
    {
        field           : string;
        label           : string;
        type            : ColumnType;
        justify?        : "center" | "left" | "right" | "inherit" | "justify";
        width?          : number;
        options?        : ColumnOptions;
        renderer?       : CellRenderer;
        labels?         : CellLabel;
        hideable?       : boolean;
        hidden?         : boolean;
        sortable?       : boolean;
    }

    export interface Action
    {
        id       : string;
        label    : string;
        icon     : JSX.Element;
        choices? : Array<ButtonIconDropdown.Choice>; //dropdown? : (( row: Row ) => Array<ButtonIconDropdown.Choice>);
        filter?  : ( value : string, row : TableInput.Row ) => boolean;
    }

    export enum Selectable
    {
        NONE = "none",
        SINGLE = "single",
        MULTIPLE = "multiple"
    }

    export enum Paging
    {
        NONE = "none",
        OFFSET = "offset",
        TOKEN = "token"
    }

    export interface Sort
    {
        field       : string;
        direction   : "asc" | "desc";
    }

    export interface Props
    {
        id                  : string;
        dense?              : boolean;
        stickyHeader?       : boolean;

            sx?             : { maxHeight?  : number;
                                minWidth?   : string | number;
                                height?     : number | string;
                                m?          : any;
                                mb?         : number;
                                mx?         : number; };

        expandedRenderer?   : ExpandedRenderer;

        selectable?         : TableInput.Selectable;
        selected?           : Array<string>;
        disabled?           : boolean;

        actions?            : Array<TableInput.Action>;

        columns             : Array<TableInput.Column>;
        data                : Array<TableInput.Row>;

        sort?               : Sort;

        // pagination
        paging?             : Paging;
        // either using offset/count OR next (token)
        // if offset/count, then onOffset is the callback
        // if next, then onNext is the callback
        offset?             : number;   // 0 offset
        count?              : number;   // number to display on a page
        total?              : number;   // total possible

        next?               : string;

        onOffset?           : onOffsetCallback;
        onSort?             : onSortCallback;
        onNext?             : onNextCallback;
        onAction?           : onActionCallback;
        onSelected?         : onSelectionCallback;
        onDoubleClick?      : onDoubleClickCallback;
        onHiddenChanged?    : onHiddenChangedCallback;  // returns fields still hidden
    }



    //
    // for custom renderers
    export type CellRenderer     = ( col : TableInput.Column, row : TableInput.Row, value : any ) => JSX.Element;
    export type ExpandedRenderer = ( row : TableInput.Row ) => JSX.Element;
    export type onActionCallback = ( action : string, row : TableInput.Row, choice? : string ) => void;
    export type onSelectionCallback = ( ids : Array<string> ) => void;
    export type onHiddenChangedCallback = ( fields : Array<string> ) => void;
    export type onOffsetCallback = ( offset : number ) => void;
    export type onNextCallback = ( token : string ) => void;
    export type onSortCallback = ( sort : Sort ) => void;
    export type CellLabel = ( value : string ) => string;
    export type onDoubleClickCallback = ( row : TableInput.Row ) => void;

    
}

export default TableInput;
// eof