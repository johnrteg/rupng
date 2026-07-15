import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, CircularProgress, Stack, Typography } from "@mui/material";

import { Media, GetVariantSpecs, PostAssetVariants } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import SelectInput  from '@widgets/core/SelectInput';

//
// GenerateVariantsDialog — request (re)generation of a named variant profile for an asset (media-4.6). Loads
// the configured profiles (GetVariantSpecs), lets the user pick one, shows the specs that apply to THIS asset's
// mime, then kicks off processing (PostAssetVariants — async). The parent snacks + reloads; variants appear on
// the asset (and its expanded row) once processing completes.
//
export function GenerateVariantsDialog( props : GenerateVariantsDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [profiles,setProfiles] = React.useState< Record<string, Array<Media.VariantSpec>> >( {} );
    const [profile,setProfile]   = React.useState< string >( "" );
    const [loading,setLoading]   = React.useState< boolean >( true );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => void load(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetVariantSpecs.Response> = await appmodel.server.fetch( new GetVariantSpecs() );
        if( reply.ok && reply.data )
        {
            setProfiles( reply.data.profiles );
            const names : Array<string> = Object.keys( reply.data.profiles );
            if( names.length > 0 ) setProfile( names[ 0 ] );
        }
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // does a spec's source-mime matcher apply to this envelope's ORIGINAL? ("image/*" / exact / "*")
    function specApplies( spec : Media.VariantSpec ) : boolean
    {
        const sourceMime : string = Media.originalItem( props.asset )?.mime ?? "";
        const pattern : string = spec.mime;
        if( !pattern || pattern === "*" || pattern === "*/*" ) return true;
        if( pattern.endsWith( "/*" ) ) return sourceMime.startsWith( pattern.slice( 0, -1 ) );
        return pattern === sourceMime;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const applicable : Array<Media.VariantSpec> = ( profiles[ profile ] ?? [] ).filter( specApplies );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // kick off generation → true on success (dialog closes; parent reloads)
    async function onGenerate() : Promise<boolean>
    {
        if( profile === "" ) return false;
        const reply : RestfulService.Reply<PostAssetVariants.Response> = await appmodel.server.fetch( new PostAssetVariants( props.asset.guid, { profile } ) );
        return props.onStarted( reply.ok );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const choices : Array<SelectInput.Choice> = Object.keys( profiles ).map( ( name ) => ( { value: name, label: name } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-generate-variants"
                          title={"Generate variants"}
                          yesLabel={"Generate"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ !loading && profile !== "" && applicable.length > 0 }
                          onYes={ onGenerate }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>

                    { loading &&
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading profiles…"}</Typography></Stack> }

                    { !loading && choices.length === 0 &&
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No variant profiles are configured."}</Typography> }

                    { !loading && choices.length > 0 &&
                        <>
                            <SelectInput id="variant-profile" label={"Profile"} value={ profile } choices={ choices } onChange={ setProfile } sx={{ width: "100%" }} />

                            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                { applicable.length > 0 ? "These variants will be produced for this file:" : "This profile has no variants for this file type." }
                            </Typography>

                            <Stack direction="row" spacing={ 1 } sx={{ flexWrap: "wrap", gap: 1 }}>
                                { applicable.map( ( spec, index ) =>
                                    <Chip key={ `${ spec.label ?? "spec" }-${ index }` } size="small" variant="outlined"
                                          label={ `${ spec.label ?? profile }${ spec.width ? ` · ${ spec.width }${ spec.height ? `×${ spec.height }` : "w" }` : "" }` } />
                                ) }
                            </Stack>

                            <Box>
                                <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Generation runs in the background; variants appear once processing completes."}</Typography>
                            </Box>
                        </>
                    }

                </Stack>
            </DialogWindow>;
}

export namespace GenerateVariantsDialog
{
    export interface Props
    {
        asset      : Media.Asset;
        onStarted  : ( ok : boolean ) => boolean;   // report result to parent; return true to close
        onClose    : () => void;
    }
}

export default GenerateVariantsDialog;
// eof
