#
# Report
#

Objective: Report creation and scheduling

Requirements:
* Manage report generation
* Centraolized dash of available reports based on the user's access role
* Reports are placed in SQS queue and Jobs (Lambda) pick them up for generation
* Reports can be one-time, scheduled and scheduled repeated.
* Report Job would pull needed data from other services.
* Each report can have 0-many parameters to generate the report.
* Each report will have a unique id to reference.
* User can see a dash/list of submitted reports and download and delete
* Reports have a well defined interface, like endpoints, for the UI to know what parameters are needed to submit the report.  There will be a common base interface for shared parameters across reports.
* All report submissions are logged by who, when, what and where
* Reports can support 1 or more formats: CSV, PDF, Excel, JSON
* Services can create materialized views to help with report creation.
* Reports can have 
* Version the report spec for compatibility.  Long repeat schedule may still contained older version of the request.
* Be able to send to 1 or more destinations: download, email, sftp, dropbox, box.com, google drive, ms onedrive

# Services:
* AWS EventBridge Scheduler: enqueue now, schedule one off, or repeat.
* AWS SQS + DLQ
* Lambda for "short" reports: < 15 minutes
* ECS/Fargate for "long reports"
* AWS S3 for output
* AWS DyanmoDB for submission/status + TTL
* Materialize view by exporting materialized view into a reporting database.  AWS Athena + S3.
* Submit reports via [report dispatcher] from EventBridge
[ sumbit ] -> DDB -> [ EventBridge ] -> [ report dispatcher ] -> SQS -> ECS / Job

* Destination queues
    S3/<accountId>/reports/<fileId>.<ext> -> notification if preference
    
    [ job creatator ] -> write file -> done -> [ same creator then routes ] -> SQS -> [ delivery ]

    SQS:email-<provider> provider = aws, sendmail
    SQS:storage-<provider> provider = sftp, dropbox, google-drive
    SQS:text-<provider> provider = twilio, bandwidth
    SQS:crm-<provider> provider = mscrm

    For things like email and text, per account fail-over plan.
    * Try provider N times before failure
    * Then try another provider, repeat
    * Total failure occurs when all providers have been tried, each config N times

    Shared model definition:
    * deliveryId
    * accountId
    * Multiple envelopes:
        channel (email, storage)
        provider
        attempt
    * providerChain[]
    * payloadRef (S3 key)
    * destination

    TTL can be global or by account S3 prefix <accountId>/reports/

    Based on account preferences and setup
    If item failed to send, DLQ with notification
    Generated report would need to be compied to each path