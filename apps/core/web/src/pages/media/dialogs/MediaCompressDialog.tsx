import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Media, MediaConfig, Texting, PostAssetCompress } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import SelectInput  from '@widgets/core/SelectInput';

// human display name for a tracked destination carrier (texting-5.6) — pure, doesn't depend on the component.
const CARRIER_LABEL : Record<Texting.Carrier, string> =
{
    [ Texting.Carrier.ATT ]:         "AT&T",
    [ Texting.Carrier.VERIZON ]:     "Verizon",
    [ Texting.Carrier.TMOBILE ]:     "T-Mobile",
    [ Texting.Carrier.US_CELLULAR ]: "US Cellular",
    [ Texting.Carrier.UNKNOWN ]:     "carrier can't be determined",
};

//
// MediaCompressDialog — pick a distribution target and compress a video (media-10.10). Async: enqueues the
// media-video Job; the compressed variant appears on the asset when the job completes. The parent owns
// open/close + the asset; this owns the target selection + the request.
//
// The two MMS targets (`mms-relaxed`/`mms-safe`) are CARRIER-tiered, not just another distribution size —
// carrier MMS byte caps aren't uniform, but they cluster into two bands (Telnyx/Bandwidth/AWS MMS guidance,
// texting-2.6): Tier-1 carriers tolerate ~1MB, everyone else (and any destination whose carrier couldn't be
// resolved) needs the ~600KB-safe universal size. `Texting.MMS_TIER_BY_CARRIER` is the single source of
// truth for which carrier needs which tier — this dialog only renders it, never hardcodes the carrier list.
//
export function MediaCompressDialog( props : MediaCompressDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    // which tracked carriers fall under each MMS tier — derived from the shared texting model, not hardcoded.
    function carriersForTier( tier : Texting.MmsTier ) : string
    {
        const carriers : Array<string> = Object.entries( Texting.MMS_TIER_BY_CARRIER )
            .filter( ( [ , carrierTier ] : [ string, Texting.MmsTier ] ) : boolean => carrierTier === tier )
            .map( ( [ carrier ] : [ string, Texting.MmsTier ] ) : string => CARRIER_LABEL[ carrier as Texting.Carrier ] );
        return carriers.join( ", " );
    }

    // the MMS carrier-tier targets go first (with a divider), then the rest of the distribution targets —
    // both pulled from the seeded config (the Console can add/edit more).
    const mmsChoices : Array<SelectInput.Choice> = [
        { value: Texting.MmsTier.RELAXED, label: `${ MediaConfig.DEFAULT.videoTargets[ Texting.MmsTier.RELAXED ]?.label } — ${ carriersForTier( Texting.MmsTier.RELAXED ) }` },
        { value: Texting.MmsTier.SAFE,    label: `${ MediaConfig.DEFAULT.videoTargets[ Texting.MmsTier.SAFE ]?.label } — ${ carriersForTier( Texting.MmsTier.SAFE ) }`, divider: true },
    ];
    const otherChoices : Array<SelectInput.Choice> = Object.entries( MediaConfig.DEFAULT.videoTargets )
        .filter( ( [ value ] : [ string, MediaConfig.VideoTarget ] ) : boolean => value !== Texting.MmsTier.RELAXED && value !== Texting.MmsTier.SAFE )
        .map( ( [ value, target ] : [ string, MediaConfig.VideoTarget ] ) : SelectInput.Choice => ( { value, label: target.label } ) );
    const choices : Array<SelectInput.Choice> = [ ...mmsChoices, ...otherChoices ];

    const [target,setTarget] = React.useState< string >( choices[ 0 ]?.value ?? Texting.MmsTier.SAFE );

    // the selected target's own limits, for the caption below the picker — never a hand-rolled KB helper.
    const selected : MediaConfig.VideoTarget | undefined = MediaConfig.DEFAULT.videoTargets[ target ];
    const limitsCaption : string = selected?.maxSizeKb !== undefined
        ? `Up to ${ appmodel.ui.locale.bytes( selected.maxSizeKb * 1024 ) }${ selected.maxWidth ? `, ${ selected.maxWidth }px wide` : "" }${ selected.maxSeconds ? `, ${ selected.maxSeconds }s max` : "" }.`
        : "";

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onCompress() : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostAssetCompress.Response> = await appmodel.server.fetch( new PostAssetCompress( props.asset.guid, { target } ) );
        return props.onDone( reply.ok );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-compress"
                          title={"Compress video"}
                          yesLabel={"Compress"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ target !== "" }
                          onYes={ onCompress }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {"Choose a distribution target. For MMS, pick the tier that matches the recipient carrier — compression runs in the background and adds a compressed variant to this video."}
                    </Typography>
                    <SelectInput id="compress-target" label={"Target"} value={ target } choices={ choices } onChange={ setTarget } sx={{ width: 360 }} />
                    { limitsCaption && <Typography variant="caption" sx={{ color: "text.disabled" }}>{ limitsCaption }</Typography> }
                </Stack>
            </DialogWindow>;
}

export namespace MediaCompressDialog
{
    export interface Props
    {
        asset   : Media.Asset;
        onDone  : ( ok : boolean ) => boolean;   // report result to parent; return true to close
        onClose : () => void;
    }
}

export default MediaCompressDialog;
// eof
