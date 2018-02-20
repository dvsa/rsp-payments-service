import auth from './functions/auth';
import list from './functions/list';
import get from './functions/get';
import create from './functions/create';
import remove from './functions/delete';
import update from './functions/update';
import getToken from './functions/getToken';

const handler = {
	auth,
	list,
	get,
	create,
	remove,
	update,
	getToken,
};

export default handler;
