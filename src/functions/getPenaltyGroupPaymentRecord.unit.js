import expect from 'expect';
import sinon from 'sinon';
import GroupPayments from '../services/groupPayments';

import getPenaltyGroupPaymentRecord from './getPenaltyGroupPaymentRecord';
import createResponse from '../utils/createResponse';
import groupPayments from '../../mock-data/fake-group-payments.json';

describe('getPenaltyGroupPaymentRecord', () => {

	let event;
	let payment;

	afterEach(() => {
		event = null;
	});

	describe('when a specific group payment record is requested', () => {

		beforeEach(() => {
			event = {
				httpMethod: 'GET',
				pathParameters: {
					id: '1',
				},
			};
			payment = groupPayments.filter(item => item.ID === '15xk9i0xujgg');
			sinon.stub(GroupPayments.prototype, 'getPenaltyGroupPaymentRecord').callsFake((id, callback) => {
				const response = createResponse({
					body: payment,
				});
				callback(null, response);
			});
		});

		it('should return a 200 success with the correct payment', (done) => {

			getPenaltyGroupPaymentRecord(event, null, (err, res) => {
				expect(err).toBe(null);
				expect(res.statusCode).toBe(200);
				expect(JSON.parse(res.body)).toEqual(payment);
				done();
			});

		});

	});

});
