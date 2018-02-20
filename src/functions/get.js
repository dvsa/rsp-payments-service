import { doc } from 'serverless-dynamodb-client';
import Payments from '../services/payments';

const payments = new Payments(doc, process.env.DYNAMODB_TABLE, process.env.DECRYPT_ARN);

export default (event, context, callback) => {

	payments.get(event.pathParameters.id, callback);

};
