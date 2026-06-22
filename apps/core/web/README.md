#
# Web
#

Requirements:
* React
* Typescript
* MUI
* Hosted in AWS S3 configured for webiste hosting
* Hosting
    * AWS CloudFront: CDN in front of S3, fast global delivery
    * OR AWS Amplify Hosting
        * CI/CD
        * Custom domains (needed for whitelabel)
        * Each domain can point to a different branch of the code (development, staging, production)
        * Password protected preview for staging
        * No downtime, easy roolbacks
        * Amplify API creates subdomains
        * Automated SSL certificate management
        * Build and deploy from git
* Websocket support: API Gateway WebSockeckets
* AWS CloudWatch RUM; user-monitoring to monitoring service with transaction-id

* Consider Vite for the bundler insterad of webpack?

