import { doc } from 'serverless-dynamodb-client';
import GroupPayments from '../services/groupPayments';

const groupPayments = new GroupPayments(
	doc,
	process.env.DYNAMODB_GROUP_PAYMENTS_TABLE,
	process.env.PENALTYGROUP_UPDATE_ARN,
);

export default (event, context, callback) => {

	groupPayments.deletePenaltyGroupPaymentRecord(event.pathParameters.id, callback);

};
