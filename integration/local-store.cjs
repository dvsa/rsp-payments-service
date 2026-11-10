const { isDeepStrictEqual } = require('node:util');
const { OWNER } = require('./fixtures.cjs');

class SafetyError extends Error {}

function localUrl(value, port, pathname) {
	let url;
	try { url = new URL(value); } catch { throw new SafetyError('Invalid local integration URL'); }
	if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
		|| url.port !== String(port) || url.username || url.password || url.search || url.hash
		|| url.pathname.replace(/\/$/, '') !== pathname) {
		throw new SafetyError(`Only loopback HTTP on port ${port} with the documented local path is allowed`);
	}
	return url.toString().replace(/\/$/, '');
}

function configuration(env) {
	if (env.CI) throw new SafetyError('Integration tools refuse CI execution');
	if (env.INTEGRATION_PAYMENTS_TABLE && env.INTEGRATION_PAYMENTS_TABLE !== 'paymentsTable') {
		throw new SafetyError('Only the local paymentsTable is allowed');
	}
	if (env.INTEGRATION_GROUP_PAYMENTS_TABLE && env.INTEGRATION_GROUP_PAYMENTS_TABLE !== 'groupPaymentsTable') {
		throw new SafetyError('Only the local groupPaymentsTable is allowed');
	}
	return {
		baseUrl: localUrl(env.INTEGRATION_BASE_URL || 'http://localhost:3000/dev', 3000, '/dev'),
		dynamoUrl: localUrl(env.INTEGRATION_DYNAMODB_URL || 'http://localhost:8000', 8000, ''),
		allowLambda: env.INTEGRATION_ALLOW_LAMBDA === 'yes',
	};
}

function client(endpoint) {
	localUrl(endpoint, 8000, '');
	const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
	const {
		DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand,
	} = require('@aws-sdk/lib-dynamodb');
	const service = new DynamoDBClient({
		endpoint,
		region: 'eu-west-1',
		credentials: { accessKeyId: 'localIntegration', secretAccessKey: 'localIntegration' },
		maxAttempts: 1,
		requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
	});
	const document = DynamoDBDocumentClient.from(service, {
		marshallOptions: { removeUndefinedValues: true },
	});
	return {
		get: (input) => ({ promise: () => document.send(new GetCommand(input)) }),
		put: (input) => ({ promise: () => document.send(new PutCommand(input)) }),
		delete: (input) => ({ promise: () => document.send(new DeleteCommand(input)) }),
		service: { describeTable: (input) => ({ promise: () => service.send(new DescribeTableCommand(input)) }) },
	};
}

function entries(data) {
	return [
		...data.payments.map((item) => ({ table: 'paymentsTable', item, seed: true })),
		...data.groups.map((item) => ({ table: 'groupPaymentsTable', item, seed: true })),
		...Object.values(data.created).map((item) => ({ table: 'paymentsTable', item })),
		...data.createdMembers.map((item) => ({ table: 'paymentsTable', item })),
		{ table: 'groupPaymentsTable', item: data.createdGroup },
		{ table: 'paymentsTable', item: { ID: data.invalidId } },
		{ table: 'paymentsTable', item: { ID: data.missingId } },
		{ table: 'groupPaymentsTable', item: { ID: data.missingGroup } },
	];
}

function owned(item) {
	if (!item) return false;
	if (item.IntegrationFixture === OWNER) return true;
	if (item.IntegrationFixture !== undefined) return false;
	if (item.PaymentDetail?.PaymentRef?.startsWith(`${OWNER}-`)) return true;
	const payments = Object.values(item.Payments || {});
	return payments.length > 0 && payments.every((payment) => payment.PaymentRef?.startsWith(`${OWNER}-`));
}

async function get(db, table, id) {
	return (await db.get({ TableName: table, Key: { ID: id }, ConsistentRead: true }).promise()).Item;
}

async function verifyTables(db) {
	for (const TableName of ['paymentsTable', 'groupPaymentsTable']) {
		const { Table } = await db.service.describeTable({ TableName }).promise();
		if (Table.TableStatus !== 'ACTIVE' || Table.KeySchema.length !== 1
			|| Table.KeySchema[0].AttributeName !== 'ID' || Table.KeySchema[0].KeyType !== 'HASH'
			|| !Table.AttributeDefinitions.some((field) => field.AttributeName === 'ID' && field.AttributeType === 'S')) {
			throw new SafetyError('Local table schema does not match the Payments ID key');
		}
	}
}

async function snapshot(db, data) {
	const originals = [];
	for (const entry of entries(data)) {
		const original = await get(db, entry.table, entry.item.ID);
		if (original && !owned(original)) throw new SafetyError('Fixture ID collision; no records were seeded');
		originals.push({ ...entry, original });
	}
	return originals;
}

function condition(item) {
	if (item.IntegrationFixture === OWNER) {
		return {
			ConditionExpression: '#owner = :owner',
			ExpressionAttributeNames: { '#owner': 'IntegrationFixture' },
			ExpressionAttributeValues: { ':owner': OWNER },
		};
	}
	if (item.Payments) {
		return {
			ConditionExpression: '#payments = :payments AND attribute_not_exists(#owner)',
			ExpressionAttributeNames: { '#payments': 'Payments', '#owner': 'IntegrationFixture' },
			ExpressionAttributeValues: { ':payments': item.Payments },
		};
	}
	return {
		ConditionExpression: '#detail = :detail AND #status = :status AND attribute_not_exists(#owner)',
		ExpressionAttributeNames: { '#detail': 'PaymentDetail', '#status': 'PenaltyStatus', '#owner': 'IntegrationFixture' },
		ExpressionAttributeValues: { ':detail': item.PaymentDetail, ':status': item.PenaltyStatus },
	};
}

async function seed(db, data) {
	for (const entry of entries(data)) {
		const current = await get(db, entry.table, entry.item.ID);
		if (current && !owned(current)) throw new SafetyError('Fixture ownership changed before seeding');
		if (!entry.seed) {
			if (current) {
				await db.delete({
					TableName: entry.table, Key: { ID: entry.item.ID }, ...condition(current),
				}).promise();
			}
		} else {
			await db.put({
				TableName: entry.table,
				Item: entry.item,
				...(current ? condition(current) : { ConditionExpression: 'attribute_not_exists(ID)' }),
			}).promise();
		}
	}
}

async function restore(db, originals) {
	const failures = [];
	for (const entry of originals) {
		try {
			const current = await get(db, entry.table, entry.item.ID);
			if (current && !owned(current)) throw new SafetyError('Cleanup ownership check failed; foreign records were preserved');
			if (entry.original) {
				await db.put({
					TableName: entry.table,
					Item: entry.original,
					...(current ? condition(current) : { ConditionExpression: 'attribute_not_exists(ID)' }),
				}).promise();
			} else if (current) {
				await db.delete({
					TableName: entry.table, Key: { ID: entry.item.ID }, ...condition(current),
				}).promise();
			}
			if (!isDeepStrictEqual(await get(db, entry.table, entry.item.ID), entry.original)) {
				throw new SafetyError('Cleanup read-back did not match the original reserved record');
			}
		} catch { failures.push(entry.item.ID); }
	}
	if (failures.length) throw new SafetyError(`Cleanup could not restore ${failures.length} reserved records; inspect owned fixture recovery instructions`);
}

module.exports = {
	SafetyError, localUrl, configuration, client, entries, owned, get, verifyTables, snapshot, seed, restore,
};
