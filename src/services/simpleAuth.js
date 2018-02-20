/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
// TODO, replace this with real authentication.

export default class SimpleAuth {
	constructor(token) {
		this.token = token;
	}

	isTokenValid() {
		return this.token === 'allow' || this.token === 'deny';
	}

	getTokenEffect() {
		return (this.token === 'allow') ? 'Allow' : 'Deny';
	}

	getPrincipalId() {
		return 'Auth User';
	}
}
