import createResponse from '../utils/createResponse';

export default class GroupPayments {
	constructor(db, tableName, updatePenaltyGroupPaymentRecord) {
		this.db = db;
		this.tableName = tableName;
		this.updatePenaltyGroupPaymentRecord = updatePenaltyGroupPaymentRecord;
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

				// TODO: Penalty group document update Lambda invocation

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
