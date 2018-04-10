import auth from './functions/auth';
import list from './functions/list';
import get from './functions/get';
import create from './functions/create';
import remove from './functions/delete';
import update from './functions/update';
import batchFetch from './functions/batchFetch';
import checkPaymentPaid from './functions/check-payment-paid';
import setPenaltyPaid from './functions/set-penalty-paid';

const handler = {
	auth,
	list,
	get,
	create,
	remove,
	update,
	batchFetch,
	checkPaymentPaid,
};

export default handler;
