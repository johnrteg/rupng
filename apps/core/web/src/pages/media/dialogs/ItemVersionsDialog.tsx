import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined';

import { Media, GetItemVersions, PostItemRevert } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow  from '@widgets/core/DialogWindow';
import ButtonIcon    from '@widgets/core/ButtonIcon';
import AlertPrompt   from '@widgets/core/AlertPrompt';

//
// ItemVersionsDialog — the S3 version history of a single ITEM within an envelope (media-1.4). Lists the
// stored versions (newest first) and lets the user revert to a prior one; reverting copies that version back
// onto the current key (a new latest version — nothing is destroyed). The parent owns open/close and reports;
// this dialog owns its own load + revert-confirm state.
//
export function ItemVersionsDialog( props : ItemVersionsDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const itemKey : string = Media.itemKey( props.item.usage, props.item.profile );

    const [versions,setVersions] = React.useState< Array<Media.ItemVersion> >( [] );
    const [loading,setLoading]   = React.useState< boolean >( true );
    const [pending,setPending]   = React.useState< Media.ItemVersion | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => void load(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the item's S3 version history (newest first)
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetItemVersions.Response> = await appmodel.server.fetch( new GetItemVersions( props.asset.guid, itemKey ) );
        if( reply.ok && reply.data ) setVersions( reply.data.versions );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the revert alert-prompt action: on YES revert to the pending version + report to parent; else dismiss
    async function onRevertAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( action === AlertPrompt.Action.YES && pending )
        {
            const reply : RestfulService.Reply<PostItemRevert.Response> = await appmodel.server.fetch( new PostItemRevert( props.asset.guid, { item: itemKey, versionId: pending.versionId } ) );
            props.onReverted( reply.ok );
        }
        setPending( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a human label for the item this history belongs to (title context)
    function itemLabel() : string
    {
        const usage : string = props.item.usage.charAt( 0 ).toUpperCase() + props.item.usage.slice( 1 );
        return props.item.profile ? `${ usage } · ${ props.item.profile }` : usage;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-item-versions"
                          title={ `Versions — ${ itemLabel() }` }
                          yesLabel={"Done"}
                          minWidth="sm"
                          onYes={ () => Promise.resolve( true ) }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{ `${ props.asset.name } — revert to restore an earlier version of this item.` }</Typography>

                    { loading &&
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }

                    { !loading && versions.length === 0 &&
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No version history for this item yet."}</Typography> }

                    { !loading && versions.length > 0 &&
                        <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", columnGap: 2, rowGap: 1, alignItems: "center" }}>
                            {/* header */}
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>{"When"}</Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Version"}</Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Size"}</Typography>
                            <Box />
                            {/* rows */}
                            { versions.map( ( version ) =>
                                <React.Fragment key={ version.versionId }>
                                    <Typography variant="body2">{ appmodel.ui.locale.date_time_normal.format( new Date( version.lastModified ) ) }</Typography>
                                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", minWidth: 0 }}>
                                        <Typography variant="body2" noWrap>{ version.versionId }</Typography>
                                        { version.isLatest && <Chip size="small" variant="outlined" color="success" label={"Current"} /> }
                                    </Stack>
                                    <Typography variant="body2">{ appmodel.ui.locale.bytes( version.size ) }</Typography>
                                    <ButtonIcon id={ `revert-${ version.versionId }` } icon={ <ReplayOutlinedIcon fontSize="small" /> } label={"Revert to this version"} size="small" disabled={ version.isLatest } onClick={ () => setPending( version ) } />
                                </React.Fragment>
                            ) }
                        </Box> }
                </Stack>

                { pending &&
                    <AlertPrompt id="media-item-revert-confirm"
                                 type={ AlertPrompt.Type.QUESTION }
                                 title={"Revert item"}
                                 message={ `Revert "${ itemLabel() }" to the version from ${ appmodel.ui.locale.date_time_normal.format( new Date( pending.lastModified ) ) }? This creates a new current version from those bytes.` }
                                 yesText={"Revert"}
                                 cancelText={"Cancel"}
                                 onAction={ onRevertAction } /> }
            </DialogWindow>;
}

export namespace ItemVersionsDialog
{
    export interface Props
    {
        asset      : Media.Asset;
        item       : Media.Item;
        onReverted : ( ok : boolean ) => boolean;   // report result to parent; return true to close
        onClose    : () => void;
    }
}

export default ItemVersionsDialog;
// eof
