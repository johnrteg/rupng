//
// account — CloudManifest: the service's AWS footprint (a resource manifest, no CDK/AWS coupling).
//
// Exported SEPARATELY from runtime code (imports only @repo/cloud-manifest data) so the /cloud CDK app
// can pull just the manifest at synth. Two ECS roles (Main + Read — same image, APP_NAME=account;
// SERVICE_ROLE selects the role, PORT is its slot in the ACCOUNT block). Behind an API Gateway.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType,
    Ports,
} from "@repo/cloud-manifest";
import { Events } from "@repo/system";   // Kafka topics = Events.Object (per-entity state change)

export const manifest : ResourceManifest =
{
    service     : "account",
    description : "Accounts, hierarchy, membership, plans/pricing, subscriptions, invoicing, usage. Two roles: Main + Read.",
    tracing     : true,

    owns:
    {
        // The two ECS Fargate ROLES — same image (root Dockerfile, APP_NAME=account); SERVICE_ROLE selects
        // the role and PORT is its slot in the ACCOUNT block (@repo/services Ports: main 8120 / read 8121).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.ACCOUNT.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                key             : "read",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.ACCOUNT.READ,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "read" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 8, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
        ],

        // API gateway (the front door). The service enforces auth itself, so the gateway passes through
        // (authorizer NONE). /version + /health are inherited; the resource routes are generated from the
        // public RestfulEndpoint defs in cloud/src/app.ts via apiEndpoints(...).
        api:
        {
            key        : "api",
            authorizer : ApiAuthorizer.NONE,
            cors       : true,
            throttle   : { default: { rateLimit: 100, burstLimit: 200 },
                           production: { rateLimit: 1000, burstLimit: 2000 } },
            endpoints  :
            [
                { method: "GET", path: "/version", public: true, authRequired: false },
                { method: "GET", path: "/health",  public: true, authRequired: false },
            ],
        },

        // Runtime config (AppConfig) — the account service's non-secret operational policy (AccountConfig:
        // hierarchy, membership defaults, retention windows), tunable without a redeploy. Seeded on boot.
        appConfig:
        [
            { key: "config", application: "account", profiles: [ { key: "settings" }, { key: "flags", type: "feature_flags" } ] },
        ],

        // DynamoDB tables — the account domain (the API contract types live in @repo/api: Account, Billing).
        tables:
        [
            // accounts — the core record; GSI parentId (list sub-accounts), GSI joinCode (join-by-code lookup)
            { key: "accounts", partitionKey: { name: "accountId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "parentId", partitionKey: { name: "parentId", type: AttrType.STRING }, projection: "ALL" },
                  { name: "joinCode", partitionKey: { name: "joinCode", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // members — account↔user membership (SoT here); SK userId, GSI userId (accounts a user is in)
            { key: "members", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "userId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "userId", partitionKey: { name: "userId", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // plans — the pricing catalog (versioned); GSI key for stable lookup
            { key: "plans", partitionKey: { name: "planId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "key", partitionKey: { name: "key", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // subscriptions — an account's plan instance (+ frozen PriceSnapshot); SK subscriptionId
            { key: "subscriptions", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "subscriptionId", type: AttrType.STRING } },

            // invoices — computed, immutable; SK invoiceId
            { key: "invoices", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "invoiceId", type: AttrType.STRING } },

            // usage — metered aggregates read at invoice time; SK = <metric>#<period>
            { key: "usage", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "sk", type: AttrType.STRING } },

            // features — the capability catalog (toggle keys); PK key
            { key: "features", partitionKey: { name: "key", type: AttrType.STRING } },

            // coupons — discount codes; PK code
            { key: "coupons", partitionKey: { name: "code", type: AttrType.STRING } },
        ],
    },

    // Kafka — consume auth.user (provision the account on a new verified identity) → publish account.account.
    subscribes: [ { topic: Events.Object.AUTH_USER, consumerGroup: "account-provisioning" } ],
    publishes:  [ { topic: Events.Object.ACCOUNT_ACCOUNT } ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
