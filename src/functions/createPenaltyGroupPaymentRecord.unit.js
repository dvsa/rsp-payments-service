import expect from 'expect';
import sinon from 'sinon';
import GroupPayments from '../services/groupPayments';

import createPenaltyGroupPaymentRecord from './createPenaltyGroupPaymentRecord';
import createResponse from '../utils/createResponse';
import groupPayments from '../../mock-data/fake-group-payments.json';

describe('createPenaltyGroupPaymentRecord', () => {

	let event;
	let payment;
	let createPenaltyGroupPaymentRecordStub;

	afterEach(() => {
		event = null;
	});

	beforeEach(() => {
		event = {
			httpMethod: 'POST',
			body: '{"PaymentCode":"12212","PenaltyType":"FPN","PaymentDetail":{"PaymentMethod":"CARD","PaymentRef":"receipt_reference","AuthCode":"auth_code","PaymentAmount":120,"PaymentDate":1533200397}}',
		};
		payment = groupPayments.filter(item => item.ID === '15xk9i0xujgg');
		createPenaltyGroupPaymentRecordStub = sinon.stub(GroupPayments.prototype, 'createPenaltyGroupPaymentRecord').callsFake((id, callback) => {
			const response = createResponse({
				body: payment,
			});
			callback(null, response);
		});
	});

	describe('when a specific payment is requested', () => {

		it('should return a 200 success with the correct payment', (done) => {

			createPenaltyGroupPaymentRecord(event, null, (err, res) => {
				expect(err).toBe(null);
				expect(res.statusCode).toBe(200);
				expect(createPenaltyGroupPaymentRecordStub.called).toBe(true);
				expect(JSON.parse(res.body)).toEqual(payment);
				done();
			});

		});

	});

});
