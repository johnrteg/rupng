//
import React from "react";
import { JSX } from "react";

import { Button, Divider, Stack, Typography } from "@mui/material";
import CropPortraitOutlinedIcon  from "@mui/icons-material/CropPortraitOutlined";
import CropLandscapeOutlinedIcon from "@mui/icons-material/CropLandscapeOutlined";

import { SvgDocument } from "@repo/api";

import SelectInput from "@widgets/core/SelectInput";
import NumericInput from "@widgets/core/NumericInput";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType, ptToUnit, unitToPt, PAGE_PRESETS, DEFAULT_PAGE_SIZE, PresetSize, PagePresetOption } from "@widgets/svg/editor/SvgEditorModel";

//
// Preset and DPI choices — pure constants; no React dependency.
//
const PRESET_CHOICES : Array<SelectInput.Choice> =
[
    { value: PagePresetOption.CUSTOM,              label: "Custom size" },
    { value: "",                                   label: "Print", divider: true },
    { value: SvgDocument.PagePreset.LETTER,        label: "Letter  (8.5 × 11 in)" },
    { value: SvgDocument.PagePreset.LEGAL,         label: "Legal  (8.5 × 14 in)" },
    { value: SvgDocument.PagePreset.TABLOID,       label: "Tabloid  (11 × 17 in)" },
    { value: SvgDocument.PagePreset.A4,            label: "A4  (210 × 297 mm)" },
    { value: SvgDocument.PagePreset.A5,            label: "A5  (148 × 210 mm)" },
    { value: SvgDocument.PagePreset.POSTCARD_4X6,  label: "Postcard  (4 × 6 in)" },
    { value: SvgDocument.PagePreset.RACK_CARD,     label: "Rack Card  (3.5 × 9 in)" },
    { value: SvgDocument.PagePreset.DOOR_HANGER,   label: "Door Hanger  (2 × 5 in)" },
    { value: SvgDocument.PagePreset.BUSINESS_CARD, label: "Business Card  (3.5 × 2 in)" },
    { value: "",                                   label: "Social", divider: true },
    { value: SvgDocument.PagePreset.SOCIAL_1X1,   label: "Square  1:1  (1080 × 1080 px)" },
    { value: SvgDocument.PagePreset.SOCIAL_16X9,  label: "Landscape  16:9  (1920 × 1080 px)" },
    { value: SvgDocument.PagePreset.SOCIAL_9X16,  label: "Portrait  9:16  (1080 × 1920 px)" },
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

// Decimal places shown for a custom width/height value, appropriate to the unit's typical precision.
const UNIT_DECIMAL_PLACES : Record<SvgDocument.Unit, number> =
{
    [ SvgDocument.Unit.INCHES ]: 2,
    [ SvgDocument.Unit.MM ]:     1,
    [ SvgDocument.Unit.PX ]:     0,
    [ SvgDocument.Unit.PT ]:     1,
};

//
// PageInspector — document settings for page size, orientation, and DPI. Used inside
// SvgDocumentSettingsDialog. Reads and writes doc.pageSize (the document-level canonical source)
// and simultaneously syncs ALL pages' size field so they stay consistent. Changes dispatch SET_DOC
// (snapshots to undo history). Custom width/height commit on blur or Enter key.
//
export function PageInspector( props : PageInspector.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );

    // resolve the effective size — doc.pageSize is canonical; fall back to the first page's size
    // for docs saved before the doc-level pageSize field was introduced
    const effectiveSize : SvgDocument.PageSize = props.doc.pageSize ?? props.doc.pages[ 0 ]?.size ?? DEFAULT_PAGE_SIZE;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // apply a size patch to BOTH doc.pageSize AND all pages — the document has one shared page size
    function applySize( patch : Partial<SvgDocument.PageSize> ) : void
    {
        if( editor.state.doc === null ) return;
        
        const newSize : SvgDocument.PageSize = { ...effectiveSize, ...patch };
        const newOrientation : SvgDocument.Orientation = newSize.width >= newSize.height
            ? SvgDocument.Orientation.LANDSCAPE
            : SvgDocument.Orientation.PORTRAIT;
        const pages : Array<SvgDocument.Page> = editor.state.doc.pages.map(
            ( candidate : SvgDocument.Page ) : SvgDocument.Page =>
                ( { ...candidate, size: newSize, orientation: newOrientation } )
        );
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: { ...editor.state.doc, pageSize: newSize, pages } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // preset change — switch to a named preset or revert to custom (keeping current dimensions)
    function onPresetChange( value : string ) : void
    {
        if( value === PagePresetOption.CUSTOM )
        {
            applySize( { preset: null } );
            return;
        }
        const preset : SvgDocument.PagePreset = value as SvgDocument.PagePreset;
        const size   : PresetSize = PAGE_PRESETS[ preset ];
        // preserve the current orientation when switching presets
        const landscape : boolean = effectiveSize.width >= effectiveSize.height;
        const width  : number = landscape ? Math.max( size.width, size.height ) : Math.min( size.width, size.height );
        const height : number = landscape ? Math.min( size.width, size.height ) : Math.max( size.width, size.height );
        applySize( { preset, width, height, unit: SvgDocument.Unit.PT } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // swap width ↔ height to flip orientation (portrait ↔ landscape)
    function onFlipOrientation() : void
    {
        applySize( { width: effectiveSize.height, height: effectiveSize.width } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onDpiChange( value : string ) : void
    {
        applySize( { dpi: Number( value ) || 72 } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onUnitChange( value : string ) : void
    {
        applySize( { unit: value as SvgDocument.Unit } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // custom width/height — NumericInput commits on blur/Enter itself; the value arrives already
    // in the displayed unit, so convert back to pt before storing
    function onWidthChange( value : number ) : void
    {
        const widthPt : number = unitToPt( value, effectiveSize.unit, effectiveSize.dpi );
        applySize( { preset: null, width: Math.max( 1, widthPt ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onHeightChange( value : number ) : void
    {
        const heightPt : number = unitToPt( value, effectiveSize.unit, effectiveSize.dpi );
        applySize( { preset: null, height: Math.max( 1, heightPt ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const preset      : string  = effectiveSize.preset ?? PagePresetOption.CUSTOM;
    const isCustom    : boolean = effectiveSize.preset === null;
    const isSquare    : boolean = effectiveSize.width === effectiveSize.height;
    const isLandscape : boolean = effectiveSize.width > effectiveSize.height;

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 } sx={{ p: 2 }}>

                { /* ── Size / Preset ────────────────────────────────────────────── */ }
                <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Page size"}</Typography>
                <SelectInput    id="page-preset"
                                label={"Size"}
                                value={ preset }
                                choices={ PRESET_CHOICES }
                                onChange={ onPresetChange }
                                 />

                { /* ── Orientation toggle — flip width ↔ height for non-square pages ── */ }
                { !isCustom && !isSquare &&
                    <Stack direction="row" spacing={ 1 }>
                        <Button size="small"
                                variant={ !isLandscape ? "contained" : "outlined" }
                                startIcon={ <CropPortraitOutlinedIcon /> }
                                onClick={ isLandscape ? onFlipOrientation : undefined }
                                sx={{ flex: 1 }}>
                            {"Portrait"}
                        </Button>
                        <Button size="small"
                                variant={ isLandscape ? "contained" : "outlined" }
                                startIcon={ <CropLandscapeOutlinedIcon /> }
                                onClick={ !isLandscape ? onFlipOrientation : undefined }
                                sx={{ flex: 1 }}>
                            {"Landscape"}
                        </Button>
                    </Stack> }

                { /* ── Custom dimensions — Width × Height + Unit ─────────────────── */ }
                { isCustom &&
                    <>
                        <Stack direction="row" spacing={ 1 }>
                            <NumericInput   id="page-width" label={"Width"}
                                            value={ ptToUnit( effectiveSize.width, effectiveSize.unit, effectiveSize.dpi ) }
                                            decimalPlaces={ UNIT_DECIMAL_PLACES[ effectiveSize.unit ] }
                                            minValue={ 0 }
                                            onChange={ onWidthChange } />
                            <NumericInput   id="page-height" label={"Height"}
                                            value={ ptToUnit( effectiveSize.height, effectiveSize.unit, effectiveSize.dpi ) }
                                            decimalPlaces={ UNIT_DECIMAL_PLACES[ effectiveSize.unit ] }
                                            minValue={ 0 }
                                            onChange={ onHeightChange } />
                            <SelectInput    id="page-unit"
                                            label={"Unit"}
                                            value={ effectiveSize.unit }
                                            onChange={ onUnitChange } choices={ UNIT_CHOICES } />
                        </Stack>
                        
                    </> }

                <Divider />

                { /* ── Resolution ──────────────────────────────────────────────────── */ }
                <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Resolution"}</Typography>
                <SelectInput id="page-dpi" label={"DPI"} value={ String( effectiveSize.dpi ) }
                             onChange={ onDpiChange } choices={ DPI_CHOICES } />

            </Stack>;
}

export namespace PageInspector
{
    export interface Props
    {
        /** The full document — page size is document-level, not per-page. */
        doc : SvgDocument.Doc;
    }
}

export default PageInspector;
