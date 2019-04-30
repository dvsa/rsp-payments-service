import expect from 'expect';
import sinon from 'sinon';
import Payments from '../services/payments';

import list from './list';
import createResponse from '../utils/createResponse';
import payments from '../../mock-data/fake-payments.json';

describe('list', () => {
	afterEach(() => {
		Payments.prototype.list.restore();
	});

	describe('when a list of users are requested', () => {
		beforeEach(() => {
			sinon.stub(Payments.prototype, 'list').callsFake(() => {
				const response = createResponse({
					body: payments,
				});
				return Promise.resolve(response);
			});
		});

		it('should return a 200 success', async () => {
			const res = await list();
			expect(res.statusCode).toBe(200);
			expect(res.body).toEqual(JSON.stringify(payments));
		});
	});
});
