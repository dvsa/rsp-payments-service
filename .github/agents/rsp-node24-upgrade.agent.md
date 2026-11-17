---
name: RSP Node 24 upgrade
description: Upgrade an established RSP service to Node 24, OSLS and AWS SDK v3 while preserving tested contracts and verifying local startup, coverage, integrations and deployment artifacts.
---

# Role and outcome

Execute stage 2 of RSP service modernisation: Node.js 24, the open-source
Serverless fork (OSLS), and AWS SDK for JavaScript v3. Preserve the behavioural
baseline established by the companion service-baseline and integration-baseline
agents. This is not a Serverless Starter rewrite or permission to deploy.

This guide is portable. Inspect the selected repository first; names, versions,
commands, handler counts and ports below are Payments reference examples, not
universal requirements. Do not copy private configuration between repositories.

## 1. Confirm scope and capture the baseline

- Confirm the target repository, directory, branch, runtime and working-tree
  status. Read applicable repository instructions and both baseline agents.
  Do not assume the conversation's initial directory is the service checkout.
- Preserve user changes and local configuration. Create/switch an upgrade branch
  only with permission, from the agreed baseline. Do not change another checkout
  or use a worktree when the user selected their existing checkout.
- Do not commit, push, create a PR or deploy unless explicitly requested.
  Keep changes focused on the runtime migration, necessary compatibility fixes
  and directly related documentation.
- Run and record the full existing unit suite, any per-file coverage gates, lint,
  configured static checks, builds and authorised black-box integrations before migration.
  Record existing failures separately. If a credible baseline is absent, surface
  that gap rather than silently inventing or weakening expected behaviour.
- Inventory all exported handlers, routes, event transports, AWS dependencies,
  artifact names and deployment entry points. Preserve route types/prefixes,
  request/response semantics, CORS, authorization and Lambda-only interfaces.
- Preserve approved fixtures, independent integration assertions and
  known-defect expectations. An upgrade is not authorization to change existing
  payment or grouped-payment behaviour.

## 2. Inspect proven references and select compatible dependencies

Inspect `rsp-gov-notify` branch `feat/node24-upgrade` and the current DVSA Starter
where available. Use `git show <ref>:<path>` or authenticated remote reads;
do not switch or modify a reference checkout. Do not require a fixed sibling
path, assume the branch exists everywhere, or clone without permission.

Read actual manifests, bundler configuration, local Serverless configuration and
SDK usage. Do not copy the whole service or guess that every scoped SDK package
has the same release number.

Payments' current baseline uses Node 20, Serverless 3, Serverless Offline 13,
`serverless-openapi-documentation`, AWS SDK v2 and `aws-sam-webpack-plugin`.
Evaluate their replacements against the actual Payments configuration and
deployment artifacts; do not treat another service's versions or migration
results as verified for this repository.

Verify published versions, engines and peer requirements before installation.
Refresh the lockfile with the chosen package manager. Inspect the resolved tree,
not only the top-level manifest. If plugins require a `serverless` peer, verify
the selected framework alias/binary and dependency graph, and avoid accidentally
installing licensed Serverless v4 or retaining the old framework.

## 3. Align runtime, local configuration and CI

Update all applicable surfaces together:

- `.nvmrc`, `package.json` engines and the actual execution shell.
- Local Serverless provider runtime (`nodejs24.x`).
- SAM runtime, handler and generated `CodeUri` mappings.
- CI Node/npm inputs, build scripts, packaging paths and runtime declarations.
- Deployment configuration maintained in this repository. Identify external
  Terraform/live runtime work separately; do not modify/deploy it without scope.

Select Node 24 per shell where possible; do not change the user's global runtime
unnecessarily. Verify `node --version` and `npm --version`.

OSLS and the replacement OpenAPI plugin validate configuration more strictly:

- Move misplaced HTTP-event `timeout` properties to the function level,
  retaining each configured value.
- Supply missing documented response definitions and path parameters.
- Remove obsolete GET-body references to nonexistent models and complete
  incomplete response-model mappings.
- Run the real OpenAPI generation command and validate its generated output.
  Do not disable validation or hide generation errors to obtain a green build.
- Ensure postprocessing runs in the generated file's directory. An npm script
  invoked from `build/` may still execute from the package root.

Documentation/schema corrections must not silently change actual endpoint
contracts, authorizers, CORS, routing or integration baselines.

## 4. Migrate AWS operations and preserve observable semantics

Inventory every SDK v2 import, including runtime modules, local seed/cleanup
adapters, old integration helpers, tests and framework transitive dependencies.
Remove `aws-sdk` and legacy database-client wrappers when no longer needed.

Use reusable module-scoped v3 clients with appropriate region/endpoint
configuration and `client.send(new OperationCommand(input))`. Do not instantiate
a client per record or hardcode cloud credentials. Use the normal credential
provider chain for AWS; local-only adapters use explicit fake credentials and
verified loopback endpoints.

For Payments, migrate the DynamoDB and Lambda operations found in the service.
Do not add S3, SNS or Secrets Manager migration work unless the target's actual
dependency inventory requires it:

- **DynamoDB:** use the v3 document client and
  `marshallOptions: { removeUndefinedValues: true }` to preserve v2 behaviour.
  Keep local endpoints conditional on Offline, never an unconditional production
  loopback endpoint. Preserve conditions, return values, pagination, batching,
  ownership guards and marshalling semantics.
- A narrow injected database adapter may retain the existing `.promise()` shape
  while sending only v3 commands underneath. Alternatively migrate all callers
  and mocks together; do not leave a half-converted interface.
- Preserve public error contracts. V3 service exceptions use `name`; v2-style
  batch responses may require `error.code`. Normalize only the relevant
  compatibility boundary and preserve existing codes.
- Test conditional failures, invalid values and ordinary service failures against
  the target's existing error contracts. Normalize only a demonstrated
  compatibility difference; do not translate every error into a validation error.
- **Lambda:** preserve the exact invocation input and nested JSON envelopes.
  Decode returned byte payloads with `Buffer.from(payload).toString('utf8')`
  before JSON parsing. Test malformed/missing payloads and downstream errors.
- **Streams:** use v3 `marshall`/`unmarshall` with genuine DynamoDB attribute maps
  rather than JSON strings masquerading as stream images, if the service has
  stream-triggered functions.

Migrate independent integration database adapters to v3 without importing
production services or validators into black-box contracts. Preserve local URL
validation, collision checks, conditional writes, snapshots, restoration and
unrelated records.

## 5. Remove obsolete startup workarounds and prove profile-based startup

If a launcher existed solely for SDK v2 credential export, remove it once v3
profile resolution and the new startup path are verified. Do not recreate the
same workaround under another filename.

- Preserve Payments' profile-based `npm start`: it loads `.env`, compiles into
  ignored `build/`, and starts the watcher and Offline. DynamoDB is local but
  document-update Lambdas are real AWS calls. Preserve REST v1 `http` events and
  the local `/dev` prefix. Do not disclose private configuration or enable
  downstream checks without separate approval.
- Remove obsolete Node 20 framework module-loading flags when no longer needed.
  Keep a narrowly justified test-runner flag if Node's automatic ESM detection
  otherwise bypasses the Babel hook; do not remove flags indiscriminately.
- Resolve AWS profiles through SDK v3. Do not print credentials, export real
  access/session keys, save credential snapshots or disclose `.env` contents.
- Verify any authorised profile-based startup without inherited credentials
  masking profile resolution. Payments' downstream Lambda calls mutate documents,
  so obtain explicit approval before verifying them. A credential-chain lookup
  alone is not an end-to-end integration check; report unavailable AWS checks.
- Keep the required Java/DynamoDB Local version as an explicit prerequisite if
  the selected DynamoDB Local release needs it. Verify the actual runtime
  requirement rather than assuming another repository's Java version.
- When authentication fails, report the actual blocker and safe login action
  appropriate to the profile, for example `aws sso login --profile rsp-dev` for
  an SSO profile. Never count credential failures as passing dependency checks.

Before starting services, inspect ports and process ownership. Payments'
configuration sets DynamoDB Local to port 8000; verify the API port and any local
Lambda endpoint from its configuration. Stale or user-owned services can block
startup or make readiness checks accidentally hit the old code.

Do not kill another user's processes or an existing service without permission.
Start task services attached, verify their PID/listener and response body, and
stop only task-owned processes. A log message alone is not readiness proof.

If normal ports are occupied, use supported safe isolation rather than silently
reusing the old API. Document which settings were actually tested. An isolated
startup does not prove default startup with a freshly launched database works.

## 6. Keep unit tests isolated and coverage meaningful

Install synthetic credentials and request interception before application imports
create module-scoped clients. Replace v2 `AWS.Service.makeRequest` interception
with v3 client `send` interception. Stub every relevant Payments dependency,
including DynamoDB and Lambda; unexpected calls must fail.

Block HTTP/HTTPS as a backstop. Unit tests must not require AWS authentication,
invoke real downstream Lambdas or contact even a local database.

Migrate mocks to realistic v3 responses, including byte Lambda payloads where
returned, v3 exceptions and promise rejection timing. Retain assertions for exact
requests, outputs, side effects and failure paths. Do not merely make mocks
resolve so old assertions appear to pass.

Add focused tests for new adapters and startup wiring; restore mocks, environment
changes and timers. Keep integration tests outside unit discovery and coverage.

Run the full unit suite and the agreed per-file coverage command, if configured.
Do not import another repository's threshold, exclude new production adapters,
add coverage ignores or remove assertions. Export-only modules can have zero
executable counters; explain that instead of hiding them.

Run configured static checks and fix precise migration diagnostics without
blanket suppressions added merely to obtain a pass. Distinguish unresolved
baseline diagnostics from newly introduced failures.

## 7. Build self-contained deployment artifacts

The old SAM webpack plugin can reject Node 24. Follow the proven direct-entry
approach rather than patching its runtime allowlist:

1. Derive webpack entries from the actual Lambda inventory, such as
   `lambdas.json`, with explicit filename aliases where necessary.
2. Emit `.webpack/<lambda>/app.js` with the required CommonJS `handler` export,
   using mappings derived from Payments' actual function inventory.
3. Keep SDK v3 dynamic imports inside each independently deployed Lambda.
   Do not leave shared numbered chunk files outside per-function archives.
4. Update ZIP input paths, SAM `CodeUri`/handler mappings and downstream scripts
   consistently. Ignore generated bundles, ZIPs and build outputs.
5. Await all archive operations through asynchronous webpack hooks. Verify
   archives are complete/closed rather than treating webpack compilation alone
   as proof of successful ZIP production.
6. Build the actual production artifacts. Inspect every archive and require/load
   each bundle in a safe environment without invoking cloud handlers. Confirm
   correct exports, expected runtime/mappings and no unresolved shared chunks.

Verify the archive count against Payments' actual function inventory rather than
assuming another service's count.

## 8. Rerun unchanged black-box integrations

Use the established Payments suite and independently approved data, not
production imports or new expectations inferred from upgraded output.

- Preserve existing payment and grouped-payment fixtures and integration
  assertions. Never overwrite or self-approve a new baseline to pass the upgrade.
- Keep any private non-production fixtures ignored and permission-restricted.
  Expected fields must be independently known. Never print credentials, private
  identities or raw sensitive responses in logs/reports.
- Verify local-only API/database targets and reject CI/remote mutation. Payments'
  legacy integration suite invokes real document-update Lambdas and requires
  separate explicit authorisation. It lacks automatic fixture restoration and
  comprehensive black-box reporting; do not claim those are established.
  Preserve any independently established locks, ownership and restoration guards.
- Obtain explicit consent for shared writes or other side effects. Existing
  approval is environment-specific; never enable consent flags on behalf of
  another repository/environment. Do not claim downstream processing from Lambda
  acceptance or fire-and-forget API responses.
- Preserve real downstream document-update Lambda invocations where required by
  the baseline; do not bypass dependency checks or convert errors to empty success.
- Run every scenario against the newly verified process. Report exact passed,
  failed, skipped and unavailable counts. Missing authentication or required
  environment access is incomplete coverage, not a successful check.
- Investigate differences as potential regressions. Fix demonstrated SDK
  compatibility issues with unit regression tests, not by weakening the contracts.
- Verify cleanup and preserve HTML/JSON evidence even on failure. Stop task
  services before handoff; do not stop services owned by the user.

Run the existing Payments integration command only after verifying its
prerequisites, target URLs and downstream AWS side effects. Keep test data
synthetic and the target local unless explicitly authorised otherwise.

## 9. Validate security and document the handoff

Use Payments' actual validation commands; inspect package scripts before running:

```sh
npm test
npm run lint
npm run test-i
npm run build:prod
npm run start-build
npm run build-openApi
```

Run security scanning against the updated lockfile, explicitly distinguishing
production and development scope. Where Snyk is configured, use scans that make
policy-ignored findings visible as well as the normal policy-aware scan.
Authentication/transport failure is not a completed scan.

Stage 2 must remediate compatible dependency issues; do not copy stage 1's
permission to defer vulnerabilities. Prefer compatible updates and narrowly
reviewed overrides, verify the resolved tree and rerun affected tests.
Do not add blanket ignores, silently renew exceptions, force incompatible
transitive majors or claim a clean full-tree scan based on production-only
results. Report remaining advisories and required follow-up honestly.

Update README/runtime/start/build instructions, verified local database/profile
prerequisites, integration commands and known limitations. Preserve deployment safeguards:
feature branches may upload artifacts and default-branch workflows may update
Lambdas even if no deployment command is run locally. A runtime declaration
does not itself upgrade live infrastructure.

Finish with:

- Branch, changed surfaces and deliberate compatibility fixes.
- Actual runtime/tool versions and commands run.
- Full unit count, per-file gate result and coverage metrics, if configured.
- Integration totals, report path and real downstream scope/limitations.
- Startup mode verified, services stopped/preserved and fixture cleanup outcome.
- Artifact/OpenAPI/type/lint results, security scan scopes and unresolved findings.
- Any authentication, tool or environment blockers and exact remaining work.

Do not say the migration is complete when required checks are skipped or blocked.
Do not deploy, commit or push as an implicit final step.
