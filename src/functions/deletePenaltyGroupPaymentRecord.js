import { doc } from 'serverless-dynamodb-client';
import GroupPayments from '../services/groupPayments';

const groupPayments = new GroupPayments(
	doc,
	process.env.DYNAMODB_GROUP_PAYMENTS_TABLE,
	process.env.PENALTYGROUP_UPDATE_ARN,
	process.env.PENALTY_DOCS_UPDATE_ARN,
	process.env.DOCUMENTUPDATE_ARN,
);

export default (event, context, callback) => {
	const { id, type } = event.pathParameters;
	groupPayments.deletePenaltyGroupPaymentRecord(id, type, callback);

};
