import { doc } from 'serverless-dynamodb-client';
import GroupPayments from '../services/groupPayments';
import Payments from '../services/payments';

const groupPayments = new GroupPayments(
	doc,
	process.env.DYNAMODB_GROUP_PAYMENTS_TABLE,
	process.env.PENALTYGROUP_UPDATE_ARN,
	process.env.PENALTY_DOCS_UPDATE_ARN,
	process.env.DOCUMENTUPDATE_ARN,
);

const payments = new Payments(
	doc,
	process.env.DYNAMODB_PAYMENTS_TABLE,
	process.env.DECRYPT_ARN,
	process.env.DOCUMENTUPDATE_ARN,
	process.env.DOCUMENTDELETE_ARN,
);

function deletePayments(penaltyIds) {
	penaltyIds.forEach((penaltyId) => {
		payments.deletePaymentOnly(penaltyId, (paymentDeleteErr) => {
			console.log('Encountered error when deleting payment for group payment.');
			console.log(paymentDeleteErr);
		});
	});
}

export default (event, context, callback) => {
	const { id, penaltyType } = event.pathParameters;
	groupPayments.deletePenaltyGroupPaymentRecord(
		id,
		penaltyType,
		((err, httpResponse, penaltyIds) => {
			if (!err && penaltyIds !== undefined) {
				deletePayments(penaltyIds);
			}
			callback(httpResponse);
		}),
	);
};
