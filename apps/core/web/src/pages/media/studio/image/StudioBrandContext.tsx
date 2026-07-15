import { createContext } from "react";

import { Account } from '@repo/api';

//
// StudioBrandContext — carries the current image project's CAMPAIGN brand identity (colors + fonts) into the
// tldraw UI overrides (the style panel is a tldraw `components` override, so it can't take props directly). The
// editor loads them from the project's campaign and provides them here; the brand style section consumes them.
// The ACCOUNT brand identity is read globally (AppModel), so only the per-project campaign values need threading.
//
export interface StudioBrandContextValue
{
    campaignPalette : Array<string>;              // the project's campaign brand colors (empty when unassigned)
    campaignFonts   : Array<Account.BrandFont>;   // the project's campaign brand fonts (empty when unassigned)
}

export const StudioBrandContext = createContext<StudioBrandContextValue>( { campaignPalette: [], campaignFonts: [] } );

export default StudioBrandContext;
// eof
