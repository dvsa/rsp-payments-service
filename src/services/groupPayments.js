import createResponse from '../utils/createResponse';

export default class GroupPayments {
	constructor(db, tableName) {
		this.db = db;
		this.tableName = tableName;
	}

	createGroupPaymentRecord(body, callback) {
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
				statusCode: 405,
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
				});

				// TODO: Penalty group document Lambda invocation

				callback(null, response);
			});
		}

	}

}
