import supertest from 'supertest';
import expect from 'expect';

import payments from '../../mock-data/fake-payments.json';

const url = 'http://localhost:3000/payments';
const request = supertest(url);

describe('payments', () => {

	context('GET', () => {

		context('all payments', () => {

			it('should return all payments', (done) => {

				request
					.get('/')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.payments.length).toEqual(4);
						done();
					});

			});

			it('should block unauthorised requests', (done) => {

				request
					.get('/')
					.set('Context-Type', 'application/json')
					.set('authorization', 'hack')
					.expect(401)
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.message).toEqual('Unauthorized');
						done();
					});

			});

		});

		context('one payment', () => {

			it('should return the correct payment', (done) => {

				const expectedPayment = payments.filter(payment => payment.ID === '820500000877_FPN')[0];

				request
					.get('/820500000877_FPN')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json')
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
				.set('Context-Type', 'application/json')
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
							expect(_res.body.payments.length).toEqual(3);
							done();
						});
				});
		});
	});
});
