import AppModel from "@model/AppModel";
//
import React from "react";
import { JSX } from "react";

import { Box, Button, CircularProgress, FormControlLabel, Radio, RadioGroup, Stack, Typography } from "@mui/material";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";

import { SvgDocument } from "@repo/api";
import { Type } from "@repo/common";
import JSZip from "jszip";

import DialogWindow from "@widgets/core/DialogWindow";
import { Manifest, ManifestAsset } from "@widgets/svg/editor/SvgItemExportModel";
import { AssetCheck, AssetDecision, parseImportBundle, checkExistingAssets, materializeAssets, buildImportPayload } from "@widgets/svg/editor/SvgItemImport";

//
// SvgItemImportDialog — the reverse of the layers panel's "Export Item…": pick a previously-exported `.zip`
// item bundle, check each referenced image's original Media Library id against this account's library, let
// the user resolve any found conflicts (use the existing asset vs import a fresh copy — assets that aren't
// found are imported automatically, no prompt), then hand the materialized `{ object, assets }` back to the
// caller to dispatch as `IMPORT_ITEM`. Built on the house DialogWindow, mirroring SvgAssetPickerDialog.
//
export function SvgItemImportDialog( props : SvgItemImportDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [ manifest, setManifest ] = React.useState<Manifest | null>( null );
    const [ zip, setZip ]           = React.useState<JSZip | null>( null );
    const [ checks, setChecks ]     = React.useState<Array<AssetCheck>>( [] );
    const [ decisions, setDecisions ] = React.useState<Record<string, AssetDecision>>( {} );

    const [ checking, setChecking ] = React.useState<boolean>( false );   // resolving asset existence
    const [ busy, setBusy ]         = React.useState<boolean>( false );   // materializing on Import
    const [ error, setError ]       = React.useState<string>( "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // pick a bundle — parse it, then check every referenced asset's original mediaId against this
    // account's library so the conflict rows below know whether to prompt
    async function onFileChosen( event : React.ChangeEvent<HTMLInputElement> ) : Promise<void>
    {
        const file : File | undefined = event.target.files?.[ 0 ];
        if( !file ) return;
        setError( "" );
        setChecking( true );

        const parsed : Type.Result<{ manifest : Manifest; zip : JSZip }> = await parseImportBundle( file );
        if( !parsed.ok )
        {
            setChecking( false );
            setError( parsed.error );
            return;
        }

        const found : Array<AssetCheck> = await checkExistingAssets( parsed.data.manifest, appmodel );
        // default every found conflict to "use existing" — the recommended, least-surprising choice
        const defaults : Record<string, AssetDecision> = {};
        for( const check of found ) if( check.found ) defaults[ check.manifestAssetId ] = "existing";

        setManifest( parsed.data.manifest );
        setZip( parsed.data.zip );
        setChecks( found );
        setDecisions( defaults );
        setChecking( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onDecisionChanged( manifestAssetId : string, decision : AssetDecision ) : void
    {
        setDecisions( ( current : Record<string, AssetDecision> ) : Record<string, AssetDecision> => ( { ...current, [ manifestAssetId ]: decision } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // materialize every asset (reuse or upload), remap the object subtree onto the results, hand it up
    async function onImport() : Promise<boolean>
    {
        if( manifest === null || zip === null ) return false;
        setBusy( true );
        setError( "" );

        const materialized : Type.Result<{ idMap : Record<string, string>; assets : Array<SvgDocument.Asset> }> =
            await materializeAssets( manifest, zip, decisions, appmodel );
        setBusy( false );
        if( !materialized.ok ) { setError( materialized.error ); return false; }

        const payload : { object : SvgDocument.ObjectNode } = buildImportPayload( manifest, materialized.data.idMap );
        props.onImported( { object: payload.object, assets: materialized.data.assets } );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one conflicting-asset row — a found source offers the use-existing/import-new choice; a not-found
    // source has nothing to decide (it always imports as new, silently)
    function assetRow( asset : ManifestAsset, check : AssetCheck ) : JSX.Element
    {
        return  <Stack key={ asset.id } spacing={ 0.5 } sx={{ py: 0.5 }}>
                    <Typography variant="body2">{ asset.name }</Typography>
                    { check.found
                        ? <RadioGroup row value={ decisions[ asset.id ] ?? "existing" }
                                      onChange={ ( _event : React.ChangeEvent<HTMLInputElement>, value : string ) : void => onDecisionChanged( asset.id, value as AssetDecision ) }>
                              <FormControlLabel value="existing" control={ <Radio size="small" /> } label={"Use existing"} />
                              <FormControlLabel value="new"      control={ <Radio size="small" /> } label={"Import as new copy"} />
                          </RadioGroup>
                        : <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Not found in this library — will import as new"}</Typography> }
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( !props.open ) return <></>;
    return <DialogWindow id="svg-item-import" title={"Import Item"} minWidth="sm" yesLabel={"Import"} cancelLabel={"Cancel"}
                         ready={ manifest !== null && !checking && !busy } onYes={ onImport } onClose={ props.onClose }>
        <Box sx={{ p: 2 }}>
            <Stack spacing={ 2 }>
                <Button component="label" variant="outlined" startIcon={ <UploadFileOutlinedIcon /> } sx={{ alignSelf: "flex-start" }}>
                    {"Choose an item file"}
                    <input type="file" accept=".zip" hidden onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => void onFileChosen( event ) } />
                </Button>

                { checking && <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><CircularProgress size={ 16 } /><Typography variant="caption">{"Checking referenced images…"}</Typography></Box> }
                { error !== "" && <Typography variant="body2" sx={{ color: "error.main" }}>{ error }</Typography> }

                { manifest !== null && !checking &&
                    <Stack spacing={ 1 }>
                        <Typography variant="body2">{ manifest.object.name }</Typography>
                        { checks.length > 0 &&
                            <Stack spacing={ 1 } sx={{ pl: 1, borderLeft: 2, borderColor: "divider" }}>
                                { checks.map( ( check : AssetCheck ) : JSX.Element | null =>
                                {
                                    const asset : ManifestAsset | undefined = manifest.assets.find( ( candidate : ManifestAsset ) : boolean => candidate.id === check.manifestAssetId );
                                    return asset === undefined ? null : assetRow( asset, check );
                                } ) }
                            </Stack> }
                        { busy && <CircularProgress size={ 16 } /> }
                    </Stack> }
            </Stack>
        </Box>
    </DialogWindow>;
}

export namespace SvgItemImportDialog
{
    export interface Props
    {
        open       : boolean;
        onImported : ( payload : { object : SvgDocument.ObjectNode; assets : Array<SvgDocument.Asset> } ) => void;
        onClose    : () => void;
    }
}

export default SvgItemImportDialog;
// eof
