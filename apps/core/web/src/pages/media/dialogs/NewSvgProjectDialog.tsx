import AppModel from "@model/AppModel";
//
import React from "react";
import { JSX } from "react";

import { Box, Button, Card, CardActionArea, Stack, Tab, Tabs, Typography } from "@mui/material";
import CropPortraitOutlinedIcon  from "@mui/icons-material/CropPortraitOutlined";
import CropLandscapeOutlinedIcon from "@mui/icons-material/CropLandscapeOutlined";

import { SvgDocument, SvgTemplate, Media, StudioProject, PostStudioProject, PutSvgCanvas, PostSvgFromTemplate, GetSvgTemplates } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import DialogWindow from "@widgets/core/DialogWindow";
import TextInput from "@widgets/core/TextInput";
import SelectInput from "@widgets/core/SelectInput";
import SvgService from "@model/service/SvgService";
import { makeBlankDoc, makeBlankPage, makeBlankLayer, makeId, unitToPt, PAGE_PRESETS, PresetSize, PagePresetOption } from "@widgets/svg/editor/SvgEditorModel";

//
// All 12 preset cards grouped by category. Listed at module scope — pure data, no React dependency.
//
const PRINT_PRESETS : Array<{ label : string; preset : SvgDocument.PagePreset }> =
[
    { label: "Letter",        preset: SvgDocument.PagePreset.LETTER },
    { label: "Legal",         preset: SvgDocument.PagePreset.LEGAL },
    { label: "Tabloid",       preset: SvgDocument.PagePreset.TABLOID },
    { label: "A4",            preset: SvgDocument.PagePreset.A4 },
    { label: "A5",            preset: SvgDocument.PagePreset.A5 },
    { label: "Postcard 4×6",  preset: SvgDocument.PagePreset.POSTCARD_4X6 },
    { label: "Rack Card",     preset: SvgDocument.PagePreset.RACK_CARD },
    { label: "Door Hanger",   preset: SvgDocument.PagePreset.DOOR_HANGER },
    { label: "Business Card", preset: SvgDocument.PagePreset.BUSINESS_CARD },
];

const SOCIAL_PRESETS : Array<{ label : string; preset : SvgDocument.PagePreset }> =
[
    { label: "Square 1:1",     preset: SvgDocument.PagePreset.SOCIAL_1X1 },
    { label: "Landscape 16:9", preset: SvgDocument.PagePreset.SOCIAL_16X9 },
    { label: "Portrait 9:16",  preset: SvgDocument.PagePreset.SOCIAL_9X16 },
];

const DPI_CHOICES : Array<SelectInput.Choice> =
[
    { value: "72",  label: "72 dpi — screen" },
    { value: "96",  label: "96 dpi" },
    { value: "150", label: "150 dpi" },
    { value: "300", label: "300 dpi — print" },
    { value: "600", label: "600 dpi — high res" },
];

const UNIT_CHOICES : Array<SelectInput.Choice> =
[
    { value: SvgDocument.Unit.INCHES, label: "Inches (in)" },
    { value: SvgDocument.Unit.MM,     label: "Millimeters (mm)" },
    { value: SvgDocument.Unit.PX,     label: "Pixels (px)" },
    { value: SvgDocument.Unit.PT,     label: "Points (pt)" },
];

// Returns a human-readable dimension string: inches for print presets, pixels for social presets.
function presetDimLabel( preset : SvgDocument.PagePreset ) : string
{
    const size : PresetSize = PAGE_PRESETS[ preset ];
    if( preset === SvgDocument.PagePreset.SOCIAL_1X1 || preset === SvgDocument.PagePreset.SOCIAL_16X9 || preset === SvgDocument.PagePreset.SOCIAL_9X16 )
    {
        return `${ size.width } × ${ size.height } px`;
    }
    const widthIn  : number = Math.round( ( size.width  / 72 ) * 10 ) / 10;
    const heightIn : number = Math.round( ( size.height / 72 ) * 10 ) / 10;
    return `${ widthIn } × ${ heightIn } in`;
}

//
// NewSvgProjectDialog — name + template/blank picker for a new SVG design. Offers all 12 built-in size presets
// (grouped into Print and Social), a Custom size option (width/height/unit inputs), and a DPI selector. Also
// fetches the template gallery (category tabs). On create it forks a template (PostSvgFromTemplate) or creates
// a blank project (PostStudioProject + PutSvgCanvas). The parent owns open/close.
//
export function NewSvgProjectDialog( props : NewSvgProjectDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const svc : SvgService = React.useMemo( () : SvgService => new SvgService( appmodel ), [ appmodel ] );

    const [ name, setName ]                     = React.useState<string>( "" );
    const [ templates, setTemplates ]           = React.useState<Array<SvgTemplate.Summary>>( [] );
    const [ category, setCategory ]             = React.useState<SvgTemplate.Category | "all">( "all" );
    const [ selectedTemplate, setSelectedTemplate ] = React.useState<string | null>( null );
    // blankPreset: one of the 12 named presets, PagePresetOption.CUSTOM, or null (when a template is selected)
    const [ blankPreset, setBlankPreset ]       = React.useState<SvgDocument.PagePreset | PagePresetOption | null>( SvgDocument.PagePreset.LETTER );
    // custom size inputs (in the selected display unit)
    const [ customWidth, setCustomWidth ]       = React.useState<string>( "8.5" );
    const [ customHeight, setCustomHeight ]     = React.useState<string>( "11" );
    const [ customUnit, setCustomUnit ]         = React.useState<SvgDocument.Unit>( SvgDocument.Unit.INCHES );
    // resolution — applies to blank projects; default 300 dpi for print quality
    const [ dpi, setDpi ]                       = React.useState<number>( 300 );
    // orientation — portrait by default; landscape swaps width ↔ height on named non-square presets
    const [ isLandscape, setIsLandscape ]       = React.useState<boolean>( false );

    React.useEffect( componentLoaded, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        void loadTemplates();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function loadTemplates() : Promise<void>
    {
        const reply : RestfulService.Reply<GetSvgTemplates.Response> = await svc.getTemplates( null );
        if( reply.ok && reply.data ) setTemplates( reply.data.templates );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // select a built-in blank preset (clears any template selection; reset orientation to portrait)
    function chooseBlank( preset : SvgDocument.PagePreset ) : void
    {
        setBlankPreset( preset );
        setSelectedTemplate( null );
        setIsLandscape( false );
    }
    // select the custom size option (clears any template selection)
    function chooseCustom() : void
    {
        setBlankPreset( PagePresetOption.CUSTOM );
        setSelectedTemplate( null );
    }
    // select a gallery template (clears the blank selection)
    function chooseTemplate( templateId : string ) : void
    {
        setSelectedTemplate( templateId );
        setBlankPreset( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build the page for a blank project from the current preset/custom/DPI/orientation state
    function buildPage() : SvgDocument.Page
    {
        if( blankPreset !== PagePresetOption.CUSTOM && blankPreset !== null )
        {
            // named preset — use the factory then apply DPI and orientation
            const page : SvgDocument.Page = makeBlankPage( blankPreset );
            const naturalW : number = page.size.width;
            const naturalH : number = page.size.height;
            const isSquare : boolean = naturalW === naturalH;
            const width  : number = ( !isSquare && isLandscape ) ? Math.max( naturalW, naturalH ) : Math.min( naturalW, naturalH );
            const height : number = ( !isSquare && isLandscape ) ? Math.min( naturalW, naturalH ) : Math.max( naturalW, naturalH );
            const orientation : SvgDocument.Orientation = isLandscape ? SvgDocument.Orientation.LANDSCAPE : SvgDocument.Orientation.PORTRAIT;
            return { ...page, orientation, size: { ...page.size, width, height, dpi } };
        }
        // custom size — convert display-unit values to points
        const widthPt  : number = unitToPt( Number( customWidth  ) || 612, customUnit, dpi );
        const heightPt : number = unitToPt( Number( customHeight ) || 792, customUnit, dpi );
        const layer    : SvgDocument.Layer = makeBlankLayer();
        return {
            id          : makeId(),
            name        : "Page 1",
            size        : { preset: null, width: widthPt, height: heightPt, unit: customUnit, dpi },
            orientation : widthPt >= heightPt ? SvgDocument.Orientation.LANDSCAPE : SvgDocument.Orientation.PORTRAIT,
            bleed       : 0,
            safeArea    : 0,
            background  : { kind: "color", color: "#ffffff", assetId: null },
            layers      : [ layer ],
            guides      : [],
            grid        : null,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onCreate() : Promise<boolean>
    {
        if( selectedTemplate !== null ) return createFromTemplate( selectedTemplate );
        if( blankPreset !== null ) return createBlank();
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function createFromTemplate( templateId : string ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostSvgFromTemplate.Response> = await svc.createFromTemplate( templateId, name.trim() );
        if( reply.ok && reply.data ) { props.onCreated( reply.data.projectId ); return true; }
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function createBlank() : Promise<boolean>
    {
        const created : RestfulService.Reply<PostStudioProject.Response> = await appmodel.server.fetch( new PostStudioProject( { name: name.trim(), kind: Media.Kind.IMAGE } ) );
        if( !created.ok || !created.data ) return false;
        const project : StudioProject.Entity = created.data.project;
        const firstPage : SvgDocument.Page = buildPage();
        const doc : SvgDocument.Doc = { ...makeBlankDoc( project.id ), pageSize: firstPage.size, pages: [ firstPage ] };
        const saved : RestfulService.Reply<PutSvgCanvas.Response> = await appmodel.server.fetch( new PutSvgCanvas( { projectId: project.id, doc } ) );
        if( !saved.ok ) return false;
        props.onCreated( project.id );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the templates matching the active category tab
    const visibleTemplates : Array<SvgTemplate.Summary> = category === "all"
        ? templates
        : templates.filter( ( template : SvgTemplate.Summary ) : boolean => template.category === category );

    const ready : boolean = name.trim().length > 0 && ( selectedTemplate !== null || blankPreset !== null );

    // show orientation toggle for named (non-custom) presets whose natural dimensions are not square
    const isNamedPreset : boolean = blankPreset !== null && blankPreset !== PagePresetOption.CUSTOM;
    const showOrientationToggle : boolean = isNamedPreset && blankPreset !== null && blankPreset !== PagePresetOption.CUSTOM
        && PAGE_PRESETS[ blankPreset as SvgDocument.PagePreset ].width !== PAGE_PRESETS[ blankPreset as SvgDocument.PagePreset ].height;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a selectable preset card — shows the preset label and its dimensions
    function presetCard( key : string, label : string, sublabel : string, selected : boolean, onPick : () => void ) : JSX.Element
    {
        return  <Card key={ key } variant="outlined"
                      sx={{ minWidth: 96, flexShrink: 0, borderColor: selected ? "primary.main" : "divider", borderWidth: selected ? 2 : 1 }}>
                    <CardActionArea onClick={ onPick } sx={{ p: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "flex-end", minHeight: 72 }}>
                        <Typography variant="caption" noWrap sx={{ fontWeight: 600 }}>{ label }</Typography>
                        <Typography variant="caption" noWrap sx={{ color: "text.secondary" }}>{ sublabel }</Typography>
                    </CardActionArea>
                </Card>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a named preset card — computes its dimension sub-label from the preset enum
    function namedPresetCard( blank : { label : string; preset : SvgDocument.PagePreset } ) : JSX.Element
    {
        const sublabel : string = presetDimLabel( blank.preset );
        return presetCard( `blank-${ blank.preset }`, blank.label, sublabel, blankPreset === blank.preset, () : void => chooseBlank( blank.preset ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a gallery template card
    function templateCard( template : SvgTemplate.Summary ) : JSX.Element
    {
        return presetCard( template.id, template.name, "", selectedTemplate === template.id, () : void => chooseTemplate( template.id ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( !props.open ) return <></>;
    return  <DialogWindow id="svg-new-project-dialog" title={"New design"} yesLabel={"Create"} cancelLabel={"Cancel"}
                          ready={ ready } onYes={ onCreate } onClose={ props.onClose } minWidth="md">
                <Stack spacing={ 2 } sx={{ pt: 1, minWidth: 560 }}>
                    <TextInput id="svg-new-name" label={"Name"} value={ name } onChange={ ( value : string ) : void => setName( value ) } />

                    { /* ── Size presets ─────────────────────────────────────────────────── */ }
                    <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Print"}</Typography>
                    <Stack direction="row" spacing={ 1 } sx={{ overflowX: "auto", pb: 0.5 }}>
                        { PRINT_PRESETS.map( ( blank : { label : string; preset : SvgDocument.PagePreset } ) : JSX.Element => namedPresetCard( blank ) ) }
                    </Stack>

                    <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Social"}</Typography>
                    <Stack direction="row" spacing={ 1 }>
                        { SOCIAL_PRESETS.map( ( blank : { label : string; preset : SvgDocument.PagePreset } ) : JSX.Element => namedPresetCard( blank ) ) }
                    </Stack>

                    { /* Custom card + inline size inputs */ }
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "flex-start" }}>
                        { presetCard( "blank-custom", "Custom", "set your own size", blankPreset === PagePresetOption.CUSTOM, chooseCustom ) }
                        { blankPreset === PagePresetOption.CUSTOM &&
                            <Stack direction="row" spacing={ 1 } sx={{ flexGrow: 1, alignItems: "center" }}>
                                <TextInput id="svg-new-width"  label={"Width"}  value={ customWidth  } onChange={ ( value : string ) : void => setCustomWidth( value )  } />
                                <TextInput id="svg-new-height" label={"Height"} value={ customHeight } onChange={ ( value : string ) : void => setCustomHeight( value ) } />
                                <SelectInput id="svg-new-unit" label={"Unit"} value={ customUnit }
                                             onChange={ ( value : string ) : void => setCustomUnit( value as SvgDocument.Unit ) }
                                             choices={ UNIT_CHOICES } />
                            </Stack> }
                    </Stack>

                    { /* Orientation toggle — portrait / landscape for named non-square presets */ }
                    { showOrientationToggle &&
                        <Stack direction="row" spacing={ 1 }>
                            <Button size="small" variant={ !isLandscape ? "contained" : "outlined" }
                                    startIcon={ <CropPortraitOutlinedIcon /> }
                                    onClick={ () : void => setIsLandscape( false ) }
                                    sx={{ flex: 1 }}>
                                {"Portrait"}
                            </Button>
                            <Button size="small" variant={ isLandscape ? "contained" : "outlined" }
                                    startIcon={ <CropLandscapeOutlinedIcon /> }
                                    onClick={ () : void => setIsLandscape( true ) }
                                    sx={{ flex: 1 }}>
                                {"Landscape"}
                            </Button>
                        </Stack> }

                    { /* DPI selector — shown when a blank (not template) is the active choice */ }
                    { blankPreset !== null &&
                        <SelectInput id="svg-new-dpi" label={"Resolution"} value={ String( dpi ) }
                                     onChange={ ( value : string ) : void => setDpi( Number( value ) ) }
                                     choices={ DPI_CHOICES } /> }

                    { /* ── Template gallery ────────────────────────────────────────────── */ }
                    <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Templates"}</Typography>
                    <Tabs value={ category } variant="scrollable" scrollButtons="auto"
                          onChange={ ( _event : React.SyntheticEvent, value : SvgTemplate.Category | "all" ) : void => setCategory( value ) }>
                        <Tab value="all" label={"All"} />
                        { Object.values( SvgTemplate.Category ).map( ( value : SvgTemplate.Category ) : JSX.Element => <Tab key={ value } value={ value } label={ value } /> ) }
                    </Tabs>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                        { visibleTemplates.length === 0
                            ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No templates in this category yet."}</Typography>
                            : visibleTemplates.map( ( template : SvgTemplate.Summary ) : JSX.Element => templateCard( template ) ) }
                    </Box>
                </Stack>
            </DialogWindow>;
}

export namespace NewSvgProjectDialog
{
    export interface Props
    {
        open      : boolean;
        onClose   : () => void;
        onCreated : ( projectId : string ) => void;
    }
}

export default NewSvgProjectDialog;
