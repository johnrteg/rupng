//
import { Registration } from "@repo/api";

//
// RegistrationStateMachine — the PURE transition graph behind registration-3.1 (`draft → submitted →
// pending-vetting → approved / rejected → number-associated → active`) plus its remediation edges
// (registration-3.2: a rejected/failed entity loops back to `submitted` after an edit).
//
// It is deliberately data + pure functions, with no facades, no IO and no logging, for two reasons:
//   1. BOTH the Service role and the Job Lambdas drive the same machine (registration-12.1/12.5), so the
//      rules can't live on either one of them.
//   2. A transition rule you can't read at a glance is a rule nobody checks. The two `LEGAL` maps below ARE
//      the specification — the state diagram in SPECS.md and this file are meant to be diffable by eye.
//
// TERMINALITY is the poll sweep's stop condition (registration-5.3). A terminal status is one TCR will not
// move off on its own; the sweep clears `nextPollAt` when a row reaches one and never schedules it again
// until an explicit action (a resubmit, a reprovision, an override) puts it back in flight.
//
export namespace RegistrationStateMachine
{
    // ── Brand ─────────────────────────────────────────────────────────────────────────────────

    /** Every legal successor of a brand status. An edge absent from this map is rejected by
     *  {@link canTransitionBrand}, so a bad webhook or a careless override can't corrupt the projection. */
    export const LEGAL_BRAND : Record<Registration.BrandStatus, Array<Registration.BrandStatus>> =
    {
        [ Registration.BrandStatus.DRAFT ]:
            [ Registration.BrandStatus.SUBMITTED ],
        [ Registration.BrandStatus.SUBMITTED ]:
            [ Registration.BrandStatus.IN_REVIEW, Registration.BrandStatus.PIN_SENT, Registration.BrandStatus.APPROVED,
              Registration.BrandStatus.NEEDS_APPEAL, Registration.BrandStatus.FAILED, Registration.BrandStatus.EXPIRED ],
        [ Registration.BrandStatus.IN_REVIEW ]:
            [ Registration.BrandStatus.PIN_SENT, Registration.BrandStatus.APPROVED, Registration.BrandStatus.NEEDS_APPEAL,
              Registration.BrandStatus.FAILED, Registration.BrandStatus.EXPIRED ],
        // the Campaign Verify PIN leg — a PIN is mailed to the entity of record, then entered back
        [ Registration.BrandStatus.PIN_SENT ]:
            [ Registration.BrandStatus.PIN_INPUTTED, Registration.BrandStatus.FAILED, Registration.BrandStatus.EXPIRED ],
        [ Registration.BrandStatus.PIN_INPUTTED ]:
            [ Registration.BrandStatus.IN_REVIEW, Registration.BrandStatus.APPROVED, Registration.BrandStatus.FAILED,
              Registration.BrandStatus.EXPIRED ],
        // an approved brand can still lapse, or be pulled back into an appeal if a re-vet downgrades it
        [ Registration.BrandStatus.APPROVED ]:
            [ Registration.BrandStatus.NEEDS_APPEAL, Registration.BrandStatus.EXPIRED ],
        // an EVP scoring failure lands here, NEVER on FAILED — see Registration.BrandStatus's own doc block
        [ Registration.BrandStatus.NEEDS_APPEAL ]:
            [ Registration.BrandStatus.APPEAL_IN_PROGRESS, Registration.BrandStatus.FAILED, Registration.BrandStatus.EXPIRED ],
        [ Registration.BrandStatus.APPEAL_IN_PROGRESS ]:
            [ Registration.BrandStatus.APPROVED, Registration.BrandStatus.FAILED, Registration.BrandStatus.EXPIRED ],
        // registration-3.2 remediation — an edited, rejected brand re-enters the pipeline at SUBMITTED
        [ Registration.BrandStatus.FAILED ]:
            [ Registration.BrandStatus.SUBMITTED ],
        [ Registration.BrandStatus.EXPIRED ]:
            [ Registration.BrandStatus.SUBMITTED ],
    };

    /** Brand statuses the poll sweep stops on (registration-5.3). `FAILED`/`EXPIRED` are terminal only until
     *  a resubmit explicitly re-enters the pipeline; `APPROVED` is the successful end of the brand leg. */
    export const TERMINAL_BRAND : ReadonlyArray<Registration.BrandStatus> =
        [ Registration.BrandStatus.APPROVED, Registration.BrandStatus.FAILED, Registration.BrandStatus.EXPIRED ];

    /** Is `to` a legal successor of `from` for a brand? A self-transition is allowed and treated as a no-op
     *  re-confirmation (TCR redelivers webhooks at-least-once, so idempotency matters more than strictness). */
    export function canTransitionBrand( from : Registration.BrandStatus, to : Registration.BrandStatus ) : boolean
    {
        if( from === to ) return true;
        return LEGAL_BRAND[ from ].includes( to );
    }

    /** Has a brand reached a status the sweep should stop polling? */
    export function isBrandTerminal( status : Registration.BrandStatus ) : boolean
    {
        return TERMINAL_BRAND.includes( status );
    }

    // ── Campaign ──────────────────────────────────────────────────────────────────────────────

    /** Every legal successor of a campaign status — the registration-3.1 pipeline plus the drift states
     *  (`SUSPENDED`/`EXPIRED`) TCR can push a live campaign into at any time. */
    export const LEGAL_CAMPAIGN : Record<Registration.CampaignStatus, Array<Registration.CampaignStatus>> =
    {
        [ Registration.CampaignStatus.DRAFT ]:
            [ Registration.CampaignStatus.SUBMITTED ],
        [ Registration.CampaignStatus.SUBMITTED ]:
            [ Registration.CampaignStatus.PENDING_VETTING, Registration.CampaignStatus.IN_REVIEW, Registration.CampaignStatus.APPROVED,
              Registration.CampaignStatus.REJECTED, Registration.CampaignStatus.EXPIRED ],
        [ Registration.CampaignStatus.PENDING_VETTING ]:
            [ Registration.CampaignStatus.IN_REVIEW, Registration.CampaignStatus.APPROVED, Registration.CampaignStatus.REJECTED,
              Registration.CampaignStatus.EXPIRED ],
        [ Registration.CampaignStatus.IN_REVIEW ]:
            [ Registration.CampaignStatus.APPROVED, Registration.CampaignStatus.REJECTED, Registration.CampaignStatus.EXPIRED ],
        // registration-4.1 — carrier provisioning is what carries an approved campaign toward ACTIVE
        [ Registration.CampaignStatus.APPROVED ]:
            [ Registration.CampaignStatus.NUMBER_ASSOCIATED, Registration.CampaignStatus.REJECTED,
              Registration.CampaignStatus.SUSPENDED, Registration.CampaignStatus.EXPIRED ],
        [ Registration.CampaignStatus.NUMBER_ASSOCIATED ]:
            [ Registration.CampaignStatus.ACTIVE, Registration.CampaignStatus.SUSPENDED, Registration.CampaignStatus.EXPIRED ],
        [ Registration.CampaignStatus.ACTIVE ]:
            [ Registration.CampaignStatus.SUSPENDED, Registration.CampaignStatus.EXPIRED ],
        // a DCA suspension is reversible — a remediated campaign can be un-suspended back to ACTIVE
        [ Registration.CampaignStatus.SUSPENDED ]:
            [ Registration.CampaignStatus.ACTIVE, Registration.CampaignStatus.EXPIRED ],
        // registration-3.2 remediation — an edited, rejected campaign re-enters the pipeline at SUBMITTED
        [ Registration.CampaignStatus.REJECTED ]:
            [ Registration.CampaignStatus.SUBMITTED ],
        [ Registration.CampaignStatus.EXPIRED ]:
            [ Registration.CampaignStatus.SUBMITTED ],
    };

    /** Campaign statuses the poll sweep stops on (registration-5.3). `ACTIVE` is the successful end state;
     *  `REJECTED`/`SUSPENDED`/`EXPIRED` are terminal until an explicit resubmit/reprovision re-opens them. */
    export const TERMINAL_CAMPAIGN : ReadonlyArray<Registration.CampaignStatus> =
        [ Registration.CampaignStatus.ACTIVE, Registration.CampaignStatus.REJECTED,
          Registration.CampaignStatus.SUSPENDED, Registration.CampaignStatus.EXPIRED ];

    /** Is `to` a legal successor of `from` for a campaign? Self-transitions are allowed (idempotent
     *  redelivery), same rationale as {@link canTransitionBrand}. */
    export function canTransitionCampaign( from : Registration.CampaignStatus, to : Registration.CampaignStatus ) : boolean
    {
        if( from === to ) return true;
        return LEGAL_CAMPAIGN[ from ].includes( to );
    }

    /** Has a campaign reached a status the sweep should stop polling? */
    export function isCampaignTerminal( status : Registration.CampaignStatus ) : boolean
    {
        return TERMINAL_CAMPAIGN.includes( status );
    }

    // ── Poll-sweep backoff (registration-5.3) ─────────────────────────────────────────────────

    /** The next `nextPollAt` for an in-flight row: `initialDelay * multiplier^attempts`, clamped to
     *  `maxDelaySeconds`. Exported (rather than inlined in the job) so the on-demand check&sync path and the
     *  sweep compute the SAME schedule, and so the arithmetic is testable without a Lambda. */
    export function nextPollAt( sweep : RegistrationStateMachine.Sweep, attempts : number, from : Date = new Date() ) : string
    {
        const raw : number = sweep.initialDelaySeconds * Math.pow( sweep.backoffMultiplier, Math.max( 0, attempts ) );
        const seconds : number = Math.min( sweep.maxDelaySeconds, Math.max( sweep.initialDelaySeconds, raw ) );
        return new Date( from.getTime() + seconds * 1000 ).toISOString();
    }

    /** The backoff knobs {@link nextPollAt} needs — structurally `RegistrationConfig.PollSweep`, restated
     *  here so this pure module doesn't drag a config import into the Lambda bundle. */
    export interface Sweep { initialDelaySeconds : number; maxDelaySeconds : number; backoffMultiplier : number; }
}

export default RegistrationStateMachine;
// eof
