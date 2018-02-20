const replace = require('replace');

replace({
	regex: '"requestBody": {},',
	replacement: '',
	paths: ['openapi.json'],
	recursive: true,
	silent: true,
});
