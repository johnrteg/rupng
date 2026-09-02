//
import { randomUUID } from "node:crypto";

import { Dynamo } from "@repo/services";
import type { Type } from "@repo/common";

//
// SurveyTokenStore — survey's OWN pending PURL/submission-token queue (the `survey_tokens` DDB table: PK
// token, TTL expiresAt). Mirrors auth's ActionStore shape (apps/core/auth/src/services/ActionStore.ts) but
// is a SEPARATE table survey owns outright — per CLAUDE.md's no-cross-service-DB-reads rule, survey never
// reads/writes `auth_actions`. Ties an unauthenticated form submission back to a known contact (pseudonymous,
// survey-7.3); a truly anonymous distribution (survey-4.4) mints a token with no `contactId` at all.
//
export class SurveyTokenStore
{
    private static readonly TABLE : string = "survey_tokens";

    /** Default lifetime — long enough to cover a slow-to-respond recipient without keeping stale tokens live. */
    private static readonly DEFAULT_TTL_DAYS : number = 30;

    constructor( private readonly dynamo : Dynamo ) {}

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Mint a pending submission token for one distribution recipient. */
    public async create( input : SurveyTokenStore.CreateInput ) : Promise<Type.Result<SurveyTokenStore.Entity>>
    {
        const now : Date = new Date();
        const ttlDays : number = input.ttlDays ?? SurveyTokenStore.DEFAULT_TTL_DAYS;
        const entity : SurveyTokenStore.Entity =
        {
            token:          randomUUID(),
            accountId:      input.accountId,
            surveyId:       input.surveyId,
            surveyVersion:  input.surveyVersion,
            distributionId: input.distributionId,
            contactId:      input.contactId,
            responseId:     input.responseId,
            createdAt:      now.toISOString(),
            expiresAt:      Math.floor( now.getTime() / 1000 ) + ttlDays * 24 * 60 * 60,
        };
        const wrote : Type.Result<void> = await this.dynamo.put( SurveyTokenStore.TABLE, { ...entity } );
        if( !wrote.ok ) return { ok: false, error: wrote.error, cause: wrote.cause };
        return { ok: true, data: entity };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch a token row (the URL token = `token`), or undefined once expired/absent. */
    public async get( token : string ) : Promise<Type.Result<SurveyTokenStore.Entity | undefined>>
    {
        return this.dynamo.get<SurveyTokenStore.Entity>( SurveyTokenStore.TABLE, { token } );
    }
}

export namespace SurveyTokenStore
{
    export interface CreateInput
    {
        accountId:       string;
        surveyId:        string;
        surveyVersion:   number;
        distributionId?: string;
        contactId?:      string;   // absent when the distribution is anonymous (survey-4.4)
        responseId:      string;
        ttlDays?:        number;
    }

    /** One pending submission token (DynamoDB `survey_tokens`: PK token, TTL expiresAt). */
    export interface Entity
    {
        token:           string;
        accountId:       string;
        surveyId:        string;
        surveyVersion:   number;
        distributionId?: string;
        contactId?:      string;
        responseId:      string;
        createdAt:       string;
        expiresAt:       number;
    }
}

export default SurveyTokenStore;
// eof
