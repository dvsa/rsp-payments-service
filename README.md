# RSP Payments service

## Node 24 runtime upgrade

This branch upgrades the established Node 20 baseline to Node 24, the open-source
Serverless fork (OSLS) and AWS SDK v3. Payment business behaviour, REST routes and
accepted defects are preserved. This is not a Serverless Starter rewrite or an
upgrade of live infrastructure.

Startup loads `.env` and runs Babel/watch/Offline in ignored `build/`. SDK v3 uses
the normal profile provider chain for real Lambda calls; the old credential-export
launcher is removed. Only Offline's loopback DynamoDB client uses explicit fake
credentials. Production DynamoDB still uses the normal AWS provider chain.

**The database is local, but downstream document-update Lambdas are real AWS
calls.** There is no shared Lambda factory, synthetic Lambda server or production
client redirection. Read-only payment/group GETs access only DynamoDB Local.
Creating/deleting payments or groups can mutate downstream Documents resources.
Obtain explicit approval before those checks.

### First run

Prerequisites: Node 24.22.2, npm 11, Java 21 and AWS CLI v2 for profile
authentication/credential-process profiles. With nvm:

```sh
nvm install
nvm use
npm ci --ignore-scripts
```

Create `.env` from `.env.example` if you do not already have private local
configuration. Do not overwrite an existing file. Select your normal
non-production AWS profile through `AWS_PROFILE` in the shell or `.env`.
The Offline scripts pin their child processes to local `paymentsTable` and
`groupPaymentsTable`, overriding any non-local table names without editing `.env`.
Placeholder Lambda ARNs are sufficient for database-only reads; authorised
downstream checks need the correct environment-specific ARNs.

Authenticate using the login procedure for that profile. For an SSO profile,
for example:

```sh
aws sso login --profile YOUR_PROFILE
npm run setup:local
npm start
```

`setup:local` copies local files, including `.env`, into ignored `build/` and
downloads DynamoDB Local over HTTPS into `build/.dynamodb/`. It needs network
access once. `npm start` uses Node's `--env-file` support without exporting
access/session keys. Successful database reads do not prove AWS authentication;
only explicitly authorised downstream checks exercise that dependency.

Configure `JAVA_HOME` or `PATH` yourself; startup does not select a JDK. The
downloaded DynamoDB Local 1.25.1 was verified with Corretto 21.0.13. This is the
verified combination, not a claim that every DynamoDB Local release requires
Java 21.

The resolved local tools are OSLS 4.6.0, Offline 14.8.4 and
`serverless-dynamodb`. The `serverless` package is an OSLS alias, also used to
satisfy plugin peers; licensed Serverless v4 and AWS SDK v2 are not installed.
The obsolete framework module-loading flag is removed. The test scripts retain
`--no-experimental-detect-module` so Mocha uses the Babel require hook.

### Local transport and readiness

| Component | Address |
| --- | --- |
| REST v1 API, `dev` stage | `http://localhost:3000/dev` |
| Offline Lambda invocation API | `http://localhost:3002` |
| DynamoDB Local | `http://localhost:8000` |

The nine Serverless events use `http`, matching Terraform's REST API v1
`AWS_PROXY` integrations and `dev` stage. IAM authorizers and CORS remain in the
configuration. Only the local `offline` command bypasses authorization with
`--noAuth`. Do not expose local services to an untrusted network; DynamoDB Local
may listen beyond loopback.

Offline retains `reloadHandler: true` from the accepted baseline. Fresh workers
avoid reuse after the known PUT timeout. This is a local emulation setting, not
a production handler fix.

Check these ports and their process owners before starting; do not reuse an old
API or stop somebody else's service. After `Server ready`, inspect actual seeds:

```sh
curl --fail http://localhost:3000/dev/payments/820500000877_FPN
curl --fail http://localhost:3000/dev/groupPayments/15xk9i0xujgg
```

The first body contains `payment.ID` equal to `820500000877_FPN`; the second
contains group `ID` equal to `15xk9i0xujgg` and its `Payments` categories.
Individual payment fixtures use the current persisted fields: `ID`,
`PenaltyStatus` and `PaymentDetail`. Paid records include the required payment
method and date; unpaid records have an empty `PaymentDetail`.

The seed contains four standalone payments and six group-member payments:

| Group | Type | Member payment IDs |
| --- | --- | --- |
| `15xk9i0xujgg` | FPN | `820500000881_FPN`, `820500000882_FPN` |
| `15xk9i0xujgg` | IM | `0000011123456_IM` |
| `15xef9lt3bhc` | FPN | `820500000883_FPN` |
| `15xef9lt3bhc` | CDN | `820500000884_CDN`, `820500000885_CDN` |

Group entries contain `PaymentStatus: PAID`, `PaymentMethod`, a seconds-based
`PaymentDate` and `penaltyIds`. Each member has the matching `PenaltyGroupId`
and payment details. The full category payment amount is copied onto each
member, matching current group-creation behaviour rather than splitting it.

Stop with Ctrl-C in the startup terminal. The watcher, Offline and its DynamoDB
child must stop together. The database is in-memory: restarting reseeds both
tables and discards local changes. Never stop another user's process to free a
port.

### Route inventory

Paths below are relative to `/dev` locally.

| Method | Route | Handler |
| --- | --- | --- |
| GET | `/payments` | `list` |
| GET | `/payments/{id}` | `get` |
| POST | `/payments` | `create` |
| PUT | `/payments/{id}` | `update` |
| DELETE | `/payments/{id}` | `remove` |
| POST | `/payments/batches` | `batchFetch` |
| GET | `/groupPayments/{id}` | `getPenaltyGroupPaymentRecord` |
| POST | `/groupPayments` | `createPenaltyGroupPaymentRecord` |
| DELETE | `/groupPayments/{id}/{penaltyType}` | `deletePenaltyGroupPaymentRecord` |

Individual IDs combine reference and penalty type, for example
`999999000001_FPN`. Types are `FPN`, `IM` and `CDN`; IM references have additional
validation. Group creation takes `PaymentCode`, `PenaltyType`, `PaymentDetail`
and `PenaltyIds`. See the service unit tests for synthetic request bodies and
exact downstream invocation envelopes.

### Isolated regression checks

These commands require no `.env`, AWS login, database or API:

```sh
npm test
npm run test:coverage
npm run test:local-tooling
npm run test:integration:tooling
npm run lint
npm run lint:integration
npm run build:prod
```

The unit bootstrap installs synthetic credentials before importing application
modules, blocks HTTP/HTTPS/native fetch and unexpected SDK requests, and restores Sinon stubs
after each test. Tests exercise real validation, database request shapes,
conditional writes, Lambda envelopes, handler boundaries and existing defects.

Coverage uses NYC with coverage-only Babel Istanbul instrumentation on original
source. It includes all production `src/**/*.js`, including never-imported files;
only unit tests and `src/test/` are excluded. The agreed minimum is **95% per
production file** for statements, branches, functions and lines. HTML/JSON reports
are in ignored `coverage/`, with raw data in `.nyc_output/`. Export-only
`src/handler.js` remains included with zero executable counters, although NYC's
text table displays 0%. There is no configured type-check command.

CI runs the same coverage gate and local-tooling tests with Node 24/npm 11.
Integration tests are separate, manual and blocked in CI.

Verified locally on Node 24.22.2/npm 11.19.1:

| Check | Result |
| --- | --- |
| Isolated unit suite | 108 passed, including v3 commands/errors/byte payloads, isolation and existing-defect contracts |
| Source coverage | 99.62% statements, 98.73% branches, 100% functions, 99.60% lines; 95% per-file gate passed |
| Startup/transport safety tests | Six passed, including real direct-startup scripts with synthetic profile configuration |
| Integration-tooling safety tests | 24 passed, covering target/ownership/race guards, cleanup, runner outcomes and reports |
| Authorised manual API baseline | 35 passed across all nine routes in `rspnonprod`; known-defect cases are explicitly labelled |
| Legacy integrations | Nine passed after the owned-fixture suite; their mutations were discarded with the in-memory database |
| Profile-based local startup | Verified seeded payment/group bodies and authorised real Lambda invocations, with inherited credential variables cleared; restart to load later fixture additions |
| Shutdown | Task-owned watcher, Offline and DynamoDB stopped; ports released |
| Source and integration lint | Passed |
| Production build | Nine closed, self-contained ZIPs validated; handler exports loaded without cloud invocation |
| OpenAPI | Strict generation/validation passed for all nine operations |
| OSLS package | `npm run start-build` passed; lockfile-based production install, all handlers present, `.env` and tests excluded |
| Production dependencies | npm audit and Snyk: no findings |
| Full development dependency tree | npm audit: 11 affected packages (four high/seven moderate); policy-aware Snyk: seven medium advisories; `--ignore-policy`: 11 unique advisories (four high/seven medium) |

An initial upgraded contract run had three unexpected read timeouts. Cold
profile-backed loopback reads took roughly 0.5-1.1 seconds versus 6-19 ms with
fake local credentials. Restricting fake credentials to Offline's DynamoDB
client removed that unnecessary profile dependency; the unchanged suite then
passed 35/35, including cleanup. Real Lambda calls still used the approved AWS
profile. The earlier failed HTML/JSON evidence is retained in
`integration-reports/`; no expectations or timeout contracts were weakened.

### Build outputs

`npm run build:prod` derives all nine entries from `lambdas.json`, emits
`.webpack/<function>/app.js` and awaits complete `dist/<function>.zip` archives.
Each ZIP includes its own SDK v3 code, without shared numbered chunks. The SAM
template maps Node 24 functions to those directories and `app.handler`; SAM is
not required for local development and `.aws-sam/` is not a build input.

`npm run build-openApi` generates and strictly validates `build/openapi.json`,
then postprocesses it in that directory. Documentation-only additions supply the
missing group request model and IAM 403 responses; obsolete GET body references
are removed. Existing request/response model files still contain legacy schema
definitions; successful generation is not a claim that every schema has been
fully reconciled with current payment contracts. The independent integration
suite remains the behavioural baseline.

`npm run start-build` is a separate OSLS packaging check, not a deployment. It
recreates `build/`, so stop local services first and rerun `npm run setup:local`
afterwards. Do not use `zip.sh` for verification: it runs `predeploy` and prunes
the working dependency installation.

### Manual contract baseline

After starting the service in the first terminal, run the recommended portable
baseline in a second terminal:

```sh
npm run test:integration:local
npm run test:integration:report:open
```

The 35 scenarios inventory all nine exports/routes and verify exact responses,
independent GET/database read-backs, individual/group transitions, rejection
side effects and fixture restoration. Default execution seeds/restores only
reserved local fixtures and skips AWS-capable routes; skipped coverage produces
a nonzero exit. Existing Bruno fixtures are preserved.

For the complete baseline, first authenticate and obtain explicit approval for
the configured non-production downstream Lambda effects:

```sh
INTEGRATION_ALLOW_LAMBDA=yes npm run test:integration:local
```

Every run generates escaped, self-contained HTML and machine-readable JSON in
ignored `integration-reports/`, including setup failures. The new suite's actual
API execution results must be read from those reports; offline tooling checks
are not a successful API run. See [the integration guide](integration/README.md)
for complete contracts, first-run steps, seed/reset commands, credential refresh,
owned-fixture recovery and coverage limitations. Do not persist the approval
flag unless future runs in that environment are also authorised.

### Legacy manual integrations

`npm run test-i` and `npm run integration` use the existing service integration
tests. They mutate seeded local records and invoke real document-update Lambdas.
They refuse to run unless `INTEGRATION_ALLOW_LAMBDA=yes` is explicitly supplied,
and still refuse CI. Do not set that flag without environment-specific approval.
With approval, authenticate, start a freshly seeded service, then run in a second
terminal:

```sh
INTEGRATION_ALLOW_LAMBDA=yes npm run test-i -- --timeout 30000
```

The nine legacy tests previously passed in an authorised non-production run.
They depend on execution order and include destructive fixture checks, without
snapshot restoration or HTML reporting. Prefer the new owned-fixture baseline;
restart the in-memory service after legacy tests. Neither suite independently
verifies downstream document state.

### Existing defects and operational limits

- Individual updates return 200 with `{}` before the DynamoDB promise settles;
  asynchronous write failures escape the existing catch. Synchronous failures
  still return the existing 500 response at service level. The exported PUT
  handler is non-async and never calls its callback: locally both valid and
  invalid requests actually return an empty HTTP 504. This accepted known-defect
  baseline checks both the exact timeout and the persisted/no-write outcome.
- The group-creation handler catches synchronous exceptions, not rejected service
  promises. Malformed JSON also escapes some existing handler error blocks.
- Missing individual payments return 200 with `{}`; missing groups return 404.
  Individual creation validation failures return 405.
- Persistence and downstream Lambda invocations are not transactional. A
  downstream failure can be reported after a local write/deletion.
- Lambda `FunctionError` responses can still yield successful payment/group
  responses; isolated tests explicitly preserve this limitation.
- Creation stores only ID, status and payment details. Paid deletion can send
  string `"undefined"` for missing document metadata.
- Group deletion can log member-cleanup failures and still return success.
  DynamoDB unprocessed batch items are not retried; scans are not paginated.
- Existing logging includes payment tokens/details without general redaction;
  that pre-existing issue has not been silently changed in the runtime upgrade.
- No remote CI, independent downstream document-state verification or deployment
  is implied by these checks. Existing workflows can upload feature-branch
  artifacts and update non-production Lambdas from the default branch.

The full-tree security gate is not clear. Compatible upgrades and same-major
YAML/nanoid overrides were applied, but development-tool advisories remain.
The four high-severity Snyk findings in Faker, braces, flat and uri-js have
user-approved exceptions in `.snyk`, expiring **2027-06-10 at 00:00 UTC**.
They match four exact advisory IDs and eight version-specific development
dependency paths, not whole packages, production dependencies or future
versions. No incompatible transitive-major overrides were added.

Published upstream releases were checked: Postman 5.3.1 still pins Faker 5.5.3
and uses APIs incompatible with patched Faker 10.5+; current OSLS still requires
unpatched braces; even webpack-merge 6 retains affected flat; removing uri-js
requires a separate Airbnb/ESLint policy migration. These exceptions are
temporary risk acceptance, not fixes or proof of non-exploitability. Recheck
upstream and remediate before expiry; keep `snyk test --dev --ignore-policy` in
manual verification so accepted findings remain visible.

Seven medium Snyk advisories remain unignored. npm audit does not use `.snyk`
and still reports its full development findings. Further remediation is
required before calling stage 2's security work complete. The existing logging
issue also remains. Live Lambda runtime changes remain external infrastructure
work.
