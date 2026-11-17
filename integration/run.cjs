const fs = require('node:fs');
const path = require('node:path');
const { ContractFailure, recorder } = require('./assertions.cjs');
const { fixtures } = require('./fixtures.cjs');
const localStore = require('./local-store.cjs');
const reports = require('./report.cjs');
const {
	inventory, scenarios, paymentRead, groupRead,
} = require('./contracts.cjs');

class DependencyUnavailable extends Error {
	constructor(message, pendingMutation = false) {
		super(message);
		this.pendingMutation = pendingMutation;
	}
}

function safeError(error) {
	if (error instanceof ContractFailure || error instanceof localStore.SafetyError
		|| error instanceof DependencyUnavailable) return error.message;
	return 'Setup, transport or cleanup failed; raw errors and payloads deliberately withheld';
}

async function http(baseUrl, method, route, body, expected, checks, format = 'json') {
	localStore.localUrl(baseUrl, 3000, '/dev');
	const origin = 'http://localhost:3000';
	let response;
	let result;
	try {
		response = await fetch(`${baseUrl}${route}`, {
			method,
			redirect: 'error',
			signal: AbortSignal.timeout(30000),
			headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	} catch {
		const mutation = method !== 'GET' && route !== '/payments/batches';
		throw new DependencyUnavailable('Local HTTP service is unavailable or the request timed out', mutation);
	}
	try {
		result = format === 'gateway-timeout' ? await response.text() : await response.json();
	} catch {
		checks.deep(response.status, expected, `HTTP status expected ${expected}; received ${response.status}`);
		throw new ContractFailure('Response body could not be decoded using its declared contract format');
	}
	const codes = new Set(['CredentialsError', 'ExpiredToken', 'ExpiredTokenException', 'AccessDeniedException', 'UnrecognizedClientException', 'ResourceNotFoundException']);
	if (codes.has(result?.code) || codes.has(result?.err?.code)) {
		throw new DependencyUnavailable('AWS or local database dependency unavailable or unauthorised; check service login/configuration');
	}
	checks.deep(response.status, expected, `HTTP status expected ${expected}; received ${response.status}`);
	checks.check(response.headers.get('content-type')?.includes('application/json'), 'Response content type is JSON');
	checks.deep(response.headers.get('access-control-allow-origin'), origin, 'Offline CORS permits the explicit local browser origin');
	return { body: result, status: response.status };
}

async function poll(check) {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		try { return await check(); } catch (error) {
			if (!(error instanceof ContractFailure) || attempt === 11) throw error;
			await new Promise((resolve) => { setTimeout(resolve, 150); });
		}
	}
	return undefined;
}

function guardMutation(endpoint, route, body, data) {
	if (['list', 'get', 'batchFetch', 'getPenaltyGroupPaymentRecord'].includes(endpoint.id)) return;
	const entries = localStore.entries(data);
	const paymentIds = new Set(entries.filter((entry) => entry.table === 'paymentsTable').map((entry) => entry.item.ID));
	const groupIds = new Set(entries.filter((entry) => entry.table === 'groupPaymentsTable').map((entry) => entry.item.ID));
	let allowed;
	if (endpoint.id === 'create') allowed = paymentIds.has(`${body?.PenaltyReference}_${body?.PenaltyType}`);
	else if (endpoint.id === 'createPenaltyGroupPaymentRecord') {
		allowed = (groupIds.has(body?.PaymentCode) || body?.PaymentCode === '')
			&& Array.isArray(body?.PenaltyIds) && body.PenaltyIds.every((id) => paymentIds.has(id));
	} else if (endpoint.id === 'deletePenaltyGroupPaymentRecord') allowed = groupIds.has(route.split('/')[2]);
	else allowed = paymentIds.has(route.split('/')[2]);
	if (!allowed) throw new localStore.SafetyError('HTTP mutation escaped the reserved fixture IDs');
}

async function execute(options = {}) {
	const env = options.env || process.env;
	const operation = options.operation || 'test';
	const progress = options.progress || console.log;
	const tests = options.tests || scenarios();
	const report = {
		startedAt: new Date().toISOString(),
		node: process.version,
		operation,
		scope: { target: 'Loopback HTTP :3000/dev and local DynamoDB :8000 only', realDownstreamLambdaEnabled: env.INTEGRATION_ALLOW_LAMBDA === 'yes' },
		inventory,
		scenarios: tests.map(({
			id, endpoint, validation, knownDefect,
		}) => ({
			id, endpoint, validation, knownDefect: !!knownDefect, status: 'not-run', reason: 'Setup did not complete',
		})),
		setup: 'not-started',
		cleanup: 'not-required',
		outcome: 'failed',
	};
	let db;
	let originals;
	let lock;
	let interrupted = false;
	let pendingMutation = false;
	const lockFile = options.lockFile || path.resolve(__dirname, '../.integration-local.lock');
	const write = options.write || reports.write;
	const data = options.data || fixtures();
	const onSignal = () => { interrupted = true; };
	options.signal?.addEventListener('abort', onSignal);
	if (options.handleSignals) {
		process.on('SIGINT', onSignal);
		process.on('SIGTERM', onSignal);
	}
	progress('Starting Payments integration baseline...');
	try {
		const config = localStore.configuration(env);
		if (!['test', 'seed', 'reset'].includes(operation)) throw new localStore.SafetyError('Unknown integration operation');
		try { lock = fs.openSync(lockFile, 'wx', 0o600); } catch { throw new localStore.SafetyError('Integration lock exists; verify the active process before recovery'); }
		fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: report.startedAt }));
		db = options.db || localStore.client(config.dynamoUrl);
		progress('Checking local table schemas and reserved-ID collisions...');
		await localStore.verifyTables(db);
		originals = await localStore.snapshot(db, data);
		if (interrupted || options.signal?.aborted) throw new localStore.SafetyError('Integration interrupted before fixture mutation');
		if (operation === 'reset') {
			await localStore.restore(db, originals.map((entry) => ({ ...entry, original: undefined })));
			originals = undefined;
			report.setup = 'Only owned reserved fixture records removed';
		} else {
			progress(`Seeding ${data.payments.length} owned payments and ${data.groups.length} owned group...`);
			await localStore.seed(db, data);
			report.setup = 'Owned local fixtures seeded';
		}
		if (interrupted) throw new localStore.SafetyError('Integration interrupted during setup');
		if (operation !== 'test') {
			originals = undefined;
			report.scenarios.forEach((scenario) => { scenario.reason = 'Seed/reset operation; no HTTP scenario executed'; });
			report.outcome = 'setup-only';
			return report;
		}
		const context = (checks, actions) => {
			return {
				data,
				poll,
				check: checks.check,
				deep: checks.deep,
				stored: async (table, id) => {
					actions.push(`Independent consistent read from local ${table}`);
					return localStore.get(db, table, id);
				},
				http: async (method, route, body, expected, format) => {
					const endpoint = inventory.find((entry) => entry.route.startsWith(`${method} `)
						&& new RegExp(`^${entry.route.split(' ')[1].replace(/\{[^}]+\}/g, '[^/]+')}$`).test(route));
					if (!endpoint) throw new localStore.SafetyError('Scenario attempted an uninventoried HTTP route');
					if (endpoint.requiresLambdaApproval && !config.allowLambda) {
						throw new localStore.SafetyError('HTTP route requires explicit approval for real downstream Lambda effects');
					}
					guardMutation(endpoint, route, body, data);
					actions.push(`${endpoint.route}; expected HTTP ${expected}`);
					try {
						return await (options.http || http)(config.baseUrl, method, route, body, expected, checks, format);
					} catch (error) {
						if (error instanceof DependencyUnavailable && error.pendingMutation) pendingMutation = true;
						throw error;
					}
				},
			};
		};
		progress('Verifying that the running API reads every exact seeded record before HTTP mutations...');
		const preflightChecks = recorder();
		report.preflight = { assertions: preflightChecks.evidence, actions: [] };
		const preflight = context(preflightChecks, report.preflight.actions);
		for (const payment of data.payments) await paymentRead(preflight, payment);
		for (const group of data.groups) await groupRead(preflight, group);
		report.setup = 'Local table schemas, ownership and exact API/database alignment verified';
		for (let index = 0; index < tests.length; index += 1) {
			const test = tests[index];
			const result = report.scenarios[index];
			if (interrupted || pendingMutation) break;
			const missing = (test.dependsOn || []).find((id) => !report.scenarios.some((scenario) => scenario.id === id && scenario.status === 'passed'));
			if (missing) {
				result.reason = `Prerequisite ${missing} did not pass`;
				progress(`[${index + 1}/${tests.length}] ${test.id}: not-run (${result.reason})`);
				continue;
			}
			if (test.aws && !config.allowLambda) {
				result.status = 'skipped';
				result.reason = 'Requires explicit INTEGRATION_ALLOW_LAMBDA=yes approval for real downstream AWS mutations';
				progress(`[${index + 1}/${tests.length}] ${test.id}: skipped (real AWS effects not enabled)`);
				continue;
			}
			const checks = recorder();
			result.actions = [];
			result.assertions = checks.evidence;
			const started = Date.now();
			progress(`[${index + 1}/${tests.length}] Starting ${test.id}`);
			try {
				await test.run(context(checks, result.actions));
				result.status = 'passed';
				delete result.reason;
			} catch (error) {
				if (interrupted) report.outcome = 'interrupted';
				result.status = error instanceof DependencyUnavailable ? 'dependency-unavailable' : 'failed';
				result.reason = safeError(error);
				if (error instanceof ContractFailure) result.difference = error.difference;
			}
			result.durationMs = Date.now() - started;
			progress(`[${index + 1}/${tests.length}] ${test.id}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
		}
		report.outcome = 'incomplete';
		if (report.scenarios.every((scenario) => scenario.status === 'passed')) report.outcome = 'passed';
		if (report.scenarios.some((scenario) => ['failed', 'dependency-unavailable'].includes(scenario.status))) report.outcome = 'failed';
		if (interrupted) report.outcome = 'interrupted';
	} catch (error) {
		report.reason = safeError(error);
		report.setup = 'failed';
		progress(`Setup failed: ${report.reason}`);
	} finally {
		if (originals && db) {
			progress('Restoring originals and removing only owned temporary records...');
			try {
				await localStore.restore(db, originals);
				report.cleanup = 'All reserved originals restored; newly created owned records removed';
			} catch (error) {
				report.cleanup = safeError(error);
				report.outcome = 'failed';
			}
		}
		if (lock !== undefined) {
			try {
				const ownedLock = fs.fstatSync(lock);
				fs.closeSync(lock);
				if (fs.existsSync(lockFile) && fs.statSync(lockFile).ino === ownedLock.ino) fs.unlinkSync(lockFile);
			} catch {
				report.cleanup += '; lock release failed: verify stale-lock recovery instructions';
				report.outcome = 'failed';
			}
		}
		if (pendingMutation) {
			report.pendingMutation = true;
			report.cleanup += '; a timed-out HTTP mutation may still finish: wait for service completion before recovery';
			report.outcome = 'failed';
		}
		if (options.handleSignals) {
			process.removeListener('SIGINT', onSignal);
			process.removeListener('SIGTERM', onSignal);
		}
		options.signal?.removeEventListener('abort', onSignal);
		report.finishedAt = new Date().toISOString();
		reports.summarize(report);
		progress(`Results: ${report.outcome}; ${JSON.stringify(report.summary)}. Cleanup: ${report.cleanup}`);
		const location = write(report);
		if (location) progress(`Report: ${location}`);
	}
	return report;
}

async function main() {
	const operation = process.argv[2] || 'test';
	if (operation === 'report') {
		console.log(reports.regenerate());
		return;
	}
	if (operation === 'open') {
		const { spawn } = require('node:child_process');
		const file = path.join(reports.directory, 'latest.html');
		if (!fs.existsSync(file)) throw new Error('No integration report exists yet');
		const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
		const child = spawn(command, [file], { stdio: 'inherit' });
		child.on('error', () => { console.error('Cannot open report; open integration-reports/latest.html manually'); process.exitCode = 1; });
		child.on('exit', (code) => { process.exitCode = code || 0; });
		return;
	}
	const report = await execute({ operation, handleSignals: true });
	process.exitCode = ['passed', 'setup-only'].includes(report.outcome) ? 0 : 1;
}

if (require.main === module) {
	main().catch(() => {
		console.error('Integration command failed; inspect local report permissions/configuration');
		process.exitCode = 1;
	});
}

module.exports = {
	DependencyUnavailable, safeError, http, poll, execute,
};
