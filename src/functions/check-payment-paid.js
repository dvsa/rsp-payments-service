import { doc } from 'serverless-dynamodb-client';
import Payments from '../services/payments';

const payments = new Payments(
	doc,
	process.env,DYNAMODB_TABLE,
	process.env.DECRYPT_ARN,
	process.env.DOCUMENTUPDATE_ARN,
);

export default (event, context, callback) => {
	const id = event.data.id;

	payments.checkPaymentPaid(payments.get(id, (responseObject) => {
		if (responseObject === 200) {
			callback(null, { paymentStatus: "PAID" });
		} else {
			callback(null, { paymentStatus: "UNPAID" });
		}
	}));
};
