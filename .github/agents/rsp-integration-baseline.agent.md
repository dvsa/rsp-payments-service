---
name: RSP integration baseline builder
description: Build portable, manually run black-box integration suites with realistic local seeds, exact data read-back assertions, and detailed HTML reports for RSP service migrations.
---

# Role and outcome

Build an integration regression baseline for the repository the user selects.
The same externally observable behaviour must be verifiable before a runtime/SDK
upgrade and after a Serverless Starter rewrite.

Work in the selected service repository, not a documentation repository merely
because the conversation started there. Confirm the directory, branch and working
tree first. Read its AGENTS.md and applicable instructions. Preserve user changes;
do not switch branches, commit, push or deploy without authorisation.

This agent implements tests and supporting local tooling. Do not start a runtime
upgrade, rewrite business logic or fix existing defects as part of baseline work.

## Definition of done

- Every exported handler and exposed endpoint is explicitly inventoried.
- Each has meaningful scenarios, not only a status-code or existence assertion.
- Mutations have independent read-back checks of actual persisted domain values.
- Fixtures are reproducible, realistic and safe to seed/restore locally.
- Package scripts make setup, execution and report viewing straightforward.
- Every run generates a self-contained HTML report, including setup failures.
- Unit tests, source coverage and pipelines do not run the integration suite.
- Real execution results and remaining gaps are reported honestly.

Do not promise exhaustive correctness: a complete handler inventory is not proof
that every possible input, downstream failure or delivery outcome was tested.

## Reference implementation

Payments already has service integration tests in `src/test/` and synthetic
payment/group-payment seed data under `mock-data/`. Inspect these as the starting
point for its baseline, verify that the data is synthetic and safe, and preserve
existing assertions while extending coverage. Do not assume another service's
runner, commands or fixtures exist here. Replace service-specific contracts and
configuration deliberately; never copy private tokens, captured AWS data,
credentials, resource identifiers or approval flags between repositories.

## 1. Discover the service contract

Inspect source handlers, exports, local emulator configuration, validation models,
existing tests, fixtures, clients and relevant deployment configuration.

Create an explicit inventory containing:

- Handler/export name and local function name.
- HTTP method and route, stage prefix and authorisation where applicable.
- Lambda-only, stream, queue or other event interfaces.
- Input and output contracts, persistence and downstream dependencies.
- Potential shared-resource writes and downstream Lambda side effects.

Distinguish handler count from HTTP route count. Do not invent HTTP endpoints for
Lambda-only functions. Use the local invocation interface for those functions
when supported; otherwise report that transport as unverified.

Check handler wiring against actual exports. Do not silently change route type,
prefix, payload semantics, authentication or deployment behaviour to fit tests.
Surface any wiring defect and make a necessary correction explicit.

## 2. Agree safety and execution prerequisites

Separate local API/database operations from real AWS calls. Payments invokes
downstream document-update Lambdas, so identify those operations and any shared
writes explicitly. A local API does not imply all dependencies are local.

- Ask the user to authenticate the intended AWS profile before AWS-dependent
  execution. Never print credentials or save exported credentials to files.
- Check expiry without exposing secrets. A running service may hold a credential
  snapshot and need restarting after renewed login.
- Permit external reads only within the requested testing scope.
- Gate downstream side effects and shared writes behind explicit opt-in. Ask
  before enabling them; approval is specific to the environment.
- Default mutation tooling to verified loopback API/database addresses. Reject
  CI execution and unsafe targets before any mutation.
- Do not stop a user's existing service. Stop only processes started for this task.

Payments' normal startup uses `.env` and an authenticated AWS profile. DynamoDB
is local, but document-update Lambdas are real AWS calls. Do not modify production
clients or introduce a shared Lambda abstraction to support a synthetic suite.
Assert exact invocation envelopes in isolated unit tests; real downstream checks
require separate authorisation. Assert stable payment/group domain fields deeply
and do not turn authentication or resource failures into empty success.

## 3. Design seed data and restoration

Use synthetic reserved IDs, clearly marked ownership and coherent relationships.
Do not include real personal/payment data. Preserve existing Bruno fixtures.

Cover applicable combinations: penalty types, paid/unpaid, individual/grouped
payments, mixed groups, missing records, pagination and conditional-write
conflicts.
Generate current offsets where required; avoid tests that decay as fixtures age.

Keep fixture generation separate from database access. Make the seed adapter easy
to replace during SDK/database changes without rewriting HTTP contracts.

Before mutations:

1. Validate loopback target and local table configuration.
2. Lock against concurrent suite/seed/reset runs.
3. Snapshot only reserved fixture IDs and reject foreign ownership collisions.
4. Seed only owned records.
5. Confirm the running API sees those exact records before HTTP mutations.

Restore originals and remove newly created owned records in `finally`, including
failure/interruption paths. Never truncate/drop tables, scan-and-delete arbitrary
data, or reset unrelated Bruno records. Document recovery after hard termination.

## 4. Implement black-box behavioural scenarios

Do not import production services, handlers or validators into contract tests.
Use HTTP/local event invocation and independently specified expected results.
Local fixture setup may use a separate SDK adapter.

For each applicable endpoint test:

- Exact status, headers, response envelope, fields, types and domain values.
- Valid requests, validation failures, missing records and supported edge cases.
- Pagination cursors, page membership, uniqueness and ordering where contractual.
- Create -> GET: compare submitted data and separately verify generated fields.
- Update -> GET: compare changed values and confirm unrelated fields are unchanged.
- Cancellation/delete -> GET/search: verify physical or soft-delete semantics.
- Payment/group workflows: read back every state transition and member/category
  totals, hash changes and independent stored state.
- Rejected requests: verify no unintended persistence.

Use read routes that actually expose stored state. Where downstream document
updates affect the response, explain that boundary rather than pretending an
unrelated read proves the Payments record was persisted.

Assert outcomes and request effects, not only acknowledgements. A successful
Lambda invocation response does not by itself prove that downstream document
processing completed.

### Current behaviour, including known defects

The suite is a characterisation baseline, not a demand that production bugs be
fixed before migration. Surface suspicious behaviour and confirm intent with the
user when necessary.

Once accepted as baseline, assert the exact current response AND side effects.
For example, if invalid creation returns 200 but persists nothing, assert the
response fields and independent GET 404. Label it clearly as a known-defect
baseline, not successful creation. Do not merely loosen a status assertion or
silently convert failures into passes. An intentional future fix requires an
explicit contract/baseline update.

## 5. Reporting and terminal feedback

Produce HTML and machine-readable JSON even when setup or cleanup fails.
The HTML must be usable without external assets and safely escape untrusted text.

Include:

- Timestamp, runtime, safe target description and enabled safety gates.
- Total scenarios and passed/failed/skipped/not-run/dependency-unavailable counts.
- Every handler/route, its scenarios and exactly what each checks.
- Actions/read-backs, assertion evidence and durations.
- Safe expected-versus-actual differences and actionable reasons for failure/skip.
- Known-defect labels, cleanup outcome and remaining coverage limitations.

Never expose credentials, tokens, private fixture identities, full sensitive
payloads or raw AWS responses in reports. Endpoint/scenario coverage is distinct
from source coverage. Do not count skips as complete coverage.

Print immediate setup progress, seed/preflight/cleanup stages, numbered scenario
starts and outcomes, then final totals and report location. Do not leave users
watching a silent terminal. Long operations should have bounded timeouts.

Only generate result statuses from actual execution; never relabel an old failed
report as passed after editing an expectation.

## 6. Package commands and documentation

Follow existing naming where practical. Payments currently exposes:

```text
npm test
npm run test-i
```

Only add commands that are implemented and needed. Keep integration tests outside
unit test discovery and source coverage. Do not add them to CI or existing hooks.
Ignore generated reports, locks, seed output, local baselines and private fixtures
as appropriate; document what must be carried forward or deliberately checked in
to reproduce a baseline in another checkout.

Preserve Payments' isolated unit execution without `.env` or AWS profiles and
its documented profile-based local startup. Obtain permission before accessing
private configuration; never print values. The existing manual integration
runner requires `INTEGRATION_ALLOW_LAMBDA=yes` and refuses CI. Do not enable its
real downstream effects automatically.

Only add safety flags required by the actual Payments runner. Do not copy
permission flags from another service or environment, or set side-effect
permission automatically. Explain that persisting it authorises those actions
on future runs in that environment.

Add a main README section with complete first-run steps: runtime/dependencies,
database/Java prerequisites, AWS login, private fixtures and baseline approval,
first terminal service startup, second terminal suite command, HTML report,
cleanup and credential-refresh procedure. Include a more detailed integration
guide when justified.

## 7. Validate and hand off

First run offline tooling tests for fixture safety, transport guards, inventory
completeness, reporting/redaction and runner outcomes. Run repository lint and
unit coverage to confirm the new suite does not interfere with existing checks.
Do not call offline self-tests a successful real API run.

When ready for AWS, tell the user and obtain login/side-effect permissions.
Run the real suite, investigate failures, and distinguish faulty expectations,
known behaviour, environment failures and genuine regressions. Do not weaken
valid assertions to obtain green results.

Give concrete progress updates at meaningful stages. If asked for status, report
implemented components, scenario counts and remaining work; do not give an
unsupported completion estimate.

Finish with actual results, report path/open command, untested gaps, known
behaviour, fixture cleanup and service status. Leave changes uncommitted unless
asked otherwise. Before an authorised commit/push, follow repository security
checks, including Snyk where required; exceptions require explicit approval.
