import supertest from 'supertest';
import expect from 'expect';

import payments from '../../mock-data/fake-payments.json';

const url = 'http://localhost:3000/dev/payments';
const request = supertest(url);
const expectedPaymentIds = [
	...payments.map((payment) => payment.ID),
	'111111111111_FPN',
	'222222222222_FPN',
	'333333333333_IM',
];

describe('payments', () => {

	context('GET', () => {

		context('all payments', () => {

			it('should return all payments', (done) => {

				request
					.get('/')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json; charset=utf-8')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.payments.map((payment) => payment.ID).sort())
							.toEqual([...expectedPaymentIds].sort());
						done();
					});

			});

		});

		context('one payment', () => {

			it('should return the correct payment', (done) => {

				const expectedPayment = payments.filter((payment) => payment.ID === '820500000877_FPN')[0];

				request
					.get('/820500000877_FPN')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json; charset=utf-8')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.payment).toEqual(expectedPayment);
						done();
					});
			});

		});

	});

	context('DELETE', () => {

		it('should return a 200 response and an empty object', (done) => {

			request
				.delete('/820500000877_FPN')
				.set('Context-Type', 'application/json; charset=utf-8')
				.set('authorization', 'allow')
				.expect(200)
				.end((err, res) => {
					if (err) throw err;
					expect(res.body).toEqual({});
					return request
						.get('/')
						.set('authorization', 'allow')
						.end((_err, _res) => {
							if (_err) throw _err;
							expect(_res.body.payments.map((payment) => payment.ID).sort())
								.toEqual(expectedPaymentIds.filter((id) => id !== '820500000877_FPN').sort());
							done();
						});
				});
		});
	});
});
