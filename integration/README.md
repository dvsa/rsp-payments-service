# Payments local integration baseline

This manual black-box suite is the regression contract for the Node 20 baseline,
later runtime/SDK upgrades and a Serverless Starter rewrite. Contracts use HTTP
and independently authored expected values, not production services, handlers or
validators. Only the separate local fixture adapter uses the existing AWS SDK.
Production logic is unchanged.

## First run

Follow the main README's Node 20/npm 10, Java 21, dependencies, DynamoDB install
and private `.env` setup. No private test fixtures are required: all additional
fixtures in `fixtures.cjs` are synthetic. Do not copy captured AWS records.

In the first terminal, authenticate the intended approved non-production profile
and start Payments:

```sh
aws sso login --profile YOUR_PROFILE
npm start
```

Use the login procedure appropriate to your profile; SSO is an example. Check
that the service's four configured downstream Lambda ARNs belong to the approved
environment/account. Never print or copy credentials. The normal launcher loads
`.env` and resolves the profile in memory. Restart it after refreshing credentials.

In the second terminal, first check the offline tooling:

```sh
npm run test:integration:tooling
npm run lint:integration
```

Then run the local-database-only subset:

```sh
npm run test:integration:local
```

This runs read contracts and local individual updates, but skips real-AWS-capable
create/delete routes. It deliberately exits nonzero for incomplete coverage.
It is not a read-only database run: it seeds/restores reserved local fixtures and
changes one reserved payment's status.

For the complete 35-scenario baseline, obtain explicit environment-specific
approval **before** enabling real downstream effects:

```sh
INTEGRATION_ALLOW_LAMBDA=yes npm run test:integration:local
npm run test:integration:report:open
```

That flag permits real configured document/group update Lambda calls from the
running service, including paid deletions. The normal full run attempts 11 such
invocations with synthetic IDs. It does not sandbox those Lambdas or restore
their downstream state. Persisting/exporting the flag authorises those effects
on future runs in that shell/environment. Bruno is not protected by this gate.

The suite itself does not load `.env` or authenticate AWS: only the running
service owns real credentials/configuration. Its direct database client has
explicit fake credentials and a loopback endpoint. No deployment occurs.

## Inventory and contracts

All nine exports have one configured REST v1 HTTP route. The local prefix is
`/dev`, IAM authorizers remain configured, and the launcher uses local `--noAuth`.
There are no Lambda-only, stream or queue handlers. The `remove` export's local
function name is `delete`; other local/export names match.

HTTP scenarios send an explicit local browser `Origin` and check JSON and CORS
headers. Offline reflects that origin; without an Origin request header it
omits the CORS response header, even though the application helper emits `*`.
The helper's original wildcard response is separately unit-tested.

Local Offline uses `reloadHandler: true`. Offline 13 can terminate a timed-out
worker yet leave it available for reuse; subsequent PUT requests then never
execute. Fresh workers make repeated runs deterministic without repairing the
non-async handler or changing production code. Restart the server after changing
this configuration.

| Export | Method and route | Input/output and effects |
| --- | --- | --- |
| `list` | GET `/payments` | `{payments: [...]}` from one local table scan; complete owned record values/uniqueness, no ordering or pagination guarantee |
| `get` | GET `/payments/{id}` | `{payment: storedRecord}`; a missing record currently returns 200 `{}` |
| `batchFetch` | POST `/payments/batches` | `{ids: [...]}` to `{payments: [...]}` projected to ID/status/details; missing IDs omitted, order unspecified |
| `create` | POST `/payments` | Reference/type/status/detail plus optional downstream payment code; returns `{payment: ...}` and persists ID/status/details before calling Documents |
| `update` | PUT `/payments/{id}` | Validated reference/type/status/detail; changes status/type/details locally and preserves unrelated fields; non-async handler currently returns an empty 504 in Offline, even for validation rejection |
| `remove` | DELETE `/payments/{id}` | Deletes locally, returns `{}`; paid records additionally invoke Documents |
| `getPenaltyGroupPaymentRecord` | GET `/groupPayments/{id}` | Full stored group/categories/member IDs; missing is 404 `{}` |
| `createPenaltyGroupPaymentRecord` | POST `/groupPayments` | PaymentCode/type/detail/member IDs; new group returns 201 full group, extension returns 200 category detail; writes group/members and invokes group update |
| `deletePenaltyGroupPaymentRecord` | DELETE `/groupPayments/{id}/{penaltyType}` | Deletes category/member payments, invokes document updates; returns remaining group or `{}` after physical final deletion |

`contracts.cjs` is the authoritative scenario inventory. Offline tests compare it
with actual handler exports and Serverless method/path/function wiring. Scenarios
cover FPN/IM/CDN, paid/unpaid, missing records, batch projection/errors, creation,
duplicate overwrites, validation/no-write cases, status transitions, individual
deletion, mixed group creation/extension/duplicate rejection and category/final
group deletion.

Mutations are followed by exact HTTP GET and independent strongly consistent
DynamoDB reads. Group scenarios check every member, parent linkage, category
amount, preserved category and deleted record. The full category amount is copied
to each member, matching current behaviour. Assertions do not import application
logic to generate their expected response.

The table scan must contain all owned fixtures in its single page. Large existing
local datasets can make that fail: Payments does not implement scan pagination.
Do not delete unrelated records to make it pass; use a separately authorised
fresh local service or record the limitation.

## Fixture ownership, restoration and recovery

Defaults are `http://localhost:3000/dev`, `http://localhost:8000`,
`paymentsTable` and `groupPaymentsTable`. Only documented loopback hosts,
ports and paths are accepted; redirects, URL credentials, remote targets and CI
execution are rejected. Optional `INTEGRATION_BASE_URL` and
`INTEGRATION_DYNAMODB_URL` can select an equivalent allowed loopback address.
Table overrides cannot select non-local tables.

The suite acquires `.integration-local.lock`, checks both table schemas, snapshots
all reserved IDs and rejects foreign collisions before any seeding. It seeds 11
payments and one group, verifies the API sees the exact data, then starts HTTP
scenarios. Payment references use reserved `990098...` IDs; group IDs begin
`rspintegrationpayments`. Fixtures carry `RSP-PAYMENTS-INTEGRATION-V1` ownership,
or an owned payment-reference prefix for records created through the API.

Only registered reserved IDs may be mutated through HTTP. Foreign records are
never overwritten by seed/restore, and conditional writes guard ownership races.
Normal completion/failure/SIGINT/SIGTERM restores previous reserved records,
removes newly created owned records and independently verifies cleanup. The
original eight Bruno seed payments/two groups are not reset or changed.

Do not run Bruno mutations or another seed/reset tool concurrently. The lock
coordinates this suite's commands, not arbitrary clients or the service launcher.
Do not restart DynamoDB while the suite owns its lock.

Manual fixture commands use the same local/schema/ownership/lock guards:

```sh
npm run test:integration:seed
npm run test:integration:reset
```

Seed leaves owned fixtures for inspection. Reset removes only reserved owned
fixtures; neither command executes HTTP scenarios or proves endpoint coverage.
Neither truncates tables or scans/deletes arbitrary records.

Snapshots are held only in memory. After SIGKILL or a hard crash, first verify
that the PID recorded in `.integration-local.lock` is no longer active; do not
remove another process's lock. Remove only that confirmed stale lock, then run
the reset command to remove owned leftovers. It cannot reconstruct pre-existing
owned snapshots lost with the process. Foreign collisions require investigation,
not automatic deletion. Restarting the in-memory service discards all local
changes and requires separate permission if other users depend on it.

HTTP requests time out after 30 seconds; local SDK requests have bounded timeouts
and no retries. A timed-out HTTP mutation may still finish inside the service:
the runner stops further scenarios and marks cleanup uncertain/failed rather
than claiming success. Wait for the service operation to finish before recovery.
Local restoration never rolls back real downstream AWS changes.

## Reports and interpretation

Every test/seed/reset run writes timestamped HTML/JSON and
`integration-reports/latest.html` / `latest.json`, including setup/cleanup
failures. HTML is self-contained and escaped. Reports contain safe structural
differences, authored checks/actions, durations, safety gates, per-route counts,
known-defect labels and cleanup outcomes, not raw responses, credentials or ARNs.

```sh
npm run test:integration:report
npm run test:integration:report:open
```

The first command only rebuilds HTML from the existing JSON. It never reruns
scenarios or changes their recorded statuses. Opening the HTML directly also
works. Reports and locks are ignored; carry source fixtures/contracts/tooling and
explicitly approved result artifacts into a migration baseline, never private
configuration or credential exports.

Results distinguish passed, failed, skipped, not-run and dependency-unavailable.
Unsuccessful dependencies prevent dependent scenarios running. Skips are not
successful coverage. An all-pass scenario result with failed cleanup is still a
failed run. Source coverage is separate; unit discovery, coverage, hooks and CI
do not execute this suite.

Known behaviour is characterised, not repaired: missing individual GET returns
200 `{}`, duplicate individual overwrite, invalid batches returning database
errors and missing group/category deletion returning 501. Missing individual
deletion, unhandled asynchronous conditional-update failures, malformed inputs,
downstream invocation envelopes and ignored Lambda `FunctionError` values are
covered by isolated unit tests where HTTP probing could destabilise the server.

The PUT timeout was reproduced and explicitly accepted as a known-defect baseline:
both valid and invalid requests return HTTP 504 with a zero-length body locally.
The valid request still persists its state transition; the invalid request
persists nothing. Both are independently read back. The underlying service's
premature 200 `{}` and validation 405 responses remain unit-characterised, but
its exported non-async handler never completes the HTTP invocation. A future
intentional fix must update this contract explicitly, not silently relax it.

A successful Lambda invocation/HTTP response does **not** prove downstream
document processing succeeded. The service ignores some Lambda function-error
payloads, and local writes plus downstream effects are non-transactional. This is
a Payments-state regression baseline, not exhaustive delivery/error injection,
an IAM test, load test or independent downstream document read-back.
