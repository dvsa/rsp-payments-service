/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
import Joi from 'joi';
import createResponse from '../utils/createResponse';
import paymentValidation from '../validationModels/paymentValidation';

export default class Payments {

	constructor(db, tableName, decryptArn) {
		this.db = db;
		this.tableName = tableName;
		this.decryptArn = decryptArn;
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

	create(body, callback) {
		let error;
		let response;
		const timestamp = new Date().getTime();

		const params = {
			TableName: this.tableName,
			Item: {
				ID: body.ID,
				Status: body.Status,
				PenaltyAmount: body.PenaltyAmount,
				PenaltyType: body.PenaltyType,
				Payment: body.Payment,
				date: timestamp,
			},
		};

		const checkTest = this.validatePayment(body, paymentValidation);
		if (!checkTest.valid) {
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

		const timestamp = new Date().getTime();

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
				':updatedAt': timestamp,
			},
			UpdateExpression: 'SET #Status = :Status, #PenaltyAmount = :PenaltyAmount, #PenaltyType = :PenaltyType, #Payment = :Payment, updatedAt = :updatedAt',
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
