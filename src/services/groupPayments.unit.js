import expect from 'expect';
import sinon from 'sinon';
import { LambdaClient, InvokeCommand, LambdaServiceException } from '@aws-sdk/client-lambda';
import GroupPayments from './groupPayments';
import seededGroups from '../../mock-data/fake-group-payments.json';
import seededPayments from '../../mock-data/fake-payments.json';

const groupId = 'LOCALGROUP';
const detail = {
	PaymentRef: 'LOCAL-REF',
	AuthCode: 'LOCAL123',
	PaymentAmount: 120,
	PaymentDate: 1700000000,
	PaymentMethod: 'CARD',
};
const penaltyIds = ['999999000001_FPN', '999999000002_FPN'];
const input = () => ({
	PaymentCode: groupId,
	PenaltyType: 'FPN',
	PaymentDetail: { ...detail },
	PenaltyIds: [...penaltyIds],
});
const stored = () => ({
	ID: groupId,
	Payments: { FPN: { ...detail, PaymentStatus: 'PAID', penaltyIds: [...penaltyIds] } },
});
const bodyOf = (response) => JSON.parse(response.body);

describe('GroupPayments service', () => {
	let db;
	let service;
	let invoke;

	beforeEach(() => {
		db = {};
		['get', 'put', 'delete', 'batchWrite'].forEach((method) => {
			db[method] = sinon.stub().throws(new Error(`Unexpected ${method}`));
		});
		service = new GroupPayments(db, 'groupPaymentsTable', 'local-group-update', 'local-documents-update', 'local-document-update');
		invoke = sinon.stub().throws(new Error('Unexpected Lambda invocation'));
		sinon.stub(LambdaClient.prototype, 'send').callsFake((command) => {
			expect(command).toBeInstanceOf(InvokeCommand);
			return invoke(command.input);
		});
		sinon.stub(console, 'log');
		sinon.stub(console, 'error');
	});

	function succeeds(method, result = {}) {
		db[method].returns({ promise: sinon.stub().resolves(result) });
	}

	function fails(method, error) {
		db[method].returns({ promise: sinon.stub().rejects(error) });
	}

	seededGroups.forEach((group) => {
		Object.entries(group.Payments).forEach(([type, payment]) => {
			it(`seeded ${group.ID}/${type} matches group creation and its linked member writes`, async () => {
				succeeds('get');
				succeeds('put');
				succeeds('batchWrite');
				invoke.resolves({});
				const members = payment.penaltyIds.map((id) => seededPayments.find((member) => member.ID === id));
				expect(members.length).toBeGreaterThan(0);
				expect(members).not.toContain(undefined);
				const response = await service.createPenaltyGroupPaymentRecord({
					PaymentCode: group.ID,
					PenaltyType: type,
					PaymentDetail: members[0].PaymentDetail,
					PenaltyIds: payment.penaltyIds,
				});
				const expected = { ID: group.ID, Payments: { [type]: payment } };
				expect(response.statusCode).toBe(201);
				expect(bodyOf(response)).toEqual(expected);
				expect(db.put.firstCall.args[0]).toEqual({ TableName: 'groupPaymentsTable', Item: expected });
				expect(db.batchWrite.firstCall.args[0]).toEqual({
					RequestItems: {
						paymentsTable: members.map((member) => ({ PutRequest: { Item: member } })),
					},
				});
			});
		});
	});

	it('seeded groups link every grouped payment exactly once without orphaned members', () => {
		const memberIds = seededGroups.flatMap((group) => Object.values(group.Payments)
			.flatMap((payment) => payment.penaltyIds));
		expect(new Set(seededPayments.map((payment) => payment.ID)).size).toBe(seededPayments.length);
		expect(new Set(memberIds).size).toBe(memberIds.length);
		expect(seededPayments.filter((payment) => payment.PenaltyGroupId)
			.map((payment) => payment.ID).sort()).toEqual(memberIds.sort());
	});

	it('retrieves the complete group and exact database key', async () => {
		succeeds('get', { Item: stored() });
		expect(await service.getPenaltyGroupPaymentRecord(groupId)).toEqual(stored());
		expect(db.get.firstCall.args[0]).toEqual({ TableName: 'groupPaymentsTable', Key: { ID: groupId } });
	});

	it('returns an empty object for a missing group', async () => {
		succeeds('get');
		expect(await service.getPenaltyGroupPaymentRecord('missing')).toEqual({});
	});

	it('creates group and member payments and forwards the exact downstream envelope', async () => {
		succeeds('get');
		succeeds('put');
		succeeds('batchWrite');
		invoke.resolves({});
		const response = await service.createPenaltyGroupPaymentRecord(input());
		expect(response.statusCode).toBe(201);
		expect(bodyOf(response)).toEqual(stored());
		expect(db.put.firstCall.args[0]).toEqual({ TableName: 'groupPaymentsTable', Item: stored() });
		expect(db.batchWrite.firstCall.args[0]).toEqual({
			RequestItems: {
				paymentsTable: penaltyIds.map((id) => ({
					PutRequest: {
						Item: {
							ID: id, PenaltyStatus: 'PAID', PaymentDetail: detail, PenaltyGroupId: groupId,
						},
					},
				})),
			},
		});
		expect(invoke.firstCall.args[0].FunctionName).toBe('local-group-update');
		expect(JSON.parse(invoke.firstCall.args[0].Payload)).toEqual({
			body: { id: groupId, paymentStatus: 'PAID', penaltyType: 'FPN' },
		});
		expect(db.put.calledBefore(invoke)).toBe(true);
	});

	it('extends another penalty type without changing its existing payment', async () => {
		const existing = stored();
		existing.Payments.IM = existing.Payments.FPN;
		delete existing.Payments.FPN;
		succeeds('get', { Item: existing });
		succeeds('put');
		succeeds('batchWrite');
		invoke.resolves({});
		const response = await service.createPenaltyGroupPaymentRecord(input());
		expect(response.statusCode).toBe(200);
		expect(bodyOf(response)).toEqual({ ...detail, PaymentStatus: 'PAID' });
		const write = db.put.firstCall.args[0];
		expect(write.Item.Payments.IM).toEqual(stored().Payments.FPN);
		expect(write.Item.Payments.FPN).toEqual(stored().Payments.FPN);
		expect(write.ConditionExpression).toBe('attribute_exists(#ID)');
		expect(write.ExpressionAttributeNames).toEqual({ '#ID': 'ID' });
	});

	it('rejects a duplicate penalty-type payment without further writes or invocations', async () => {
		succeeds('get', { Item: stored() });
		const response = await service.createPenaltyGroupPaymentRecord(input());
		expect(response.statusCode).toBe(400);
		expect(bodyOf(response).err).toContain('already exists');
		expect(db.put.called).toBe(false);
		expect(db.batchWrite.called).toBe(false);
		expect(invoke.called).toBe(false);
	});

	it('extends an empty existing category', async () => {
		succeeds('get', { Item: { ID: groupId, Payments: { FPN: {} } } });
		succeeds('put');
		succeeds('batchWrite');
		invoke.resolves({});
		expect((await service.createPenaltyGroupPaymentRecord(input())).statusCode).toBe(200);
		expect(db.put.firstCall.args[0].Item).toEqual(stored());
	});

	[
		[{ PaymentCode: '' }, 'Invalid Id'],
		[{ PenaltyType: 'INVALID' }, 'Invalid penalty type'],
	].forEach(([overrides, message]) => {
		it(`rejects ${message} before any database access`, async () => {
			const response = await service.createPenaltyGroupPaymentRecord({ ...input(), ...overrides });
			expect(response.statusCode).toBe(400);
			expect(bodyOf(response).err).toContain(message);
			expect(db.get.called).toBe(false);
			expect(invoke.called).toBe(false);
		});
	});

	it('reports a failure writing a new group', async () => {
		succeeds('get');
		fails('put', new Error('Unavailable'));
		const response = await service.createPenaltyGroupPaymentRecord(input());
		expect(response.statusCode).toBe(500);
		expect(bodyOf(response)).toBe('Error creating new group payment record');
		expect(invoke.called).toBe(false);
	});

	[new Error('Unavailable'), 'Unavailable'].forEach((error) => {
		it('reports a failure reading the group without writing', async () => {
			fails('get', error);
			expect((await service.createPenaltyGroupPaymentRecord(input())).statusCode).toBe(500);
			expect(db.put.called).toBe(false);
		});
	});

	it('reports downstream failure after group persistence', async () => {
		succeeds('get');
		succeeds('put');
		succeeds('batchWrite');
		invoke.rejects(new Error('Unavailable'));
		expect((await service.createPenaltyGroupPaymentRecord(input())).statusCode).toBe(500);
		expect(db.put.calledOnce).toBe(true);
	});

	it('characterises Lambda FunctionError not preventing successful group and member creation', async () => {
		succeeds('get');
		succeeds('put');
		succeeds('batchWrite');
		invoke.resolves({
			StatusCode: 200, FunctionError: 'Unhandled', Payload: Buffer.from('{"errorMessage":"Synthetic failure"}'),
		});
		const response = await service.createPenaltyGroupPaymentRecord(input());
		expect(response.statusCode).toBe(201);
		expect(bodyOf(response)).toEqual(stored());
		expect(db.put.calledOnce).toBe(true);
		expect(db.batchWrite.calledOnce).toBe(true);
	});

	it('reports a member batch-write failure', async () => {
		succeeds('get');
		succeeds('put');
		fails('batchWrite', new Error('Unavailable'));
		invoke.resolves({});
		expect((await service.createPenaltyGroupPaymentRecord(input())).statusCode).toBe(500);
	});

	it('wraps a synchronous member request-construction failure', async () => {
		succeeds('get');
		succeeds('put');
		invoke.resolves({});
		const response = await service.createPenaltyGroupPaymentRecord({ ...input(), PenaltyIds: undefined });
		expect(response.statusCode).toBe(500);
		expect(db.batchWrite.called).toBe(false);
	});

	[[undefined, 'FPN'], [groupId, undefined]].forEach(([id, type]) => {
		it('rejects missing group delete parameters without database access', async () => {
			const result = await service.deletePenaltyGroupPaymentRecord(id, type);
			expect(result.response.statusCode).toBe(400);
			expect(bodyOf(result.response)).toContain("Couldn't remove the payment");
			expect(db.get.called).toBe(false);
		});
	});

	it('deletes the final group category and updates the exact member documents', async () => {
		succeeds('get', { Item: stored() });
		succeeds('delete');
		invoke.resolves({});
		const result = await service.deletePenaltyGroupPaymentRecord(groupId, 'FPN');
		expect(result.response.statusCode).toBe(200);
		expect(bodyOf(result.response)).toEqual({});
		expect(result.penaltyIds).toEqual(penaltyIds);
		expect(db.delete.firstCall.args[0]).toEqual({
			TableName: 'groupPaymentsTable', Key: { ID: groupId }, ReturnValues: 'ALL_OLD',
		});
		expect(invoke.firstCall.args[0]).toEqual({
			FunctionName: 'local-documents-update',
			Payload: JSON.stringify({ body: { penaltyDocumentIds: penaltyIds } }),
		});
		expect(db.delete.calledBefore(invoke)).toBe(true);
	});

	it('preserves other payment categories when deleting one category', async () => {
		const existing = stored();
		existing.Payments.IM = { ...detail, PaymentStatus: 'PAID', penaltyIds: ['999999100001_IM'] };
		const remaining = { ID: groupId, Payments: { IM: { ...existing.Payments.IM } } };
		succeeds('get', { Item: existing });
		succeeds('put');
		invoke.resolves({});
		const result = await service.deletePenaltyGroupPaymentRecord(groupId, 'FPN');
		expect(result.response.statusCode).toBe(200);
		expect(bodyOf(result.response)).toEqual(remaining);
		expect(db.put.firstCall.args[0]).toEqual({
			TableName: 'groupPaymentsTable',
			Item: remaining,
			ConditionExpression: 'attribute_exists(#ID)',
			ExpressionAttributeNames: { '#ID': 'ID' },
		});
		expect(db.delete.called).toBe(false);
		expect(result.penaltyIds).toEqual(penaltyIds);
	});

	[409, undefined].forEach((status) => {
		it(`returns group delete failure ${status || 501}`, async () => {
			fails('get', { statusCode: status, message: 'Unavailable' });
			const result = await service.deletePenaltyGroupPaymentRecord(groupId, 'FPN');
			expect(result.response.statusCode).toBe(status || 501);
			expect(result.penaltyIds).toBeUndefined();
			expect(invoke.called).toBe(false);
		});
	});

	it('reports a document-update failure after group deletion', async () => {
		succeeds('get', { Item: stored() });
		succeeds('delete');
		invoke.rejects(new Error('Unavailable'));
		const result = await service.deletePenaltyGroupPaymentRecord(groupId, 'FPN');
		expect(result.response.statusCode).toBe(501);
		expect(result.penaltyIds).toBeUndefined();
	});

	it('retains the downstream HTTP error status for SDK v3 Lambda service exceptions', async () => {
		succeeds('get', { Item: stored() });
		succeeds('delete');
		invoke.rejects(new LambdaServiceException({
			name: 'ResourceNotFoundException', $fault: 'client', $metadata: { httpStatusCode: 404 },
		}));
		const result = await service.deletePenaltyGroupPaymentRecord(groupId, 'FPN');
		expect(result.response.statusCode).toBe(404);
		expect(result.penaltyIds).toBeUndefined();
	});
});
