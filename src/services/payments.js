/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
import AWS from 'aws-sdk';
import Validation from 'rsp-validation';
import createResponse from '../utils/createResponse';

const lambda = new AWS.Lambda({ region: 'eu-west-1' });

export default class Payments {
	constructor(db, tableName, decryptArn, documentUpdateArn, documentDeleteArn) {
		this.db = db;
		this.tableName = tableName;
		this.decryptArn = decryptArn;
		this.documentUpdateArn = documentUpdateArn;
		this.documentDeleteArn = documentDeleteArn;
	}

	async batchFetch(idList) {
		const keys = [];
		idList.forEach((element) => {
			keys.push({ ID: element });
		});

		const params = {
			RequestItems: {
				[process.env.DYNAMODB_PAYMENTS_TABLE]: {
					Keys: keys,
					ProjectionExpression: 'ID, PaymentDetail, PenaltyStatus',
				},
			},
		};

		try {
			const data = this.db.batchGet(params).promise();
			const payments = data.Responses[process.env.DYNAMODB_PAYMENTS_TABLE];

			return createResponse({
				body: {
					payments,
				},
			});
		} catch (err) {
			console.log(err);
			return createResponse({
				body: { err },
				statusCode: 500,
			});
		}
	}

	list(callback) {
		let response;
		let error;

		const params = {
			TableName: this.tableName,
		};

		this.db.scan(params, onScan);

		function onScan(err, data) {
			if (err) {
				error = createResponse({
					body: {
						err,
					},
					statusCode: 500,
				});
				callback(error);
			} else {
				const payments = data.Items;

				response = createResponse({
					body: {
						payments,
					},
				});
				callback(null, response);
			}
		}

	}

	get(id, callback) {
		let error;
		let response;

		const params = {
			TableName: this.tableName,
			Key: { ID: id },
		};

		this.db.get(params, (err, data) => {

			if (err) {
				error = createResponse({
					body: {
						err,
					},
					statusCode: 500,
				});
				callback(error);
			} else {
				const payment = data.Item;
				response = createResponse({
					body: {
						payment,
					},
				});
				callback(null, response);
			}
		});

	}

	constructID(penaltyReference, penaltyType) {
		if (typeof penaltyReference === 'undefined' || typeof penaltyType === 'undefined') {
			return '';
		}

		if (penaltyType === 'IM') {
			const matches = penaltyReference.match(/^([0-9]{6})([0-1])([0-9]{6})$/);

			let initialSegment = 0;
			let lastSegment = 0;
			let middleSegment = 0;

			if (matches === null) {
				return '';
			}
			if (matches.length > 3) {
				initialSegment = Number(matches[1]);
				middleSegment = Number(matches[2]);
				lastSegment = Number(matches[3]);
				if (initialSegment === 0 || lastSegment === 0 || (middleSegment > 1 || middleSegment < 0)) {
					return '';
				}
				return `${penaltyReference}_IM`;
			}
		} else {
			const matches = penaltyReference.match(/^([0-9]{12,13})$/);
			if (matches === null) {
				return '';
			}
			return `${penaltyReference}_${penaltyType}`;
		}

		return '';
	}

	async create(body) {
		const constructedID = `${body.PenaltyReference}_${body.PenaltyType}`;
		const params = {
			TableName: this.tableName,
			Item: {
				ID: constructedID,
				PenaltyStatus: body.PenaltyStatus,
				PaymentDetail: body.PaymentDetail,
			},
		};

		const bodyToValidate = {
			PenaltyStatus: body.PenaltyStatus,
			PenaltyType: body.PenaltyType,
			PenaltyReference: body.PenaltyReference,
			PaymentDetail: body.PaymentDetail,
		};
		// body.PaymentDetail.paymentCode
		const checkTest = Validation.paymentValidation(bodyToValidate);

		if (!checkTest.valid) {
			const err = checkTest.error.message;
			const validationError = createResponse({
				body: {
					err,
				},
				statusCode: 405,
			});
			return validationError;
		}

		try {
			await this.db.put(params);
		} catch (err) {
			return createResponse({
				body: {
					err,
				},
				statusCode: 500,
			});
		}

		const payItem = params.Item;

		try {
			await lambda.invoke({
				FunctionName: this.documentUpdateArn,
				Payload: `{"body": { "id": "${constructedID}", "paymentStatus": "${body.PenaltyStatus}", "paymentAmount": "${payItem.PaymentDetail.PaymentAmount}","penaltyRefNo": "${body.PenaltyReference}", "penaltyType":"${body.PenaltyType}", "paymentToken":"${body.PaymentCode}" } }`,
			}).promise();
			return createResponse({
				body: {
					payment: payItem,
				},
			});
		} catch (lambdaError) {
			return createResponse({ statusCode: 400, error: lambdaError });
		}
	}

	deletePaymentOnly(id) {
		const params = {
			TableName: this.tableName,
			Key: { ID: id },
		};

		return this.db.delete(params).promise();
	}

	async delete(id) {
		let error;

		const params = {
			TableName: this.tableName,
			Key: { ID: id },
			ReturnValues: 'ALL_OLD',
		};

		let data;
		try {
			data = await this.db.delete(params).promise();
		} catch (err) {
			error = createResponse({
				body: "Couldn't remove the payment.",
				statusCode: err.statusCode || 501,
			});
			return error;
		}

		const deletedData = data.Attributes;
		const paymentInfo = {
			PenaltyStatus: deletedData.PenaltyStatus,
			PenaltyType: deletedData.PenaltyType,
			PenaltyReference: deletedData.PenaltyReference,
			PaymentDetail: deletedData.PaymentDetail,
		};

		const response = createResponse({
			body: {},
		});

		if (paymentInfo.PenaltyStatus === 'PAID') {
			try {
				const externalData = await lambda.invoke({
					FunctionName: this.documentDeleteArn,
					Payload: `{"body": { "id": "${id}", "paymentStatus": "UNPAID", "paymentAmount": "${paymentInfo.PaymentDetail.PaymentAmount}","penaltyRefNo": "${paymentInfo.PenaltyReference}", "penaltyType":"${paymentInfo.PenaltyType}", "paymentToken":"${paymentInfo.PaymentCode}" } }`,
				}).promise();

				if (externalData.Payload) {
					return response;
				}
				return createResponse({ statusCode: 400 });
			} catch (lambdaError) {
				return createResponse({ statusCode: 400, error: lambdaError });
			}
		}
		return response;
	}

	update(id, body, callback) {

		let error;
		let response;
		const params = {
			TableName: this.tableName,
			Key: { ID: id },
			ExpressionAttributeNames: {
				'#PenaltyStatus': 'PenaltyStatus',
				'#PenaltyType': 'PenaltyType',
				'#PaymentDetail': 'PaymentDetail',
				'#ID': 'ID',
			},
			ExpressionAttributeValues: {
				':PenaltyStatus': body.PenaltyStatus,
				':PenaltyType': body.PenaltyType,
				':PaymentDetail': body.PaymentDetail,
			},
			UpdateExpression: 'SET #PenaltyStatus = :PenaltyStatus, #PenaltyType = :PenaltyType, #PaymentDetail = :PaymentDetail',
			ConditionExpression: 'attribute_exists(#ID) AND #PenaltyStatus <> :PenaltyStatus',
			ReturnValues: 'ALL_NEW',
		};
		const checkTest = Validation.paymentValidation(body);

		if (!checkTest.valid) {
			const err = checkTest.error.message;
			const validationError = createResponse({
				body: {
					err,
				},
				statusCode: 405,
			});
			callback(null, validationError);
		} else {
			this.db.update(params, (err, result) => {
				if (err) {
					error = createResponse({
						body: {
							err: 'Failed to update payment',
						},
						statusCode: 500,
					});
					callback(null, error);
				} else {
					response = createResponse({
						statusCode: 200,
						body: result.Attributes,
					});
					callback(null, response);
				}
			});
		}

	}
}

