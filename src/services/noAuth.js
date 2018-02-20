/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
// TODO, replace this with real authentication.

export default class NoAuth {
	constructor(token) {
		this.token = token;
	}

	isTokenValid() {
		return true;
	}

	getTokenEffect() {
		return 'Deny';
	}

	getPrincipalId() {
		return 'Auth User';
	}
}
