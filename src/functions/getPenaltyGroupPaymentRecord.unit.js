import expect from 'expect';
import sinon from 'sinon';
import GroupPayments from '../services/groupPayments';

import getPenaltyGroupPaymentRecord from './getPenaltyGroupPaymentRecord';
import groupPayments from '../../mock-data/fake-group-payments.json';

describe('get', () => {
	let event;
	let payment;

	afterEach(() => {
		event = null;
	});

	describe('when a specific payment is requested', () => {
		beforeEach(() => {
			event = {
				httpMethod: 'GET',
				pathParameters: {
					id: '1',
				},
			};
			payment = groupPayments.filter((item) => item.ID === '15xk9i0xujgg');
			sinon.stub(GroupPayments.prototype, 'getPenaltyGroupPaymentRecord').resolves(payment);
		});

		it('should return a 200 success with the correct payment', async () => {
			const res = await getPenaltyGroupPaymentRecord(event);
			expect(res.statusCode).toBe(200);
			expect(JSON.parse(res.body)).toEqual(payment);
		});
	});
});
