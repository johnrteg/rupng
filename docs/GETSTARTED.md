# rupng

RumbleUp omnichannel marketing & engagement platform — a Turborepo + npm-workspaces monorepo
(TypeScript, Fastify on AWS, CDK infrastructure). This README covers local dev setup.

## Prerequisites

- Node.js (with npm workspaces support)
- Docker (for LocalStack)
- AWS CDK CLI: `npm install -g aws-cdk`
- GitHub CLI (`gh`) — used by the Console's Repo/Deploy tabs to open PRs and by the release workflow
  (see [RELEASE.md](../RELEASE.md)). Install from <https://cli.github.com>:
  - macOS: `brew install gh`
  - Windows: `winget install GitHub.cli`
  - Linux: `sudo apt install gh` (or `sudo dnf install gh`)

  Then authenticate once: `gh auth login`.

## Install dependencies

Install root toolchain (the `-W` flag installs at the workspace root, shared by all packages):

```bash
npm install typescript@5.9.3 @types/node@22 --save-dev -W
```

Clean reinstall, if needed:

```bash
rm -rf node_modules **/node_modules
rm -rf .turbo **/bin
npm install
```

## LocalStack (local AWS emulation)

See https://www.localstack.cloud/

1. Register and log into LocalStack.
2. Install the CLI:
   ```bash
   brew install localstack/tap/localstack-cli
   ```
3. Verify the install (expect e.g. `LocalStack CLI 2026.5.0`):
   ```bash
   localstack -v
   ```
4. Set your personal auth token (copied from the LocalStack dashboard after login):
   ```bash
   localstack auth set-token <token>     # → "Token configured successfully"
   localstack auth show-token            # verify
   ```
5. Start LocalStack (`-d` runs it in the background):
   ```bash
   localstack start -d
   ```
6. Check / stop:
   ```bash
   localstack status
   localstack stop
   ```

## AWS profile & credentials

In `~/.aws/config`:

```ini
[profile localstack]
region = us-east-1
output = json
endpoint_url = http://localhost.localstack.cloud:4566
```

In `~/.aws/credentials`:

```ini
[localstack]
aws_access_key_id = test
aws_secret_access_key = test
```

Or export for the current shell:

```bash
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
```

## Deploy

### To LocalStack

```bash
npx aws-cdk-local bootstrap
npx aws-cdk-local deploy  --app 'node ./bin/cloud.js'   # add --verbose for detail
npx aws-cdk-local destroy --app 'node ./bin/cloud.js'
```

### To AWS

```bash
cdk deploy
```
