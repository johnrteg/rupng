import AppModel from "@model/AppModel";
//
import React from "react";
import { JSX } from "react";

import { Box, Card, CardActionArea, Stack, Tab, Tabs, Typography } from "@mui/material";

import { SvgDocument, SvgTemplate, Media, StudioProject, PostStudioProject, PutSvgCanvas, PostSvgFromTemplate, GetSvgTemplates } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import DialogWindow from "@widgets/core/DialogWindow";
import TextInput from "@widgets/core/TextInput";
import SvgService from "@model/service/SvgService";
import { makeBlankDoc, makeBlankPage } from "@widgets/svg/editor/SvgEditorModel";

//
// NewSvgProjectDialog — name + template/blank picker for a new SVG design. Fetches the template gallery
// (category tabs) and offers three built-in blank sizes (Letter / Business Card / Social 1×1). On create it
// either forks the chosen template (PostSvgFromTemplate) or creates a blank project (PostStudioProject +
// PutSvgCanvas), then hands the new projectId to the parent. The parent owns open/close.
//
export function NewSvgProjectDialog( props : NewSvgProjectDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const svc : SvgService = React.useMemo( () : SvgService => new SvgService( appmodel ), [ appmodel ] );

    const [ name, setName ] = React.useState<string>( "" );
    const [ templates, setTemplates ] = React.useState<Array<SvgTemplate.Summary>>( [] );
    const [ category, setCategory ]   = React.useState<SvgTemplate.Category | "all">( "all" );
    const [ selectedTemplate, setSelectedTemplate ] = React.useState<string | null>( null );
    const [ blankPreset, setBlankPreset ] = React.useState<SvgDocument.PagePreset | null>( SvgDocument.PagePreset.LETTER );

    React.useEffect( componentLoaded, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // on mount: load the full template gallery (filtered client-side by the category tab)
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
    // select a built-in blank size (clears any template selection)
    function chooseBlank( preset : SvgDocument.PagePreset ) : void
    {
        setBlankPreset( preset );
        setSelectedTemplate( null );
    }
    // select a gallery template (clears the blank selection)
    function chooseTemplate( templateId : string ) : void
    {
        setSelectedTemplate( templateId );
        setBlankPreset( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // create the project — fork a template, or create a blank project + seed its doc
    async function onCreate() : Promise<boolean>
    {
        if( selectedTemplate !== null ) return createFromTemplate( selectedTemplate );
        if( blankPreset !== null ) return createBlank( blankPreset );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // fork the chosen template into a new editable project
    async function createFromTemplate( templateId : string ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostSvgFromTemplate.Response> = await svc.createFromTemplate( templateId, name.trim() );
        if( reply.ok && reply.data ) { props.onCreated( reply.data.projectId ); return true; }
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // create a blank project (studio row) then seed its S3 doc at the chosen page size
    async function createBlank( preset : SvgDocument.PagePreset ) : Promise<boolean>
    {
        const created : RestfulService.Reply<PostStudioProject.Response> = await appmodel.server.fetch( new PostStudioProject( { name: name.trim(), kind: Media.Kind.IMAGE } ) );
        if( !created.ok || !created.data ) return false;

        const project : StudioProject.Entity = created.data.project;
        const doc : SvgDocument.Doc = { ...makeBlankDoc( project.id ), pages: [ makeBlankPage( preset ) ] };
        const saved : RestfulService.Reply<PutSvgCanvas.Response> = await appmodel.server.fetch( new PutSvgCanvas( { projectId: project.id, doc } ) );
        if( !saved.ok ) return false;

        props.onCreated( project.id );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the built-in blank starter cards
    const BLANKS : Array<{ label : string; preset : SvgDocument.PagePreset }> =
    [
        { label: "Letter",        preset: SvgDocument.PagePreset.LETTER },
        { label: "Business Card", preset: SvgDocument.PagePreset.BUSINESS_CARD },
        { label: "Social 1×1",    preset: SvgDocument.PagePreset.SOCIAL_1X1 },
    ];

    // the templates matching the active category tab
    const visibleTemplates : Array<SvgTemplate.Summary> = category === "all"
        ? templates
        : templates.filter( ( template : SvgTemplate.Summary ) : boolean => template.category === category );

    const ready : boolean = name.trim().length > 0 && ( selectedTemplate !== null || blankPreset !== null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a selectable starter card (blank or template)
    function starterCard( key : string, label : string, selected : boolean, onPick : () => void ) : JSX.Element
    {
        return  <Card key={ key } variant="outlined" sx={{ width: 120, height: 96, borderColor: selected ? "primary.main" : "divider", borderWidth: selected ? 2 : 1 }}>
                    <CardActionArea onClick={ onPick } sx={{ height: "100%", p: 1, display: "flex", alignItems: "flex-end" }}>
                        <Typography variant="caption" noWrap>{ label }</Typography>
                    </CardActionArea>
                </Card>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( !props.open ) return <></>;
    return  <DialogWindow id="svg-new-project-dialog" title={"New design"} yesLabel={"Create"} cancelLabel={"Cancel"}
                          ready={ ready } onYes={ onCreate } onClose={ props.onClose } minWidth="md">
                <Stack spacing={ 2 } sx={{ pt: 1, minWidth: 480 }}>
                    <TextInput id="svg-new-name" label={"Name"} value={ name } onChange={ ( value : string ) : void => setName( value ) } />

                    <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Blank"}</Typography>
                    <Stack direction="row" spacing={ 1 }>
                        { BLANKS.map( ( blank : { label : string; preset : SvgDocument.PagePreset } ) : JSX.Element => starterCard( `blank-${ blank.preset }`, blank.label, blankPreset === blank.preset, () : void => chooseBlank( blank.preset ) ) ) }
                    </Stack>

                    <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Templates"}</Typography>
                    <Tabs value={ category } variant="scrollable" scrollButtons="auto"
                          onChange={ ( _event : React.SyntheticEvent, value : SvgTemplate.Category | "all" ) : void => setCategory( value ) }>
                        <Tab value="all" label={"All"} />
                        { Object.values( SvgTemplate.Category ).map( ( value : SvgTemplate.Category ) : JSX.Element => <Tab key={ value } value={ value } label={ value } /> ) }
                    </Tabs>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                        { visibleTemplates.length === 0
                            ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No templates in this category yet."}</Typography>
                            : visibleTemplates.map( ( template : SvgTemplate.Summary ) : JSX.Element => starterCard( template.id, template.name, selectedTemplate === template.id, () : void => chooseTemplate( template.id ) ) ) }
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
