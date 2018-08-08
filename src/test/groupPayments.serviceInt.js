/* eslint-disable no-use-before-define */

import supertest from 'supertest';
import expect from 'expect';
import AWS from 'aws-sdk';

const url = 'http://localhost:3000/groupPayments';
const request = supertest(url);
const groupId = '15xk9i0xujgg';

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
						expect(res.body.ID).toEqual(groupId);
						expect(res.body.Payments.FPN.PaymentRef).toBe('REF12345');
						expect(res.body.Payments.FPN.AuthCode).toBe('1234TBD');
						expect(res.body.Payments.FPN.PaymentAmount).toBe('800');
						expect(res.body.Payments.FPN.PaymentDate).toBe(1519300376667);
						expect(res.body.Payments.FPN.PaymentStatus).toBe('UNPAID');
						expect(res.body.Payments.IM.PaymentRef).toBe('RJF12345');
						expect(res.body.Payments.IM.AuthCode).toBe('1234TBG');
						expect(res.body.Payments.IM.PaymentAmount).toBe('80');
						expect(res.body.Payments.IM.PaymentDate).toBe(1519300376667);
						expect(res.body.Payments.IM.PaymentStatus).toBe('PAID');
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
						if (err) throw err;
						expect(res.body.ID).toBe('12212');
						expect(res.body.Payments.FPN)
							.toEqual({
								...fakePenaltyGroupPaymentRecordPayload.PaymentDetail,
								PaymentStatus: 'PAID',
							});
						done();
					});
			});
		});

		context('a new IM payment for an existing penalty group payment record', () => {
			it('should return created penalty group payment record with generated ID', (done) => {
				const fakePenaltyGroupPaymentRecordPayload = {
					PaymentCode: '12212',
					PenaltyType: 'IM',
					PaymentDetail: {
						PaymentMethod: 'CARD',
						PaymentRef: 'receipt_reference',
						AuthCode: 'auth_code',
						PaymentAmount: 80,
						PaymentDate: 1533200397,
					},
				};
				request
					.post('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.send(fakePenaltyGroupPaymentRecordPayload)
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.ID).toBe('12212');
						expect(res.body.Payments.FPN)
							.toEqual({
								...fakePenaltyGroupPaymentRecordPayload.PaymentDetail,
								PaymentStatus: 'PAID',
							});
						done();
					});
			});
		});

		context('an IM payment for an existing penalty group payment record with an existing IM payment', () => {
			it('should return created penalty group payment record with generated ID', (done) => {
				const fakePenaltyGroupPaymentRecordPayload = {
					PaymentCode: '12212',
					PenaltyType: 'IM',
					PaymentDetail: {
						PaymentMethod: 'CARD',
						PaymentRef: 'receipt_reference',
						AuthCode: 'auth_code',
						PaymentAmount: 80,
						PaymentDate: 1533200397,
					},
				};
				request
					.post('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.send(fakePenaltyGroupPaymentRecordPayload)
					.expect(400)
					.end((err, res) => {
						if (err) throw err;
						expect(res.body).toBe('Payment for IM already exists in 12212 payment group');
						done();
					});
			});
		});
	});

});

