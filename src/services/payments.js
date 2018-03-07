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

	// updateDocument(id, payment) {
	// 	const url = `${this.documentURL}/document/${id}`;
	// 	console.log(`url ${url}`);
	// 	const options = {
	// 		method: 'PUT',
	// 		url,
	// 		body: { payment },
	// 		headers: { Authorization: 'allow' },
	// 		json: true,
	// 	};

	// 	return request(options);
	// }

	batchFetch(idList, callback) {
		let response;
		let error;
		const keys = [];
		idList.forEach((element) => {
			console.log(element);
			keys.push({ ID: element });
			// keys.push({ ID: { S: element } });
		});

		console.log(`${keys.length}`);
		const params = {
			RequestItems: {
				paymentsTable: {
					Keys: keys,
					ProjectionExpression: 'ID, PaymentDetail, PenaltyStatus',
				},
			},
		};

		console.log(JSON.stringify(params, null, 2));

		console.log('batchFetching paymentsTable..');

		this.db.batchGet(params, onBatch);

		function onBatch(err, data) {
			if (err) {
				error = createResponse({
					body: {
						err,
					},
					statusCode: 500,
				});
				console.log(JSON.stringify(error, null, 2));
				callback(error);
			} else {
				console.log(JSON.stringify(data, null, 2));
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

		console.log('Scanning paymentsTable..');

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
				console.log(JSON.stringify(data, null, 2));
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
				console.log(JSON.stringify(err, null, 2));
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
			const matches = penaltyReference.match(/^([0-9]{1,6})-([0-1])-([0-9]{1,6})$/);

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
				const initialOutput = '000000'.slice(initialSegment.toString().length) + initialSegment.toString();
				const middleOutput = middleSegment.toString();
				const lastOutput = '000000'.slice(lastSegment.toString().length) + lastSegment.toString();
				return `${initialOutput}${middleOutput}${lastOutput}_IM`;
			}
		} else {
			return `${penaltyReference}_${penaltyType}`;
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
		console.log(`constructedID: (${constructedID})`);
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
					console.error(error);
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

				// this.updateDocument(params.Item.ID, params.Item)
				// 	.then((documentResponse) => {
				// 		const outputResponse = JSON.stringify(documentResponse, null, 2);
				// 		console.log(`outputResponse from document update ${outputResponse}`);
				// 	});
				// TODO replace with lambda to lambda
				lambda.invoke({
					FunctionName: this.documentUpdateArn,
					Payload: `{"body": { "id": "${body.id}", "paymentStatus": "${body.PenaltyStatus}" } }`,
				}, (lambdaError, data) => {
					if (lambdaError) {
						console.log('Document service returned an error');
						console.log(JSON.stringify(lambdaError, null, 2));
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
				'#Status': 'Status',
				'#PenaltyAmount': 'PenaltyAmount',
				'#PenaltyType': 'PenaltyType',
				'#Payment': 'Payment',
			},
			ExpressionAttributeValues: {
				':Status': body.Status,
				':PenaltyAmount': body.PenaltyAmount,
				':PenaltyType': body.PenaltyType,
				':Payment': body.Payment,
			},
			UpdateExpression: 'SET #Status = :Status, #PenaltyAmount = :PenaltyAmount, #PenaltyType = :PenaltyType, #Payment = :Payment',
			ReturnValues: 'ALL_NEW',
		};

		const checkTest = this.validatePayment(body, paymentValidation);
		if (!checkTest.valid) {
			callback(null, checkTest.response);
		} else {
		// update the todo in the database
			this.db.update(params, (err, result) => {
				// handle potential errors
				if (err) {
					console.error(err);
					error = createResponse({
						message,
						statusCode: err.statusCode || 501,
						body: 'Couldn\'t fetch the payment.',
					});
					callback(error);
				}
				// create a response
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
		console.log(JSON.stringify(validationResult, null, 2));
		if (validationResult.error) {
			const err = 'Invalid Input';
			const error = createResponse({
				body: {
					err,
				},
				statusCode: 405,
			});
			return { valid: false, response: error };
		}
		return { valid: true, response: {} };
	}

}
