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
	const deletePromises = penaltyIds.map(penaltyId =>
		payments.deletePaymentOnly(penaltyId).catch((err) => {
			console.log('Encountered error when deleting payment for group payment.');
			console.log(err);
		}));

	return Promise.all(deletePromises);
}

export default async (event) => {
	const { id, penaltyType } = event.pathParameters;
	const {
		response,
		penaltyIds,
	} = await groupPayments.deletePenaltyGroupPaymentRecord(id, penaltyType);

	if (penaltyIds !== undefined) {
		await deletePayments(penaltyIds);
	}

	return response;
};
