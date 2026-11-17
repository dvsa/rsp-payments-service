const http = require('node:http');
const https = require('node:https');
const { devNull } = require('node:os');
const sinon = require('sinon');

for (const name of Object.keys(process.env)) {
	if (name.startsWith('AWS_')) delete process.env[name];
}
Object.assign(process.env, {
	AWS_ACCESS_KEY_ID: 'local',
	AWS_SECRET_ACCESS_KEY: 'local',
	AWS_REGION: 'eu-west-1',
	AWS_CONFIG_FILE: devNull,
	AWS_SHARED_CREDENTIALS_FILE: devNull,
	AWS_EC2_METADATA_DISABLED: 'true',
	IS_OFFLINE: 'true',
	ENV: 'DEV',
	DYNAMODB_PAYMENTS_TABLE: 'paymentsTable',
	DYNAMODB_GROUP_PAYMENTS_TABLE: 'groupPaymentsTable',
	DOCUMENTUPDATE_ARN: 'local-document-update',
	DOCUMENTDELETE_ARN: 'local-document-delete',
	PENALTYGROUP_UPDATE_ARN: 'local-group-update',
	PENALTY_DOCS_UPDATE_ARN: 'local-documents-update',
});

for (const transport of [http, https]) {
	for (const method of ['request', 'get']) {
		transport[method] = () => {
			throw new Error('Unexpected network request in unit tests');
		};
	}
}

global.fetch = () => {
	throw new Error('Unexpected network request in unit tests');
};

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient } = require('@aws-sdk/client-lambda');
const blocked = () => {
	throw new Error('Unexpected AWS request in unit tests');
};
for (const Client of [DynamoDBClient, DynamoDBDocumentClient, LambdaClient]) Client.prototype.send = blocked;

exports.mochaHooks = {
	afterEach() {
		sinon.restore();
	},
};
