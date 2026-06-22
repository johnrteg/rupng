#
# Media Service
#

Objective: Manage all media that might be generated and consumed by accounts.

Requirements:
* All media segmented by account Id
* Raw data files are in AWS S3 and segmented by account Id buckets at some root bucket (e.g. "/media")
* DayamoDB contains a mapping of data to the objects in each account bucket.
    * guid (object name in bucket)
    * filenane
    * created time
    * last accessed time
    * mime type
    * file extension
    * file size
    * access role
    * account Id (PK)
    * parent.uid (for variants)
    * status : uploading, scanning, processing, ok/failed/quarantined
    * tags (array<string>)
    * version (from S3)
    * soft deletes and then sweep to delete
    * TTL (default, account specfic, environment specific)
    * Meta: (video: frame, image: width, height, quality/depth)
* Endpoint to access files with access controls in place and data logging on access history.  No direct S3 access.
    * CloudFront does provide metric on date/time, region, https tatus and referral as long as that can be accessed centrally for audit purposes.
    * Private files that required access or that do not need fast access (reports) would hide behind the endpoint
    * Look into S3 pre-signed URLs/cookies.
    * Only to define decision + time-limited URL; never stream the bytes. -> S3/CloudFront.
    * New versions get a new url: /public/:guid/:version
* Future: scan for viruses on upload (ClamAV: Lambda/ECS) to scan files, or Sophos for commercial. Facotory pattern to determine which service/libary is used to scan.
* Use AWC CDN for public paths
    * AWS CloudFront distribution for public buckets
    * Setup Origin Access Control (OAC) so CloudFront can only access the bucket directly with no public access
    * Serve public media files
    * Media endpoint only hit on first request or cache expiration
* Cold files
    * Move to glacier past some last accessed time
* Enforce account bandwidth limits via Gateway
* API throttle limits and rate limits
    * Redis
    Reset counters periodically
    Not able to limit CDN files (OK)
* Be able to process uploaded files based on account rules
    * Image variants (mobile, tablet, desktop):  (NPM Sharp for resize, crop and convert)
    * Video processing: compression: AWS Elemental MediaConvert: transcoding, compression and format conversion
    * Alway maintain original
    * Look into CloudFront + Lambda@Edge for variant creation and then cache instead of pre-processing variants.  TTL.
* Upload
    * Direct to S3 via pre-signed POST/PUT URL
    * S3 created event -> SQS -> [media dispatcher] -> SQS -> [quarentined] -> Job/App
* Buckets
    * :accountId/public/:guid
    * :accountId/protected/:guid
    * :accountId/private/:guid