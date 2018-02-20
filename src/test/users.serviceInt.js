import supertest from 'supertest';
import expect from 'expect';

import users from '../../mock-data/fake-users.json';

const url = 'http://localhost:3000/users';
const request = supertest(url);

describe('users', () => {

	context('GET', () => {

		context('all users', () => {

			it('should return all users', (done) => {

				request
					.get('/')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.users.length).toEqual(4);
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

		context('one user', () => {

			it('should return the correct user', (done) => {

				const expectedUser = users.filter(user => user.id === '1')[0];

				request
					.get('/1')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.user).toEqual(expectedUser);
						done();
					});
			});

		});

	});

	context('PUT', () => {

		context('Create new user', () => {

			it('returns the newly created user', (done) => {

				request
					.put('/')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.send({
						name: 'Michael',
						role: 'admin',
					})
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.user.name).toEqual('Michael');
						expect(res.body.user.role).toEqual('admin');
						return request
							.get('/')
							.set('authorization', 'allow')
							.end((_err, _res) => {
								if (_err) throw _err;
								expect(_res.body.users.length).toEqual(5);
								done();
							});
					});
			});
		});
	});

	context('DELETE', () => {

		it('should return a 200 response and an empty object', (done) => {

			request
				.delete('/2')
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
							expect(_res.body.users.length).toEqual(4);
							done();
						});
				});
		});
	});
});
