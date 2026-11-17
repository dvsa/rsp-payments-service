const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const yaml = require('js-yaml');

async function runLauncher(options = {}) {
	const calls = [];
	const output = [];
	const signals = new Map();
	const child = new EventEmitter();
	child.pid = 424242;
	child.kill = (signal) => calls.push({ signal });
	const processStub = {
		env: { AWS_PROFILE: 'synthetic-profile', PATH: '/synthetic/bin', ...options.env },
		versions: { node: '20.20.2' },
		platform: 'darwin',
		on: (signal, callback) => signals.set(signal, callback),
		kill: (pid, signal) => calls.push({ pid, signal }),
	};
	const context = {
		process: processStub,
		console: { log: (message) => output.push(message), error: (message) => output.push(message) },
		require(name) {
			if (name === 'node:path') return path;
			if (name === 'node:net') return {
				createServer: () => ({
					once() {},
					listen(port, host, callback) { calls.push({ port, host }); callback(); },
					close(callback) { callback(); },
				}),
			};
			if (name !== 'node:child_process') throw new Error(`Unexpected dependency ${name}`);
			return {
				execFileSync(command, args) {
					calls.push({ command, args });
					if (command !== 'aws') return '/synthetic/java21\n';
					if (options.authFailure) throw new Error('Synthetic authentication failure');
					return JSON.stringify(options.credentials || {
						AccessKeyId: 'synthetic-access', SecretAccessKey: 'synthetic-secret', SessionToken: 'synthetic-session',
					});
				},
				spawnSync: () => ({ status: 0, stdout: options.javaVersion || 'openjdk version "21.0.13"', stderr: '' }),
				spawn(command, args, settings) { calls.push({ command, args, settings }); return child; },
			};
		},
	};
	await vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../scripts/start-local.cjs'), 'utf8'), context);
	return { calls, output, signals, child, process: processStub };
}

test('local routes match the Terraform REST v1 method/path/handler inventory', () => {
	const config = yaml.load(fs.readFileSync(path.resolve(__dirname, '../serverless/serverless.yml'), 'utf8'));
	const routes = Object.values(config.functions).flatMap((definition) => definition.events.map((event) => {
		assert.ok(event.http, 'Every Payments HTTP route must use REST v1 http events, not httpApi');
		assert.equal(event.http.authorizer.type, 'aws_iam');
		return `${event.http.method.toUpperCase()} /${event.http.path} ${definition.handler}`;
	}));
	assert.deepEqual(routes.sort(), [
		'GET /payments handler.list',
		'GET /payments/{id} handler.get',
		'POST /payments handler.create',
		'PUT /payments/{id} handler.update',
		'DELETE /payments/{id} handler.remove',
		'POST /payments/batches handler.batchFetch',
		'GET /groupPayments/{id} handler.getPenaltyGroupPaymentRecord',
		'POST /groupPayments handler.createPenaltyGroupPaymentRecord',
		'DELETE /groupPayments/{id}/{penaltyType} handler.deletePenaltyGroupPaymentRecord',
	].sort());
	assert.equal(config.provider.stage, 'dev');
});

test('configured Offline binding accepts localhost requests using local DNS resolution', async () => {
	const http = require('node:http');
	const config = yaml.load(fs.readFileSync(path.resolve(__dirname, '../serverless/serverless.yml'), 'utf8'));
	const server = http.createServer((request, response) => response.end('local-ready'));
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, config.custom['serverless-offline'].host, resolve);
	});
	try {
		const body = await new Promise((resolve, reject) => {
			http.get(`http://localhost:${server.address().port}/`, { autoSelectFamily: false }, (response) => {
				let data = '';
				response.on('data', (chunk) => { data += chunk; });
				response.on('end', () => resolve(data));
				response.on('error', reject);
			}).on('error', reject);
		});
		assert.equal(body, 'local-ready');
	} finally {
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});

test('Documents-style launcher passes credentials and local table overrides only to child processes', async () => {
	const result = await runLauncher({ env: {
		DYNAMODB_PAYMENTS_TABLE: 'synthetic-nonlocal-table',
		DYNAMODB_GROUP_PAYMENTS_TABLE: 'synthetic-nonlocal-group-table',
	} });
	const auth = result.calls.find((call) => call.command === 'aws');
	assert.equal(auth.args.join(' '), 'configure export-credentials --profile synthetic-profile --format process');
	const launch = result.calls.find((call) => call.command === 'npm');
	assert.equal(launch.args.join(' '), 'run start:local');
	assert.equal(launch.settings.env.AWS_ACCESS_KEY_ID, 'synthetic-access');
	assert.equal(launch.settings.env.AWS_SESSION_TOKEN, 'synthetic-session');
	assert.equal(launch.settings.env.DYNAMODB_PAYMENTS_TABLE, 'paymentsTable');
	assert.equal(launch.settings.env.DYNAMODB_GROUP_PAYMENTS_TABLE, 'groupPaymentsTable');
	assert.equal(result.process.env.DYNAMODB_PAYMENTS_TABLE, 'synthetic-nonlocal-table');
	assert.equal(result.calls.filter((call) => call.port).every((call) => call.host === 'localhost'), true);
	assert.match(launch.settings.env.NODE_OPTIONS, /--no-experimental-require-module/);
	assert.match(launch.settings.env.PATH, /^\/synthetic\/java21\/bin/);
	assert.doesNotMatch(result.output.join('\n'), /synthetic-access|synthetic-secret|synthetic-session/);
});

for (const options of [
	{ authFailure: true },
	{ credentials: { AccessKeyId: 'synthetic-access' } },
	{ credentials: { AccessKeyId: 'synthetic-access', SecretAccessKey: 'synthetic-secret', Expiration: '2000-01-01T00:00:00Z' } },
]) {
	test('launcher refuses unavailable, incomplete or expired profile credentials', async () => {
		const result = await runLauncher(options);
		assert.equal(result.process.exitCode, 1);
		assert.equal(result.calls.some((call) => call.command === 'npm'), false);
		assert.match(result.output.join('\n'), /profile/);
	});
}

test('launcher requires Java 21 before starting local services', async () => {
	const result = await runLauncher({ javaVersion: 'openjdk version "17.0.1"' });
	assert.equal(result.process.exitCode, 1);
	assert.equal(result.calls.some((call) => call.command === 'npm'), false);
	assert.match(result.output.join('\n'), /Java 21/);
});

test('launcher signals its entire local process group and preserves child exit status', async () => {
	const result = await runLauncher();
	assert.equal(result.calls.find((call) => call.command === 'npm').settings.detached, true);
	result.signals.get('SIGINT')();
	assert.equal(result.calls.at(-1).pid, -424242);
	assert.equal(result.calls.at(-1).signal, 'SIGINT');
	result.child.emit('exit', 7);
	assert.equal(result.process.exitCode, 7);
});

test('real-Lambda integration tests require explicit opt-in and refuse CI', () => {
	for (const env of [{}, { CI: 'true', INTEGRATION_ALLOW_LAMBDA: 'yes' }]) {
		const result = spawnSync(process.execPath, [
			'--require', path.resolve(__dirname, 'integration-safety.cjs'), '-e', '',
		], { env, encoding: 'utf8' });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Explicit approval/);
	}
});

test('launcher refuses occupied ports before resolving AWS profiles', async () => {
	const net = require('node:net');
	const server = net.createServer();
	const ownsPort = await new Promise((resolve) => {
		server.once('error', () => resolve(false));
		server.listen(3000, 'localhost', () => resolve(true));
	});
	try {
		const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/start-local.cjs')], {
			env: { PATH: process.env.PATH }, encoding: 'utf8',
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Port 3000 is occupied/);
	} finally {
		if (ownsPort) await new Promise((resolve) => server.close(resolve));
	}
});
