//

import React from 'react';
import { JSX } from "react";
//import ReactGA from "react-ga4";

import { Breakpoint, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack } from '@mui/material';

import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import RadioButtonUncheckedOutlinedIcon from '@mui/icons-material/RadioButtonUncheckedOutlined';
import DoNotDisturbAltOutlinedIcon from '@mui/icons-material/DoNotDisturbAltOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';

import AppModel from '@model/AppModel';


//
import Pusher           from './Pusher';
import HelpButton       from './HelpButton';
//import Analytics        from '../utils/Analytics';
import TextLabel        from './TextLabel';
import Show             from './Show';
import ButtonIcon       from './ButtonIcon';
import BrowserUtils     from '@utils/BrowserUtils';


export function DialogWindow( props : DialogWindow.Props ) : JSX.Element
{
    const appdmodel       : AppModel = AppModel.instance();

    const [saving,setSaving]     = React.useState< boolean >( false );
    const [ready,setReady]       = React.useState< boolean >( true );

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( readyChanged, [props.ready] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        sendStatus();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function sendStatus( suffix : string | null = null ) : void
    {
        if( ( props.noReport === undefined || props.noReport === false ) && appdmodel.cache.tracker )
        {
            //ReactGA.send({ hitType: Analytics.Type.PAGE, page: window.location.pathname + "/dialog/" + props.id + ( suffix ? suffix : "" ) });
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    async function onYes() : Promise<void>
    {
        setSaving( true );
        if( await props.onYes() )
        {
            sendStatus( "/yes" );

            if( props.onSaved !== undefined )props.onSaved();
            //onClose();
            props.onClose();
        }
        setSaving( false );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    async function onNo() : Promise<void>
    {
        setSaving( true );
        if( props.onNo && await props.onNo() )
        {
            sendStatus( "/no" );
            
            //if( props.onSaved )await props.onSaved();
            props.onClose();
        }
        setSaving( false );
    }


    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    async function onTertiary() : Promise<void>
    {
        setSaving( true );
        if( props.onTertiary && await props.onTertiary() )
        {
            sendStatus( "/maybe" );
        }
        setSaving( false );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function readyChanged() : void
    {
        if( props.ready !== undefined && ready !== props.ready )setReady( props.ready );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClose() : void
    {
        //console.log( 'dialog::onClose', props.id );
        sendStatus( "/cancel" );
        props.onClose();
    }


    // =================================================================================================================
    return  <Dialog     open={ true }
                        fullWidth={ true }
                        disablePortal={ false }
                        fullScreen={ props.fullScreen }
                        maxWidth={ props.minWidth ? props.minWidth as Breakpoint: "sm" as Breakpoint }
                        slotProps={ props.minHeight !== undefined ? { paper: { sx: { minHeight: props.minHeight } } } : undefined } // { paper: { sx: { mt: 6 } } }
                        //sx={ { '& .MuiDialog-container': { alignItems: 'flex-start' } } }
                        >
                <DialogTitle id={ props.id + "-title" }>
                    <Stack direction="row" sx={ { p: 0 } }>
                        <TextLabel variant="h5" padding={ { top : props.titleAction !== undefined ? 1 : 0 } } value={ props.title } />
                        { props.titleAction ? <Pusher /> : null }
                        { props.titleAction ? props.titleAction : null }
                    </Stack>
                    
                </DialogTitle>
                <Divider />
                <DialogContent sx={ { p: 0,
                                    overflow: props.noScroll != undefined && props.noScroll ? "hidden" : "auto",
                                    height: props.height != undefined ? props.height : "auto" } }>

                        { props.children }

                </DialogContent>
                <Divider />
                <DialogActions>

                    { props.helpUrl !== undefined ? <HelpButton id="help" value={ props.helpUrl } /> : null }
                    { props.moreAction !== undefined && props.moreAction !== null ? props.moreAction : null }
                    
                    <Pusher />

                    { /* ---------------------- mobile actions ------------------------ */ }
                    <Show show={ BrowserUtils.isMobile }>
                        <>
                            { props.cancelLabel !== undefined ?
                            <ButtonIcon
                                id="cancel"
                                icon={ props.cancelIcon ? props.cancelIcon : <CancelOutlinedIcon /> }
                                disabled={ saving }
                                label={ props.cancelLabel }
                                onClick={ onClose }
                                />
                            : null }

                            { props.tertiaryLabel !== undefined && props.onTertiary !== undefined ?
                                <ButtonIcon
                                        id="tertiary"
                                        icon={ props.tertiaryIcon ? props.tertiaryIcon : <RadioButtonUncheckedOutlinedIcon /> }
                                        disabled={ saving || !ready }
                                        label={ props.tertiaryLabel }
                                        onClick={ () => onTertiary() }
                                        />
                            : null }

                            { props.noLabel !== undefined && props.onNo !== undefined ?
                                <ButtonIcon
                                        id="no"
                                        icon={ props.noIcon ? props.noIcon : <DoNotDisturbAltOutlinedIcon /> }
                                        disabled={ saving || !ready }
                                        label={ props.noLabel }
                                        onClick={ () => onNo() }
                                        />
                                    : null }

                            <ButtonIcon
                                        id="yes"
                                        icon={ props.yesIcon ? props.yesIcon : <CheckCircleOutlineOutlinedIcon color="primary" /> }
                                        disabled={ saving || !ready }
                                        label={ props.yesLabel }
                                        onClick={ () => onYes() }
                                        />

                        </>
                    </Show>

                    { /* ---------------------- desktop actions ------------------------ */ }
                    <Show show={ !BrowserUtils.isMobile }>
                        <>
                        { props.cancelLabel !== undefined ?
                        <Button variant="outlined"
                                disabled={ saving }
                                onClick={ () => onClose() } >{ props.cancelLabel }</Button>
                            : null }

                        { props.tertiaryLabel !== undefined && props.onTertiary !== undefined ?
                        <Button variant="outlined"
                                disabled={ saving || !ready }
                                onClick={ () => onTertiary() } >{ props.tertiaryLabel }</Button>
                            : null }

                        { props.noLabel !== undefined && props.onNo !== undefined ?
                        <Button variant="outlined"
                                disabled={ saving || !ready }
                                color={ props.noColor !== undefined ? props.noColor : "primary" }
                                onClick={ () => onNo() } >{ props.noLabel }</Button>
                            : null }

                        <Button variant="contained"
                                disabled={ saving || !ready }
                                startIcon={ props.yesIcon ? props.yesIcon : undefined }
                                loading={ saving } 
                                loadingPosition="end"
                                onClick={ () => onYes() } >{ props.yesLabel }
                        </Button>
                        </>
                    </Show>

                    

                </DialogActions>

            </Dialog>;

}

/**
 * DialogWindow component that display a dialog window of content.
 *
 * @param props.id - ID of the dialog window
 * @param props.title - Title of the top banner of the dialog window
 * @param props.ready - Optional ready state.  When true, the affirmative action will be enabled

 * @param props.yesLabel - Label of the right most, affirmative button
 * @param props.noLabel - Optional label of the second button to the right.  When not provided, the button will not be displayed.
 * @param props.cancelLabel - Optional label on the cancel button.  When not provided, the cancel button will not be displayed.

 * @param props.noColor - Optional theme color of the "no" or non-affirming action button.

 * @param props.children - Reeact components to be displayed in the body of the dialog window
 * @param props.moreAction - Optional React components to be added to the action area of the dialog window, on the left hand side.

 * @param props.minWidth - Optional designation of the relative width of the dialog.  By default, the window is "sm" for small.
 * @param props.height - Optional height of the dialog.  Otherwise, the children will determine the height of the window.
 * @param props.noScroll - Optional property to not allow the children to have a scroll bar if the children grows ataller than the height of the window.
 * @param props.noReport - Optional property to not report the window being opened to Google Analytics.

 * @param props.onYes - Async callback when the user select the affirmative action in the window.
 * @param props.onNo - Optional async callback when the user select the non-affirming action in the window.
 * @param props.onClose - Callback when the user selects the cancel button or when the affirming action returns true.
 * @param props.onSaved - Optional callback after the onYes callback returns true.  Since that also will close the window.  Allowing the parent compoent to know when successful affirming action is complete.
 */
export namespace DialogWindow
{

    export interface Props
    {
        id              : string;
        title           : string;
        helpUrl?        : string;

        ready?          : boolean;      // if the state is ready to be saved
        
        yesLabel        : string;       // affirm/yes label
        noLabel?        : string;       // not affirm/no label
        tertiaryLabel?  : string;
        cancelLabel?    : string;       // cancel, do nothing label

  
        yesIcon?        : JSX.Element;  // add or mobile override
        noIcon?         : JSX.Element;  // override mobile
        cancelIcon?     : JSX.Element;  // override mobile
        tertiaryIcon?   : JSX.Element;  // override mobile

        noColor?        : "primary" | "error";

        children        : JSX.Element | Array<JSX.Element | null> | null;
        moreAction?     : JSX.Element | null;
        titleAction?    : JSX.Element | null;

        minWidth?       : "xs" | "sm" | "md" | "lg" | "xl";
        fullScreen?     : boolean;
        height?         : number;
        minHeight?      : number;
        noScroll?       : boolean;

        noReport?       : boolean;

        stickyTop?      : number;

        onYes           : () => Promise<boolean>;       // async function onYes() : Promise<boolean>
        onNo?           : () => Promise<boolean>;       // async function onNo() : Promise<boolean>
        onTertiary?     : () => Promise<boolean>;       // async function onTertiary() : Promise<boolean>
        onClose         : () => void;                   // just close / cancel
        onSaved?        : () => void;                   // save complete
    }
}


export default DialogWindow;

// eof