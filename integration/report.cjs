const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const directory = path.resolve(__dirname, '../integration-reports');
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function summarize(report) {
	report.scenarioCount = report.scenarios.length;
	report.summary = Object.fromEntries(['passed', 'failed', 'skipped', 'not-run', 'dependency-unavailable']
		.map((status) => [status, report.scenarios.filter((scenario) => scenario.status === status).length]));
	report.endpoints = report.inventory.map((endpoint) => {
		const cases = report.scenarios.filter((scenario) => scenario.endpoint === endpoint.id);
		return {
			...endpoint,
			passed: cases.filter((scenario) => scenario.status === 'passed').length,
			total: cases.length,
			complete: cases.length > 0 && cases.every((scenario) => scenario.status === 'passed'),
		};
	});
	return report;
}

function render(report) {
	summarize(report);
	const endpoints = report.endpoints.map((endpoint) => `<tr><td>${escape(endpoint.exportName)} / ${escape(endpoint.localName)}</td><td>${escape(endpoint.route)}</td><td>${endpoint.passed}/${endpoint.total}</td><td>${endpoint.complete ? 'complete' : 'incomplete'}</td></tr>`).join('');
	const scenarios = report.scenarios.map((scenario) => `<tr><td>${escape(scenario.id)}<br>${escape(scenario.endpoint)}</td><td>${escape(scenario.validation)}${scenario.knownDefect ? '<p><strong>Known-defect baseline, not a bug fix.</strong></p>' : ''}<details><summary>${scenario.assertions?.count || 0} assertions; actions and read-backs</summary><ul>${(scenario.actions || []).map((action) => `<li>${escape(action)}</li>`).join('')}${(scenario.assertions?.checks || []).map((check) => `<li>${escape(check)}</li>`).join('')}</ul></details></td><td>${escape(scenario.status)}</td><td>${scenario.durationMs || 0} ms</td><td>${escape(scenario.reason || '')}${scenario.difference ? `<pre>${escape(JSON.stringify(scenario.difference, null, 2))}</pre>` : ''}</td></tr>`).join('');
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payments integration baseline</title>
<style>body{font:16px system-ui;margin:2rem;color:#17212b}table{border-collapse:collapse;width:100%;margin-bottom:2rem}th,td{border:1px solid #bbb;padding:.5rem;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin-top:.5rem}</style></head><body>
<h1>Payments integration baseline</h1><p>${escape(report.startedAt)} | Node ${escape(report.node)} | ${escape(report.operation)}</p>
<p><strong>${escape(report.outcome)}</strong> | ${report.scenarioCount} scenarios | ${escape(JSON.stringify(report.summary))}</p>
<p>Setup: ${escape(report.setup)}. Cleanup: ${escape(report.cleanup)}.</p><p>${escape(report.reason || '')}</p>
<details><summary>Setup preflight: ${report.preflight?.assertions?.count || 0} assertions</summary><ul>${[...(report.preflight?.actions || []), ...(report.preflight?.assertions?.checks || [])].map((item) => `<li>${escape(item)}</li>`).join('')}</ul></details>
<p>Target and safety gates: ${escape(JSON.stringify(report.scope))}</p>
<p>Nine HTTP routes and nine exports; REST v1, /dev prefix. Configuration retains IAM authorization; the local launcher uses --noAuth. No Lambda-only handlers. Endpoint/scenario coverage is not source coverage. Skipped and not-run cases are incomplete coverage.</p>
<p>Downstream Lambda calls are real AWS calls when explicitly enabled. Passing HTTP responses do not prove downstream document state or delivery; this suite reads back local Payments state only.</p>
<h2>Handler inventory</h2><table><tr><th>Export / local function</th><th>Route</th><th>Passed / scenarios</th><th>Coverage</th></tr>${endpoints}</table>
<h2>Scenarios</h2><table><tr><th>Scenario / handler</th><th>Checks</th><th>Result</th><th>Duration</th><th>Reason / safe difference</th></tr>${scenarios}</table>
<h2>Limits</h2><p>No response payloads, credentials, actual ARNs or private identities are included. Payments has no implemented scan pagination. Controlled downstream failures and asynchronous conditional-update rejections remain unit-characterised, not comprehensive black-box failure injection.</p></body></html>`;
}

function write(report, output = directory) {
	const html = render(report);
	fs.mkdirSync(output, { recursive: true });
	const stem = `${report.startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
	for (const name of [stem, 'latest']) {
		fs.writeFileSync(path.join(output, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
		fs.writeFileSync(path.join(output, `${name}.html`), html, { mode: 0o600 });
	}
	return path.join(output, 'latest.html');
}

function regenerate(output = directory) {
	const report = JSON.parse(fs.readFileSync(path.join(output, 'latest.json'), 'utf8'));
	fs.writeFileSync(path.join(output, 'latest.html'), render(report), { mode: 0o600 });
	return path.join(output, 'latest.html');
}

module.exports = {
	directory, escape, summarize, render, write, regenerate,
};
