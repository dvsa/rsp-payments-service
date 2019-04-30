import { doc } from 'serverless-dynamodb-client';
import GroupPayments from '../services/groupPayments';
import createResponse from '../utils/createResponse';

const payments = new GroupPayments(
	doc,
	process.env.DYNAMODB_GROUP_PAYMENTS_TABLE,
	process.env.PENALTYGROUP_UPDATE_ARN,
	process.env.PENALTY_DOCS_UPDATE_ARN,
	process.env.DOCUMENTUPDATE_ARN,
);

export default (event) => {

	const data = JSON.parse(event.body);

	try {
		return payments.createPenaltyGroupPaymentRecord(data);
	} catch (err) {
		if (err.statusCode) {
			return err;
		}
		return createResponse({ statusCode: 500, body: err });
	}

};
