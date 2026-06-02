
npm install @types/node --save-dev --workspace=@repo/common

$ rm -rf node_modules **/node_modules
$ rm -rf .turbo **/bin

#
# installing packages
#
npm install typescript@5.9.3 @types/node@22 --save-dev -W
# with the `-W` option to put at root for all work spaces


# --------------------------------------------------------------------
# Install AWS CDK
`npm install -g aws-cdk`


* Install localstack:
# https://www.localstack.cloud/
1) Register and log into localstack.
2) `brew install localstack/tap/localstack-cli`
3) Copy Personal Auth Token from localstack web page after login:
4) Verify install by `>localstack` -v and should get something like: `LocalStack CLI 2026.5.0`
5) Set token: `> localstack auth set-token <token>`. Should reply with `Token configured successfully`
6) Verify token `> localstack auth show-token`

7) Run localstack `localstack start`
* Options: -d (background)

     __                     _______ __             __
    / /   ____  _________ _/ / ___// /_____ ______/ /__
   / /   / __ \/ ___/ __ `/ /\__ \/ __/ __ `/ ___/ //_/
  / /___/ /_/ / /__/ /_/ / /___/ / /_/ /_/ / /__/ ,<
 /_____/\____/\___/\__,_/_//____/\__/\__,_/\___/_/|_|

- LocalStack CLI: 2026.5.0
- Profile: default
- App: https://app.localstack.cloud

[19:28:45] starting LocalStack in Docker mode 🐳                   

8) Status check: `localstack status`
┌─────────────────┬───────────────────────────────────────────────────────┐
│ Runtime version │ 2026.5.0                                              │
│ Docker image    │ tag: latest, id: a3517e7b7c14, 📆 2026-05-20T08:13:15 │
│ Runtime status  │ ✖ stopped                                             │
└─────────────────┴───────────────────────────────────────────────────────┘

9) Stop: `localstack stop`

ls-DoloNUjo-JuBi-7284-raSA-wipIyIyI29c0

# Start localstack
`localstack start -d`  // in background

in `~/.aws`
Create `config` file containing:
[profile localstack]
region=us-east-1
output=json
endpoint_url = http://localhost.localstack.cloud:4556

Create `credentials`
[localstack]
aws_access_key_id = test
aws_secret_access_key = test



export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test

# --------------------------------------------------------------------
# setup
# Deploy to local stack
`npx aws-cdk-local bootstrap`

# --------------------------------------------------------------------
# Deploy
`npx aws-cdk-local deploy --app 'node ./bin/cloud.js'` (-verbose)

# Destroy
`npx aws-cdk-local destroy --app 'node ./bin/cloud.js`

# Deploy to AWS
`cdk deploy`
