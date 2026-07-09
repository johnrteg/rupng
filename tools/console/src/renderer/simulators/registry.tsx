//
// The DEV-SIMULATOR registry — the single source the Console's Simulators surface renders from. Each entry is
// a fake/mock service that stands in for a real external provider during local dev (a fake ESP now; an SMS or
// voice gateway later). A simulator declares its service id (which MATCHES the catalog + what `processManager`
// spawns/stops), its local port, and the inspector VIEWS (inbox/config/…) that examine it. Adding a new
// simulator is one entry here plus its view components — the Simulators surface (run/stop + views) picks it up
// automatically, with no other wiring.
//
import type { ReactElement } from "react";

import { FakeInboxView } from "../components/FakeInboxView";
import { FakeConfigView } from "../components/FakeConfigView";

/** One inspector view (a sub-tab) for a simulator — self-contained; talks to the simulator's own bridge. */
export interface SimulatorView
{
    id     : string;               // stable sub-tab id
    label  : string;               // tab label
    render : () => ReactElement;   // the view element
}

/** One dev simulator — a fake provider RUN and INSPECTED entirely from the Console. */
export interface SimulatorDef
{
    id    : string;                // service id — matches the catalog + what processManager start/stops
    label : string;
    blurb : string;
    port  : number;                // its local MAIN port (drives the open-in-browser affordance)
    views : Array<SimulatorView>;
}

/** The registered simulators. fake-email is the first; SMS/voice gateways slot in exactly the same way. */
export const SIMULATORS : Array<SimulatorDef> =
[
    {
        id:    "fake-email",
        label: "Fake Email",
        blurb: "Simulated email provider (fake ESP) — captures every outbound send so you can inspect the raw MIME without a real inbox.",
        port:  9100,
        views:
        [
            { id: "inbox",  label: "Inbox",  render: () : ReactElement => <FakeInboxView /> },
            { id: "config", label: "Config", render: () : ReactElement => <FakeConfigView /> },
        ],
    },
];

export default SIMULATORS;
