import { doc } from 'serverless-dynamodb-client';
import Payments from '../services/payments';

const payments = new Payments(
	doc,
	process.env.DYNAMODB_TABLE,
	process.env.DECRYPT_ARN,
	process.env.DOCUMENTUPDATE_ARN,
	process.env.DOCUMENTDELETE_ARN,
);

export default (event, context, callback) => {

	const data = JSON.parse(event.body);

	payments.create(data, callback);

};
