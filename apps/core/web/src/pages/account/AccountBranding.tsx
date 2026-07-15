import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";

import { Access } from '@repo/system';
import { Account, GetAccount, PutAccount } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage        from '@widgets/app/AuthPage';
import PaletteEditor   from '@widgets/core/PaletteEditor';
import BrandFontEditor from '@widgets/core/BrandFontEditor';
import BrandSvgEditor  from '@widgets/core/BrandSvgEditor';
import SaveBar         from '@widgets/app/SaveBar';
import AccountChange   from '@widgets/app/AccountChange';

//
// Account : Branding — the account's brand identity (color palette + fonts) used across content creation, the
// image editor, and image search. Split out of Account : Details so branding has its own home. Admins edit +
// Save; other members see it read-only.
//
export function AccountBranding( props : AccountBranding.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const editable : boolean = Access.isAllowed( appmodel.auth.role(), Access.AccountRole.ACCOUNT );

    const [account,setAccount]     = React.useState< Account.Entity | null >( null );
    const [loading,setLoading]     = React.useState< boolean >( true );
    const [error,setError]         = React.useState< string >( "" );
    const [palette,setPalette]     = React.useState< Array<string> >( [] );
    const [fonts,setFonts]         = React.useState< Array<Account.BrandFont> >( [] );
    const [svgs,setSvgs]           = React.useState< Array<Account.BrandSvg> >( [] );
    const [original,setOriginal]   = React.useState< { palette : Array<string>; fonts : Array<Account.BrandFont>; svgs : Array<Account.BrandSvg> } | null >( null );
    const [saveError,setSaveError] = React.useState< string >( "" );

    const dirty : boolean = original !== null && JSON.stringify( { palette, fonts, svgs } ) !== JSON.stringify( original );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [] );

    function componentLoaded() : void { void load(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        setError( "" );
        const reply : RestfulService.Reply<GetAccount.Response> = await appmodel.server.fetch( new GetAccount() );
        setLoading( false );
        if( reply.ok && reply.data )
        {
            setAccount( reply.data );
            setPalette( reply.data.palette ?? [] );
            setFonts( reply.data.fonts ?? [] );
            setSvgs( reply.data.svgs ?? [] );
            setOriginal( { palette: reply.data.palette ?? [], fonts: reply.data.fonts ?? [], svgs: reply.data.svgs ?? [] } );
        }
        else setError( "Could not load the account." );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onReset() : void
    {
        setSaveError( "" );
        if( original === null ) return;
        setPalette( original.palette );
        setFonts( original.fonts );
        setSvgs( original.svgs );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // returns true on success (SaveBar flashes the green "Saved" chip); false shows the error text
    async function onSave() : Promise<boolean>
    {
        setSaveError( "" );
        const update : Account.Update = { palette, fonts, svgs };
        const reply : RestfulService.Reply<PutAccount.Response> = await appmodel.server.fetch( new PutAccount( update ) );
        if( reply.ok && reply.data )
        {
            setAccount( reply.data );
            setOriginal( { palette, fonts, svgs } );
            return true;
        }
        setSaveError( "Could not save branding. Please try again." );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // account switched away / cleared — drop local state so the next account loads fresh
    function onAccountCleared() : void
    {
        setAccount( null );
        setOriginal( null );
    }

    // account (re)selected — reload for the new acting account
    function onAccountRefresh() : void
    {
        if( Access.isAllowed( appmodel.auth.role(), Access.AccountRole.USER ) ) void load();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Account : Branding"}>
                <Box sx={{ p: 2, pb: editable ? 12 : 2, mx: "auto" }}>

                    { loading && <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                    { !loading && error !== "" && <Typography variant="body2" sx={{ color: "error.main", p: 2 }}>{ error }</Typography> }

                    { !loading && account &&
                        <Stack spacing={ 2 }>
                            <Card variant="outlined">
                                <CardHeader title={"Theme"} subheader={"Brand colors and fonts used across content creation, the image editor, and image search."} />
                                <Divider />
                                <CardContent>
                                    <Stack spacing={ 3 }>
                                        <PaletteEditor label={"Colors"} value={ palette } readOnly={ !editable } onChange={ setPalette } />
                                        <BrandFontEditor label={"Fonts"} value={ fonts } readOnly={ !editable } onChange={ setFonts } />
                                        <BrandSvgEditor label={"Graphics"} value={ svgs } readOnly={ !editable } onChange={ setSvgs } />
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Stack>
                    }
                </Box>

                { editable && !loading && account &&
                    <SaveBar dirty={ dirty } error={ saveError } onReset={ onReset } onSave={ onSave } />
                }

                <AccountChange onClear={ onAccountCleared } onRefresh={ onAccountRefresh } />
            </AuthPage>;
}

export namespace AccountBranding
{
    export interface Props
    {
    }
}

export default AccountBranding;
