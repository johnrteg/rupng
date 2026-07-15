//
import { Email } from "@repo/api";

import { EmailProvider } from "./EmailProvider";
import { SesProvider } from "./adapters/SesProvider";
import { LettrProvider } from "./adapters/LettrProvider";
import { FakeProvider } from "./adapters/FakeProvider";
import { SendGridProvider } from "./adapters/SendGridProvider";
import { MailgunProvider } from "./adapters/MailgunProvider";
import { PostmarkProvider } from "./adapters/PostmarkProvider";
import { SparkPostProvider } from "./adapters/SparkPostProvider";
import { BrevoProvider } from "./adapters/BrevoProvider";
import { MailchimpProvider } from "./adapters/MailchimpProvider";
import { MailjetProvider } from "./adapters/MailjetProvider";
import { MailerSendProvider } from "./adapters/MailerSendProvider";
import { MailtrapProvider } from "./adapters/MailtrapProvider";
import { ResendProvider } from "./adapters/ResendProvider";

//
// EmailFactory — the registry of transport adapters (email-3.2), mirroring media's BrowseFactory / @repo/ai's
// AiFactory: a `Map<Provider, make>` seeded with the built-ins and extended via `register()`. Adding a provider
// = register an adapter; no call site changes. Key resolution + enablement live in EmailService (config +
// secrets); a marketplace provider registers its adapter here at install time.
//
export class EmailFactory
{
    private readonly registry : Map<Email.Provider, () => EmailProvider> = new Map<Email.Provider, () => EmailProvider>( [
        [ Email.Provider.SES,        () => new SesProvider() ],
        [ Email.Provider.LETTR,      () => new LettrProvider() ],
        [ Email.Provider.SENDGRID,   () => new SendGridProvider() ],
        [ Email.Provider.MAILGUN,    () => new MailgunProvider() ],
        [ Email.Provider.POSTMARK,   () => new PostmarkProvider() ],
        [ Email.Provider.SPARKPOST,  () => new SparkPostProvider() ],
        [ Email.Provider.BREVO,      () => new BrevoProvider() ],
        [ Email.Provider.MAILCHIMP,  () => new MailchimpProvider() ],
        [ Email.Provider.MAILJET,    () => new MailjetProvider() ],
        [ Email.Provider.MAILERSEND, () => new MailerSendProvider() ],
        [ Email.Provider.MAILTRAP,   () => new MailtrapProvider() ],
        [ Email.Provider.RESEND,     () => new ResendProvider() ],
        [ Email.Provider.FAKE,       () => new FakeProvider() ],
        // SMTP (nodemailer — dev sink / BYO relay) + a marketplace adapter land next.
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register (or replace) an adapter — add a provider without editing call sites. */
    public register( provider : Email.Provider, make : () => EmailProvider ) : void { this.registry.set( provider, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Instantiate one provider's adapter, or undefined if none is registered. */
    public get( provider : Email.Provider ) : EmailProvider | undefined
    {
        const make : ( () => EmailProvider ) | undefined = this.registry.get( provider );
        return make ? make() : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Every registered provider id (for listing/enablement). */
    public providers() : Array<Email.Provider> { return [ ...this.registry.keys() ]; }
}

export default EmailFactory;
// eof
