const { isDeepStrictEqual } = require('node:util');

class ContractFailure extends Error {
	constructor(message, mismatch) {
		super(message);
		this.difference = mismatch;
	}
}

function shape(value) {
	if (value === undefined) return 'undefined';
	if (value === null) return 'null';
	if (Array.isArray(value)) return `array (${value.length} entries)`;
	if (typeof value === 'object') return `object (${Object.keys(value).length} fields)`;
	return typeof value;
}

function difference(actual, expected, field = '$') {
	if (isDeepStrictEqual(actual, expected)) return undefined;
	if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
		for (const key of Object.keys(expected)) {
			if (!isDeepStrictEqual(actual[key], expected[key])) return difference(actual[key], expected[key], `${field}.${key}`);
		}
	}
	return {
		field, expected: shape(expected), actual: shape(actual), values: 'Contents deliberately withheld',
	};
}

function recorder() {
	const evidence = { count: 0, checks: [] };
	function check(condition, message, actual, expected) {
		evidence.count += 1;
		if (!evidence.checks.includes(message)) evidence.checks.push(message);
		if (!condition) throw new ContractFailure(message, difference(actual, expected));
	}
	function deep(actual, expected, message) {
		check(isDeepStrictEqual(actual, expected), message, actual, expected);
	}
	return { evidence, check, deep };
}

module.exports = { ContractFailure, recorder };
