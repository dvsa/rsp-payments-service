const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, mock } = require('node:test');
const { isDeepStrictEqual } = require('node:util');
const yaml = require('js-yaml');
const store = require('./local-store.cjs');
const { fixtures, clone } = require('./fixtures.cjs');
const { inventory, scenarios } = require('./contracts.cjs');
const { ContractFailure, recorder } = require('./assertions.cjs');
const reports = require('./report.cjs');
const { execute, http, DependencyUnavailable } = require('./run.cjs');

function memory(initial = []) {
	const items = new Map(initial.map(({ table, item }) => [`${table}/${item.ID}`, clone(item)]));
	const writes = [];
	const value = (table, id) => {
		const item = items.get(`${table}/${id}`);
		return item === undefined ? undefined : clone(item);
	};
	const check = (params, current) => {
		const expression = params.ConditionExpression || '';
		const values = params.ExpressionAttributeValues || {};
		let allowed;
		if (expression === 'attribute_not_exists(ID)') allowed = !current;
		else if (expression.includes('#owner = :owner')) allowed = current?.IntegrationFixture === values[':owner'];
		else if (expression.includes('#payments')) allowed = current && !current.IntegrationFixture && isDeepStrictEqual(current.Payments, values[':payments']);
		else allowed = current && !current.IntegrationFixture && isDeepStrictEqual(current.PaymentDetail, values[':detail']) && current.PenaltyStatus === values[':status'];
		if (!allowed) throw new Error('ConditionalCheckFailedException');
	};
	return {
		items,
		writes,
		value,
		service: {
			describeTable: () => ({
				promise: async () => ({
					Table: {
						TableStatus: 'ACTIVE',
						KeySchema: [{ AttributeName: 'ID', KeyType: 'HASH' }],
						AttributeDefinitions: [{ AttributeName: 'ID', AttributeType: 'S' }],
					},
				}),
			}),
		},
		get: ({ TableName, Key }) => ({ promise: async () => ({ Item: value(TableName, Key.ID) }) }),
		put: (params) => ({
			promise: async () => {
				check(params, value(params.TableName, params.Item.ID));
				items.set(`${params.TableName}/${params.Item.ID}`, clone(params.Item));
				writes.push(params);
				return {};
			},
		}),
		delete: (params) => ({
			promise: async () => {
				check(params, value(params.TableName, params.Key.ID));
				items.delete(`${params.TableName}/${params.Key.ID}`);
				writes.push(params);
				return {};
			},
		}),
	};
}

function fakeHttp(db) {
	return async (base, method, route, body, expected, checks) => {
		assert.equal(method, 'GET', 'Offline runner tests only fake the preflight GETs');
		const [, resource, id] = route.split('/');
		const item = db.value(resource === 'payments' ? 'paymentsTable' : 'groupPaymentsTable', id);
		const status = item || resource === 'payments' ? 200 : 404;
		const paymentBody = item ? { payment: item } : {};
		checks.deep(status, expected, 'Fake preflight HTTP status');
		return { body: resource === 'payments' ? paymentBody : item || {} };
	};
}

function setup(t, overrides = {}) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payments-integration-tooling-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const data = fixtures(1700000000);
	const db = memory([{ table: 'paymentsTable', item: { ID: 'UNRELATED', Note: 'Preserve Bruno data' } }]);
	return {
		directory,
		data,
		db,
		options: {
			env: {},
			data,
			db,
			lockFile: path.join(directory, 'suite.lock'),
			progress: () => {},
			http: fakeHttp(db),
			write: (report) => reports.write(report, directory),
			...overrides,
		},
	};
}

test('independent inventory covers every actual handler export, local REST event and scenario dependency', () => {
	const yamlConfig = yaml.load(fs.readFileSync(path.resolve(__dirname, '../serverless/serverless.yml'), 'utf8'));
	const routes = Object.entries(yamlConfig.functions).flatMap(([name, fn]) => fn.events.map(({ http: event }) => ({
		localName: name, exportName: fn.handler.replace('handler.', ''), route: `${event.method.toUpperCase()} /${event.path}`,
	})));
	assert.deepEqual(
		routes.sort((a, b) => a.route.localeCompare(b.route)),
		inventory.map(({ localName, exportName, route }) => ({ localName, exportName, route })).sort((a, b) => a.route.localeCompare(b.route)),
	);
	const source = fs.readFileSync(path.resolve(__dirname, '../src/handler.js'), 'utf8');
	const exported = source.match(/export\s*\{([^}]+)\}/)[1].split(',').map((name) => name.trim()).filter(Boolean);
	assert.deepEqual(exported.sort(), inventory.map((entry) => entry.exportName).sort());
	assert.equal((source.match(/\bexport\b/g) || []).length, 1, 'Review any new export declaration explicitly');
	const cases = scenarios();
	assert.equal(new Set(cases.map((scenario) => scenario.id)).size, cases.length);
	inventory.forEach((endpoint) => assert.ok(cases.some((scenario) => scenario.endpoint === endpoint.id)));
	cases.forEach((scenario, index) => {
		assert.ok(inventory.some((endpoint) => endpoint.id === scenario.endpoint));
		if (inventory.find((endpoint) => endpoint.id === scenario.endpoint).requiresLambdaApproval) assert.equal(scenario.aws, true);
		(scenario.dependsOn || []).forEach((id) => assert.ok(cases.slice(0, index).some((candidate) => candidate.id === id)));
	});
});

test('fixture generation is reproducible with unique reserved keys and consistent paid group members', () => {
	const data = fixtures(1700000000);
	assert.deepEqual(data, fixtures(1700000000));
	assert.equal(new Set(store.entries(data).map((entry) => `${entry.table}/${entry.item.ID}`)).size, store.entries(data).length);
	for (const [type, payment] of Object.entries(data.group.Payments)) {
		for (const id of payment.penaltyIds) {
			const member = data.members.find((item) => item.ID === id);
			assert.equal(member.PenaltyGroupId, data.group.ID);
			assert.equal(member.ID.split('_')[1], type);
			const detail = { ...payment };
			delete detail.penaltyIds;
			delete detail.PaymentStatus;
			assert.deepEqual(member.PaymentDetail, detail);
		}
	}
	assert.equal(data.unpaid.PenaltyStatus, 'UNPAID');
	assert.deepEqual(data.unpaid.PaymentDetail, {});
});

test('configuration and adapter reject CI, remote URLs, wrong ports, credentials, query strings and cloud table names before mutation', () => {
	for (const env of [
		{ CI: 'true' }, { CI: 'false' }, { INTEGRATION_BASE_URL: 'http://example.invalid:3000/dev' },
		{ INTEGRATION_BASE_URL: 'http://localhost:3000/other' },
		{ INTEGRATION_BASE_URL: 'http://localhost:3000/dev?unsafe=yes' },
		{ INTEGRATION_BASE_URL: 'http://user:password@localhost:3000/dev' },
		{ INTEGRATION_DYNAMODB_URL: 'https://localhost:8000' },
		{ INTEGRATION_DYNAMODB_URL: 'http://localhost:8001' },
		{ INTEGRATION_PAYMENTS_TABLE: 'cloud-payments' },
		{ INTEGRATION_GROUP_PAYMENTS_TABLE: 'cloud-groups' },
	]) assert.throws(() => store.configuration(env), store.SafetyError);
	assert.throws(() => store.client('http://example.invalid:8000'), store.SafetyError);
	assert.equal(store.configuration({}).allowLambda, false);
	assert.equal(store.configuration({ INTEGRATION_ALLOW_LAMBDA: 'yes' }).allowLambda, true);
});

test('collision detection completes before seeding and preserves foreign records', async () => {
	const data = fixtures(1700000000);
	const foreign = { ID: data.createdGroup.ID, Payments: {}, Note: 'Foreign' };
	const db = memory([{ table: 'groupPaymentsTable', item: foreign }]);
	await assert.rejects(store.snapshot(db, data), /Fixture ID collision/);
	assert.equal(db.writes.length, 0);
	assert.deepEqual(db.value('groupPaymentsTable', foreign.ID), foreign);
});

test('seed/restore recovers originals and removes created records without touching unrelated data', async () => {
	const data = fixtures(1700000000);
	const original = { ...data.paid, BaselineNote: 'Original owned state' };
	const db = memory([
		{ table: 'paymentsTable', item: original },
		{ table: 'paymentsTable', item: { ID: 'UNRELATED', Note: 'Keep' } },
		{ table: 'paymentsTable', item: data.created.FPN },
	]);
	const before = new Map(db.items);
	const originals = await store.snapshot(db, data);
	await store.seed(db, data);
	assert.equal(db.value('paymentsTable', data.created.FPN.ID), undefined);
	db.items.set(`paymentsTable/${data.created.IM.ID}`, clone(data.created.IM));
	await store.restore(db, originals);
	assert.deepEqual(db.items, before);
});

test('cleanup refuses a replaced foreign record but continues restoring other reserved IDs', async () => {
	const data = fixtures(1700000000);
	const db = memory();
	const originals = await store.snapshot(db, data);
	await store.seed(db, data);
	const foreign = { ID: data.paid.ID, Note: 'Must not overwrite' };
	db.items.set(`paymentsTable/${foreign.ID}`, foreign);
	await assert.rejects(store.restore(db, originals), /Cleanup could not restore 1 reserved records/);
	assert.deepEqual(db.value('paymentsTable', foreign.ID), foreign);
	assert.equal(db.items.size, 1);
});

test('runner writes HTML/JSON for setup failures, without raw sensitive error values', async (t) => {
	const { directory, options, db } = setup(t, { env: { CI: 'true' } });
	const report = await execute(options);
	assert.equal(report.setup, 'failed');
	assert.equal(report.outcome, 'failed');
	assert.equal(db.writes.length, 0);
	assert.ok(report.scenarios.every((scenario) => scenario.status === 'not-run'));
	assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8')).outcome, 'failed');
	assert.ok(fs.existsSync(path.join(directory, 'latest.html')));
});

test('runner distinguishes passes, gated skips and failed prerequisites and always restores fixtures', async (t) => {
	const tests = [
		{
			id: 'read', endpoint: 'get', validation: 'read', run: async (c) => c.deep(await c.stored('paymentsTable', c.data.paid.ID), c.data.paid, 'Exact owned read'),
		},
		{
			id: 'aws', endpoint: 'create', validation: 'AWS gated', aws: true, run: () => { throw new Error('Must not execute'); },
		},
		{
			id: 'dependent', endpoint: 'remove', validation: 'Dependency', dependsOn: ['aws'], run: () => { throw new Error('Must not execute'); },
		},
	];
	const { options, db } = setup(t, { tests });
	const before = new Map(db.items);
	const report = await execute(options);
	assert.deepEqual(report.scenarios.map((scenario) => scenario.status), ['passed', 'skipped', 'not-run']);
	assert.equal(report.outcome, 'incomplete');
	assert.deepEqual(db.items, before);
});

test('failed assertions redact values and cleanup a partially completed creation', async (t) => {
	const { options, db, data } = setup(t);
	const before = new Map(db.items);
	options.tests = [{
		id: 'partial-create',
		endpoint: 'create',
		validation: 'Safe differences',
		run(c) {
			db.items.set(`paymentsTable/${data.created.FPN.ID}`, clone(data.created.FPN));
			c.deep({ PaymentRef: 'DO-NOT-REPORT-PRIVATE' }, { PaymentRef: 'synthetic-expected' }, 'Exact payment reference');
		},
	}];
	const report = await execute(options);
	assert.equal(report.outcome, 'failed');
	assert.equal(report.scenarios[0].difference.field, '$.PaymentRef');
	assert.doesNotMatch(JSON.stringify(report), /DO-NOT-REPORT-PRIVATE|synthetic-expected/);
	assert.deepEqual(db.items, before);
});

test('interruption stops subsequent scenarios, restores fixtures and releases the lock', async (t) => {
	const signal = new AbortController();
	let secondRan = false;
	const { options, db } = setup(t, {
		signal: signal.signal,
		tests: [
			{
				id: 'interrupt', endpoint: 'get', validation: 'Interrupt', run: () => signal.abort(),
			},
			{
				id: 'after', endpoint: 'get', validation: 'Not run', run: () => { secondRan = true; },
			},
		],
	});
	const before = new Map(db.items);
	const report = await execute(options);
	assert.equal(report.outcome, 'interrupted');
	assert.equal(secondRan, false);
	assert.equal(report.scenarios[1].status, 'not-run');
	assert.deepEqual(db.items, before);
	assert.equal(fs.existsSync(options.lockFile), false);
});

test('a concurrent run is rejected without disturbing the active run or its fixtures', async (t) => {
	let release;
	let ready;
	const entered = new Promise((resolve) => { ready = resolve; });
	const waiting = new Promise((resolve) => { release = resolve; });
	const { options, db, data } = setup(t, {
		tests: [{
			id: 'active', endpoint: 'get', validation: 'Lock', run: async () => { ready(); await waiting; },
		}],
	});
	const first = execute(options);
	await entered;
	try {
		const second = await execute(options);
		assert.equal(second.setup, 'failed');
		assert.match(second.reason, /Integration lock exists/);
		assert.deepEqual(db.value('paymentsTable', data.paid.ID), data.paid);
		assert.equal(fs.existsSync(options.lockFile), true);
	} finally { release(); }
	assert.equal((await first).outcome, 'passed');
	assert.equal(fs.existsSync(options.lockFile), false);
});

test('transport uses bounded requests, forbids redirects and never exposes raw dependency errors', async (t) => {
	let sent;
	const fake = mock.method(global, 'fetch', async (url, options) => {
		sent = options;
		return {
			status: 500,
			headers: new Headers({ 'content-type': 'application/json', 'access-control-allow-origin': options.headers.Origin }),
			json: async () => ({ err: { code: 'ExpiredTokenException', message: 'DO-NOT-REPORT' } }),
		};
	});

	t.after(() => fake.mock.restore());
	await assert.rejects(http('http://localhost:3000/dev', 'GET', '/payments', undefined, 500, recorder()), DependencyUnavailable);
	assert.equal(sent.redirect, 'error');
	assert.ok(sent.signal instanceof AbortSignal);
	await assert.rejects(http('http://example.invalid:3000/dev', 'POST', '/payments', {}, 200, recorder()), store.SafetyError);
});

test('successful HTTP contracts check the browser-origin CORS behaviour actually exposed by Offline', async (t) => {
	const fake = mock.method(global, 'fetch', async (url, options) => {
		assert.equal(options.headers.Origin, 'http://localhost:3000');
		return {
			status: 200,
			json: async () => ({ payments: [] }),
			headers: new Headers({ 'content-type': 'application/json', 'access-control-allow-origin': options.headers.Origin }),
		};
	});
	t.after(() => fake.mock.restore());
	assert.deepEqual((await http('http://localhost:3000/dev', 'GET', '/payments', undefined, 200, recorder())).body, { payments: [] });
});

test('known empty 504 responses are explicit contracts, not converted to successful empty JSON', async (t) => {
	const fake = mock.method(global, 'fetch', async (url, options) => ({
		status: 504,
		headers: new Headers({ 'content-type': 'application/json', 'access-control-allow-origin': options.headers.Origin }),
		json: async () => { throw new SyntaxError('Empty body'); },
		text: async () => '',
	}));
	t.after(() => fake.mock.restore());
	await assert.rejects(http('http://localhost:3000/dev', 'PUT', '/payments/fixture', {}, 200, recorder()), ContractFailure);
	const actual = await http('http://localhost:3000/dev', 'PUT', '/payments/fixture', {}, 504, recorder(), 'gateway-timeout');
	assert.equal(actual.status, 504);
	assert.equal(actual.body, '');
});

test('reports escape untrusted text and do not count skipped/not-run scenarios as complete endpoint coverage', () => {
	const report = {
		startedAt: 'test',
		node: 'test',
		operation: 'test',
		outcome: 'incomplete',
		scope: {},
		inventory: [{ id: 'get', route: 'GET /payments/{id}' }],
		scenarios: [
			{
				id: '<script>bad()</script>', endpoint: 'get', validation: 'Read', status: 'passed',
			},
			{
				id: 'gated', endpoint: 'get', validation: 'Not executed', status: 'skipped',
			},
		],
	};
	const html = reports.render(report);
	assert.doesNotMatch(html, /<script>/);
	assert.match(html, /&lt;script&gt;/);
	assert.equal(report.endpoints[0].complete, false);
	assert.equal(report.summary.passed, 1);
	assert.equal(report.summary.skipped, 1);
});

test('a partial seed failure restores all previous state and reports the setup failure', async (t) => {
	const { options, db } = setup(t);
	const before = new Map(db.items);
	const { put } = db;
	let attempts = 0;
	db.put = (params) => {
		attempts += 1;
		if (attempts === 2) return { promise: async () => { throw new Error('DO-NOT-REPORT-PRIVATE'); } };
		return put(params);
	};
	const report = await execute(options);
	assert.equal(report.setup, 'failed');
	assert.equal(report.outcome, 'failed');
	assert.deepEqual(db.items, before);
	assert.doesNotMatch(JSON.stringify(report), /DO-NOT-REPORT-PRIVATE/);
});

test('conditional seeding rejects a foreign record inserted after snapshot without overwriting it', async () => {
	const data = fixtures(1700000000);
	const db = memory();
	const originals = await store.snapshot(db, data);
	const { put } = db;
	const foreign = { ID: data.paid.ID, Note: 'Concurrent foreign owner' };
	db.put = (params) => {
		db.items.set(`paymentsTable/${foreign.ID}`, foreign);
		return put(params);
	};
	await assert.rejects(store.seed(db, data), /ConditionalCheckFailedException/);
	assert.equal(db.writes.length, 0);
	await assert.rejects(store.restore(db, originals), /Cleanup could not restore 1 reserved records/);
	assert.deepEqual(db.value('paymentsTable', foreign.ID), foreign);
});

test('cleanup failure makes an otherwise passing run fail and preserves foreign replacements', async (t) => {
	const { options, db, data } = setup(t);
	options.tests = [{
		id: 'changed-owner',
		endpoint: 'get',
		validation: 'Preserve a concurrent owner',
		run: () => { db.items.set(`paymentsTable/${data.paid.ID}`, { ID: data.paid.ID, Note: 'Foreign replacement' }); },
	}];
	const report = await execute(options);
	assert.equal(report.scenarios[0].status, 'passed');
	assert.equal(report.outcome, 'failed');
	assert.match(report.cleanup, /Cleanup could not restore 1 reserved records/);
	assert.equal(db.items.size, 2, 'Only the unrelated and foreign replacement records remain');
});

test('API preflight mismatch prevents all HTTP scenarios and restores seeded data', async (t) => {
	let ran = false;
	const { options, db } = setup(t, {
		http: async () => ({ body: { payment: {} } }),
		tests: [{
			id: 'must-not-run', endpoint: 'get', validation: 'Preflight', run: () => { ran = true; },
		}],
	});
	const before = new Map(db.items);
	const report = await execute(options);
	assert.equal(report.setup, 'failed');
	assert.equal(ran, false);
	assert.deepEqual(db.items, before);
});

test('transport gates real Lambda routes even if scenario metadata omits the AWS flag', async (t) => {
	const { options, data } = setup(t);
	options.tests = [{
		id: 'missing-gate',
		endpoint: 'remove',
		validation: 'Transport safety',
		run: (c) => c.http('DELETE', `/payments/${data.removePaid.ID}`, undefined, 200),
	}];
	const report = await execute(options);
	assert.equal(report.scenarios[0].status, 'failed');
	assert.match(report.scenarios[0].reason, /requires explicit approval/);
});

test('HTTP mutations cannot escape reserved IDs or alter unrelated Bruno fixtures', async (t) => {
	const { options, db } = setup(t);
	const before = new Map(db.items);
	options.tests = [{
		id: 'foreign-target',
		endpoint: 'update',
		validation: 'Reserved namespace',
		run: (c) => c.http('PUT', '/payments/UNRELATED', {}, 200),
	}];
	const report = await execute(options);
	assert.equal(report.scenarios[0].status, 'failed');
	assert.match(report.scenarios[0].reason, /escaped the reserved fixture IDs/);
	assert.deepEqual(db.items, before);
});

test('timed-out mutations stop further scenarios and report uncertain late server writes', async (t) => {
	let nextRan = false;
	const { options, db, data } = setup(t, { env: { INTEGRATION_ALLOW_LAMBDA: 'yes' } });
	const preflight = fakeHttp(db);
	options.http = (...args) => {
		if (args[1] === 'DELETE') throw new DependencyUnavailable('Synthetic mutation timeout', true);
		return preflight(...args);
	};
	options.tests = [
		{
			id: 'timeout',
			endpoint: 'remove',
			validation: 'Timeout',
			run: (c) => c.http('DELETE', `/payments/${data.removePaid.ID}`, undefined, 200),
		},
		{
			id: 'after-timeout',
			endpoint: 'get',
			validation: 'Not run',
			run: () => { nextRan = true; },
		},
	];
	const report = await execute(options);
	assert.equal(report.outcome, 'failed');
	assert.equal(report.pendingMutation, true);
	assert.equal(nextRan, false);
	assert.match(report.cleanup, /may still finish/);
});

test('seed/reset preserve unrelated data and never claim HTTP endpoint coverage', async (t) => {
	const { options, db, data } = setup(t);
	const seed = await execute({ ...options, operation: 'seed' });
	assert.equal(seed.outcome, 'setup-only');
	assert.ok(seed.scenarios.every((scenario) => scenario.status === 'not-run'));
	assert.deepEqual(db.value('paymentsTable', data.paid.ID), data.paid);
	assert.equal(db.items.size, 1 + data.payments.length + data.groups.length);
	const reset = await execute({ ...options, operation: 'reset' });
	assert.equal(reset.outcome, 'setup-only');
	assert.ok(reset.scenarios.every((scenario) => scenario.status === 'not-run'));
	assert.deepEqual([...db.items.values()], [{ ID: 'UNRELATED', Note: 'Preserve Bruno data' }]);
});

test('report regeneration preserves the exact original JSON execution results', async (t) => {
	const { options, directory } = setup(t, { env: { CI: 'true' } });
	await execute(options);
	const file = path.join(directory, 'latest.json');
	const before = fs.readFileSync(file, 'utf8');
	reports.regenerate(directory);
	assert.equal(fs.readFileSync(file, 'utf8'), before);
	assert.match(fs.readFileSync(path.join(directory, 'latest.html'), 'utf8'), /<strong>failed<\/strong>/);
});
