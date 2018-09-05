import { Lambda } from 'aws-sdk';
import createResponse from '../utils/createResponse';
import isEmptyObject from '../utils/isEmptyObject';

const lambda = new Lambda({ region: 'eu-west-1' });
export default class GroupPayments {
	constructor(db, tableName, updatePenaltyGroupPaymentRecordArn) {
		this.db = db;
		this.tableName = tableName;
		this.updatePenaltyGroupPaymentRecordArn = updatePenaltyGroupPaymentRecordArn;
	}

	async createPenaltyGroupPaymentRecord(body, callback) {
		const validationResponse = GroupPayments.tryGenerateValidationErrorResponse(body);
		if (validationResponse) {
			return callback(null, validationResponse);
		}

		const {
			PaymentDetail,
			PenaltyType,
			PaymentCode,
			PenaltyIds,
		} = body;
		const paidPayment = {
			...PaymentDetail,
			PaymentStatus: 'PAID',
		};

		try {
			const groupPayment = await this.getPenaltyGroupPaymentRecord(PaymentCode);
			let resp;
			if (isEmptyObject(groupPayment)) {
				resp = await this._createNewGroupPayment(PaymentCode, PenaltyType, paidPayment);
			} else {
				resp = await this._extendGroupPayment(PaymentCode, paidPayment, PenaltyType, groupPayment);
			}

			await Promise.all([
				this._applyPaymentToPenaltyGroup(PaymentCode, paidPayment.PaymentStatus, PenaltyType),
				this._createIndividualPaymentRecords(PenaltyIds, PaymentDetail, PaymentCode),
			]);

			return callback(null, resp);
		} catch (err) {
			console.log(err);
			if (err.statusCode) {
				return callback(null, err);
			}
			return callback(null, createResponse(null, { statusCode: 500 }));
		}
	}

	async getPenaltyGroupPaymentRecord(id) {
		const params = {
			TableName: this.tableName,
			Key: { ID: id },
		};
		const resp = await this.db.get(params).promise();
		return resp.Item || {};
	}

	async _createIndividualPaymentRecords(penaltyIds, paymentDetail, paymentCode) {
		try {
			const singlePaymentPutRequests = penaltyIds.map(id => ({
				PutRequest: {
					Item: {
						ID: id,
						PenaltyStatus: 'PAID',
						PaymentDetail: paymentDetail,
						PenaltyGroupId: paymentCode,
					},
				},
			}));
			const singlePaymentsParams = {
				RequestItems: {
					[process.env.DYNAMODB_PAYMENTS_TABLE]: singlePaymentPutRequests,
				},
			};
			return this.db.batchWrite(singlePaymentsParams).promise();
		} catch (err) {
			throw new Error(`Error batchWriting individual payment records: ${err}`);
		}
	}

	async _createNewGroupPayment(paymentCode, penaltyType, paymentDetail) {
		try {
			console.log('Create a new record if item doesn\'t exist');
			const putParams = {
				TableName: this.tableName,
				Item: {
					ID: paymentCode,
					Payments: {
						[penaltyType]: paymentDetail,
					},
				},
			};
			await this.db.put(putParams).promise();
			return createResponse({ body: putParams.Item, statusCode: 201 });
		} catch (err) {
			throw createResponse({ body: 'Error creating new group payment record', statusCode: 500 });
		}
	}

	async _extendGroupPayment(paymentCode, paymentDetail, penaltyType, existingPayment) {
		const paymentForType = existingPayment.Payments[penaltyType];
		if (typeof paymentForType !== 'undefined' && !isEmptyObject(paymentForType)) {
			const msg = `Payment for ${penaltyType} already exists in ${paymentCode} payment group`;
			throw GroupPayments.create400Response(msg);
		}
		existingPayment.Payments[penaltyType] = paymentDetail;
		const putUpdateParams = {
			TableName: this.tableName,
			Item: existingPayment,
			ConditionExpression: 'attribute_exists(#ID)',
			ExpressionAttributeNames: {
				'#ID': 'ID',
			},
		};
		await this.db.put(putUpdateParams).promise();
		return createResponse({ statusCode: 200, body: paymentDetail });
	}

	async _applyPaymentToPenaltyGroup(id, paymentStatus, penaltyType) {
		console.log(`Invoke updatePenaltyGroupPaymentRecord, args: ${id}, ${paymentStatus}, ${penaltyType}`);
		return lambda.invoke({
			FunctionName: this.updatePenaltyGroupPaymentRecordArn,
			Payload: `{"body": { "id": "${id}", "paymentStatus": "${paymentStatus}", "penaltyType": "${penaltyType}" } }`,
		}).promise();
	}

	static create400Response(err) {
		return createResponse({
			body: { err },
			statusCode: 400,
		});
	}

	static tryGenerateValidationErrorResponse(body) {
		if (body.PaymentCode === '') {
			return GroupPayments.create400Response('Invalid Id');
		}
		if (!['FPN', 'IM', 'CDN'].includes(body.PenaltyType)) {
			const err = `Invalid penalty type ${body.PenaltyType}, must be either FPN, IM or CDN`;
			return GroupPayments.create400Response(err);
		}
		return null;
	}
}
