import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, FormControlLabel, Slider, Stack, Switch, Tab, Tabs, Typography } from "@mui/material";
import ImageOutlinedIcon        from '@mui/icons-material/ImageOutlined';
import MovieOutlinedIcon        from '@mui/icons-material/MovieOutlined';
import RecordVoiceOverOutlinedIcon from '@mui/icons-material/RecordVoiceOverOutlined';
import GraphicEqOutlinedIcon    from '@mui/icons-material/GraphicEqOutlined';
import AutoAwesomeOutlinedIcon  from '@mui/icons-material/AutoAwesomeOutlined';

import { Access } from '@repo/system';
import { AiRouting, AiGen, Media, PostAiGenerate, DeleteAsset, GetAsset, GetMediaUrl, GetVoices } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage    from '@widgets/app/AuthPage';
import TextInput   from '@widgets/core/TextInput';
import SelectInput from '@widgets/core/SelectInput';
import AudioInput  from '@widgets/core/AudioInput';
import SnackAlert  from '@widgets/core/SnackAlert';
import AccountChange from '@widgets/app/AccountChange';
import AiGenSaveDialog from '@pages/media/dialogs/AiGenSaveDialog';

/** One generative surface (a tab) mapped to its AiRouting modality. */
interface TabDef { label : string; icon : JSX.Element; modality : AiRouting.Modality; }

// the generative surfaces (one tab each), mapped to their AiRouting modality
const TABS : Array<TabDef> =
[
    { label: "Image", icon: <ImageOutlinedIcon />,            modality: AiRouting.Modality.IMAGE },
    { label: "Video", icon: <MovieOutlinedIcon />,            modality: AiRouting.Modality.VIDEO },
    { label: "Voice", icon: <RecordVoiceOverOutlinedIcon />,  modality: AiRouting.Modality.TEXT_TO_SPEECH },
    { label: "Sound", icon: <GraphicEqOutlinedIcon />,        modality: AiRouting.Modality.SOUND },
];

const PROVIDER_AUTO : string = "";   // "" = use the account's config/ai route for the modality

//
// Media : AI Gen — create NEW assets from prompts (distinct from Browse, which acquires EXISTING assets).
// One tab per generative modality; each renders the normalized provider attributes (AiGen.attributesFor) as a
// dynamic form, generates a preview via PostAiGenerate, and lets the user name + tag it before saving to the
// Library (or discarding). Provider is the account default (config/ai) unless overridden per generation.
//
export function MediaAiGen( props : MediaAiGen.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [tabIndex,setTabIndex] = React.useState< number >( 0 );
    const [provider,setProvider] = React.useState< string >( PROVIDER_AUTO );
    const [prompt,setPrompt]     = React.useState< string >( "" );
    const [params,setParams]     = React.useState< Record<string, unknown> >( {} );
    const [count,setCount]       = React.useState< number >( 1 );

    const [generating,setGenerating] = React.useState< boolean >( false );
    const [batch,setBatch]           = React.useState< { batchId : string; provider : string; model? : string } | null >( null );
    const [candidates,setCandidates]           = React.useState< Array<MediaAiGen.Candidate> >( [] );
    const [picked,setPicked]         = React.useState< AiGen.Candidate | null >( null );
    const [voices,setVoices]         = React.useState< Array<Media.Voice> >( [] );
    const [saveOpen,setSaveOpen]     = React.useState< boolean >( false );
    const [snack,setSnack]           = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    const modality : AiRouting.Modality = TABS[ tabIndex ].modality;
    const attributes : Array<AiGen.Param> = AiGen.attributesFor( modality );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // provider choices for this modality: "Auto" (account default) + every catalogued provider that serves it
    const providerChoices : Array<SelectInput.Choice> =
    [
        { value: PROVIDER_AUTO, label: "Auto (account default)" },
        ...AiRouting.providersFor( modality ).map( ( info : AiRouting.ProviderInfo ) : SelectInput.Choice => ( { value: info.provider, label: info.label } ) ),
    ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    // how many solutions this modality can yield: the chosen provider's range, else the range across all
    // providers that serve the modality (Auto). Drives the count control (shown only when >1 is possible).
    const candidateRange : AiRouting.CandidateRange = provider
        ? AiRouting.candidatesFor( provider as AiRouting.Provider, modality )
        : AiRouting.candidateRangeFor( modality, AiRouting.providersFor( modality ).map( ( info : AiRouting.ProviderInfo ) : AiRouting.Provider => info.provider ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // switching modality resets the transient form (provider/params/count/preview) to that modality's defaults
    function selectTab( index : number ) : void
    {
        setTabIndex( index );
        setProvider( PROVIDER_AUTO );
        setParams( {} );
        setCount( 1 );
        setBatch( null );
        setCandidates( [] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the account's cloned voices once — they populate the Voice tab's voice picker
    React.useEffect( () : void => { void loadVoices(); }, [] );

    // fetch the account's cloned voices
    async function loadVoices() : Promise<void>
    {
        const reply : RestfulService.Reply<GetVoices.Response> = await appmodel.server.fetch( new GetVoices() );
        if( reply.ok && reply.data ) setVoices( reply.data.voices );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // keep the solution count within the active provider/modality range (reset to its default on change)
    React.useEffect( () : void => setCount( candidateRange.default ), [ tabIndex, provider ] );

    // the selectable solution counts (min..max) for the count control
    function countChoices() : Array<SelectInput.Choice>
    {
        const choices : Array<SelectInput.Choice> = [];
        for( let value : number = candidateRange.min; value <= candidateRange.max; value++ ) choices.push( { value: String( value ), label: String( value ) } );
        return choices;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the current value for an attribute (the edited value, else its declared default)
    function valueOf( param : AiGen.Param ) : unknown { return params[ param.key ] ?? param.default; }

    // merge one attribute value into the params bag
    function setValue( key : string, value : unknown ) : void
    {
        setParams( ( prior : Record<string, unknown> ) : Record<string, unknown> => ( { ...prior, [ key ]: value } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // render one normalized attribute control by its descriptor type
    function control( param : AiGen.Param ) : JSX.Element
    {
        // the voice field becomes a picker of the account's cloned voices (+ default) when any exist
        if( param.key === "voiceId" && voices.length > 0 )
            return <SelectInput id="aigen-voiceId" label={"Voice"} value={ String( valueOf( param ) ?? "" ) }
                                choices={ [ { value: "", label: "Default voice" }, ...voices.map( ( voice : Media.Voice ) : SelectInput.Choice => ( { value: voice.voiceId, label: voice.name } ) ) ] }
                                onChange={ ( value : string ) : void => setValue( param.key, value ) } sx={{ width: 200 }} />;
        if( param.type === AiGen.ParamType.SELECT )
            return <SelectInput id={ `aigen-${ param.key }` } label={ param.label } value={ String( valueOf( param ) ?? "" ) }
                                choices={ ( param.choices ?? [] ).map( ( choice : AiGen.Choice ) : SelectInput.Choice => ( { value: choice.value, label: choice.label } ) ) }
                                onChange={ ( value : string ) : void => setValue( param.key, value ) } sx={{ width: 180 }} />;
        if( param.type === AiGen.ParamType.RANGE )
            return <Box sx={{ width: 200 }}>
                       <Typography variant="caption" sx={{ color: "text.secondary" }}>{ param.label }: { String( valueOf( param ) ) }</Typography>
                       <Slider size="small" value={ Number( valueOf( param ) ?? param.min ?? 0 ) } min={ param.min } max={ param.max } step={ param.step }
                               onChange={ ( _event : Event, value : number | Array<number> ) : void => setValue( param.key, value as number ) } />
                   </Box>;
        if( param.type === AiGen.ParamType.NUMBER )
            return <TextInput id={ `aigen-${ param.key }` } label={ param.label } value={ String( valueOf( param ) ?? "" ) } allNumeric
                              onChange={ ( value : string ) : void => setValue( param.key, Number( value ) ) } width={ 120 } />;
        if( param.type === AiGen.ParamType.TOGGLE )
            return <FormControlLabel control={ <Switch checked={ Boolean( valueOf( param ) ) } onChange={ ( _event : React.ChangeEvent<HTMLInputElement>, checked : boolean ) : void => setValue( param.key, checked ) } /> } label={ param.label } />;
        return <TextInput id={ `aigen-${ param.key }` } label={ param.label } value={ String( valueOf( param ) ?? "" ) } placeHolder={ param.placeholder }
                          onChange={ ( value : string ) : void => setValue( param.key, value ) } width={ 220 } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // start an async generation (media-19): PostAiGenerate enqueues the job + returns pending candidate
    // placeholders; the poll effect resolves each preview as the media-generate Job produces the bytes.
    async function generate() : Promise<void>
    {
        if( prompt.trim() === "" ) return;
        setGenerating( true );
        setBatch( null );
        setCandidates( [] );
        // fill unset attributes with their declared defaults so the provider gets a complete param set
        const merged : Record<string, unknown> = {};
        for( const param of attributes )
        {
            const value : unknown = valueOf( param );
            if( value !== undefined ) merged[ param.key ] = value;
        }
        const chosen : number = Math.max( candidateRange.min, Math.min( candidateRange.max, count || candidateRange.default ) );
        const reply : RestfulService.Reply<PostAiGenerate.Response> = await appmodel.server.fetch(
            new PostAiGenerate( { modality, prompt: prompt.trim(), provider: provider ? ( provider as AiRouting.Provider ) : undefined, params: merged, count: chosen } ) );
        setGenerating( false );
        if( reply.ok && reply.data )
        {
            setBatch( { batchId: reply.data.batchId, provider: reply.data.provider, model: reply.data.model } );
            setCandidates( reply.data.candidates.map( ( candidate : AiGen.Pending ) : MediaAiGen.Candidate => ( { guid: candidate.guid, kind: candidate.kind, ready: false, failed: false } ) ) );
            return;
        }
        const message : string = reply.status === 501
            ? "No AI provider is configured for this media type yet."
            : RestfulService.error( reply, "Generation failed" );
        setSnack( { message, severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve ONE pending candidate: GetAsset for status, then GetMediaUrl for a preview once bytes exist.
    async function resolveCandidate( candidate : MediaAiGen.Candidate ) : Promise<MediaAiGen.Candidate>
    {
        if( candidate.ready || candidate.failed ) return candidate;
        const got : RestfulService.Reply<GetAsset.Response> = await appmodel.server.fetch( new GetAsset( candidate.guid ) );
        const status : Media.Status | undefined = got.ok && got.data ? got.data.asset.status : undefined;
        if( status === Media.Status.FAILED ) return { ...candidate, failed: true };
        if( status === Media.Status.UPLOADING || status === undefined ) return candidate;   // bytes not produced yet
        const url : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( candidate.guid ) );
        return url.ok && url.data ? { ...candidate, ready: true, previewUrl: url.data.url } : candidate;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // poll pending candidates until the Job has produced their bytes. Runs while any candidate is neither
    // ready nor failed. (Websockets replace this later.)
    React.useEffect( () : ( () => void ) | void =>
    {
        if( candidates.length === 0 || candidates.every( ( candidate : MediaAiGen.Candidate ) : boolean => candidate.ready || candidate.failed ) ) return;
        let live : boolean = true;
        const timer : ReturnType<typeof setTimeout> = setTimeout( () : void => void poll(), 2500 );

        async function poll() : Promise<void>
        {
            const next : Array<MediaAiGen.Candidate> = await Promise.all( candidates.map( resolveCandidate ) );
            if( live ) setCandidates( next );
        }

        return () : void => { live = false; clearTimeout( timer ); };
    }, [ candidates ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // delete a set of candidate assets (discard) — best-effort
    async function deleteCandidates( guids : Array<string> ) : Promise<void>
    {
        await Promise.all( guids.map( ( guid : string ) : Promise<RestfulService.Reply<DeleteAsset.Response>> => appmodel.server.fetch( new DeleteAsset( guid ) ) ) );
    }

    // discard every current candidate without keeping any
    async function discardAll() : Promise<void>
    {
        await deleteCandidates( candidates.map( ( candidate : MediaAiGen.Candidate ) : string => candidate.guid ) );
        setBatch( null );
        setCandidates( [] );
    }

    // keep one candidate: open the name/tag dialog for it; on save, the other candidates are discarded
    function keep( candidate : MediaAiGen.Candidate ) : void
    {
        setPicked( { guid: candidate.guid, kind: candidate.kind, mime: "", previewUrl: candidate.previewUrl ?? "" } );
        setSaveOpen( true );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the picked candidate was saved: discard the ones the user didn't keep, snack, and reset the batch
    function onCandidateSaved( ok : boolean ) : boolean
    {
        if( ok && picked )
        {
            const others : Array<string> = candidates.filter( ( candidate : MediaAiGen.Candidate ) : boolean => candidate.guid !== picked.guid ).map( ( candidate : MediaAiGen.Candidate ) : string => candidate.guid );
            void deleteCandidates( others );
            setSnack( { message: "Saved to your library.", severity: "success" } );
            setBatch( null );
            setCandidates( [] );
        }
        closeSave();
        return true;
    }

    // close the save dialog + clear the pick
    function closeSave() : void { setSaveOpen( false ); setPicked( null ); }

    // account switched/refreshed: drop the transient generation state
    function onAccountCleared() : void { setBatch( null ); setCandidates( [] ); setPrompt( "" ); }
    function onAccountRefreshed() : void { setBatch( null ); setCandidates( [] ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // preview one candidate solution — spinner while the Job runs, the media once ready, or a failed note.
    // Fills its grid cell (width 100%) so the solutions tile responsively in the right-hand image list.
    function candidateCard( candidate : MediaAiGen.Candidate ) : JSX.Element
    {
        return  <Stack key={ candidate.guid } spacing={ 1 } sx={{ p: 1, border: "1px solid", borderColor: "divider", borderRadius: 1, width: "100%" }}>
                    { candidate.failed
                        ? <Box sx={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}><Typography variant="body2" sx={{ color: "error.main" }}>{"Generation failed"}</Typography></Box>
                      : !candidate.ready
                        ? <Box sx={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "action.hover", borderRadius: 1 }}><CircularProgress size={ 22 } /></Box>
                      : candidate.kind === Media.Kind.IMAGE
                        ? <Box component="img" src={ candidate.previewUrl } alt="candidate" sx={{ width: "100%", height: 200, objectFit: "contain", borderRadius: 1, bgcolor: "action.hover" }} />
                      : candidate.kind === Media.Kind.AUDIO
                        ? <Box sx={{ height: 200, display: "flex", alignItems: "center" }}><AudioInput id={ `aigen-audio-${ candidate.guid }` } value={ candidate.previewUrl ?? "" } width="100%" /></Box>
                        : null }
                    <Button variant="contained" size="small" disabled={ !candidate.ready } onClick={ () : void => keep( candidate ) }>{"Keep"}</Button>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the RIGHT pane — the candidate solutions as an image list (a responsive grid), with a header + discard.
    // Shows a spinner while starting and a placeholder when there's nothing yet, so the pane never reads blank.
    function solutionsPane() : JSX.Element
    {
        if( generating )
            return <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Starting…"}</Typography></Stack>;
        if( candidates.length === 0 )
            return <Stack sx={{ alignItems: "center", justifyContent: "center", height: "100%", minHeight: 260, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
                       <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Your generated solutions will appear here."}</Typography>
                   </Stack>;
        return  <Stack spacing={ 2 }>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                            { candidates.length > 1 ? `${ candidates.length } solutions — keep the one you want` : "Keep it or discard" }
                        </Typography>
                        { batch && <Chip size="small" variant="outlined" label={ `${ batch.provider }${ batch.model ? " · " + batch.model : "" }` } /> }
                        <Box sx={{ flexGrow: 1 }} />
                        <Button variant="text" color="inherit" onClick={ () : void => void discardAll() }>{"Discard all"}</Button>
                    </Stack>
                    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 2 }}>
                        { candidates.map( candidateCard ) }
                    </Box>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Media : AI Gen"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"AI Gen"} subheader={"Create new images, video, voice, and sound from prompts."} />
                        <Divider />
                        <Tabs value={ tabIndex } onChange={ ( _event : React.SyntheticEvent, index : number ) : void => selectTab( index ) } variant="scrollable" allowScrollButtonsMobile>
                            { TABS.map( ( tab : TabDef ) : JSX.Element => <Tab key={ tab.label } icon={ tab.icon } iconPosition="start" label={ tab.label } /> ) }
                        </Tabs>
                        <Divider />
                        <CardContent>
                            {/* two-pane: the filters/controls in a LEFT column, the generated solutions as an
                                image list on the RIGHT (row Stack spacing 1; the controls column is spacing 2) */}
                            <Stack direction="row" spacing={ 1 } sx={{ alignItems: "flex-start" }}>
                                <Stack spacing={ 2 } sx={{ width: 340, flexShrink: 0 }}>
                                    <TextInput  id="aigen-prompt"
                                                label={"Prompt"}
                                                value={ prompt }
                                                onChange={ setPrompt }
                                                multiline
                                                maxRows={ 6 }
                                                fullWidth
                                                placeHolder={ `Describe the ${ TABS[ tabIndex ].label.toLowerCase() } to generate…` } />

                                    <SelectInput    id="aigen-provider"
                                                    sx={{ width: "100%" }}
                                                    label={"Provider"}
                                                    value={ provider }
                                                    choices={ providerChoices }
                                                    onChange={ setProvider }  />

                                    { attributes.map( ( param : AiGen.Param ) : JSX.Element => <Box key={ param.key }>{ control( param ) }</Box> ) }

                                    { candidateRange.max > 1 &&
                                        <SelectInput    id="aigen-count"
                                                        sx={{ width: "100%" }}
                                                        label={"Solutions"}
                                                        value={ String( count || candidateRange.default ) }
                                                        choices={ countChoices() }
                                                        onChange={ ( value : string ) : void => setCount( Number( value ) ) }  /> }

                                    <Button variant="contained"
                                            startIcon={ <AutoAwesomeOutlinedIcon /> }
                                            disabled={ generating || prompt.trim() === "" }
                                            onClick={ () : void => void generate() }>
                                        { generating ? "Generating…" : "Generate" }
                                    </Button>
                                </Stack>

                                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                    { solutionsPane() }
                                </Box>
                            </Stack>
                        </CardContent>
                    </Card>
                </Box>

                { saveOpen && picked &&
                    <AiGenSaveDialog candidate={ picked }
                                     defaultName={ `${ TABS[ tabIndex ].label } — ${ prompt.trim().slice( 0, 40 ) }` }
                                     onSaved={ onCandidateSaved }
                                     onClose={ closeSave } /> }

                <AccountChange onClear={ onAccountCleared } onRefresh={ onAccountRefreshed } />

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () : void => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace MediaAiGen
{
    export interface Props {}

    /** A candidate solution in the UI as the media-generate Job produces it: pending → ready (previewUrl) or
     *  failed. Resolved by polling GetAsset (status) + GetMediaUrl (preview). */
    export interface Candidate { guid : string; kind : string; previewUrl? : string; ready : boolean; failed : boolean; }
}

export default MediaAiGen;
// eof
