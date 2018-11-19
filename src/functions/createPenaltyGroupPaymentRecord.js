import { doc } from 'serverless-dynamodb-client';
import GroupPayments from '../services/groupPayments';
import createResponse from '../utils/createResponse';

const payments = new GroupPayments(
	doc,
	process.env.DYNAMODB_GROUP_PAYMENTS_TABLE,
	process.env.PENALTY_DOCS_UPDATE_ARN,
	process.env.DOCUMENTUPDATE_ARN,
);

export default (event, context, callback) => {

	const data = JSON.parse(event.body);

	try {
		payments.createPenaltyGroupPaymentRecord(data, callback);
	} catch (err) {
		if (err.statusCode) {
			callback(null, err);
		} else {
			callback(null, createResponse({ statusCode: 500, body: err }));
		}
	}

};
