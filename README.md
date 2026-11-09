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
npm run lint
npm run build:prod
```

The unit bootstrap installs synthetic credentials before importing application
modules, blocks HTTP/HTTPS and unexpected SDK requests, and restores Sinon stubs
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
| Isolated unit suite | 84 passed, including standalone/group creation shapes and linked seed-record consistency |
| Source coverage | 99.59% statements, 98.48% branches, 100% functions, 99.58% lines; 95% per-file gate passed |
| Startup/transport safety tests | 10 passed, including localhost binding |
| Authenticated local startup | Verified via `/dev` GETs before the fixture refresh; restart to load the updated eight-payment seed |
| Shutdown | Ctrl-C stopped the watcher, Offline and DynamoDB; task-owned ports were released |
| Lint and production build | Passed; all nine ZIPs validated and handler exports loaded without invoking them |

### Manual integrations and remaining work

`npm run test-i` and `npm run integration` use the existing service integration
tests. They mutate seeded local records and invoke real document-update Lambdas.
They refuse to run unless `INTEGRATION_ALLOW_LAMBDA=yes` is explicitly supplied,
and still refuse CI. Do not set that flag without environment-specific approval.
With approval, authenticate, start a freshly seeded service, then run in a second
terminal:

```sh
INTEGRATION_ALLOW_LAMBDA=yes npm run test-i
```

The legacy tests depend on their execution order and include destructive fixture checks; they
do not provide automatic snapshot restoration, comprehensive black-box coverage
or an HTML report. Restart the in-memory service afterwards. A full portable
integration/Bruno baseline with owned fixtures and restoration remains future
work. Unit coverage and database-only startup reads do not verify real downstream
document updates.

### Existing defects and operational limits

- Individual updates return 200 with `{}` before the DynamoDB promise settles;
  asynchronous write failures escape the existing catch. Synchronous failures
  still return the existing 500 response.
- The group-creation handler catches synchronous exceptions, not rejected service
  promises. Malformed JSON also escapes some existing handler error blocks.
- Missing individual payments return 200 with `{}`; missing groups return 404.
  Individual validation failures return 405.
- Persistence and downstream Lambda invocations are not transactional. A
  downstream failure can be reported after a local write/deletion.
- Creation stores only ID, status and payment details. Paid deletion can send
  string `"undefined"` for missing document metadata.
- Group deletion can log member-cleanup failures and still return success.
  DynamoDB unprocessed batch items are not retried; scans are not paginated.
- The legacy OpenAPI plugin emits Serverless 3 validation warnings for its
  `documentation` extension. This does not justify disabling validation or
  changing application contracts.
- No remote CI, real downstream integration, security scan or deployment is
  implied by local checks. Existing workflows can upload feature-branch
  artifacts and update non-production Lambdas from the default branch.

Keep dependency/security remediation in the later supported-runtime stage. Run
the required scans before an authorised commit/push; any Payments-specific
deferral requires an agreed deadline and explicit approval. Do not deploy this
legacy baseline or copy another service's Snyk exceptions.
