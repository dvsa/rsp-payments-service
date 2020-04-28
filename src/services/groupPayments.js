// @ts-check
import { Lambda } from 'aws-sdk';
import createResponse from '../utils/createResponse';
import isEmptyObject from '../utils/isEmptyObject';
import { logInfo, logError } from '../utils/logger';

const lambda = new Lambda({ region: 'eu-west-1' });
export default class GroupPayments {
	constructor(
		db, tableName, updatePenaltyGroupPaymentRecordArn, updateMultiplePenaltyDocumentsArn,
		documentUpdateArn,
	) {
		this.db = db;
		this.tableName = tableName;
		this.updateMultiplePenaltyDocumentsArn = updateMultiplePenaltyDocumentsArn;
		this.updatePenaltyGroupPaymentRecordArn = updatePenaltyGroupPaymentRecordArn;
		this.documentUpdateArn = documentUpdateArn;
	}

	async createPenaltyGroupPaymentRecord(body) {
		const validationResponse = GroupPayments.tryGenerateValidationErrorResponse(body);
		if (validationResponse) {
			return validationResponse;
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
				resp = await this._createNewGroupPayment(PaymentCode, PenaltyType, paidPayment, PenaltyIds);
			} else {
				resp = await this._extendGroupPayment(
					PaymentCode,
					paidPayment,
					PenaltyType,
					groupPayment,
					PenaltyIds,
				);
			}

			await Promise.all([
				this._applyPaymentToPenaltyGroup(PaymentCode, paidPayment.PaymentStatus, PenaltyType),
				this._createIndividualPaymentRecords(PenaltyIds, PaymentDetail, PaymentCode),
			]);

			logInfo('CreateGroupPaymentRecordSuccess', {
				paymentCode: PaymentCode,
				penaltyType: PenaltyType,
			});

			return resp;
		} catch (err) {
			logError('CreateGroupPaymentRecordError', {
				paymentCode: PaymentCode,
				penaltyType: PenaltyType,
				error: err.message,
			});
			if (err.statusCode) {
				return err;
			}
			return createResponse({ statusCode: 500 });
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

	async deletePenaltyGroupPaymentRecord(id, type) {
		console.info('TYPE', type);
		let error;
		let response;
		logInfo('DeleteGroupPaymentRecord', {
			id,
			type,
		});

		const createPutUpdateParams = item => ({
			TableName: this.tableName,
			Item: item,
			ConditionExpression: 'attribute_exists(#ID)',
			ExpressionAttributeNames: {
				'#ID': 'ID',
			},
		});

		const createDeleteParams = deleteId => ({
			TableName: this.tableName,
			Key: { ID: deleteId },
			ReturnValues: 'ALL_OLD',
		});

		try {
			const penaltyGroupPaymentRecord = await this.getPenaltyGroupPaymentRecord(id);
			console.info('PENALTY GROUP RECORD', penaltyGroupPaymentRecord);
			const { PaymentAmount, penaltyIds } = penaltyGroupPaymentRecord.Payments[type];
			const logMessage = {
				id,
				type,
				penaltyIds,
				paymentAmount: PaymentAmount,
			};
			logInfo('DeleteGroupPaymentRecordChildren', logMessage);

			delete penaltyGroupPaymentRecord.Payments[type];
			// Delete the entire item if there are no other payments
			if (isEmptyObject(penaltyGroupPaymentRecord.Payments)) {
				await this.db.delete(createDeleteParams(id)).promise();
				// Need to update the document with the new payment status
				await this._createMultipleDocumentUpdateInvocation(penaltyIds);
				response = createResponse({ body: {} });
				logInfo('DeleteGroupPaymentRecordAllUnpaidSuccess', logMessage);
				return { response, penaltyIds };
			}
			// Otherwise just update the Payments object
			await this.db.put(createPutUpdateParams(penaltyGroupPaymentRecord)).promise();
			// Need to update the document(s) with the new payment status
			await this._createMultipleDocumentUpdateInvocation(penaltyIds);
			response = createResponse({ body: penaltyGroupPaymentRecord });

			logInfo('DeleteGroupPaymentRecordChildrenSuccess', logMessage);

			return { response, penaltyIds };
		} catch (err) {
			logError('', {
				id,
				type,
				message: 'Error deleting penalty group payment record',
				error: err.message,
			});
			error = createResponse({
				body: `Couldn't remove the payment of type: ${type}, for code ${id}`,
				statusCode: err.statusCode || 501,
			});
			return { response: error };
		}
	}

	_createMultipleDocumentUpdateInvocation(penaltyReferences) {
		const payload = {
			body: {
				penaltyDocumentIds: penaltyReferences,
			},
		};

		return lambda.invoke({
			FunctionName: this.updateMultiplePenaltyDocumentsArn,
			Payload: JSON.stringify(payload),
		}).promise();
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

	async _createNewGroupPayment(paymentCode, penaltyType, paymentDetail, penaltyIds) {
		try {
			// Create a new record if item doesn't exist
			const putParams = {
				TableName: this.tableName,
				Item: {
					ID: paymentCode,
					Payments: {
						[penaltyType]: {
							...paymentDetail,
							penaltyIds,
						},
					},
				},
			};
			await this.db.put(putParams).promise();
			return createResponse({ body: putParams.Item, statusCode: 201 });
		} catch (err) {
			throw createResponse({ body: 'Error creating new group payment record', statusCode: 500 });
		}
	}

	async _extendGroupPayment(paymentCode, paymentDetail, penaltyType, existingPayment, penaltyIds) {
		const paymentForType = existingPayment.Payments[penaltyType];
		if (typeof paymentForType !== 'undefined' && !isEmptyObject(paymentForType)) {
			const msg = `Payment for ${penaltyType} already exists in ${paymentCode} payment group`;
			throw GroupPayments.create400Response(msg);
		}
		existingPayment.Payments[penaltyType] = {
			...paymentDetail,
			penaltyIds,
		};
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
		logInfo('InvokeUpdatePenaltyGroupPaymentRecord', {
			id,
			paymentStatus,
			penaltyType,
		});
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
