import expect from 'expect';
import sinon from 'sinon';
import Payments from './services/payments';
import GroupPayments from './services/groupPayments';
import * as handlers from './handler';

describe('Payments handler contracts', () => {
	[
		['create', 'create', { body: '{"PenaltyType":"FPN"}' }, [{ PenaltyType: 'FPN' }]],
		['batchFetch', 'batchFetch', { body: '{"ids":["999999000001_FPN"]}' }, [['999999000001_FPN']]],
		['update', 'update', { body: '{"PenaltyStatus":"PAID"}', pathParameters: { id: '999999000001_FPN' } }, ['999999000001_FPN', { PenaltyStatus: 'PAID' }]],
		['remove', 'delete', { pathParameters: { id: '999999000001_FPN' } }, ['999999000001_FPN']],
		['get', 'get', { pathParameters: { id: '999999000001_FPN' } }, ['999999000001_FPN']],
		['list', 'list', {}, []],
	].forEach(([exportName, method, event, args]) => {
		it(`${exportName} forwards parsed input and preserves the service response`, async () => {
			const expected = { statusCode: 200, body: '{"synthetic":true}' };
			const stub = sinon.stub(Payments.prototype, method).resolves(expected);
			expect(await handlers[exportName](event)).toEqual(expected);
			expect(stub.firstCall.args).toEqual(args);
		});
	});

	it('forwards a parsed group creation request', async () => {
		const expected = { statusCode: 201, body: '{"ID":"LOCALGROUP"}' };
		const stub = sinon.stub(GroupPayments.prototype, 'createPenaltyGroupPaymentRecord').resolves(expected);
		expect(await handlers.createPenaltyGroupPaymentRecord({ body: '{"PaymentCode":"LOCALGROUP"}' })).toEqual(expected);
		expect(stub.firstCall.args).toEqual([{ PaymentCode: 'LOCALGROUP' }]);
	});

	[{ statusCode: 409, body: '{}' }, new Error('Unavailable')].forEach((error) => {
		it('preserves the existing synchronous group-creation error response', async () => {
			sinon.stub(GroupPayments.prototype, 'createPenaltyGroupPaymentRecord').callsFake(() => { throw error; });
			const response = await handlers.createPenaltyGroupPaymentRecord({ body: '{}' });
			expect(response.statusCode).toBe(error.statusCode || 500);
		});
	});

	it('characterises a rejected group-creation promise escaping the response boundary', async () => {
		const error = new Error('Unavailable');
		sinon.stub(GroupPayments.prototype, 'createPenaltyGroupPaymentRecord').rejects(error);
		await expect(handlers.createPenaltyGroupPaymentRecord({ body: '{}' })).rejects.toBe(error);
	});

	it('returns an existing payment group with the response envelope', async () => {
		const item = { ID: 'LOCALGROUP', Payments: { FPN: { PaymentAmount: 120 } } };
		const stub = sinon.stub(GroupPayments.prototype, 'getPenaltyGroupPaymentRecord').resolves(item);
		const response = await handlers.getPenaltyGroupPaymentRecord({ pathParameters: { id: 'LOCALGROUP' } });
		expect(response.statusCode).toBe(200);
		expect(JSON.parse(response.body)).toEqual(item);
		expect(stub.firstCall.args).toEqual(['LOCALGROUP']);
	});

	it('returns 404 for a missing group', async () => {
		sinon.stub(GroupPayments.prototype, 'getPenaltyGroupPaymentRecord').resolves({});
		expect((await handlers.getPenaltyGroupPaymentRecord({ pathParameters: { id: 'missing' } })).statusCode).toBe(404);
	});

	[{ statusCode: 409, body: '{}' }, new Error('Unavailable')].forEach((error) => {
		it('preserves expected group errors and converts unexpected errors to 500', async () => {
			sinon.stub(GroupPayments.prototype, 'getPenaltyGroupPaymentRecord').rejects(error);
			const response = await handlers.getPenaltyGroupPaymentRecord({ pathParameters: { id: 'LOCALGROUP' } });
			expect(response.statusCode).toBe(error.statusCode || 500);
		});
	});

	it('deletes exactly the member payment records returned by group deletion', async () => {
		const expected = { statusCode: 200, body: '{}' };
		const groupStub = sinon.stub(GroupPayments.prototype, 'deletePenaltyGroupPaymentRecord').resolves({
			response: expected, penaltyIds: ['999999000001_FPN', '999999000002_FPN'],
		});
		const remove = sinon.stub(Payments.prototype, 'deletePaymentOnly').resolves({});
		expect(await handlers.deletePenaltyGroupPaymentRecord({ pathParameters: { id: 'LOCALGROUP', penaltyType: 'FPN' } })).toEqual(expected);
		expect(groupStub.firstCall.args).toEqual(['LOCALGROUP', 'FPN']);
		expect(remove.args).toEqual([['999999000001_FPN'], ['999999000002_FPN']]);
	});

	it('does not delete members when group deletion fails', async () => {
		const expected = { statusCode: 501, body: '{}' };
		sinon.stub(GroupPayments.prototype, 'deletePenaltyGroupPaymentRecord').resolves({ response: expected });
		const remove = sinon.stub(Payments.prototype, 'deletePaymentOnly');
		expect(await handlers.deletePenaltyGroupPaymentRecord({ pathParameters: { id: 'missing', penaltyType: 'FPN' } })).toEqual(expected);
		expect(remove.called).toBe(false);
	});

	it('characterises a member cleanup failure as logged but retaining the group response', async () => {
		const expected = { statusCode: 200, body: '{}' };
		sinon.stub(GroupPayments.prototype, 'deletePenaltyGroupPaymentRecord').resolves({
			response: expected, penaltyIds: ['999999000001_FPN'],
		});
		sinon.stub(Payments.prototype, 'deletePaymentOnly').rejects(new Error('Unavailable'));
		const log = sinon.stub(console, 'error');
		expect(await handlers.deletePenaltyGroupPaymentRecord({ pathParameters: { id: 'LOCALGROUP', penaltyType: 'FPN' } })).toEqual(expected);
		expect(JSON.parse(log.firstCall.args[0]).logName).toBe('DeletePaymentForGroupError');
	});

	it('characterises malformed individual creation JSON as a rejected request', async () => {
		await expect(handlers.create({ body: '{invalid' })).rejects.toThrow(SyntaxError);
	});
});
