import { doc } from 'serverless-dynamodb-client';
import GroupPayments from '../services/groupPayments';
import createResponse from '../utils/createResponse';
import isEmptyObject from '../utils/isEmptyObject';

const payments = new GroupPayments(
	doc,
	process.env.DYNAMODB_GROUP_PAYMENTS_TABLE,
	process.env.PENALTYGROUP_UPDATE_ARN,
	process.env.PENALTY_DOCS_UPDATE_ARN,
	process.env.DOCUMENTUPDATE_ARN,
);

export default async (event) => {
	try {
		const record = await payments.getPenaltyGroupPaymentRecord(event.pathParameters.id);
		if (isEmptyObject(record)) {
			throw createResponse({ statusCode: 404 });
		}
		return createResponse({ statusCode: 200, body: record });
	} catch (err) {
		if (err.statusCode) {
			return err;
		}
		return createResponse({ statusCode: 500, body: err });
	}
};
