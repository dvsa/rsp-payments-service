/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
import AWS from 'aws-sdk';
import Joi from 'joi';
import createResponse from '../utils/createResponse';
import paymentValidation from '../validationModels/paymentValidation';

const lambda = new AWS.Lambda({ region: 'eu-west-1' });

export default class Payments {
	constructor(db, tableName, decryptArn, documentUpdateArn) {
		this.db = db;
		this.tableName = tableName;
		this.decryptArn = decryptArn;
		this.documentUpdateArn = documentUpdateArn;
	}

	batchFetch(idList, callback) {
		let response;
		let error;
		const keys = [];
		idList.forEach((element) => {
			keys.push({ ID: element });
			// keys.push({ ID: { S: element } });
		});

		const params = {
			RequestItems: {
				paymentsTable: {
					Keys: keys,
					ProjectionExpression: 'ID, PaymentDetail, PenaltyStatus',
				},
			},
		};

		this.db.batchGet(params, onBatch);

		function onBatch(err, data) {
			if (err) {
				error = createResponse({
					body: {
						err,
					},
					statusCode: 500,
				});
				callback(error);
			} else {
				const payments = data.Responses.paymentsTable;
				// return payments
				response = createResponse({
					body: {
						payments,
					},
				});
				callback(null, response);
			}
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
				// return payments
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
			let retReference = `${penaltyReference}_${penaltyType}`;
			if (penaltyReference.length < 12 || penaltyReference.length > 13) {
				retReference = '';
			}
			return retReference;
		}

		return '';
	}

	create(body, callback) {
		let error;
		let response;

		const constructedID = `${body.PenaltyReference}_${body.PenaltyType}`; // this.constructID(body.PenaltyReference, body.PenaltyType);

		const params = {
			TableName: this.tableName,
			Item: {
				ID: constructedID,
				PenaltyStatus: body.PenaltyStatus,
				PaymentDetail: body.PaymentDetail,
			},
		};

		const checkTest = this.validatePayment(body, paymentValidation);
		if (constructedID === '') {
			const err = 'Invalid Id';
			const errorToReturn = createResponse({
				body: {
					err,
				},
				statusCode: 405,
			});
			callback(null, errorToReturn);
		} else if (!checkTest.valid) {
			callback(null, checkTest.response);
		} else {

			// write the payment to the database
			this.db.put(params, (err) => {
				// handle potential errors
				if (err) {
					console.error(JSON.stringify(err, null, 2));
					error = createResponse({
						body: {
							err,
						},
						statusCode: 500,
					});
					callback(error);
				}
				// create a response
				response = createResponse({
					body: {
						payment: params.Item,
					},
				});

				const payItem = params.Item;

				lambda.invoke({
					FunctionName: this.documentUpdateArn,
					Payload: `{"body": { "id": "${constructedID}", "paymentStatus": "${body.PenaltyStatus}", "paymentAmount": "${payItem.PaymentDetail.PaymentAmount}","penaltyRefNo": "${body.PenaltyReference}", "penaltyType":"${body.PenaltyType}" } }`,
				}, (lambdaError, data) => {
					if (lambdaError) {
						callback(null, createResponse({ statusCode: 400, error: lambdaError }));
					} else if (data.Payload) {
						callback(null, response);
					}
				});
				callback(null, response);
			});
		}

	}

	delete(id, callback) {
		let error;
		let response;

		const params = {
			TableName: this.tableName,
			Key: { ID: id },
		};

		// delete the payment from the database
		this.db.delete(params, (err) => {
			// handle potential errors
			if (err) {
				console.error(err);
				error = createResponse({
					body: 'Couldn\'t remove the payment.',
					statusCode: err.statusCode || 501,
				});
				callback(error);
			}
			// create a response
			response = createResponse({
				body: {},
			});
			callback(null, response);
		});

	}

	update(id, body, callback) {

		let message;
		let error;
		let response;
		const params = {
			TableName: this.tableName,
			Key: { ID: id },
			ExpressionAttributeNames: {
				'#PenaltyStatus': 'PenaltyStatus',
				'#PenaltyType': 'PenaltyType',
				'#PaymentDetail': 'PaymentDetail',
			},
			ExpressionAttributeValues: {
				':PenaltyStatus': body.PenaltyStatus,
				':PenaltyType': body.PenaltyType,
				':PaymentDetail': body.PaymentDetail,
			},
			UpdateExpression: 'SET #PenaltyStatus = :PenaltyStatus, #PenaltyType = :PenaltyType, #PaymentDetail = :PaymentDetail',
			ReturnValues: 'ALL_NEW',
		};

		const checkTest = this.validatePayment(body, paymentValidation);
		if (!checkTest.valid) {
			callback(null, checkTest.response);
		} else {
			this.db.update(params, (err, result) => {
				if (err) {
					error = createResponse({
						message,
						statusCode: err.statusCode || 501,
						body: 'Couldn\'t fetch the payment.',
					});
					callback(error);
				}
				response = createResponse({
					statusCode: 200,
					body: result.Attributes,
				});
				callback(null, response);
			});
		}

	}

	validatePayment(data, paymentValidationModel) {
		const validationResult = Joi.validate(data, paymentValidationModel.request);
		if (validationResult.error) {
			const err = 'Invalid Input';
			const error = createResponse({
				body: {
					err,
				},
				statusCode: 405,
			});
			return { valid: false, response: error };
		} else if (data.PenaltyReference) {
			if (!this.validatePaymentRef(data.PenaltyReference, data.PenaltyType)) {
				const err = 'Invalid Payment Reference';
				const error = createResponse({
					body: {
						err,
					},
					statusCode: 405,
				});
				return { valid: false, response: error };
			}
		}
		return { valid: true, response: {} };
	}

	validatePaymentRef(penaltyReference, penaltyType) {
		if (this.constructID(penaltyReference, penaltyType) === '') {
			return false;
		}
		return true;
	}

}

