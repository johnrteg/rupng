import type { SesListing, SesMessage } from "../shared/types";
import { TargetKind } from "../shared/types";
import { getTarget } from "./aws";

//
// SES viewer backend — LocalStack captures every SES send (it doesn't deliver) and exposes them at the
// internal dev endpoint `GET /_aws/ses`. We fetch + normalize them for the Email sub-tab. LocalStack-only:
// there's no equivalent "sent mail" capture on real AWS SES (that's CloudWatch / event destinations).
//
// The endpoint's JSON has drifted across LocalStack versions (capitalized vs snake_case keys), so we read
// each field tolerantly and present one clean shape.
//

const EDGE : string = "http://localhost:4566";

/** Coerce a value to a string only when it actually is one; otherwise undefined. Used to read tolerant, possibly-missing JSON fields. */
function str( value : unknown ) : string | undefined { return typeof value === "string" ? value : undefined; }

/** Normalize one raw LocalStack SES capture into a clean SesMessage. Each field is read across the capitalized and snake_case key variants LocalStack has used across versions. */
function normalize( message : Record<string, unknown> ) : SesMessage
{
    const body : Record<string, unknown> = ( message.Body ?? message.body ?? {} ) as Record<string, unknown>;
    // each field falls back across LocalStack's key spellings (e.g. `Source` vs `source`, `RawData` vs `raw_data` vs `raw`).
    return {
        id:           String( message.Id ?? message.id ?? "" ),
        timestamp:    str( message.Timestamp ?? message.timestamp ),
        region:       str( message.Region ?? message.region ),
        source:       str( message.Source ?? message.source ),
        destination:  ( message.Destination ?? message.destination ) as SesMessage[ "destination" ],
        subject:      str( message.Subject ?? message.subject ),
        body:         { text_part: str( body.text_part ?? body.TextPart ), html_part: str( body.html_part ?? body.HtmlPart ) },
        raw:          str( message.RawData ?? message.raw_data ?? message.raw ),
        template:     str( message.TemplateName ?? message.template_name ?? message.template ),
        templateData: str( message.TemplateData ?? message.template_data ),
    };
}

/** Fetch captured SES messages (newest first). LocalStack only. */
export async function sesMessages() : Promise<SesListing>
{
    const endpoint : string = `${EDGE}/_aws/ses`;
    if ( getTarget().kind !== TargetKind.LOCALSTACK )
        return { ok: false, messages: [], endpoint, error: "SES capture is a LocalStack feature — switch the target to LocalStack." };

    try
    {
        const res : Response = await fetch( endpoint );
        if ( !res.ok ) return { ok: false, messages: [], endpoint, error: `HTTP ${res.status} — is LocalStack up?` };
        const json : Record<string, unknown> = await res.json() as Record<string, unknown>;
        const raw : Array<unknown> = Array.isArray( json.messages ) ? json.messages as Array<unknown> : [];
        const messages : Array<SesMessage> = raw.map( ( message ) => normalize( message as Record<string, unknown> ) ).reverse();   // newest first
        return { ok: true, messages, endpoint };
    }
    catch ( err )
    {
        return { ok: false, messages: [], endpoint, error: ( err as Error ).message };
    }
}

/** Discard captured messages (best-effort — LocalStack supports DELETE on the capture endpoint). */
export async function sesClear() : Promise<void>
{
    if ( getTarget().kind !== TargetKind.LOCALSTACK ) return;
    try { await fetch( `${EDGE}/_aws/ses`, { method: "DELETE" } ); } catch { /* unsupported / down — ignore */ }
}
