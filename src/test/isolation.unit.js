import expect from 'expect';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import http from 'http';
import https from 'https';
import { doc } from '../utils/dynamodb';

describe('Payments unit-test isolation', () => {
	it('blocks unstubbed DynamoDB and Lambda requests, including the shared database client', () => {
		[
			() => doc.get({ TableName: 'unit', Key: { ID: 'unit' } }).promise(),
			() => new DynamoDBClient({}).send(new GetItemCommand({ TableName: 'unit', Key: { ID: { S: 'unit' } } })),
			() => new LambdaClient({}).send(new InvokeCommand({ FunctionName: 'unit' })),
		].forEach((request) => expect(request).toThrow('Unexpected AWS request in unit tests'));
	});

	it('blocks HTTP, HTTPS and native fetch as network backstops', () => {
		[http.request, https.request, http.get, https.get, global.fetch]
			.forEach((request) => expect(() => request('http://unit.invalid')).toThrow('Unexpected network request in unit tests'));
	});
});
