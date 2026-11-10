const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const config = yaml.load(fs.readFileSync(path.join(root, 'serverless/serverless.yml'), 'utf8'));
const { scripts } = require('../package.json');

test('local routes match the Terraform REST v1 method/path/handler inventory', () => {
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

for (const mode of ['offline', 'offline-with-auth']) {
	test(`${mode} loads the profile directly and forces local tables without exporting credentials`, () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payments-startup-test-'));
		try {
			fs.mkdirSync(path.join(directory, 'build'));
			const framework = path.join(directory, 'node_modules/serverless/bin');
			fs.mkdirSync(framework, { recursive: true });
			fs.writeFileSync(path.join(directory, 'build/.env'), [
				'AWS_PROFILE=synthetic-profile',
				'DYNAMODB_PAYMENTS_TABLE=synthetic-nonlocal-table',
				'DYNAMODB_GROUP_PAYMENTS_TABLE=synthetic-nonlocal-group-table',
			].join('\n'));
			fs.writeFileSync(path.join(framework, 'serverless.js'), `
				console.log(JSON.stringify({
					profile: process.env.AWS_PROFILE,
					payments: process.env.DYNAMODB_PAYMENTS_TABLE,
					groups: process.env.DYNAMODB_GROUP_PAYMENTS_TABLE,
					hasCredentials: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']
						.some(name => Boolean(process.env[name])),
					args: process.argv.slice(2)
				}));
			`);
			const result = spawnSync('/bin/sh', ['-c', scripts[mode]], {
				cwd: directory, env: { PATH: path.dirname(process.execPath) }, encoding: 'utf8',
			});
			assert.equal(result.status, 0, result.stderr);
			assert.deepEqual(JSON.parse(result.stdout), {
				profile: 'synthetic-profile',
				payments: 'paymentsTable',
				groups: 'groupPaymentsTable',
				hasCredentials: false,
				args: ['offline', 'start', ...(mode === 'offline' ? ['--noAuth'] : [])],
			});
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
}

test('real-Lambda integration tests require explicit opt-in and refuse CI', () => {
	for (const env of [{}, { CI: 'true', INTEGRATION_ALLOW_LAMBDA: 'yes' }]) {
		const result = spawnSync(process.execPath, [
			'--require', path.join(__dirname, 'integration-safety.cjs'), '-e', '',
		], { env, encoding: 'utf8' });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Explicit approval/);
	}
});

test('OpenAPI postprocessing operates beside the generated file rather than in the caller directory', () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payments-openapi-test-'));
	try {
		fs.copyFileSync(path.join(root, 'openapiReplace.js'), path.join(directory, 'openapiReplace.js'));
		fs.writeFileSync(path.join(directory, 'openapi.json'), JSON.stringify({
			paths: { '/payments': { get: { requestBody: {}, responses: { 200: {} } }, post: { requestBody: { required: true } } } },
		}));
		const result = spawnSync(process.execPath, [path.join(directory, 'openapiReplace.js')], { cwd: root, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		const document = JSON.parse(fs.readFileSync(path.join(directory, 'openapi.json'), 'utf8'));
		assert.equal(document.paths['/payments'].get.requestBody, undefined);
		assert.deepEqual(document.paths['/payments'].get.responses, { 200: {} });
		assert.deepEqual(document.paths['/payments'].post.requestBody, { required: true });
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
