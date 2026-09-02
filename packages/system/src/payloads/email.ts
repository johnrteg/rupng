//
// Email service payloads
//
import type { Type } from "@repo/common";

/** An email template — the `email.template` entity representation. */
export interface EmailTemplate
{
    id:        Type.ID;
    accountId?: Type.ID;
    name:      string;
    subject:   string;
    status:    string;
}

/** A sent/received email message — the `email.message` entity representation (one send-log row). */
export interface EmailMessage
{
    id:        Type.ID;         // messageId
    accountId: Type.ID;
    to:        string;
    subject:   string;
    status:    string;
}
