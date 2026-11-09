# RSP Payments service

## Node 20 local baseline

This branch establishes a local baseline for later Node 24 and Serverless Starter
work. Production JavaScript and business behaviour are unchanged. Existing defects
are characterised, not fixed. Node 20 and AWS SDK v2 are legacy dependencies
retained for this stage; this is not a deployment-ready modernisation.

Startup follows the Documents Node 20 approach: load the service's `.env`, resolve
an authenticated AWS profile with AWS CLI v2, select Java 21, and run the existing
Babel/watch/Serverless Offline workflow in ignored `build/`.

**The database is local, but downstream document-update Lambdas are real AWS
calls.** There is no shared Lambda factory, synthetic Lambda server or production
client redirection. Read-only payment/group GETs access only DynamoDB Local.
Creating/deleting payments or groups can mutate downstream Documents resources.
Obtain explicit approval before those checks.

### First run

Prerequisites: Node 20.20.2, npm 10, Java 21 and AWS CLI v2. With nvm:

```sh
nvm install
nvm use
npm ci --ignore-scripts
```

Create `.env` from `.env.example` if you do not already have private local
configuration. Do not overwrite an existing file. Select your normal
non-production AWS profile through `AWS_PROFILE` in the shell or `.env`.
The launcher pins its child processes to local `paymentsTable` and
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
access once. `npm start` exports profile credentials into memory only, checks
expiry, and passes them to its local child processes without printing values.
Restart the service after renewing expired credentials.

On macOS the launcher selects an installed Java 21 JDK; elsewhere configure
`JAVA_HOME` or `PATH`. Java 21 is the verified baseline prerequisite, not a claim
that every DynamoDB Local version requires it.

The compatible local tools are Serverless 3, Offline 13 and `serverless-dynamodb`.
Offline 12 cannot execute `nodejs20.x`; the obsolete `serverless-dynamodb-local`
plugin is incompatible with Serverless 3. A scoped
`--no-experimental-require-module` flag supports Serverless 3 on modern Node 20.

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

Offline reloads handlers for each request. This prevents Offline 13 reusing a
terminated worker after the known PUT timeout and makes repeated contract runs
reliable. It is a local emulation setting, not a production handler fix.

The launcher refuses occupied ports instead of stopping their owners. After
`Server ready`, inspect actual seeded records:

```sh
curl --fail http://localhost:3000/dev/payments/820500000877_FPN
curl --fail http://localhost:3000/dev/groupPayments/15xk9i0xujgg
```

The first body contains `payment.ID` equal to `820500000877_FPN`; the second
contains group `ID` equal to `15xk9i0xujgg` and its `Payments` categories.
Individual payment fixtures use the current persisted fields: `ID`,
`PenaltyStatus` and `PaymentDetail`. Paid records include the required payment
method and date; unpaid records have an empty `PaymentDetail`.

The seed contains four standalone payments and four group-member payments:

| Group | Type | Member payment IDs |
| --- | --- | --- |
| `15xk9i0xujgg` | FPN | `820500000881_FPN`, `820500000882_FPN` |
| `15xk9i0xujgg` | IM | `0000011123456_IM` |
| `15xef9lt3bhc` | FPN | `820500000883_FPN` |

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

CI runs the same coverage gate and local-tooling tests with Node 20/npm 10.
Integration tests are separate, manual and blocked in CI.

Verified locally on Node 20.20.2:

| Check | Result |
| --- | --- |
| Isolated unit suite | 92 passed, including fixture contracts, network isolation and existing-defect characterisation |
| Source coverage | 99.59% statements, 98.48% branches, 100% functions, 99.58% lines; 95% per-file gate passed |
| Startup/transport safety tests | 10 passed, including localhost binding |
| Integration-tooling safety tests | 24 passed, covering target/ownership/race guards, cleanup, runner outcomes and reports |
| Authorised manual API baseline | 35 passed across all nine routes in `rspnonprod`; known-defect cases are explicitly labelled |
| Default API subset | 14 passed, 16 skipped, five not-run; intentional nonzero exit for incomplete AWS-gated coverage |
| Authenticated local startup | Verified eight payment/two group seed bodies; repeated runs verified with fresh local workers |
| Shutdown | Ctrl-C stopped the watcher, Offline and DynamoDB; task-owned ports were released |
| Source and integration lint | Passed |
| Production build (earlier baseline verification) | All nine ZIPs validated and handler exports loaded without invoking them |

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
INTEGRATION_ALLOW_LAMBDA=yes npm run test-i
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
- The legacy OpenAPI plugin emits Serverless 3 validation warnings for its
  `documentation` extension. This does not justify disabling validation or
  changing application contracts.
- No remote CI, independent downstream document-state verification, security
  scan or deployment is implied by these checks. Existing workflows can upload feature-branch
  artifacts and update non-production Lambdas from the default branch.

Keep dependency/security remediation in the later supported-runtime stage. Run
the required scans before an authorised commit/push; any Payments-specific
deferral requires an agreed deadline and explicit approval. Do not deploy this
legacy baseline or copy another service's Snyk exceptions.
