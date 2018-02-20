import SimpleAuth from '../services/simpleAuth';
import NoAuth from '../services/noAuth';
import isDevEnv from '../utils/isDevEnv';

export default (event, context, callback) => {
	const token = event.authorizationToken;
	const authorizer = generateAuthorizer(token);

	if (authorizer.isTokenValid()) {
		const policyEffect = authorizer.getTokenEffect();
		const policy = generatePolicy(policyEffect, '*');
		const principalId = authorizer.getPrincipalId();
		const response = {
			principalId,
			policyDocument: policy,
		};
		callback(null, response);
	} else {
		callback('Unauthorized');
	}
};

function generateAuthorizer(token) {
	return isDevEnv() ? new SimpleAuth(token) : new NoAuth(token);
}

function generatePolicy(effect, resource) {
	const policy = {};
	policy.Version = '2012-10-17';
	policy.Statement = [];

	const statement = {};
	statement.Action = 'execute-api:Invoke';
	statement.Effect = effect;
	statement.Resource = resource;
	policy.Statement.push(statement);

	return policy;
}
