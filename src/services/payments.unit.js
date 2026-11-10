import expect from 'expect';
import sinon from 'sinon';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import Payments from './payments';
import seededPayments from '../../mock-data/fake-payments.json';
import { fixtures, payload } from '../../integration/fixtures.cjs';

const id = '999999000001_FPN';
const paymentDetail = {
	PaymentRef: 'LOCAL-REF',
	AuthCode: 'LOCAL123',
	PaymentAmount: 120,
	PaymentDate: 1700000000,
	PaymentMethod: 'CARD',
};
const paidBody = () => ({
	PenaltyReference: '999999000001',
	PenaltyType: 'FPN',
	PenaltyStatus: 'PAID',
	PaymentDetail: { ...paymentDetail },
	PaymentCode: 'LOCALCODE',
});
const bodyOf = (response) => JSON.parse(response.body);

describe('Payments service', () => {
	let db;
	let service;
	let invoke;

	beforeEach(() => {
		db = {};
		['get', 'put', 'scan', 'batchGet', 'update', 'delete'].forEach((method) => {
			db[method] = sinon.stub().throws(new Error(`Unexpected ${method}`));
		});
		service = new Payments(db, 'paymentsTable', 'unused', 'local-document-update', 'local-document-delete');
		invoke = sinon.stub().throws(new Error('Unexpected Lambda invocation'));
		sinon.stub(LambdaClient.prototype, 'send').callsFake((command) => {
			expect(command).toBeInstanceOf(InvokeCommand);
			return invoke(command.input);
		});
		sinon.stub(console, 'log');
		sinon.stub(console, 'error');
	});

	function succeeds(method, result) {
		db[method].returns({ promise: sinon.stub().resolves(result) });
	}

	function fails(method, error) {
		db[method].returns({ promise: sinon.stub().rejects(error) });
	}

	it('standalone seeded payments match validated creation responses and persisted record shapes', async () => {
		succeeds('put', {});
		invoke.resolves({});
		await Promise.all(seededPayments.filter((payment) => !payment.PenaltyGroupId).map(async (payment) => {
			const [PenaltyReference, PenaltyType] = payment.ID.split('_');
			const response = await service.create({
				PenaltyReference,
				PenaltyType,
				PenaltyStatus: payment.PenaltyStatus,
				PaymentDetail: payment.PaymentDetail,
			});
			expect(response.statusCode).toBe(200);
			expect(bodyOf(response)).toEqual({ payment });
			expect(db.put.calledWithExactly({ TableName: 'paymentsTable', Item: payment })).toBe(true);
		}));
	});

	it('lists persisted payment values and uses the selected table', async () => {
		const items = [{ ID: id, PenaltyStatus: 'PAID', PaymentDetail: paymentDetail }];
		succeeds('scan', { Items: items });
		expect(bodyOf(await service.list())).toEqual({ payments: items });
		expect(db.scan.firstCall.args).toEqual([{ TableName: 'paymentsTable' }]);
	});

	it('accepts the reserved FPN, IM and CDN integration fixtures with their exact creation shapes', async () => {
		succeeds('put', {});
		invoke.resolves({});
		await Promise.all(Object.values(fixtures(1700000000).created).map(async (payment) => {
			const response = await service.create(payload(payment));
			expect(response.statusCode).toBe(200);
			expect(bodyOf(response)).toEqual({ payment });
			expect(db.put.calledWithExactly({ TableName: 'paymentsTable', Item: payment })).toBe(true);
		}));
	});

	it('returns a database failure from list', async () => {
		fails('scan', { code: 'Unavailable' });
		const response = await service.list();
		expect(response.statusCode).toBe(500);
		expect(bodyOf(response)).toEqual({ err: { code: 'Unavailable' } });
	});

	it('characterises scan pagination being omitted from the public list response', async () => {
		succeeds('scan', { Items: [{ ID: id }], LastEvaluatedKey: { ID: id } });
		expect(bodyOf(await service.list())).toEqual({ payments: [{ ID: id }] });
		expect(db.scan.calledOnce).toBe(true);
	});

	it('fetches the exact requested payment', async () => {
		const item = { ID: id, PenaltyStatus: 'PAID', PaymentDetail: paymentDetail };
		succeeds('get', { Item: item });
		expect(bodyOf(await service.get(id))).toEqual({ payment: item });
		expect(db.get.firstCall.args).toEqual([{ TableName: 'paymentsTable', Key: { ID: id } }]);
	});

	it('characterises a missing individual payment as 200 with an empty body', async () => {
		succeeds('get', {});
		const response = await service.get('missing');
		expect(response.statusCode).toBe(200);
		expect(bodyOf(response)).toEqual({});
	});

	it('returns a database failure from get', async () => {
		fails('get', { code: 'Unavailable' });
		const response = await service.get(id);
		expect(response.statusCode).toBe(500);
		expect(bodyOf(response).err.code).toBe('Unavailable');
	});

	it('batch-fetches exact keys and projected payment fields', async () => {
		const payments = [{ ID: id, PenaltyStatus: 'PAID' }];
		succeeds('batchGet', { Responses: { paymentsTable: payments } });
		expect(bodyOf(await service.batchFetch([id]))).toEqual({ payments });
		expect(db.batchGet.firstCall.args[0]).toEqual({
			RequestItems: {
				paymentsTable: {
					Keys: [{ ID: id }],
					ProjectionExpression: 'ID, PaymentDetail, PenaltyStatus',
				},
			},
		});
	});

	it('returns a batch database failure', async () => {
		fails('batchGet', { code: 'Unavailable', message: 'Unavailable' });
		const response = await service.batchFetch([id]);
		expect(response.statusCode).toBe(500);
		expect(bodyOf(response).err.code).toBe('Unavailable');
	});

	it('characterises a missing batch ID list rejecting before database access', async () => {
		await expect(service.batchFetch()).rejects.toThrow(TypeError);
		expect(db.batchGet.called).toBe(false);
	});

	[
		[undefined, 'FPN', ''],
		['999999000001', undefined, ''],
		['999999000001', 'FPN', id],
		['999999000001', 'CDN', '999999000001_CDN'],
		['invalid', 'FPN', ''],
		['1234561123456', 'IM', '1234561123456_IM'],
		['invalid', 'IM', ''],
		['0000001123456', 'IM', ''],
		['1234561000000', 'IM', ''],
	].forEach(([reference, type, expected]) => {
		it(`constructs the payment ID for ${reference}/${type}`, () => {
			expect(service.constructID(reference, type)).toBe(expected);
		});
	});

	it('validates, persists and forwards the exact document-update envelope', async () => {
		succeeds('put', {});
		invoke.resolves({ Payload: Buffer.from('{}') });
		const input = paidBody();
		const response = await service.create(input);
		const item = { ID: id, PenaltyStatus: 'PAID', PaymentDetail: paymentDetail };
		expect(response.statusCode).toBe(200);
		expect(bodyOf(response)).toEqual({ payment: item });
		expect(db.put.firstCall.args[0]).toEqual({ TableName: 'paymentsTable', Item: item });
		expect(invoke.firstCall.args[0].FunctionName).toBe('local-document-update');
		expect(JSON.parse(invoke.firstCall.args[0].Payload)).toEqual({
			body: {
				id,
				paymentStatus: 'PAID',
				paymentAmount: 120,
				penaltyRefNo: input.PenaltyReference,
				penaltyType: 'FPN',
				paymentToken: 'LOCALCODE',
			},
		});
		expect(db.put.calledBefore(invoke)).toBe(true);
	});

	it('rejects invalid payment creation without any persistence or Lambda call', async () => {
		const response = await service.create({ ...paidBody(), PenaltyType: 'INVALID' });
		expect(response.statusCode).toBe(405);
		expect(bodyOf(response).err).toContain('Invalid Input');
		expect(db.put.called).toBe(false);
		expect(invoke.called).toBe(false);
	});

	it('does not invoke Documents after a failed payment write', async () => {
		fails('put', { code: 'Unavailable', message: 'Unavailable' });
		const response = await service.create(paidBody());
		expect(response.statusCode).toBe(500);
		expect(bodyOf(response).err.code).toBe('Unavailable');
		expect(invoke.called).toBe(false);
	});

	it('reports a downstream failure after the payment was written', async () => {
		succeeds('put', {});
		invoke.rejects(new Error('Downstream unavailable'));
		const response = await service.create(paidBody());
		expect(response.statusCode).toBe(400);
		expect(db.put.calledOnce).toBe(true);
		expect(bodyOf(response)).toEqual({});
	});

	it('characterises Lambda FunctionError not preventing a successful creation response', async () => {
		succeeds('put', {});
		invoke.resolves({
			StatusCode: 200, FunctionError: 'Unhandled', Payload: Buffer.from('{"errorMessage":"Synthetic failure"}'),
		});
		const response = await service.create(paidBody());
		expect(response.statusCode).toBe(200);
		expect(bodyOf(response)).toEqual({ payment: { ID: id, PenaltyStatus: 'PAID', PaymentDetail: paymentDetail } });
		expect(db.put.calledOnce).toBe(true);
	});

	it('deletes only an individual payment without updating Documents', async () => {
		succeeds('delete', { Attributes: { ID: id } });
		expect(await service.deletePaymentOnly(id)).toEqual({ Attributes: { ID: id } });
		expect(db.delete.firstCall.args[0]).toEqual({ TableName: 'paymentsTable', Key: { ID: id } });
		expect(invoke.called).toBe(false);
	});

	it('propagates failure when deleting only the payment', async () => {
		fails('delete', new Error('Unavailable'));
		await expect(service.deletePaymentOnly(id)).rejects.toThrow('Unavailable');
	});

	[409, undefined].forEach((status) => {
		it(`returns the delete failure status ${status || 501}`, async () => {
			fails('delete', { statusCode: status });
			const response = await service.delete(id);
			expect(response.statusCode).toBe(status || 501);
			expect(bodyOf(response)).toBe("Couldn't remove the payment.");
		});
	});

	it('deletes an unpaid record without invoking Documents', async () => {
		succeeds('delete', { Attributes: { ID: id, PenaltyStatus: 'UNPAID', PaymentDetail: {} } });
		const response = await service.delete(id);
		expect(response.statusCode).toBe(200);
		expect(bodyOf(response)).toEqual({});
		expect(db.delete.firstCall.args[0].ReturnValues).toBe('ALL_OLD');
		expect(invoke.called).toBe(false);
	});

	it('characterises missing individual deletion rejecting instead of returning a controlled 404', async () => {
		succeeds('delete', {});
		await expect(service.delete(id)).rejects.toThrow(TypeError);
		expect(invoke.called).toBe(false);
	});

	it('marks the document unpaid after deleting a paid payment', async () => {
		succeeds('delete', { Attributes: { ...paidBody(), ID: id } });
		invoke.resolves({ Payload: Buffer.from('{}') });
		const response = await service.delete(id);
		expect(response.statusCode).toBe(200);
		expect(invoke.firstCall.args[0].FunctionName).toBe('local-document-delete');
		expect(JSON.parse(invoke.firstCall.args[0].Payload)).toEqual({
			body: {
				id,
				paymentStatus: 'UNPAID',
				paymentAmount: '120',
				penaltyRefNo: '999999000001',
				penaltyType: 'FPN',
				paymentToken: 'undefined',
			},
		});
		expect(db.delete.calledBefore(invoke)).toBe(true);
	});

	it('reports a missing downstream delete payload', async () => {
		succeeds('delete', { Attributes: paidBody() });
		invoke.resolves({});
		expect((await service.delete(id)).statusCode).toBe(400);
	});

	it('retains the missing-payload failure for an empty SDK v3 byte payload', async () => {
		succeeds('delete', { Attributes: paidBody() });
		invoke.resolves({ Payload: new Uint8Array() });
		expect((await service.delete(id)).statusCode).toBe(400);
	});

	it('reports downstream failure after deleting a paid record', async () => {
		succeeds('delete', { Attributes: paidBody() });
		invoke.rejects(new Error('Unavailable'));
		expect((await service.delete(id)).statusCode).toBe(400);
	});

	it('rejects an invalid update without writing', async () => {
		const response = await service.update(id, { ...paidBody(), PenaltyType: 'INVALID' });
		expect(response.statusCode).toBe(405);
		expect(bodyOf(response).err).toContain('Invalid Input');
		expect(db.update.called).toBe(false);
	});

	it('characterises an update returning 200 with an empty body before its write settles', async () => {
		const attributes = { ID: id, PenaltyStatus: 'PAID', PaymentDetail: paymentDetail };
		let resolveWrite;
		const write = new Promise((resolve) => { resolveWrite = resolve; });
		db.update.returns({ promise: () => write });
		const input = paidBody();
		delete input.PaymentCode;
		const response = await service.update(id, input);
		expect(response.statusCode).toBe(200);
		expect(bodyOf(response)).toEqual({});
		resolveWrite({ Attributes: attributes });
		expect(await write).toEqual({ Attributes: attributes });
		expect(db.update.firstCall.args[0]).toEqual({
			TableName: 'paymentsTable',
			Key: { ID: id },
			ExpressionAttributeNames: {
				'#PenaltyStatus': 'PenaltyStatus',
				'#PenaltyType': 'PenaltyType',
				'#PaymentDetail': 'PaymentDetail',
				'#ID': 'ID',
			},
			ExpressionAttributeValues: {
				':PenaltyStatus': 'PAID',
				':PenaltyType': 'FPN',
				':PaymentDetail': paymentDetail,
			},
			UpdateExpression: 'SET #PenaltyStatus = :PenaltyStatus, #PenaltyType = :PenaltyType, #PaymentDetail = :PaymentDetail',
			ConditionExpression: 'attribute_exists(#ID) AND #PenaltyStatus <> :PenaltyStatus',
			ReturnValues: 'ALL_NEW',
		});
	});

	it('characterises an asynchronous update rejection not reaching the existing error response', async () => {
		const error = new Error('ConditionalCheckFailedException');
		const write = Promise.reject(error);
		const rejection = expect(write).rejects.toBe(error);
		db.update.returns({ promise: () => write });
		const input = paidBody();
		delete input.PaymentCode;
		const response = await service.update(id, input);
		expect(response.statusCode).toBe(200);
		expect(bodyOf(response)).toEqual({});
		await rejection;
	});

	it('preserves the existing error response for a synchronous update failure', async () => {
		db.update.throws(new Error('Unavailable'));
		const input = paidBody();
		delete input.PaymentCode;
		const response = await service.update(id, input);
		expect(response.statusCode).toBe(500);
		expect(bodyOf(response)).toEqual({ err: 'Failed to update payment' });
	});
});
