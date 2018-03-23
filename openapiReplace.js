const replace = require('replace');

replace({
	regex: '"requestBody": {},',
	replacement: '',
	paths: ['build/openapi.json'],
	recursive: true,
	silent: true,
});
