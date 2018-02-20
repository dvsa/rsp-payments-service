import expect from 'expect';
import sinon from 'sinon';
import Payments from '../services/payments';

import get from './get';
import createResponse from '../utils/createResponse';
import payments from '../../mock-data/fake-payments.json';

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
			payment = payments.filter(item => item.id === '1');
			sinon.stub(Payments.prototype, 'get').callsFake((id, callback) => {
				const response = createResponse({
					body: payment,
				});
				callback(null, response);
			});
		});

		it('should return a 200 success with the correct payment', (done) => {

			get(event, null, (err, res) => {
				expect(err).toBe(null);
				expect(res.statusCode).toBe(200);
				expect(JSON.parse(res.body)).toEqual(payment);
				done();
			});

		});

	});

});
