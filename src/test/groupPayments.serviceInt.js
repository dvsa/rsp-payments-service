/* eslint-disable no-use-before-define */

import supertest from 'supertest';
import expect from 'expect';
import AWS from 'aws-sdk';

const url = 'http://localhost:3000/groupPayments';
const request = supertest(url);
const groupId = '15xk9i0xujgg';
let docClient;

describe('penaltyGroups', () => {

	before(() => {
		AWS.config.update({
			region: 'eu-west-1',
			endpoint: 'http://localhost:8000',
		});
		docClient = new AWS.DynamoDB.DocumentClient();
	});

	context('GET', () => {
		context('an individual penalty group payment record', () => {
			it('should return the payment details of the group', async () => {
				const resp = await request
					.get(`/${groupId}`)
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json; charset=utf-8');

				expect(resp.body.ID).toEqual(groupId);
				expect(resp.body.Payments.FPN.PaymentRef).toBe('REF12345');
				expect(resp.body.Payments.FPN.AuthCode).toBe('1234TBD');
				expect(resp.body.Payments.FPN.PaymentAmount).toBe(800);
				expect(resp.body.Payments.FPN.PaymentDate).toBe(1519300376667);
				expect(resp.body.Payments.FPN.PaymentStatus).toBe('UNPAID');
				expect(resp.body.Payments.IM.PaymentRef).toBe('RJF12345');
				expect(resp.body.Payments.IM.AuthCode).toBe('1234TBG');
				expect(resp.body.Payments.IM.PaymentAmount).toBe(80);
				expect(resp.body.Payments.IM.PaymentDate).toBe(1519300376667);
				expect(resp.body.Payments.IM.PaymentStatus).toBe('PAID');
			});
		});
		context('an individual penalty group payment record that doesn\'t exist', () => {
			it('should return the payment details of the group', (done) => {
				request
					.get('/doesnotexist')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.expect(404)
					.expect('Content-Type', 'application/json; charset=utf-8')
					.end((err) => {
						if (err) throw err;
						done();
					});
			});
		});
	});

	context('POST', () => {
		context('a new penalty group payment record', () => {
			it('should return created penalty group payment record with generated ID', async () => {
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
					PenaltyIds: [
						'111111111111_FPN',
						'222222222222_FPN',
					],
				};
				const response = await request
					.post('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.send(fakePenaltyGroupPaymentRecordPayload)
					.expect(201)
					.expect('Content-Type', 'application/json; charset=utf-8');

				expect(response.body.ID).toBe('12212');
				expect(response.body.Payments.FPN)
					.toEqual({
						...fakePenaltyGroupPaymentRecordPayload.PaymentDetail,
						PaymentStatus: 'PAID',
						penaltyIds: fakePenaltyGroupPaymentRecordPayload.PenaltyIds,
					});

				const singlePenaltyPayments = await getPaymentRecords(['111111111111_FPN', '222222222222_FPN']);
				expect(singlePenaltyPayments).toHaveLength(2);
				expect(singlePenaltyPayments).toContainEqual({
					ID: '111111111111_FPN',
					PenaltyStatus: 'PAID',
					PaymentDetail: {
						PaymentRef: 'receipt_reference',
						AuthCode: 'auth_code',
						PaymentAmount: 120,
						PaymentDate: 1533200397,
						PaymentMethod: 'CARD',
					},
					PenaltyGroupId: '12212',
				});
				expect(singlePenaltyPayments).toContainEqual({
					ID: '222222222222_FPN',
					PenaltyStatus: 'PAID',
					PaymentDetail: {
						PaymentRef: 'receipt_reference',
						AuthCode: 'auth_code',
						PaymentAmount: 120,
						PaymentDate: 1533200397,
						PaymentMethod: 'CARD',
					},
					PenaltyGroupId: '12212',
				});
			});
		});

		context('a new IM payment for an existing penalty group payment record', () => {
			it('should return extended penalty group payment record with generated ID', async () => {
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
					PenaltyIds: [
						'333333333333_IM',
					],
				};
				const response = await request
					.post('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.send(fakePenaltyGroupPaymentRecordPayload)
					.expect(200)
					.expect('Content-Type', 'application/json; charset=utf-8');

				expect(response.body)
					.toEqual({
						...fakePenaltyGroupPaymentRecordPayload.PaymentDetail,
						PaymentStatus: 'PAID',
					});

				const singlePenaltyPayments = await getPaymentRecords(['333333333333_IM']);
				expect(singlePenaltyPayments).toEqual([
					{
						ID: '333333333333_IM',
						PenaltyStatus: 'PAID',
						PaymentDetail: {
							PaymentRef: 'receipt_reference',
							AuthCode: 'auth_code',
							PaymentAmount: 80,
							PaymentDate: 1533200397,
							PaymentMethod: 'CARD',
						},
						PenaltyGroupId: '12212',
					},
				]);
			});
		});

		context('an IM payment for an existing penalty group payment record with an existing IM payment', () => {
			it('should respond 400 indicating that a payment of that payment code + type already exists', (done) => {
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
					PenaltyIds: [
						'111111111111_IM',
					],
				};
				request
					.post('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.send(fakePenaltyGroupPaymentRecordPayload)
					.expect(400)
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.err).toBe('Payment for IM already exists in 12212 payment group');
						done();
					});
			});
		});

		context('a new penalty group payment record with an invalid penalty type', () => {
			it('respond 400 indicating the permitted penalty types', (done) => {
				const fakePenaltyGroupPaymentRecordPayload = {
					PaymentCode: '123432jkew',
					PenaltyType: 'INVALID',
					PaymentDetail: {
						PaymentMethod: 'CARD',
						PaymentRef: 'receipt_reference',
						AuthCode: 'auth_code',
						PaymentAmount: 120,
						PaymentDate: 1533200397,
					},
					PenaltyIds: [
						'111111111111_IM',
					],
				};
				request
					.post('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.send(fakePenaltyGroupPaymentRecordPayload)
					.expect(400)
					.expect('Content-Type', 'application/json; charset=utf-8')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.err).toBe('Invalid penalty type INVALID, must be either FPN, IM or CDN');
						done();
					});
			});
		});
	});

});

async function getPaymentRecords(penaltyIds) {
	const penaltyIdKeyObjs = penaltyIds.map(id => ({ ID: id }));
	const batchGetParams = {
		RequestItems: {
			paymentsTable: {
				Keys: penaltyIdKeyObjs,
			},
		},
	};
	const batchGetResp = await docClient.batchGet(batchGetParams).promise();
	return batchGetResp.Responses.paymentsTable;
}
