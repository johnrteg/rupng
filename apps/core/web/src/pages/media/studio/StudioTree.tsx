//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, Collapse, List, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import ExpandMoreIcon      from '@mui/icons-material/ExpandMore';
import ExpandLessIcon      from '@mui/icons-material/ExpandLess';
import FolderOutlinedIcon  from '@mui/icons-material/FolderOutlined';
import ImageOutlinedIcon   from '@mui/icons-material/ImageOutlined';
import MovieOutlinedIcon   from '@mui/icons-material/MovieOutlined';
import AudiotrackOutlinedIcon from '@mui/icons-material/AudiotrackOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';

import { Media } from '@repo/api';

//
// StudioTree — the Studio's LEFT project directory: the account's editable assets grouped into first-level
// folders by CAMPAIGN (an asset appears under each of its campaigns; assets with none fall under "Unassigned").
// Folders collapse individually; selecting an asset drives the editor pane (the parent owns selection + the
// panel's open/closed state). Presentation-only. (Campaign display names await a campaigns service — the
// folder is keyed/labelled by campaignId for now.)
//
export function StudioTree( props : StudioTree.Props ) : JSX.Element
{
    // group assets into campaign folders; the sentinel key collects assets with no campaign
    const folders : Array<StudioTree.Folder> = React.useMemo<Array<StudioTree.Folder>>( () => StudioTree.group( props.assets ), [ props.assets ] );

    const [openFolders,setOpenFolders] = React.useState< Set<string> >( () => new Set( folders.map( ( folder : StudioTree.Folder ) => folder.key ) ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // toggle a folder open/closed
    function toggleFolder( key : string ) : void
    {
        setOpenFolders( ( prior : Set<string> ) : Set<string> =>
        {
            const next : Set<string> = new Set( prior );
            ( next.has( key ) ? next.delete( key ) : next.add( key ) );
            return next;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the kind icon for an asset row
    function kindIcon( kind : Media.Kind ) : JSX.Element
    {
        if( kind === Media.Kind.IMAGE ) return <ImageOutlinedIcon fontSize="small" />;
        if( kind === Media.Kind.VIDEO ) return <MovieOutlinedIcon fontSize="small" />;
        if( kind === Media.Kind.AUDIO ) return <AudiotrackOutlinedIcon fontSize="small" />;
        return <InsertDriveFileOutlinedIcon fontSize="small" />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one asset row under a folder
    function assetRow( asset : Media.Asset ) : JSX.Element
    {
        return  <ListItemButton key={ `${ asset.guid }` } selected={ props.selectedGuid === asset.guid } onClick={ () => props.onSelect( asset ) } sx={{ borderRadius: 1, py: 0.25, pl: 3 }}>
                    <ListItemIcon sx={{ minWidth: 30, color: "text.secondary" }}>{ kindIcon( asset.kind ) }</ListItemIcon>
                    <ListItemText primary={ asset.name } sx={{ "& .MuiListItemText-primary": { fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }} />
                </ListItemButton>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <List dense disablePadding>
                { folders.length === 0 &&
                    <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"No editable media yet."}</Typography> }

                { folders.map( ( folder : StudioTree.Folder ) => (
                    <Box key={ folder.key }>
                        <ListItemButton onClick={ () => toggleFolder( folder.key ) } sx={{ borderRadius: 1, py: 0.5 }}>
                            <ListItemIcon sx={{ minWidth: 30, color: "text.secondary" }}><FolderOutlinedIcon fontSize="small" /></ListItemIcon>
                            <ListItemText primary={ folder.label } sx={{ "& .MuiListItemText-primary": { fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }} />
                            <Chip size="small" variant="outlined" label={ folder.assets.length } sx={{ height: 18, mr: 0.5 }} />
                            { openFolders.has( folder.key ) ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" /> }
                        </ListItemButton>
                        <Collapse in={ openFolders.has( folder.key ) } timeout="auto" unmountOnExit>
                            { folder.assets.map( ( asset : Media.Asset ) => assetRow( asset ) ) }
                        </Collapse>
                    </Box>
                ) ) }
            </List>;
}

export namespace StudioTree
{
    /** The sentinel folder key/label for assets not tied to any campaign. */
    export const UNASSIGNED : string = "__unassigned__";

    /** One campaign folder + the assets under it. */
    export interface Folder { key : string; label : string; assets : Array<Media.Asset>; }

    /** Group assets into campaign folders (an asset under each of its campaigns; none → Unassigned), sorted
     *  with real campaigns first (by id) and Unassigned last. Only editable kinds (image/video/audio) show. */
    export function group( assets : Array<Media.Asset> ) : Array<Folder>
    {
        const editable : Array<Media.Asset> = assets.filter( ( asset : Media.Asset ) : boolean =>
            asset.kind === Media.Kind.IMAGE || asset.kind === Media.Kind.VIDEO || asset.kind === Media.Kind.AUDIO );

        const byCampaign : Map<string, Array<Media.Asset>> = new Map<string, Array<Media.Asset>>();
        for( const asset of editable )
        {
            const keys : Array<string> = asset.campaignIds.length > 0 ? asset.campaignIds : [ UNASSIGNED ];
            for( const key of keys )
            {
                const bucket : Array<Media.Asset> = byCampaign.get( key ) ?? [];
                bucket.push( asset );
                byCampaign.set( key, bucket );
            }
        }

        const folders : Array<Folder> = [ ...byCampaign.entries() ].map( ( [ key, list ] : [ string, Array<Media.Asset> ] ) : Folder =>
            ( { key, label: key === UNASSIGNED ? "Unassigned" : key, assets: list } ) );
        folders.sort( ( left : Folder, right : Folder ) : number =>
            left.key === UNASSIGNED ? 1 : right.key === UNASSIGNED ? -1 : left.label.localeCompare( right.label ) );
        return folders;
    }

    export interface Props
    {
        assets      : Array<Media.Asset>;
        selectedGuid : string | null;
        onSelect    : ( asset : Media.Asset ) => void;
    }
}

export default StudioTree;
// eof
