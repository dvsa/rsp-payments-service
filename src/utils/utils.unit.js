import expect from 'expect';
import sinon from 'sinon';
import createResponse from './createResponse';
import isDevEnv from './isDevEnv';
import isEmptyObject from './isEmptyObject';
import { logInfo, logError } from './logger';

describe('Payments boundary utilities', () => {
	let environment;
	beforeEach(() => {
		environment = process.env;
		process.env = { ...environment };
	});
	afterEach(() => {
		process.env = environment;
	});

	it('serializes domain responses and preserves status and CORS', () => {
		expect(createResponse({ statusCode: 201, body: { ID: 'LOCALGROUP' } })).toEqual({
			statusCode: 201,
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: '{"ID":"LOCALGROUP"}',
		});

		expect(createResponse({})).toEqual({
			statusCode: 200,
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: '{}',
		});
	});

	it('recognises only the explicit DEV environment', () => {
		process.env.ENV = 'DEV';
		expect(isDevEnv()).toBe(true);
		process.env.ENV = 'PROD';
		expect(isDevEnv()).toBe(false);
	});

	it('distinguishes missing group objects from existing values', () => {
		expect(isEmptyObject({})).toBe(true);
		expect(isEmptyObject({ ID: 'LOCALGROUP' })).toBe(false);
		expect(isEmptyObject([])).toBe(false);
	});

	it('emits parseable info and error audit events', () => {
		const info = sinon.stub(console, 'log');
		const error = sinon.stub(console, 'error');
		logInfo('LocalOperation', { id: 'LOCALGROUP' });
		logError('LocalFailure', { code: 'Unavailable' });
		expect(JSON.parse(info.firstCall.args[0])).toEqual({
			logName: 'LocalOperation', message: { id: 'LOCALGROUP' }, logLevel: 'INFO',
		});
		expect(JSON.parse(error.firstCall.args[0])).toEqual({
			logName: 'LocalFailure', message: { code: 'Unavailable' }, logLevel: 'ERROR',
		});
	});

});
