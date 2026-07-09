import { JSX } from "react";

import {
    DefaultStylePanel, DefaultStylePanelContent, DefaultToolbar, DefaultToolbarContent,
    type TLComponents, type TLUiStylePanelProps,
} from 'tldraw';

import StudioBrandStyleSection from '@pages/media/studio/image/StudioBrandStyleSection';

//
// StudioEditorUi — the image editor's CUSTOM tldraw UI seam. These override tldraw's built-in panels via the
// `components` prop, but for now each renders our own shell hosting tldraw's DEFAULT content — so functionality
// is IDENTICAL to stock tldraw while giving us a place we own to augment next (brand palette colors, custom
// fonts, brand tools). Purely UI (no shape-schema changes), so existing saved canvases are unaffected.
//

//
// StudioStylePanel — our style-panel shell. Renders tldraw's default controls inside the default panel container
// (same behavior); the injection point above/below `DefaultStylePanelContent` is where the brand palette + font
// controls will land in the next iteration.
//
function StudioStylePanel( props : TLUiStylePanelProps ) : JSX.Element
{
    return <DefaultStylePanel { ...props }>
                <StudioBrandStyleSection />
                <DefaultStylePanelContent />
           </DefaultStylePanel>;
}

//
// StudioToolbar — our toolbar shell. Renders tldraw's default tools for now; brand tools get added ahead of the
// default content in the next iteration.
//
function StudioToolbar() : JSX.Element
{
    return <DefaultToolbar>
                { /* iteration point — brand tools go here */ }
                <DefaultToolbarContent />
           </DefaultToolbar>;
}

/** The `components` override for `<Tldraw components=… />` — our custom panel shells (default content for now). */
export const STUDIO_EDITOR_COMPONENTS : TLComponents =
{
    StylePanel: StudioStylePanel,
    Toolbar:    StudioToolbar,
};

export default STUDIO_EDITOR_COMPONENTS;
// eof
