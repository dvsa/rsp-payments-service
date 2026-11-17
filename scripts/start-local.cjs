const { execFileSync, spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

async function start() {
	if (process.versions.node.split('.')[0] !== '20') {
		throw new Error('This baseline requires Node 20. Run nvm use first.');
	}
	for (const port of [3000, 3002, 8000]) {
		await new Promise((resolve, reject) => {
			const server = net.createServer();
			server.once('error', () => reject(new Error(`Port ${port} is occupied. Do not stop its owner without permission.`)));
			server.listen(port, 'localhost', () => server.close(resolve));
		});
	}

	const profile = process.env.AWS_PROFILE || 'default';
	let credentials;
	try {
		credentials = JSON.parse(execFileSync('aws', [
			'configure', 'export-credentials', '--profile', profile, '--format', 'process',
		], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
	} catch {
		throw new Error('Cannot resolve the selected AWS profile. Authenticate it using your usual login process, then retry npm start.');
	}
	if (!credentials.AccessKeyId || !credentials.SecretAccessKey
		|| (credentials.Expiration && Date.parse(credentials.Expiration) <= Date.now())) {
		throw new Error('The selected AWS profile returned incomplete or expired credentials. Authenticate again and retry npm start.');
	}

	let javaHome = process.env.JAVA_HOME;
	if (process.platform === 'darwin') {
		try {
			javaHome = execFileSync('/usr/libexec/java_home', ['-v', '21'], {
				encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
			}).trim();
		} catch {
			throw new Error('Java 21 is required for this local baseline. Install a Java 21 JDK, then retry npm start.');
		}
	}
	const java = javaHome ? path.join(javaHome, 'bin', 'java') : 'java';
	const version = spawnSync(java, ['-version'], { encoding: 'utf8' });
	if (version.error || version.status !== 0 || !/version "21(?:[."])/.test(`${version.stdout}${version.stderr}`)) {
		throw new Error('Cannot run Java 21. Configure JAVA_HOME or PATH, then retry npm start.');
	}

	const env = {
		...process.env,
		DYNAMODB_PAYMENTS_TABLE: 'paymentsTable',
		DYNAMODB_GROUP_PAYMENTS_TABLE: 'groupPaymentsTable',
		AWS_PROFILE: profile,
		AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
		AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
		NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --no-experimental-require-module`.trim(),
	};
	if (credentials.SessionToken) env.AWS_SESSION_TOKEN = credentials.SessionToken;
	else delete env.AWS_SESSION_TOKEN;
	if (javaHome) {
		env.JAVA_HOME = javaHome;
		env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${env.PATH || ''}`;
	}
	console.log('Starting with the selected AWS profile and Java 21. Downstream Lambdas are real AWS calls; restart after credentials expire.');
	// A separate process group lets shutdown reach the watcher, Offline and Java.
	const child = spawn('npm', ['run', 'start:local'], {
		stdio: 'inherit', env, detached: process.platform !== 'win32',
	});
	child.on('error', () => {
		console.error('Cannot launch local service processes.');
		process.exitCode = 1;
	});
	child.on('exit', (code, signal) => {
		process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
	});
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => {
			try {
				if (process.platform === 'win32') child.kill(signal);
				else process.kill(-child.pid, signal);
			} catch (error) {
				if (error.code !== 'ESRCH') {
					console.error('Cannot signal local service processes.');
					process.exitCode = 1;
				}
			}
		});
	}
}

start().catch((error) => {
	console.error(`Local startup failed: ${error.message}`);
	process.exitCode = 1;
});
