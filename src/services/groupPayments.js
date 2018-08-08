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

	createPenaltyGroupPaymentRecord(body, callback) {
		let error;
		let response;

		if (body.PaymentCode === '') {
			const err = 'Invalid Id';
			const errorToReturn = createResponse({
				body: {
					err,
				},
				statusCode: 400,
			});
			callback(null, errorToReturn);
		}

		const paymentDetail = {
			...body.PaymentDetail,
			PaymentStatus: 'PAID',
		};

		const putParams = {
			TableName: this.tableName,
			Item: {
				ID: body.PaymentCode,
				Payments: {
					[body.PenaltyType]: paymentDetail,
				},
			},
		};

		const getParams = {
			TableName: this.tableName,
			Key: { ID: body.PaymentCode },
		};
		this.db.get(getParams).promise()
			.then((data) => {
				if (isEmptyObject(data)) {
					// Create a new record if item doesn't exist
					this.db.put(putParams).promise()
						.then(() => {
							response = createResponse({
								body: { payment: putParams.Item },
								statusCode: 201,
							});
							GroupPayments.updatePenaltyGroupPaymentRecord(
								body.PaymentCode,
								body.PaymentStatus,
								callback,
							);
							callback(null, response);
						})
						.catch((_err) => {
							error = createResponse({
								body: { _err },
								statusCode: 500,
							});
							callback(null, error);
						});
				} else {
					// Update existing item
					const item = data.Item[body.PenaltyType];
					// Return 400 bad request if payment already exists
					if (typeof item !== 'undefined' && !isEmptyObject(item)) {
						callback(null, createResponse({
							statusCode: 400,
							body: new Error(`Payment for ${body.PenaltyType} already exists`),
						}));
						return;
					}
					data.Item.Payments[body.PenaltyType] = paymentDetail;
					const putUpdateParams = {
						TableName: this.tableName,
						Item: data.Item,
						ConditionExpression: 'attribute_exists(#ID)',
						ExpressionAttributeNames: {
							'#ID': 'ID',
						},
					};
					this.db.put(putUpdateParams).promise()
						.then(() => callback(null, createResponse({ statusCode: 200, body: paymentDetail })))
						.catch((err) => {
							error = createResponse({
								body: { err },
								statusCode: 500,
							});
							callback(null, error);
						});
				}
			})
			// Catch for initial db.get
			.catch((err) => {
				error = createResponse({
					body: { err },
					statusCode: 500,
				});
				callback(null, error);
			});

	}

	getPenaltyGroupPaymentRecord(id, callback) {
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

	static updatePenaltyGroupPaymentRecord(id, paymentSatus, callback) {
		lambda.invoke({
			FunctionName: this.updatePenaltyGroupPaymentRecordArn,
			Payload: `{"body": { "id": "${id}", "paymentStatus": "${paymentSatus}" } }`,
		})
			.promise()
			.then(lambdaResponse => callback(null, lambdaResponse))
			.catch(lambdaError => callback(null, createResponse({
				statusCode: 400,
				error: lambdaError,
			})));
	}

}
