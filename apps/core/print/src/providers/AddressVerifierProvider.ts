//
import { Print } from "@repo/api";

//
// AddressVerifierProvider — the adapter interface every address-verification SOURCE implements (print-2.6),
// a SEPARATE, INDEPENDENT typed factory from `MailProvider` (mail with one, verify with another). Each source
// declares its `capabilities` (`cass`/`ncoa`); the service routes NCOA requests only to a source whose
// capabilities include it (USPS Web Tools is CASS-only, so it's never asked for NCOA).
//
export interface AddressVerifierProvider
{
    /** Which source this adapter is (the factory key). */
    readonly id : Print.AddressVerifierId;

    /** What this source can do — checked by `AddressVerifierFactory.resolve` before an NCOA call is routed
     *  here. */
    readonly capabilities : ReadonlyArray<Print.Capability>;

    /** Standardize + score deliverability for one address (CASS/DPV). NEVER throws. */
    verifyCass( address : Print.Address, ctx : AddressVerifierContext ) : Promise<CassResult>;

    /** Apply a move-update lookup (NCOA) for one address — only called on a source whose `capabilities`
     *  include `ncoa`. NEVER throws. */
    verifyNcoa( address : Print.Address, ctx : AddressVerifierContext ) : Promise<NcoaResult>;
}

/** Per-call context handed to an adapter — the resolved credential (an opaque secret payload; each adapter
 *  knows its own shape). */
export interface AddressVerifierContext { secret? : Record<string, unknown>; }

/** The result of a CASS/DPV standardization call. */
export interface CassResult { ok : boolean; standardized? : Print.Address; deliverability? : Print.Deliverability; vacant? : boolean; externalRefId? : string; error? : string; }

/** The result of an NCOA move-update call. */
export interface NcoaResult { ok : boolean; moved? : boolean; updatedAddress? : Print.Address; deceased? : boolean; error? : string; }

export default AddressVerifierProvider;
// eof
