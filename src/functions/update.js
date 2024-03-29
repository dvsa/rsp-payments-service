import { doc } from 'serverless-dynamodb-client';
import Payments from '../services/payments';

const payments = new Payments(
	doc,
	process.env.DYNAMODB_PAYMENTS_TABLE,
	process.env.DECRYPT_ARN,
	process.env.DOCUMENTUPDATE_ARN,
	process.env.DOCUMENTDELETE_ARN,
);

export const handler = (event) => {
	const data = JSON.parse(event.body);

	return payments.update(event.pathParameters.id, data);
};

export default handler;
