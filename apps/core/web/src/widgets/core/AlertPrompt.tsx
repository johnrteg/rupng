//
import React from 'react';
import { JSX } from "react";

//
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Divider, Stack, Typography } from '@mui/material';

import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import HelpCenterOutlinedIcon from '@mui/icons-material/HelpCenterOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import DoNotDisturbAltOutlinedIcon from '@mui/icons-material/DoNotDisturbAltOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';

import Show from './Show';
import ButtonIcon from './ButtonIcon';
import BrowserUtils from '@utils/BrowserUtils';
import { useIsMobile } from '../../utils/useBreakpoint';

//
//
//
export function AlertPrompt( props : AlertPrompt.Props ) : JSX.Element
{
    const [saving,setSaving]                = React.useState< boolean >( false );

    const isMobile : boolean = useIsMobile();

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    async function onActionSync( action : AlertPrompt.Action ) : Promise<void>
    {
        setSaving( true );
        await props.onAction( action );
        setSaving( false );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function Icon() : JSX.Element | null
    {
        if( props.type )
        {
            switch( props.type )
            {
                case AlertPrompt.Type.ERROR : return <ErrorOutlineOutlinedIcon sx={{fontSize:"3rem"}} color="error"/>; break;
                case AlertPrompt.Type.INFO :  return <InfoOutlinedIcon sx={{fontSize:"3rem"}}  color="info"/>; break;
                case AlertPrompt.Type.QUESTION : return <HelpCenterOutlinedIcon sx={{fontSize:"3rem"}}  color="success"/>; break;
                case AlertPrompt.Type.WARNING : return <WarningAmberOutlinedIcon sx={{fontSize:"3rem"}}  color="warning"/>; break;
            }
        }
        else
        {
            return null;
        }
    }

  // ===============================================================================================
  return (
    <Dialog open={ true } role="alertdialog" >
        <DialogTitle id={ props.id + "-alert-dialog-title" }>
            { props.title }
        </DialogTitle>
        <Divider />
        <DialogContent>
            <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                { Icon() }
                <Stack direction="column" spacing={ 2 }>
                    <Typography>{ props.message }</Typography>
                    { props.secondary ? <Typography>{ props.secondary }</Typography> : null }
                </Stack>
            </Stack>
            
        </DialogContent>
        <Divider />

        { /* ---------------------- mobile actions ------------------------ */ }
        <Show show={ isMobile }>
            <DialogActions>
                { props.cancelText ? <ButtonIcon id="cancel" icon={<CancelOutlinedIcon/>} label={ props.cancelText } disabled={ saving } onClick={ () => onActionSync( AlertPrompt.Action.CANCEL ) } /> : null }
                { props.noText ? <ButtonIcon id="no" icon={<DoNotDisturbAltOutlinedIcon/>} label={ props.noText } disabled={ saving } onClick={ () => onActionSync( AlertPrompt.Action.NO ) } /> : null }
                { props.yesText ? <ButtonIcon id="yes" icon={<CheckCircleOutlinedIcon color="primary"/>} label={ props.yesText } disabled={ saving } onClick={ () => onActionSync( AlertPrompt.Action.YES ) } /> : null }
            </DialogActions>
        </Show>

        { /* ---------------------- desktip actions ------------------------ */ }
        <Show show={ !isMobile }>
            <DialogActions>
                { props.cancelText ? <Button variant="outlined" disabled={ saving } onClick={ () => onActionSync( AlertPrompt.Action.CANCEL ) }>{ props.cancelText }</Button> : null }
                { props.noText     ? <Button variant="outlined" disabled={ saving } onClick={ () => onActionSync( AlertPrompt.Action.NO )     }>{ props.noText }</Button> : null }
                { props.yesText !== null ? <Button variant="contained"
                                                    loading={ saving }
                                                    disabled={ saving }
                                                    loadingPosition="start"
                                                    color={ props.yesColor ? props.yesColor : undefined }
                                                    autoFocus
                                                    onClick={ () => onActionSync( AlertPrompt.Action.YES ) } >{ props.yesText }</Button> : null }
            </DialogActions>
        </Show>
        
      </Dialog>
    );
    // ===============================================================================================
}

export namespace AlertPrompt
{
    export enum Action
    {
        CANCEL  = "cancel",
        NO      = "no",
        YES     = "yes"
    }

    export enum Type
    {
        INFO        = "info",
        WARNING     = "warning",
        ERROR       = "error",
        QUESTION    = "question"
    }

    export interface Props
    {
        id            : string;
        title         : string;
        message       : string;
        secondary?    : string;
        cancelText?   : string;
        noText?       : string;
        yesText       : string | null;
        yesColor?     : "success" | "primary" | "error" | "warning";
        type?         : Type;
        onAction      : ( action : AlertPrompt.Action ) => Promise<void>;
    }
}

export default AlertPrompt;
// eof