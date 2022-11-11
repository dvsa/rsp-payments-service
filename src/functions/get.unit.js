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
			payment = payments.filter((item) => item.id === '1');
			sinon.stub(Payments.prototype, 'get').callsFake(() => {
				const response = createResponse({
					body: payment,
				});
				return Promise.resolve(response);
			});
		});

		it('should return a 200 success with the correct payment', async () => {
			const res = await get(event);
			expect(res.statusCode).toBe(200);
			expect(JSON.parse(res.body)).toEqual(payment);
		});
	});
});
