import React from 'react';
import { JSX } from "react";

import { Composition, registerRoot } from 'remotion';

import { StudioProject } from '@repo/api';
import { StudioVideoComposition } from './StudioVideoComposition';

//
// The Remotion ROOT — the server-render entry point (media-21.18). @remotion/bundler bundles THIS file; the
// media render worker then selects the `studio` composition and renders it to mp4. It registers one composition
// wired to the SAME {@link StudioVideoComposition} that drives the browser <Player> preview, so preview == output.
// The width/height/fps/durationInFrames here are placeholders — the render OVERRIDES them per output format
// (`selectComposition` + a per-format override). This module is NOT imported by the web app (it calls
// `registerRoot` as a side effect); web imports the composition directly from the package index.
//

//////////////////////////////////////////////////////////////////////
// register the studio composition (defaults are overridden per-format at render time)
function StudioRoot() : JSX.Element
{
    return  <Composition id="studio"
                         component={ StudioVideoComposition }
                         durationInFrames={ 300 }
                         fps={ 30 }
                         width={ 1920 }
                         height={ 1080 }
                         defaultProps={ { doc: StudioProject.DEFAULT_VIDEO_DOC } } />;
}

registerRoot( StudioRoot );
// eof
