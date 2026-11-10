import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
	DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand,
	UpdateCommand, BatchGetCommand, BatchWriteCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import awsError from './awsError';

export function databaseOptions(env = process.env) {
	return {
		region: env.AWS_REGION || 'eu-west-1',
		...(env.IS_OFFLINE === 'true' ? {
			endpoint: 'http://localhost:8000',
			credentials: { accessKeyId: 'localPayments', secretAccessKey: 'localPayments' },
		} : {}),
	};
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient(databaseOptions()), {
	marshallOptions: { removeUndefinedValues: true },
});

// Keep the injected request interface while migrating its transport to SDK v3.
export const doc = {
	get: (input) => ({ promise: () => client.send(new GetCommand(input)).catch(awsError) }),
	put: (input) => ({ promise: () => client.send(new PutCommand(input)).catch(awsError) }),
	scan: (input) => ({ promise: () => client.send(new ScanCommand(input)).catch(awsError) }),
	update: (input) => ({ promise: () => client.send(new UpdateCommand(input)).catch(awsError) }),
	batchGet: (input) => ({ promise: () => client.send(new BatchGetCommand(input)).catch(awsError) }),
	batchWrite: (input) => ({ promise: () => client.send(new BatchWriteCommand(input)).catch(awsError) }),
	delete: (input) => ({ promise: () => client.send(new DeleteCommand(input)).catch(awsError) }),
};
