if (process.env.CI || process.env.INTEGRATION_ALLOW_LAMBDA !== 'yes') {
	throw new Error('These manual integration tests invoke real document-update Lambdas and mutate local records. Explicit approval and INTEGRATION_ALLOW_LAMBDA=yes are required; CI execution is disabled.');
}
