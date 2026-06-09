#
# Email
#

# Requirements:
* Single email sending
* Template management
    * Merge tags for contact information, account and campaign
    * Use attachedments from media service.
* Scheduled delivery
* Visitbility across account of when and how much is being sent (gantt chart): [ email dispatcher ]
* Analytics
* Retry queue of failed delivery.  Config N attempts until DLQ
    * OR if config, try another provider (N providers) until Dead
* Abstract sending
    * `AWS SES`
    * Supports custom domain, DMARC, DKIM, SPF, feedback
* One-click unsubscribe
* Bounce/complaint feedback look: `SES` emits via `SNS` with auto suppression back to contact.
* Monitor complaint rates: Gmail and Yahoo requires <0.3% rate or you will get throttled/blocked.
* Account specfic email domains.
* New IPs requiring warming ramp grandually or will get blocked. [ email dispatcher ].  Check suppression before actual delivery.
* `AWS SQS` for single and bulk sending
    * DLQ, failure management, queue management by provider, retries
    * /email/ses/send OR /email/sendmail/send
    * If failed (network, config, keys), the item in the queue is not deleted and becomes visible in the queue again after some timeout and will continue to try until “max receives” (3-5) are reached.  Visible Timeout is a time for the message to be processed normally. Then move to DLQ.
    * Use exponential backoff on re-trys.
    * Ligit failures do not get re-tried.
    * Will need a process to move items from DLQ back to normal queue.  By batches, by accountId, etc.  Manual process via an API.
* To `halt/pause/cancel` an already submitted campaign, have state in Redis for the Job to check and not send new messages.  Move the item to the /pause queue.
* `AWS Lambda` job workers to send out physical email
* `AWS DynamoDB`: Email “send” logs and analytics (delivered, clicked, opened, bounced, optout/unsubscribe).
* `AWS EventBridge` to trigger schedule campaigns
* Tracking links in email (media service)
    * Dont process synchornously: CloudFront/Lambda@Edge -> SQS -> process.  Links to process and re-direct fast.
    * Use same shortener in email that is used in SMS.  Optional tracking.
* `API Gateway` to collect open and click events??
* Shortener URLS to track links.
    * Create and manage short domain names
* Factory design on email provider: SES, SendMail, MailGun, Postmark, SparkPost and `fake`
* Fake provider: Dummy success and failure, open, clicks to scale.  Deliver to queue to random open, click, unsubscribe, referral, etc.
* Send to SQS for “delivery” and jobs to process the delivery.  Call pixel tracker for “open”, “clicks” too.  Random unsubscribe too.  Config Job for thresholds.
* Contact information from `contact service` along with bulk send form segments.
* Analytics (open, click, bounce)
    * Not in DyanmoDB, too much and slow
    * Stream events to S3 + query with Athena
* Puase flag in Redis to stop further sending by account and/or campaign
* AWS EventBridge for scheduling

