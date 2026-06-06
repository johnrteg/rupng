//
// SES facade — send transactional email over SES v2.
//
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { CloudResolver } from "@repo/cloud-spec";
import { ClientUtils } from "./ClientUtils";

/**
 * SES facade — send email over `@aws-sdk/client-sesv2`.
 *
 * Note: unlike the other facades there's no logical key to resolve — SES sending identities
 * are *configuration* (a verified domain/address), not an injected resource id, so `from` is
 * passed by the caller. **Use for** transactional/system email (verifications, receipts,
 * alerts). Bulk marketing sends go through the campaign/email services, not here. Reach
 * through `.client` for templated/raw/MIME messages.
 */
export class Ses
{
    private _client? : SESv2Client;

    /** @param cloud the owning service's resolver (kept for a uniform facade signature). */
    constructor( private readonly cloud : CloudResolver ) {}

    /** The raw `SESv2Client` — escape hatch (templates, raw MIME, suppression list). Lazy + cached. */
    get client() : SESv2Client { return this._client ??= ClientUtils.createClient( SESv2Client ); }

    /**
     * Send a simple HTML and/or text email.
     * @param opts.from    a **verified** SES identity (address or domain).
     * @param opts.to      recipient addresses.
     * @param opts.subject subject line.
     * @param opts.html    HTML body (provide `html` and/or `text`).
     * @param opts.text    plain-text body (fallback for non-HTML clients).
     * @param opts.replyTo optional Reply-To addresses.
     */
    async send( opts : { from : string; to : Array<string>; subject : string; html? : string; text? : string; replyTo? : Array<string> } ) : Promise<void>
    {
        await this.client.send( new SendEmailCommand( {
            FromEmailAddress : opts.from,
            Destination      : { ToAddresses: opts.to },
            ReplyToAddresses : opts.replyTo,
            Content          : {
                Simple: {
                    Subject : { Data: opts.subject },
                    Body    : {
                        Html : opts.html ? { Data: opts.html } : undefined,
                        Text : opts.text ? { Data: opts.text } : undefined,
                    },
                },
            },
        } ) );
    }
}
