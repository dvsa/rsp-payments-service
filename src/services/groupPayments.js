import createResponse from '../utils/createResponse';
import { Lambda } from 'aws-sdk';

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

		const params = {
			TableName: this.tableName,
			Item: {
				ID: body.PaymentCode,
				PaymentDetail: body.PaymentDetail,
			},
		};

		if (body.PaymentCode === '') {
			const err = 'Invalid Id';
			const errorToReturn = createResponse({
				body: {
					err,
				},
				statusCode: 400,
			});
			callback(null, errorToReturn);
		} else {
			this.db.put(params, (err) => {
				if (err) {
					error = createResponse({
						body: {
							err,
						},
						statusCode: 500,
					});
					callback(null, error);
				}

				response = createResponse({
					body: {
						payment: params.Item,
					},
					statusCode: 201,
				});

				lambda.invoke({
					FunctionName: this.updatePenaltyGroupPaymentRecordArn,
					Payload: `{"body": { "id": "${body.PaymentCode}", "paymentStatus": "${body.PenaltyStatus}" } }`,
				})
					.promise()
					.then(lambdaResponse => callback(null, lambdaResponse))
					.catch(lambdaError => callback(null, createResponse({
						statusCode: 400,
						error: lambdaError,
					})));
				callback(null, response);
			});
		}

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

}
