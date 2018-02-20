import expect from 'expect';
import sinon from 'sinon';
import Payments from '../services/payments';

import list from './list';
import createResponse from '../utils/createResponse';
import payments from '../../mock-data/fake-payments.json';

describe('list', () => {

	let event;

	afterEach(() => {
		event = null;
	});

	describe('when a list of users are requested', () => {

		beforeEach(() => {
			event = {
				httpMethod: 'GET',
				pathParameters: null,
			};
			sinon.stub(Payments.prototype, 'list').callsFake((callback) => {
				const response = createResponse({
					body: payments,
				});
				callback(null, response);
			});
		});

		it('should return a 200 success', (done) => {

			list(event, null, (err, res) => {
				expect(err).toBe(null);
				expect(res.statusCode).toBe(200);
				expect(res.body).toEqual(JSON.stringify(payments));
				done();
			});

		});

	});

});
