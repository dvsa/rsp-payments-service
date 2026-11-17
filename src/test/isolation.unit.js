import expect from 'expect';
import AWS from 'aws-sdk';
import http from 'http';
import https from 'https';
import { doc } from 'serverless-dynamodb-client';

describe('Payments unit-test isolation', () => {
	it('blocks unstubbed DynamoDB and Lambda requests, including the shared database client', () => {
		[
			() => doc.get({ TableName: 'unit', Key: { ID: 'unit' } }),
			() => new AWS.DynamoDB.DocumentClient().put({ TableName: 'unit', Item: { ID: 'unit' } }),
			() => new AWS.Lambda().invoke({ FunctionName: 'unit' }),
		].forEach((request) => expect(request).toThrow('Unexpected AWS request in unit tests'));
	});

	it('blocks HTTP, HTTPS and native fetch as network backstops', () => {
		[http.request, https.request, http.get, https.get, global.fetch]
			.forEach((request) => expect(() => request('http://unit.invalid')).toThrow('Unexpected network request in unit tests'));
	});
});
