import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, CircularProgress, Stack, Tab, Tabs, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

import { Media, Browse, AiRouting, AiGen, GetAssets, GetMediaUrl, PostBrowseSearch, PostBrowseImport, PatchAsset, PostAiGenerate, GetGenerateBatch, PostGeneratePromote } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import TextInput from '@widgets/core/TextInput';
import DialogWindow from '@widgets/core/DialogWindow';

//
// EmailImagePickerDialog — pick an image for an email block from three sources: the account LIBRARY (existing
// assets), a provider BROWSE search (stock), or AI generation. Browse + AI results are imported into the
// library and (when a campaign is in context) tagged to it. You SELECT an image (it highlights), then confirm
// with "Use" (or Cancel). Built on the house DialogWindow (no click-outside dismissal). Self-contained; reuses
// the media endpoints (GetAssets/GetMediaUrl/Browse/AI-gen).
//
export function EmailImagePickerDialog( props : EmailImagePickerDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [tab,setTab]   = React.useState< "library" | "browse" | "ai" >( "library" );
    const [busy,setBusy] = React.useState< boolean >( false );   // importing / promoting / resolving
    const [selected,setSelected] = React.useState< EmailImagePickerDialog.Pick | null >( null );   // library pick (already in library)
    const [browseSelected,setBrowseSelected] = React.useState< Browse.Result | null >( null );      // browse tile chosen; import deferred to "Use"
    const [aiSelected,setAiSelected]         = React.useState< AiGen.Candidate | null >( null );   // AI candidate chosen; promote deferred to "Use"

    // library
    const [assets,setAssets]         = React.useState< Array<{ guid : string; name : string; url : string }> >( [] );
    const [loadingLib,setLoadingLib] = React.useState< boolean >( false );

    // browse
    const [query,setQuery]         = React.useState< string >( "" );
    const [results,setResults]     = React.useState< Array<Browse.Result> >( [] );
    const [searching,setSearching] = React.useState< boolean >( false );

    // ai
    const [prompt,setPrompt]         = React.useState< string >( "" );
    const [batchId,setBatchId]       = React.useState< string | null >( null );
    const [candidates,setCandidates] = React.useState< Array<AiGen.Candidate> >( [] );
    const [generating,setGenerating] = React.useState< boolean >( false );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void loadLibrary(); }, [] );

    function delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve a deliverable URL for an asset — retry a few times (a just-imported asset may briefly be SCANNING)
    async function resolveUrl( guid : string ) : Promise<string>
    {
        for( let attempt : number = 0; attempt < 5; attempt += 1 )
        {
            const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( guid ) );
            if( reply.ok && reply.data ) return reply.data.url;
            await delay( 700 );
        }
        return "";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // LIBRARY — the account's image assets (scoped to the campaign when present), resolved to URLs
    async function loadLibrary() : Promise<void>
    {
        setLoadingLib( true );
        const reply : RestfulService.Reply<GetAssets.Response> = await appmodel.server.fetch( new GetAssets( { kind: Media.Kind.IMAGE, campaignId: props.campaignId } ) );
        if( reply.ok && reply.data )
        {
            const resolved : Array<{ guid : string; name : string; url : string }> = await Promise.all(
                reply.data.records.map( async ( asset : Media.Asset ) : Promise<{ guid : string; name : string; url : string }> => ( { guid: asset.guid, name: asset.name, url: await resolveUrl( asset.guid ) } ) ) );
            setAssets( resolved.filter( ( item : { url : string } ) : boolean => item.url !== "" ) );
        }
        setLoadingLib( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BROWSE — provider search → import into the library (+ campaign) → resolve URL → pick
    async function runSearch() : Promise<void>
    {
        if( query.trim() === "" ) return;
        setSearching( true );
        const reply : RestfulService.Reply<PostBrowseSearch.Response> = await appmodel.server.fetch( new PostBrowseSearch( { text: query.trim(), kinds: [ Media.Kind.IMAGE ] } ) );
        if( reply.ok && reply.data ) setResults( reply.data.results );
        setSearching( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // import a browse result into the library and return a resolved Pick; returns null if the import fails
    async function importAndResolve( result : Browse.Result ) : Promise<EmailImagePickerDialog.Pick | null>
    {
        setBusy( true );
        const imported : RestfulService.Reply<PostBrowseImport.Response> = await appmodel.server.fetch(
            new PostBrowseImport( { provider: result.provider, externalId: result.externalId } ) );
        if( imported.ok && imported.data )
        {
            const guid : string = imported.data.asset.guid;
            if( props.campaignId )
            {
                const tagged : RestfulService.Reply<PatchAsset.Response> = await appmodel.server.fetch( new PatchAsset( guid, { campaignIds: [ props.campaignId ] } ) );
                void tagged;
            }
            const url : string = await resolveUrl( guid );
            setBusy( false );
            return { guid, name: result.title, url };
        }
        setBusy( false );
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // AI — generate → poll the staging batch → promote a candidate into the library (+ campaign) → resolve → pick
    async function runGenerate() : Promise<void>
    {
        if( prompt.trim() === "" ) return;
        setGenerating( true );
        setCandidates( [] );
        const reply : RestfulService.Reply<PostAiGenerate.Response> = await appmodel.server.fetch( new PostAiGenerate( { modality: AiRouting.Modality.IMAGE, prompt: prompt.trim(), count: 2 } ) );
        if( reply.ok && reply.data ) { setBatchId( reply.data.batchId ); void pollBatch( reply.data.batchId, 0 ); }
        else setGenerating( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // poll the batch until candidates are ready (or we give up); show ready ones as they arrive
    async function pollBatch( id : string, attempt : number ) : Promise<void>
    {
        const reply : RestfulService.Reply<GetGenerateBatch.Response> = await appmodel.server.fetch( new GetGenerateBatch( id ) );
        if( reply.ok && reply.data )
        {
            const all : Array<AiGen.Candidate> = reply.data.batch.candidates;
            setCandidates( all.filter( ( candidate : AiGen.Candidate ) : boolean => candidate.status === AiGen.CandidateStatus.READY && candidate.previewUrl !== undefined ) );
            const settled : boolean = all.length > 0 && all.every( ( candidate : AiGen.Candidate ) : boolean => candidate.status === AiGen.CandidateStatus.READY );
            if( settled ) { setGenerating( false ); return; }
        }
        if( attempt < 20 ) { await delay( 1500 ); void pollBatch( id, attempt + 1 ); }
        else setGenerating( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // promote an AI candidate into the library and return a resolved Pick; returns null if the promotion fails
    async function promoteAndResolve( candidate : AiGen.Candidate ) : Promise<EmailImagePickerDialog.Pick | null>
    {
        if( !batchId ) return null;
        setBusy( true );
        const promoted : RestfulService.Reply<PostGeneratePromote.Response> = await appmodel.server.fetch(
            new PostGeneratePromote( batchId, { candidateIds: [ candidate.id ], campaignIds: props.campaignId ? [ props.campaignId ] : undefined } ) );
        if( promoted.ok && promoted.data && promoted.data.assets[ 0 ] )
        {
            const asset : { guid : string; name : string } = promoted.data.assets[ 0 ];
            const url : string = await resolveUrl( asset.guid );
            setBusy( false );
            return { guid: asset.guid, name: asset.name, url };
        }
        setBusy( false );
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // confirm the current selection — library picks pass through immediately; browse/AI items are imported/promoted first
    async function onUse() : Promise<boolean>
    {
        if( selected !== null )
        {
            props.onPick( selected );
            return true;
        }
        if( browseSelected !== null )
        {
            const pick : EmailImagePickerDialog.Pick | null = await importAndResolve( browseSelected );
            if( pick !== null ) { props.onPick( pick ); return true; }
            return false;
        }
        if( aiSelected !== null )
        {
            const pick : EmailImagePickerDialog.Pick | null = await promoteAndResolve( aiSelected );
            if( pick !== null ) { props.onPick( pick ); return true; }
            return false;
        }
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a clickable image tile — heavier border + check-circle badge when selected
    function tile( key : string, src : string, label : string, isSelected : boolean, onClick : () => void ) : JSX.Element
    {
        return (
            <Box key={ key } onClick={ onClick } title={ label }
                 sx={{ position: "relative", width: 120, height: 120, borderRadius: 1, overflow: "hidden",
                       cursor: "pointer", border: isSelected ? 3 : 2, borderColor: isSelected ? "primary.main" : "divider",
                       backgroundImage: `url(${ src })`, backgroundSize: "cover", backgroundPosition: "center",
                       "&:hover": { borderColor: "primary.main" } }}>
                { isSelected &&
                    <Box sx={{ position: "absolute", top: 4, right: 4, bgcolor: "primary.main", borderRadius: "50%",
                               display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22 }}>
                        <CheckCircleIcon sx={{ fontSize: 16, color: "primary.contrastText" }} />
                    </Box> }
            </Box>
        );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <DialogWindow id="email-image-picker" title={"Choose image"} minWidth="md" yesLabel={"Use"} cancelLabel={"Cancel"}
                         ready={ selected !== null || browseSelected !== null || aiSelected !== null } onYes={ onUse } onClose={ props.onClose }>
        <Box sx={{ p: 2 }}>
            <Tabs value={ tab } onChange={ ( _event : React.SyntheticEvent, value : "library" | "browse" | "ai" ) => setTab( value ) } sx={{ mb: 2 }}>
                <Tab value="library" label="Library" />
                <Tab value="browse" label="Browse" />
                <Tab value="ai" label="AI create" />
            </Tabs>

            { busy && <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}><CircularProgress size={ 16 } /><Typography variant="caption">{"Importing…"}</Typography></Box> }

            {/* Library */}
            { tab === "library" && (
                loadingLib
                    ? <CircularProgress size={ 20 } />
                    : assets.length === 0
                        ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No images in the library yet — try Browse or AI create."}</Typography>
                        : <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                              { assets.map( ( asset : { guid : string; name : string; url : string } ) => tile( asset.guid, asset.url, asset.name, selected?.guid === asset.guid, () => setSelected( { guid: asset.guid, name: asset.name, url: asset.url } ) ) ) }
                          </Box> ) }

            {/* Browse */}
            { tab === "browse" && <Stack spacing={ 2 }>
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "flex-end" }}>
                    <Box sx={{ flexGrow: 1 }}><TextInput id="img-browse-q" label={"Search stock providers"} value={ query } onChange={ setQuery } fullWidth /></Box>
                    <Button variant="contained" disabled={ searching } onClick={ () => void runSearch() }>{ searching ? "Searching…" : "Search" }</Button>
                </Stack>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    { results.map( ( result : Browse.Result ) : JSX.Element => tile( `${ result.provider }:${ result.externalId }`, result.thumbnailUrl, result.title,
                          browseSelected !== null && browseSelected.provider === result.provider && browseSelected.externalId === result.externalId,
                          () => setBrowseSelected( result ) ) ) }
                </Box>
                { results.length > 0 && <Typography variant="caption" sx={{ color: "text.disabled" }}>{"Select an image, then click Use to import it."}</Typography> }
            </Stack> }

            {/* AI create */}
            { tab === "ai" && <Stack spacing={ 2 }>
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "flex-end" }}>
                    <Box sx={{ flexGrow: 1 }}><TextInput id="img-ai-prompt" label={"Describe the image"} value={ prompt } onChange={ setPrompt } fullWidth /></Box>
                    <Button variant="contained" disabled={ generating } onClick={ () => void runGenerate() }>{ generating ? "Generating…" : "Generate" }</Button>
                </Stack>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    { candidates.map( ( candidate : AiGen.Candidate ) : JSX.Element => tile( candidate.id, candidate.previewUrl ?? "", "candidate",
                          aiSelected?.id === candidate.id,
                          () => setAiSelected( candidate ) ) ) }
                </Box>
                { candidates.length > 0 && <Typography variant="caption" sx={{ color: "text.disabled" }}>{"Select a result, then click Use to add it to the library."}</Typography> }
            </Stack> }
        </Box>
    </DialogWindow>;
}

export namespace EmailImagePickerDialog
{
    /** A picked library image — a durable REFERENCE (guid + name), plus a resolved preview URL and the chosen
     *  ORIGINAL/library name for display. Email blocks store the reference (not the URL) so the variant can be
     *  re-picked and the URL re-resolved. */
    export interface Pick { guid : string; name : string; url : string; }

    export interface Props
    {
        campaignId? : string;                        // imports are tagged to this campaign when present
        onPick      : ( pick : Pick ) => void;       // chosen library image (reference + a resolved preview URL)
        onClose     : () => void;
    }
}

export default EmailImagePickerDialog;
// eof
