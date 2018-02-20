import { doc } from 'serverless-dynamodb-client';
import { Lambda } from 'aws-sdk';
import Payments from '../services/payments';

const payments = new Payments(doc, process.env.DYNAMODB_TABLE, process.env.DECRYPT_ARN);

export default (event, context, callback) => {

	const lambda = new Lambda({ region: 'eu-west-1' });
	const docTypeMapping = ['FPN', 'IM', 'CDN'];
	// invoke lambda
	lambda.invoke({
		FunctionName: payments.decryptArn,
		Payload: `{"body": { "Token": "${event.pathParameters.id}" } }`,
	}, (error, data) => {
		if (error) {
			console.log('it returned an error');
			console.log(JSON.stringify(error, null, 2));
			callback(error, null);
		} else if (data.Payload) {
			console.log('it worked');
			console.log(JSON.stringify(data.Payload, null, 2));
			const parsedPayload = JSON.parse(data.Payload);
			const parsedBody = JSON.parse(parsedPayload.body);
			console.log(JSON.stringify(parsedBody));
			const docType = docTypeMapping[parsedBody.DocumentType];
			console.log(`try and get ${parsedBody.Reference}_${docType}`);
			payments.get(`${parsedBody.Reference}_${docType}`, callback);
		}
	});
};
