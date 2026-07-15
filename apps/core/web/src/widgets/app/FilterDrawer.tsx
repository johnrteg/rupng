//
import React from 'react';
import { JSX } from "react";

//
import Stack from '@mui/material/Stack';
import { Button, Drawer } from '@mui/material';
import AppModel from '../../model/AppModel';



//
export function FilterDrawer( props : FilterDrawer.Props ) : JSX.Element
{
    const appdata : AppModel = AppModel.instance();
    
    React.useEffect( () => componentLoaded(), [] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onReset() : void
    {
        props.onReset();
        setTimeout( onUpdate, 100 );    // delay so settings can refresh
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onClose() : void
    {
        props.onClose();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onUpdate() : void
    {
        if( props.onUpdate )props.onUpdate();
        props.onClose();
    }

    // ============================================================================================
    return  <Drawer open={ props.open }
                    anchor="right"
                    slotProps={ { paper: { sx: { minWidth : props.minWidth ? props.minWidth : 300,
                                                 maxWidth: "75vw" } } } }
                    onClose={ () => props.onClose() } >

                <Stack direction="column" spacing={2} sx={ { pt: 2, pl: 1, pr: 1, pb: 1 } } >

                    { props.children }

                    { props.onUpdate ? <Button variant="outlined" onClick={ () => onUpdate() } >{ appdata.ui.locale.label( 'common.button.update' ) }</Button> : null }
                    <Button variant="outlined" onClick={ () => onReset() } >{ appdata.ui.locale.label( 'common.button.reset' ) }</Button>
                    <Button variant="outlined" onClick={ () => onClose() } >{ appdata.ui.locale.label( 'common.button.close' ) }</Button>
                </Stack>
            </Drawer>;

}

////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Wrapper slide out drawer for page filters.  Use this if the page requires an overall ability to filter the contents.
 * The contents of the filter is defined by the page and the filter drawer ha sno knowldge of the contents of the filter. 
 *
 * @param open Flag to open (true) and close (false) the drawer.
 * @param children React components to fill in the filters of the drawer.  The filters are in a Stack, column oriented.
 * YOu dont specifically set children, but children is automatically set when added to the react compoentns of FilterDrawer.
 * @param minWidth Optional minimum width of the drawer.
 * @param noReport Optional to not send a report to Google Analytics
 * @param onReset Callback function when the user select the "reset" button.
 * @param onClose Callback funtion when the user select the close button or when they click outside of the drawer.
 * @param onUpdate Optional callback.  Set this and the user will see an "Update" button to select.  If the filters are "dynamic" because
 * the parent page has useEffect on each of the filters, then there is no need to have the "Update" button as well.
 * @example <FilterDrawer open={showFilter} onReset={ onReset } onClose={ () => setShowFolter( false )}><TextInput/></FilterDrawer>
 */
export namespace FilterDrawer
{
    export interface Props
    {
        open       : boolean;
        children   : Array<JSX.Element | null> | JSX.Element;
        minWidth?  : number;
        noReport?  : boolean;
        onReset    : () => void;
        onClose    : () => void;
        onUpdate?  : () => void;
    }
}

export default FilterDrawer;
// eof