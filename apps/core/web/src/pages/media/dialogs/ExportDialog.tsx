import AppModel from "@model/AppModel";
//
import React from "react";
import { JSX } from "react";

import { FormControlLabel, Stack, Switch, Typography } from "@mui/material";

import { SvgDocument, PostSvgRender, GetSvgRenderJob } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import DialogWindow from "@widgets/core/DialogWindow";
import SelectInput from "@widgets/core/SelectInput";
import SvgService from "@model/service/SvgService";

//
// ExportDialog — export settings (format, DPI, crop marks, bleed, embed fonts) + the render trigger. On
// Export it starts the async render, polls the job every 2 seconds until DONE/FAILED, then opens the download
// URL in a new tab. The parent owns open/close; this dialog owns the settings form + poll loop.
//
export function ExportDialog( props : ExportDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const svc : SvgService = React.useMemo( () : SvgService => new SvgService( appmodel ), [ appmodel ] );

    const [ format, setFormat ]         = React.useState<SvgDocument.ExportFormat>( SvgDocument.ExportFormat.PDF );
    const [ dpi, setDpi ]               = React.useState<number>( 300 );
    const [ cropMarks, setCropMarks ]   = React.useState<boolean>( false );
    const [ bleed, setBleed ]           = React.useState<boolean>( false );
    const [ embedFonts, setEmbedFonts ] = React.useState<boolean>( true );
    const [ status, setStatus ]         = React.useState<string>( "" );

    const formatChoices : Array<SelectInput.Choice> = Object.values( SvgDocument.ExportFormat ).map( ( value : SvgDocument.ExportFormat ) : SelectInput.Choice => ( { value, label: value.toUpperCase() } ) );
    const dpiChoices : Array<SelectInput.Choice> = [ 72, 150, 300, 600 ].map( ( value : number ) : SelectInput.Choice => ( { value: String( value ), label: `${ value } DPI` } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // assemble the export settings from the form (over the model defaults)
    function buildSettings() : SvgDocument.ExportSettings
    {
        return {
            ...SvgDocument.DEFAULT_EXPORT_SETTINGS,
            format, dpi, embedFonts, includeCropMarks: cropMarks, includeBleed: bleed,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // sleep helper for the poll loop
    function delay( milliseconds : number ) : Promise<void>
    {
        return new Promise<void>( ( resolve : () => void ) : void => { setTimeout( resolve, milliseconds ); } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // start the render, poll the job to completion, and open the download; returns true to close the dialog
    async function runExport() : Promise<boolean>
    {
        setStatus( "Starting render…" );
        const reply : RestfulService.Reply<PostSvgRender.Response> = await svc.render( props.projectId, buildSettings() );
        if( !reply.ok || !reply.data ) { setStatus( "Could not start the export." ); return false; }

        // poll the job every 2 seconds until a terminal status (bounded so a stuck job doesn't loop forever)
        const jobId : string = reply.data.jobId;
        for( let attempt : number = 0; attempt < 90; attempt++ )
        {
            const waited : void = await delay( 2000 );
            void waited;
            setStatus( `Rendering… (${ attempt + 1 })` );
            const job : RestfulService.Reply<GetSvgRenderJob.Response> = await svc.getRenderJob( jobId );
            if( !job.ok || !job.data ) continue;
            if( job.data.status === GetSvgRenderJob.RenderStatus.DONE )
            {
                if( job.data.outputUrl !== null ) window.open( job.data.outputUrl, "_blank" );
                setStatus( "Done." );
                return true;
            }
            if( job.data.status === GetSvgRenderJob.RenderStatus.FAILED )
            {
                setStatus( job.data.error ?? "Export failed." );
                return false;
            }
        }
        setStatus( "Export timed out." );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( !props.open ) return <></>;
    return  <DialogWindow id="svg-export-dialog" title={"Export design"} yesLabel={"Export"} cancelLabel={"Close"}
                          ready={ true } onYes={ runExport } onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ pt: 1, minWidth: 320 }}>
                    <SelectInput id="svg-export-format" label={"Format"} value={ format }
                                 choices={ formatChoices } onChange={ ( value : string ) : void => setFormat( value as SvgDocument.ExportFormat ) } />
                    <SelectInput id="svg-export-dpi" label={"Resolution"} value={ String( dpi ) }
                                 choices={ dpiChoices } onChange={ ( value : string ) : void => setDpi( Number( value ) ) } />
                    <FormControlLabel control={ <Switch checked={ cropMarks } onChange={ ( _event : React.ChangeEvent<HTMLInputElement>, checked : boolean ) : void => setCropMarks( checked ) } /> } label={"Crop marks"} />
                    <FormControlLabel control={ <Switch checked={ bleed } onChange={ ( _event : React.ChangeEvent<HTMLInputElement>, checked : boolean ) : void => setBleed( checked ) } /> } label={"Include bleed"} />
                    <FormControlLabel control={ <Switch checked={ embedFonts } onChange={ ( _event : React.ChangeEvent<HTMLInputElement>, checked : boolean ) : void => setEmbedFonts( checked ) } /> } label={"Embed fonts"} />
                    { status !== "" && <Typography variant="body2" sx={{ color: "text.secondary" }}>{ status }</Typography> }
                </Stack>
            </DialogWindow>;
}

export namespace ExportDialog
{
    export interface Props
    {
        open      : boolean;
        onClose   : () => void;
        projectId : string;
    }
}

export default ExportDialog;
