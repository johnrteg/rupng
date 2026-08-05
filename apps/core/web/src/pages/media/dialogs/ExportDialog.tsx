import React from "react";
import { JSX } from "react";

import { Alert, Stack, Typography } from "@mui/material";

import { SvgDocument, Media, GetAsset } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import CheckboxInput from "@widgets/core/CheckboxInput";
import DialogWindow from "@widgets/core/DialogWindow";
import SelectInput from "@widgets/core/SelectInput";

import AppModel from "@model/AppModel";

//
// ExportDialog — export settings (format, DPI, color space, crop marks, registration marks, color bars,
// bleed, embed fonts). On Export it calls props.onExport with the assembled settings and immediately closes.
// The caller owns job tracking and polling — this dialog is intentionally non-blocking (fire-and-forget).
//
export function ExportDialog( props : ExportDialog.Props ) : JSX.Element
{
    const [ format, setFormat ]                       = React.useState<SvgDocument.ExportFormat>( SvgDocument.ExportFormat.PDF );
    const [ dpi, setDpi ]                             = React.useState<number>( 300 );
    const [ cropMarks, setCropMarks ]                 = React.useState<boolean>( false );
    const [ bleed, setBleed ]                         = React.useState<boolean>( false );
    const [ embedFonts, setEmbedFonts ]               = React.useState<boolean>( true );
    const [ colorSpace, setColorSpace ]               = React.useState<"rgb" | "cmyk">( "rgb" );
    const [ registrationMarks, setRegistrationMarks ] = React.useState<boolean>( false );
    const [ colorBars, setColorBars ]                 = React.useState<boolean>( false );

    // images in the doc whose native resolution can't actually support the selected export DPI at their
    // displayed size — a non-blocking heads-up, not a restriction (see the ExportDialog conversation: vector
    // content upscales cleanly, only embedded raster images have a real resolution ceiling)
    const [ lowResWarnings, setLowResWarnings ]       = React.useState<Array<ExportDialog.ImageResCheck>>( [] );

    const formatChoices     : Array<SelectInput.Choice> = Object.values( SvgDocument.ExportFormat ).map( ( value : SvgDocument.ExportFormat ) : SelectInput.Choice => ( { value, label: value.toUpperCase() } ) );
    const dpiChoices        : Array<SelectInput.Choice> = [ 72, 150, 300, 600 ].map( ( value : number ) : SelectInput.Choice => ( { value: String( value ), label: `${ value } DPI` } ) );
    const colorSpaceChoices : Array<SelectInput.Choice> = [ { value: "rgb", label: "RGB" }, { value: "cmyk", label: "CMYK (preview)" } ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    // flatten every IMAGE object across a page's layers (recursing into groups) — scoped to this dialog's
    // one need (image nodes + their transform), not the full compiler walk
    function collectImageNodes( objects : Array<SvgDocument.ObjectNode> ) : Array<SvgDocument.ImageNode>
    {
        const found : Array<SvgDocument.ImageNode> = [];
        objects.forEach( ( object : SvgDocument.ObjectNode ) : void =>
        {
            if( object.kind === SvgDocument.ObjectKind.IMAGE ) found.push( object );
            else if( object.kind === SvgDocument.ObjectKind.GROUP ) found.push( ...collectImageNodes( object.objects ) );
        } );
        return found;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // look up a library asset's native pixel size — already probed + stored at upload time
    // (MediaAnalyzer.analyzeImage → Item.meta.image.width/height), never recomputed here.
    async function libraryImageSize( mediaId : string ) : Promise<{ width : number; height : number } | null>
    {
        const appmodel : AppModel = AppModel.instance();
        const reply : RestfulService.Reply<GetAsset.Response> = await appmodel.server.fetch( new GetAsset( mediaId ) );
        if( !reply.ok || !reply.data ) return null;
        const original : Media.Item | undefined = Media.originalItem( reply.data.asset );
        if( original?.meta?.image === undefined ) return null;
        return { width: original.meta.image.width, height: original.meta.image.height };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // check every placed image's effective DPI (native source pixels ÷ its displayed size in inches) against
    // the selected export DPI. A crop only exposes that many of the source's native pixels (crop rect shares
    // the source image's pt=px scale), so a cropped image's effective DPI is computed from the crop, not the
    // full asset. Sizes are read from the library (stored at upload time), cached per mediaId — never
    // measured/recomputed client-side. An asset with no mediaId (or no stored size) isn't checked.
    async function checkImageResolutions() : Promise<void>
    {
        if( props.doc === null ) { setLowResWarnings( [] ); return; }
        const doc : SvgDocument.Doc = props.doc;

        const nodes : Array<SvgDocument.ImageNode> = doc.pages.flatMap( ( page : SvgDocument.Page ) : Array<SvgDocument.ImageNode> =>
            collectImageNodes( page.layers.flatMap( ( layer : SvgDocument.Layer ) : Array<SvgDocument.ObjectNode> => layer.objects ) ) );

        const sizes : Map<string, { width : number; height : number } | null> = new Map<string, { width : number; height : number } | null>();
        const warnings : Array<ExportDialog.ImageResCheck> = [];

        for( const node of nodes )
        {
            const asset : SvgDocument.Asset | undefined = doc.assets.find( ( candidate : SvgDocument.Asset ) : boolean => candidate.id === node.assetId );
            if( asset?.kind === SvgDocument.AssetKind.SVG ) continue;   // a vector has no native-resolution ceiling to check against
            if( asset?.mediaId == null ) continue;   // not a library asset — no stored resolution to check against

            let natural : { width : number; height : number } | null | undefined = sizes.get( asset.mediaId );
            if( natural === undefined )
            {
                natural = await libraryImageSize( asset.mediaId );
                sizes.set( asset.mediaId, natural );
            }
            if( natural === null ) continue;   // no stored size on this asset — nothing to check

            const sourceWidth  : number = node.crop !== null ? node.crop.width  : natural.width;
            const sourceHeight : number = node.crop !== null ? node.crop.height : natural.height;
            const effectiveDpi : number = Math.min(
                sourceWidth  / ( node.transform.width  / 72 ),
                sourceHeight / ( node.transform.height / 72 ),
            );

            if( dpi > effectiveDpi )
                warnings.push( { name: asset.name, effectiveDpi: Math.round( effectiveDpi ) } );
        }

        setLowResWarnings( warnings );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function imagesChecked() : void
    {
        void checkImageResolutions();
    }
    React.useEffect( imagesChecked, [ props.doc, props.open, dpi ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // assemble the export settings from the current form state
    function buildSettings() : SvgDocument.ExportSettings
    {
        return {
            ...SvgDocument.DEFAULT_EXPORT_SETTINGS, format, dpi, embedFonts, colorSpace,
            includeCropMarks: cropMarks, includeBleed: bleed,
            includeRegistrationMarks: registrationMarks, includeColorBars: colorBars,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // hand the assembled settings to the caller, then close immediately (non-blocking)
    async function onExport() : Promise<boolean>
    {
        props.onExport( buildSettings() );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( !props.open ) return <></>;
    return  <DialogWindow id="svg-export-dialog" title={"Export design"} yesLabel={"Export"} cancelLabel={"Close"}
                          ready={ true } onYes={ onExport } onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 1 }}>
                    <SelectInput id="svg-export-format" label={"Format"} value={ format } choices={ formatChoices }
                                 onChange={ ( value : string ) : void => setFormat( value as SvgDocument.ExportFormat ) } />
                    <SelectInput id="svg-export-dpi" label={"Resolution"} value={ String( dpi ) } choices={ dpiChoices }
                                 onChange={ ( value : string ) : void => setDpi( Number( value ) ) } />
                    <SelectInput id="svg-export-color-space" label={"Color space"} value={ colorSpace } choices={ colorSpaceChoices }
                                 onChange={ ( value : string ) : void => setColorSpace( value as "rgb" | "cmyk" ) } />
                    <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center" }}>
                        <CheckboxInput id="svg-export-crop-marks"         label={"Crop marks"}         value={ cropMarks         } onChange={ setCropMarks         } />
                        <CheckboxInput id="svg-export-bleed"              label={"Include bleed"}      value={ bleed             } onChange={ setBleed             } />
                        <CheckboxInput id="svg-export-embed-fonts"        label={"Embed fonts"}        value={ embedFonts        } onChange={ setEmbedFonts        } />
                    </Stack>
                    <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center" }}>
                        <CheckboxInput id="svg-export-registration-marks" label={"Registration marks"} value={ registrationMarks } onChange={ setRegistrationMarks } />
                        <CheckboxInput id="svg-export-color-bars"         label={"Color bars"}         value={ colorBars         } onChange={ setColorBars         } />
                    </Stack>

                    { lowResWarnings.length > 0 &&
                        <Alert severity="warning">
                            <Typography variant="body2">{"This export resolution exceeds the native resolution of:"}</Typography>
                            { lowResWarnings.map( ( warning : ExportDialog.ImageResCheck, index : number ) : JSX.Element =>
                                <Typography key={ index } variant="body2">
                                    {`• ${ warning.name } (effective ~${ warning.effectiveDpi } DPI at its placed size)`}
                                </Typography>
                            ) }
                        </Alert>
                    }
                </Stack>
            </DialogWindow>;
}

export namespace ExportDialog
{
    export interface Props
    {
        open     : boolean;
        doc      : SvgDocument.Doc | null;
        onClose  : () => void;
        onExport : ( settings : SvgDocument.ExportSettings ) => void;
    }

    // one over-DPI image found by checkImageResolutions
    export interface ImageResCheck
    {
        name         : string;
        effectiveDpi : number;
    }
}

export default ExportDialog;
