/* eslint-disable no-use-before-define */

import supertest from 'supertest';
import expect from 'expect';
import AWS from 'aws-sdk';

const url = 'http://localhost:3000/groupPayments';
const request = supertest(url);
const groupId = '15xef9lt3bbb';

describe('penaltyGroups', () => {

	before(() => {
		AWS.config.update({
			region: 'eu-west-1',
			endpoint: 'http://localhost:8000',
		});
	});

	context('GET', () => {
		context('an individual penalty group payment record', () => {
			it('should return the payment details of the group', (done) => {
				request
					.get(`/${groupId}`)
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.payment.ID).toEqual(groupId);
						expect(res.body.payment.PaymentDetail.PaymentRef).toBe('RHF12345');
						expect(res.body.payment.PaymentDetail.AuthCode).toBe('1234BBB');
						expect(res.body.payment.PaymentDetail.PaymentAmount).toBe(400);
						expect(res.body.payment.PaymentDetail.PaymentDate).toBe(1519300376667);
						done();
					});
			});
		});
	});

	context('POST', () => {
		context('a new penalty group payment record', () => {
			it('should return created penalty group payment record with generated ID', (done) => {
				const fakePenaltyGroupPaymentRecordPayload = {
					PaymentCode: '12212',
					PenaltyType: 'FPN',
					PaymentDetail: {
						PaymentMethod: 'CARD',
						PaymentRef: 'receipt_reference',
						AuthCode: 'auth_code',
						PaymentAmount: 120,
						PaymentDate: 1533200397,
					},
				};
				request
					.post('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.send(fakePenaltyGroupPaymentRecordPayload)
					.expect(201)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						console.log(res.body);
						if (err) throw err;
						expect(res.body.payment.ID).toBe('12212');
						expect(res.body.payment.PaymentDetail).toEqual(fakePenaltyGroupPaymentRecordPayload.PaymentDetail);
						done();
					});
			});
		});
	});

});

