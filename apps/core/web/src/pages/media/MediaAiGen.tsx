import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Checkbox, Chip, CircularProgress, Divider, FormControlLabel, Slider, Stack, Switch, Tab, Tabs, Typography } from "@mui/material";
import ImageOutlinedIcon        from '@mui/icons-material/ImageOutlined';
import MovieOutlinedIcon        from '@mui/icons-material/MovieOutlined';
import RecordVoiceOverOutlinedIcon from '@mui/icons-material/RecordVoiceOverOutlined';
import GraphicEqOutlinedIcon    from '@mui/icons-material/GraphicEqOutlined';
import AutoAwesomeOutlinedIcon  from '@mui/icons-material/AutoAwesomeOutlined';
import LibraryAddOutlinedIcon   from '@mui/icons-material/LibraryAddOutlined';

import { Access } from '@repo/system';
import { AiRouting, AiGen, Media, PostAiGenerate, GetGenerateBatch, PostGeneratePromote, DeleteGenerateBatch, GetVoices } from '@repo/api';
import CampaignSelect from '@widgets/app/CampaignSelect';
import { RestfulService } from '@repo/endpoint';

import AuthPage    from '@widgets/app/AuthPage';
import TextInput   from '@widgets/core/TextInput';
import SelectInput from '@widgets/core/SelectInput';
import AudioInput  from '@widgets/core/AudioInput';
import SnackAlert  from '@widgets/core/SnackAlert';
import AccountChange from '@widgets/app/AccountChange';

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
// Media : AI Gen — create NEW assets from prompts (distinct from Browse, which acquires EXISTING assets). One
// tab per generative modality; each renders the normalized provider attributes (AiGen.attributesFor) as a
// dynamic form. Generation STAGES candidates (media-18) — they're produced into a staging bucket, NOT the
// library; the user reviews them, multi-selects, and adds the chosen ones to the library (or discards).
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
    const [promoting,setPromoting]   = React.useState< boolean >( false );
    const [batch,setBatch]           = React.useState< { batchId : string; provider : string; model? : string } | null >( null );
    const [candidates,setCandidates] = React.useState< Array<AiGen.Candidate> >( [] );
    const [selected,setSelected]     = React.useState< Set<string> >( new Set() );
    const [acceptCampaigns,setAcceptCampaigns] = React.useState< Array<string> >( [] );   // campaigns to file accepted images into
    const [voices,setVoices]         = React.useState< Array<Media.Voice> >( [] );
    const [snack,setSnack]           = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    const modality : AiRouting.Modality = TABS[ tabIndex ].modality;
    const attributes : Array<AiGen.Param> = AiGen.attributesFor( modality );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // provider choices for this modality — a provider MUST be picked (no "Auto"); the list is every catalogued
    // provider that serves the modality
    const providerChoices : Array<SelectInput.Choice> =
        AiRouting.providersFor( modality ).map( ( info : AiRouting.ProviderInfo ) : SelectInput.Choice => ( { value: info.provider, label: info.label } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // how many solutions this modality can yield: the chosen provider's range, else the range across all
    // providers that serve the modality (Auto). Drives the count control (shown only when >1 is possible).
    const candidateRange : AiRouting.CandidateRange = provider
        ? AiRouting.candidatesFor( provider as AiRouting.Provider, modality )
        : AiRouting.candidateRangeFor( modality, AiRouting.providersFor( modality ).map( ( info : AiRouting.ProviderInfo ) : AiRouting.Provider => info.provider ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // switching modality resets the transient form (provider/params/count/staged solutions) to defaults
    function selectTab( index : number ) : void
    {
        setTabIndex( index );
        setProvider( PROVIDER_AUTO );
        setParams( {} );
        setCount( 1 );
        reset();
    }

    // clear the staged batch + selection
    function reset() : void { setBatch( null ); setCandidates( [] ); setSelected( new Set() ); setAcceptCampaigns( [] ); }

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
    // start an async generation (media-18): PostAiGenerate enqueues the job + returns the staging batch with
    // pending candidate placeholders; the poll effect resolves each preview as the Job stages the bytes.
    async function generate() : Promise<void>
    {
        if( prompt.trim() === "" ) return;
        setGenerating( true );
        reset();
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
            setCandidates( reply.data.candidates.map( ( candidate : AiGen.Pending ) : AiGen.Candidate => ( { id: candidate.id, kind: candidate.kind, status: AiGen.CandidateStatus.PENDING } ) ) );
            return;
        }
        const message : string = reply.status === 501
            ? "No AI provider is configured for this media type yet."
            : RestfulService.error( reply, "Generation failed" );
        setSnack( { message, severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // poll the staging batch until every candidate resolves (READY / FAILED). (Websockets replace this later.)
    React.useEffect( () : ( () => void ) | void =>
    {
        if( !batch || candidates.length === 0 ) return;
        if( candidates.every( ( candidate : AiGen.Candidate ) : boolean => candidate.status !== AiGen.CandidateStatus.PENDING ) ) return;
        let live : boolean = true;
        const timer : ReturnType<typeof setTimeout> = setTimeout( () : void => void poll(), 2500 );

        async function poll() : Promise<void>
        {
            const reply : RestfulService.Reply<GetGenerateBatch.Response> = await appmodel.server.fetch( new GetGenerateBatch( batch!.batchId ) );
            if( live && reply.ok && reply.data ) setCandidates( reply.data.batch.candidates );
        }

        return () : void => { live = false; clearTimeout( timer ); };
    }, [ batch, candidates ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // toggle a candidate in the multi-select set
    function toggleSelect( id : string ) : void
    {
        setSelected( ( prior : Set<string> ) : Set<string> =>
        {
            const next : Set<string> = new Set( prior );
            ( next.has( id ) ? next.delete( id ) : next.add( id ) );
            return next;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // add the selected staged candidates to the library (promote) — discards the rest of the batch on success
    async function addSelected() : Promise<void>
    {
        if( !batch || selected.size === 0 ) return;
        setPromoting( true );
        const reply : RestfulService.Reply<PostGeneratePromote.Response> = await appmodel.server.fetch(
            new PostGeneratePromote( batch.batchId, { candidateIds: [ ...selected ], campaignIds: acceptCampaigns } ) );
        setPromoting( false );
        if( reply.ok && reply.data )
        {
            setSnack( { message: `Added ${ reply.data.assets.length } to your library.`, severity: "success" } );
            reset();
            return;
        }
        setSnack( { message: RestfulService.error( reply, "Could not add to library" ), severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // discard the whole staged batch (delete staging bytes) — best-effort
    async function discardAll() : Promise<void>
    {
        if( batch ) await appmodel.server.fetch( new DeleteGenerateBatch( batch.batchId ) );
        reset();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // account switched/refreshed: drop the transient generation state
    function onAccountCleared() : void { reset(); setPrompt( "" ); }
    function onAccountRefreshed() : void { reset(); }

    // true while any candidate is still being produced — the Generate button stays disabled until all resolve
    const pending : boolean = candidates.some( ( candidate : AiGen.Candidate ) : boolean => candidate.status === AiGen.CandidateStatus.PENDING );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // preview one staged candidate — spinner while pending, the media once ready (with a select checkbox), or a
    // failed note. Fills its grid cell (width 100%) so the solutions tile responsively in the right-hand list.
    function candidateCard( candidate : AiGen.Candidate ) : JSX.Element
    {
        const ready : boolean = candidate.status === AiGen.CandidateStatus.READY;
        return  <Stack key={ candidate.id } spacing={ 1 } sx={{ p: 1, border: "1px solid", borderColor: selected.has( candidate.id ) ? "primary.main" : "divider", borderRadius: 1, width: "100%" }}>
                    { candidate.status === AiGen.CandidateStatus.FAILED
                        ? <Box sx={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", p: 1 }}><Typography variant="caption" sx={{ color: "error.main" }}>{ candidate.error ?? "Generation failed" }</Typography></Box>
                      : !ready
                        ? <Box sx={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "action.hover", borderRadius: 1 }}><CircularProgress size={ 22 } /></Box>
                      : candidate.kind === Media.Kind.IMAGE
                        ? <Box component="img" src={ candidate.previewUrl } alt="candidate" sx={{ width: "100%", height: 200, objectFit: "contain", borderRadius: 1, bgcolor: "action.hover" }} />
                      : candidate.kind === Media.Kind.AUDIO
                        ? <Box sx={{ height: 200, display: "flex", alignItems: "center" }}><AudioInput id={ `aigen-audio-${ candidate.id }` } value={ candidate.previewUrl ?? "" } width="100%" /></Box>
                        : null }
                    { ready &&
                        <FormControlLabel control={ <Checkbox checked={ selected.has( candidate.id ) } onChange={ () : void => toggleSelect( candidate.id ) } /> } label={"Select"} /> }
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the RIGHT pane — the staged candidates as an image list (a responsive grid), with a header + actions.
    // Shows a spinner while starting and a placeholder when there's nothing yet, so the pane never reads blank.
    function solutionsPane() : JSX.Element
    {
        if( generating )
            return <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Starting…"}</Typography></Stack>;
        if( candidates.length === 0 )
            return <Stack sx={{ alignItems: "center", justifyContent: "center", height: "100%", minHeight: 260, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
                       <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Your generated solutions will appear here. They aren't added to your library until you select and add them."}</Typography>
                   </Stack>;
        return  <Stack spacing={ 2 }>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", flexWrap: "wrap" }}>
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                            { candidates.length > 1 ? `${ candidates.length } solutions — select the ones to keep` : "Select it to keep, or discard" }
                        </Typography>
                        { batch && <Chip size="small" variant="outlined" label={ `${ batch.provider }${ batch.model ? " · " + batch.model : "" }` } /> }
                        <Box sx={{ minWidth: 240 }}>
                            <CampaignSelect value={ acceptCampaigns } onChange={ setAcceptCampaigns } label={"Add to campaigns (optional)"} />
                        </Box>
                        <Box sx={{ flexGrow: 1 }} />
                        <Button variant="text" color="inherit" disabled={ promoting } onClick={ () : void => void discardAll() }>{"Discard all"}</Button>
                        <Button variant="contained" startIcon={ <LibraryAddOutlinedIcon /> } disabled={ promoting || selected.size === 0 } onClick={ () : void => void addSelected() }>
                            { promoting ? "Adding…" : selected.size > 0 ? `Add ${ selected.size } to library` : "Add to library" }
                        </Button>
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
                            {/* two-pane: the filters/controls in a LEFT column, the staged solutions on the RIGHT */}
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
                                            disabled={ generating || pending || prompt.trim() === "" || provider === "" }
                                            onClick={ () : void => void generate() }>
                                        { generating || pending ? "Generating…" : "Generate" }
                                    </Button>
                                </Stack>

                                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                    { solutionsPane() }
                                </Box>
                            </Stack>
                        </CardContent>
                    </Card>
                </Box>

                <AccountChange onClear={ onAccountCleared } onRefresh={ onAccountRefreshed } />

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () : void => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace MediaAiGen
{
    export interface Props {}
}

export default MediaAiGen;
// eof
