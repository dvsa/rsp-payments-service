const fs = require('node:fs');
const path = require('node:path');

const filename = path.join(__dirname, 'openapi.json');
const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
for (const item of Object.values(document.paths)) {
	for (const operation of Object.values(item)) {
		if (operation.requestBody && Object.keys(operation.requestBody).length === 0) {
			delete operation.requestBody;
		}
	}
}
fs.writeFileSync(filename, `${JSON.stringify(document, null, 2)}\n`);
