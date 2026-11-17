import expect from 'expect';
import sinon from 'sinon';
import { DynamoDBServiceException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { LambdaServiceException } from '@aws-sdk/client-lambda';
import { databaseOptions, doc } from './dynamodb';
import awsError from './awsError';

describe('SDK v3 compatibility boundaries', () => {
	it('uses the normal AWS chain in production and a loopback endpoint only for Offline', () => {
		expect(databaseOptions({})).toEqual({ region: 'eu-west-1' });
		expect(databaseOptions({ IS_OFFLINE: 'false', AWS_REGION: 'eu-west-2' })).toEqual({ region: 'eu-west-2' });
		const local = {
			region: 'eu-west-1',
			endpoint: 'http://localhost:8000',
			credentials: { accessKeyId: 'localPayments', secretAccessKey: 'localPayments' },
		};
		expect(databaseOptions({ IS_OFFLINE: 'true' })).toEqual(local);
		expect(databaseOptions()).toEqual(local);
	});

	[
		['get', 'GetCommand', { TableName: 'unit', Key: { ID: 'unit' }, ConsistentRead: true }],
		['put', 'PutCommand', { TableName: 'unit', Item: { ID: 'unit' }, ConditionExpression: 'attribute_not_exists(ID)' }],
		['scan', 'ScanCommand', { TableName: 'unit' }],
		['update', 'UpdateCommand', { TableName: 'unit', Key: { ID: 'unit' }, ReturnValues: 'ALL_NEW' }],
		['batchGet', 'BatchGetCommand', { RequestItems: { unit: { Keys: [{ ID: 'unit' }] } } }],
		['batchWrite', 'BatchWriteCommand', { RequestItems: { unit: [{ DeleteRequest: { Key: { ID: 'unit' } } }] } }],
		['delete', 'DeleteCommand', { TableName: 'unit', Key: { ID: 'unit' }, ReturnValues: 'ALL_OLD' }],
	].forEach(([operation, name, input]) => {
		it(`sends the exact ${operation} request and preserves its resolved response`, async () => {
			const response = { synthetic: true };
			const send = sinon.stub(DynamoDBDocumentClient.prototype, 'send').resolves(response);
			expect(await doc[operation](input).promise()).toBe(response);
			expect(send.calledOnce).toBe(true);
			expect(send.firstCall.args[0].constructor.name).toBe(name);
			expect(send.firstCall.args[0].input).toEqual(input);
		});
	});

	it('preserves v2-style error codes and HTTP statuses for real v3 service exceptions', async () => {
		const error = new DynamoDBServiceException({
			name: 'ValidationException', message: 'Synthetic validation error', $fault: 'client', $metadata: { httpStatusCode: 400 },
		});
		sinon.stub(DynamoDBDocumentClient.prototype, 'send').rejects(error);
		await expect(doc.batchGet({ RequestItems: {} }).promise()).rejects.toBe(error);
		expect(error.code).toBe('ValidationException');
		expect(error.statusCode).toBe(400);
	});

	it('preserves Lambda error identity and existing compatibility fields', () => {
		const error = new LambdaServiceException({
			name: 'ResourceNotFoundException', $fault: 'client', $metadata: { httpStatusCode: 404 },
		});
		error.code = 'ExistingCode';
		error.statusCode = 409;
		expect(() => awsError(error)).toThrow(error);
		expect(error.code).toBe('ExistingCode');
		expect(error.statusCode).toBe(409);
	});

	[['ConditionalCheckFailedException', 400], ['InternalServerError', 500]].forEach(([name, statusCode]) => {
		it(`preserves ${name} without reclassifying the service failure`, async () => {
			const input = { TableName: 'unit', Item: { ID: 'unit' }, ConditionExpression: 'attribute_not_exists(ID)' };
			const error = new DynamoDBServiceException({
				name, $fault: 'client', $metadata: { httpStatusCode: statusCode },
			});
			const send = sinon.stub(DynamoDBDocumentClient.prototype, 'send').rejects(error);
			await expect(doc.put(input).promise()).rejects.toBe(error);
			expect(error.code).toBe(name);
			expect(error.statusCode).toBe(statusCode);
			expect(send.lastCall.args[0].input).toEqual(input);
		});
	});

	it('does not turn ordinary marshalling or application failures into service validation errors', () => {
		const error = new Error('Synthetic ordinary failure');
		expect(() => awsError(error)).toThrow(error);
		expect(error.code).toBeUndefined();
		expect(error.statusCode).toBeUndefined();
	});
});
