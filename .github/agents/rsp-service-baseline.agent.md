---
name: RSP service baseline builder
description: Establish local RSP service execution, isolated unit tests and enforced coverage before runtime upgrades and Serverless Starter rewrites.
---

# RSP service modernisation baseline

Use this guide to establish a repeatable, tested baseline for an existing RSP
service before upgrading or rewriting it. It is intended to be copied into other
service repositories. Inspect each repository first: package versions, commands,
routes and AWS services below are reference patterns, not universal requirements.

## Keep the three stages separate

1. **Local baseline:** run the existing service on its current runtime, support
   Bruno collection development, and establish meaningful automated regression
   tests.
2. **Supported runtime:** upgrade to Node.js 24, the open-source Serverless
   replacement used by the DVSA Starter, and AWS SDK for JavaScript v3. Preserve
   the API contracts and business behaviour established in stage 1.
3. **Starter rewrite:** rebuild using the DVSA Serverless Starter, carrying forward
   the same behavioural tests and Bruno requests.

The cross-service milestone is stage 2 before July 2027. Node.js 20 is an interim
compatibility baseline, not the supported-runtime destination. Completing stage 1
does not authorise starting stage 2 or deploying the service.

## Working safely

- Confirm the repository, current branch, runtime and working-tree status before
  editing. Read existing instructions, scripts, workflows and configuration.
- Work on the user's selected branch. Do not modify `main`, create/switch branches,
  discard changes, commit or push without the user's authorisation.
- Preserve existing local configuration and unrelated changes. Do not commit
  `.env`, credentials, generated builds, coverage reports or downloaded databases.
- Keep changes surgical. Do not bundle runtime upgrades, architectural rewrites
  or dependency remediation into baseline work without approval.
- Report and characterise existing defects without changing production logic.
  Any behaviour fix requires separate approval and regression tests.

## Establish local execution

1. Inventory handlers, routes, validation, configuration sources and downstream
   dependencies. Separate local infrastructure from real AWS calls.
2. Check the actual Node version and align `.nvmrc`, package engines, local
   emulator runtime and CI with the baseline runtime.
3. Select compatible local tooling. Do not install licensed Serverless Framework
   v4 accidentally. For the later Node 24 stage, inspect the current DVSA Starter
   and an already-upgraded service rather than guessing package versions.
4. Make the documented `npm start` command sufficient after prerequisites and
   normal AWS authentication where the existing local workflow requires it.
   Do not rely on an agent's private shell setup.
5. Document Java/database requirements, profile selection, ports, seeded data,
   startup, shutdown and credential expiry.
6. Verify readiness with an actual endpoint and inspect its response body, not
   just its HTTP status. Check a database-only endpoint and an authorised
   read-only AWS endpoint where applicable.

### Payments service reference

- This repository's current baseline is Node 20, Serverless 3, Serverless Offline
  13, `serverless-dynamodb`, `serverless-openapi-documentation` and AWS SDK
  v2. It has local `paymentsTable` and `groupPaymentsTable` DynamoDB tables.
- `npm run setup:local` installs DynamoDB Local into ignored `build/`. `npm start`
  loads Payments' `.env`, resolves its authenticated AWS profile in memory,
  selects Java 21 and runs the existing compile/watch/Offline flow.
  `npm test` runs isolated unit tests; `npm run test:coverage` enforces 95% per
  executable production file in all four metrics. `npm run test-i` is manual,
  refuses CI and requires explicit opt-in for real downstream Lambda mutations.
- The service stores individual and grouped payment records in DynamoDB Local,
  but its document-update Lambda clients still use real AWS. Do not introduce a
  shared client abstraction or change production logic for local startup.
- Terraform uses REST API v1 with AWS_PROXY integrations and IAM authorizers.
  Local events use `http` with the `/dev` prefix; `--noAuth` is local only.
- The current local DynamoDB configuration uses port 8000. Verify the API port,
  Java/DynamoDB Local requirements and effective route prefixes from the selected
  configuration and startup output rather than copying values from another
  service.

Do not silently change `http`/`httpApi`, authorisation, CORS or route prefixes.
Compare local events against deployment configuration and existing clients first.
Local authorisation bypasses must remain local.

## Establish behavioural tests before migrating

Run the existing suite first and record its results. Measure all production
source, including files never imported by tests; report the measurement tool and
scope. A passing suite or a high percentage alone does not establish correctness.

Cover each applicable area:

- Handler input parsing, validation, parameter forwarding and response contracts.
- Create/read/update/delete and batch workflows, pagination, missing records,
  invalid inputs and downstream failures.
- Individual and grouped payment creation, reads, updates and deletion;
  payment status, penalty types, group membership and conditional writes.
- Configuration from environment, defaults and failures where applicable.
- DynamoDB request shapes and conditions; downstream document-update Lambda
  payload/response contracts and failure behaviour.
- Response helpers, hashing, dates, filtering and other shared utilities.

Use representative fixtures and real validation where practical. Assert the
returned data and meaningful side effects, not only status codes or that a
function exists. Handler-export tests are useful wiring checks, not endpoint
behaviour tests. Do not stub the implementation under test just to raise coverage.
Every `expect(...)` needs an assertion matcher.

### Isolate unit tests

- No AWS login, credentials, running database or external service should be needed.
- Install synthetic credentials and request interception before importing modules
  that instantiate AWS clients.
- Make unexpected database/AWS requests fail. Mock expected requests explicitly
  and assert their inputs/results, including downstream Lambda invocations.
- Block HTTP/HTTPS as a backstop. Never let a unit test invoke a real downstream
  Lambda or write to a shared AWS resource.
- Restore test-specific stubs, timers and environment changes. Keep integration
  tests separate from the isolated unit suite.
- Use realistic DynamoDB request/response shapes. Assert downstream Lambda
  payloads and ordering where applicable.
- Document existing defects and limitations; do not weaken validation or silently
  redefine intended behaviour to make tests pass.

## Make coverage reproducible and enforceable

Do not copy another service's coverage tool or threshold without checking
Payments' existing setup and agreeing the target:

- `npm test` runs isolated tests.
- Add or adapt a coverage command only after verifying it runs the same isolated
  suite. Agree a meaningful per-production-file threshold for this service;
  another repository's percentage is not evidence that it is appropriate here.
- Include all production JavaScript. Exclude only identified tests, test helpers,
  fixtures and generated files; do not exclude hard-to-test production code.
- Instrument original source before Babel transforms it. Avoid counting Babel
  interop/regenerator helpers as application behaviour or instrumenting twice.
- Restrict instrumentation to the coverage environment so builds are unchanged.
- Keep HTML/JSON reports in ignored `coverage/` and raw data in ignored
  `.nyc_output/`; exclude these generated directories from type checking.
- Export-only modules can have zero executable counters. Explain this rather
  than inventing executable coverage or hiding the module.
- Do not add coverage-ignore directives, lower thresholds or remove assertions
  merely to pass the gate.

Choose tooling and thresholds appropriate to the repository. Report the measured
source-level coverage scope and agreed per-file thresholds; explain any
measurement-method change before comparing percentages.

Run lint, the coverage suite and any existing type check. Distinguish newly
introduced errors from verified baseline errors; do not suppress existing
diagnostics to claim a clean result. Record unresolved defects and diagnostics
in the service documentation.

## Bruno and integration confidence

Unit coverage complements rather than replaces endpoint checks. Build Bruno
requests with valid synthetic data and documented expected responses. Record:

- Local versus non-production environment, authentication and route prefixes.
- Required body/query fields, validation errors and state prerequisites.
- Which requests access real AWS resources, mutate data or invoke downstream
  document-update Lambdas.
- Seed/reset behaviour, pagination and time-dependent fixture limitations.

Use only authorised resources. Do not perform destructive or downstream-mutating
integration checks without approval. Carry the collection forward unchanged where
contracts remain unchanged, and explicitly review intentional contract changes.

## Security checks and CI

- Run Snyk before every authorised commit/push. A transport/authentication failure
  is not a successful scan; report it and retry or obtain direction.
- Record scan scope. A production-only scan does not cover development dependencies.
- During stage 1 (the initial local baseline), do not attempt to resolve Snyk
  findings by upgrading dependencies or changing application code. Preserve the
  existing baseline and defer vulnerability remediation to stage 2.
- For this local-only stage, add findings from a fresh scan to `.snyk` as explicit
  advisory-specific exceptions, not blanket ignores. This workflow authorises
  deferral for the initial baseline only. Include each advisory ID, a reason
  stating that remediation is deferred to stage 2, and an expiry no later than
  the agreed stage-2 remediation deadline. If no deadline has been agreed, ask
  for one before adding exceptions. Rerun Snyk with the policy applied and report
  the deferred findings separately; exceptions do not fix vulnerabilities.
- Do not deploy the baseline with deferred findings. Outside stage 1, prefer
  compatible remediation within the agreed scope and obtain explicit approval
  for any further exceptions.
- Do not copy another service's Snyk exceptions or assume its remediation
  deadline applies here. Any exception for Payments requires a fresh scan and
  explicit approval for this repository and its deadline.
- Read failed CI logs before changing code. Distinguish installation/setup errors
  from failed tests, lint or builds.
- Check this repository's actual reusable-workflow inputs before changing CI;
  do not copy another service's Node/npm settings.
- Keep repository-specific fixes in the calling workflow; do not change shared
  DVSA workflows or other repositories without authorisation.
- Preserve deployment guards. Before merging, inspect workflows triggered by
  `main`: this service can upload artifacts and update non-production Lambdas.
  Calling a branch a local baseline does not itself disable deployment on merge.

## Stage completion and handoff

Stage 1 should leave a documented, repeatable local startup; isolated behavioural
tests; enforced coverage thresholds; passing relevant CI; and a clear inventory
of remaining Bruno/integration work and known defects.

When moving to stage 2, use `rsp-gov-notify`'s Node 24 upgrade and the current DVSA
Starter as references, not blind replacements. Payments' current AWS SDK
operations are DynamoDB and Lambda; verify the actual dependency inventory before
migrating. Preserve DynamoDB marshalling and conditional-write behaviour, decode
Lambda byte responses where returned, and preserve the downstream document-update
Lambda contracts. Verify profile resolution and the real Payments startup path
before removing any compatibility workaround.

Repository runtime settings do not necessarily change live infrastructure:
verify Terraform's runtime and deployment configuration separately. Stage 3
should retain the externally observable behaviours and regression suite while
changing the service structure.

Commit/push only when requested. Summarise results, deliberate behaviour changes,
unresolved risks and deployment implications accurately. Never claim a migration,
scan, integration check or deployment succeeded based solely on a proxy check.
