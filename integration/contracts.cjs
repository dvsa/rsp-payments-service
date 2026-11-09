const {
	clone, payload, details,
} = require('./fixtures.cjs');

const inventory = [
	['list', 'GET /payments'],
	['get', 'GET /payments/{id}'],
	['create', 'POST /payments'],
	['batchFetch', 'POST /payments/batches'],
	['update', 'PUT /payments/{id}'],
	['remove', 'DELETE /payments/{id}'],
	['getPenaltyGroupPaymentRecord', 'GET /groupPayments/{id}'],
	['createPenaltyGroupPaymentRecord', 'POST /groupPayments'],
	['deletePenaltyGroupPaymentRecord', 'DELETE /groupPayments/{id}/{penaltyType}'],
].map(([id, route]) => ({
	id,
	route,
	exportName: id,
	localName: id === 'remove' ? 'delete' : id,
	transport: 'HTTP',
	requiresLambdaApproval: ['create', 'remove', 'createPenaltyGroupPaymentRecord', 'deletePenaltyGroupPaymentRecord'].includes(id),
}));

async function paymentRead(c, expected) {
	c.deep((await c.http('GET', `/payments/${expected.ID}`, undefined, 200)).body, { payment: expected }, 'GET returns every persisted payment field and value');
	c.deep(await c.stored('paymentsTable', expected.ID), expected, 'Independent DynamoDB payment read-back matches exactly');
}

async function paymentAbsent(c, id) {
	c.deep((await c.http('GET', `/payments/${id}`, undefined, 200)).body, {}, 'Missing individual payment retains the existing 200 empty-object contract');
	c.deep(await c.stored('paymentsTable', id), undefined, 'Independent DynamoDB read proves the payment is absent');
}

async function groupRead(c, expected) {
	c.deep((await c.http('GET', `/groupPayments/${expected.ID}`, undefined, 200)).body, expected, 'GET returns exact group categories, member IDs and payment values');
	c.deep(await c.stored('groupPaymentsTable', expected.ID), expected, 'Independent DynamoDB group read-back matches exactly');
}

function scenarios() {
	const cases = [];
	const add = (endpoint, id, validation, run, options = {}) => cases.push({
		endpoint, id, validation, run, ...options,
	});

	add('list', 'list-owned-records', 'Exact owned paid/unpaid FPN/IM/CDN records and grouped members; uniqueness without imposing scan ordering or unrelated-data counts', async (c) => {
		const { body } = await c.http('GET', '/payments', undefined, 200);
		c.deep(Object.keys(body), ['payments'], 'List has exactly the payments envelope');
		const { payments } = body;
		c.check(Array.isArray(payments), 'List payments envelope contains an array');
		c.check(new Set(payments.map((item) => item.ID)).size === payments.length, 'Listed IDs are unique');
		const owned = payments.filter((item) => c.data.payments.some((seed) => seed.ID === item.ID));
		c.deep(owned.sort((a, b) => a.ID.localeCompare(b.ID)), clone(c.data.payments).sort((a, b) => a.ID.localeCompare(b.ID)), 'All owned list entries match full seeded domain values');
	});
	for (const [name, field] of [['fpn', 'paid'], ['unpaid', 'unpaid'], ['im', 'im'], ['cdn', 'cdn']]) {
		add('get', `get-${name}`, 'Full response envelope, field types/domain values and independent stored state', (c) => paymentRead(c, c.data[field]));
	}
	add('get', 'get-missing', 'Known behaviour: missing individual GET is 200 {}, with no stored record', (c) => paymentAbsent(c, c.data.missingId), { knownDefect: true });
	add('getPenaltyGroupPaymentRecord', 'get-group', 'FPN/IM/CDN categories, copied category amounts, exact membership and every member parent/detail', async (c) => {
		await groupRead(c, c.data.group);
		for (const member of c.data.members) await paymentRead(c, member);
	});
	add('getPenaltyGroupPaymentRecord', 'get-group-missing', 'Missing group returns exactly 404 {} and no stored item', async (c) => {
		c.deep((await c.http('GET', `/groupPayments/${c.data.missingGroup}`, undefined, 404)).body, {}, 'Missing group response envelope');
		c.deep(await c.stored('groupPaymentsTable', c.data.missingGroup), undefined, 'Missing group is absent independently');
	});
	add('batchFetch', 'batch-mixed-and-missing', 'Paid/unpaid FPN/IM/CDN projection; missing IDs omitted, exact values, uniqueness and no assumed DynamoDB ordering', async (c) => {
		const expected = [c.data.paid, c.data.unpaid, c.data.im, c.data.cdn]
			.map(({ ID, PenaltyStatus, PaymentDetail }) => ({ ID, PenaltyStatus, PaymentDetail }));
		const { body } = await c.http('POST', '/payments/batches', { ids: [...expected.map((item) => item.ID), c.data.missingId] }, 200);
		c.deep(Object.keys(body), ['payments'], 'Batch response has the exact payments envelope');
		c.deep(body.payments.sort((a, b) => a.ID.localeCompare(b.ID)), expected.sort((a, b) => a.ID.localeCompare(b.ID)), 'Exact projected batch values; no metadata leakage or missing-ID placeholder');
	});
	add('batchFetch', 'batch-all-missing', 'Missing IDs return exactly an empty payments array', async (c) => {
		c.deep((await c.http('POST', '/payments/batches', { ids: [c.data.missingId] }, 200)).body, { payments: [] }, 'All-missing batch envelope');
	});
	for (const [name, ids] of [['empty', () => []], ['duplicate', (c) => [c.data.paid.ID, c.data.paid.ID]]]) {
		add('batchFetch', `batch-${name}`, 'Existing invalid-batch behaviour: 500 with a DynamoDB ValidationException, not empty success', async (c) => {
			const { body } = await c.http('POST', '/payments/batches', { ids: ids(c) }, 500);
			c.deep(Object.keys(body), ['err'], 'Invalid batch has the error envelope');
			c.deep(body.err?.code, 'ValidationException', 'Invalid batch retains its actual database validation error code');
			await paymentRead(c, c.data.paid);
		}, { knownDefect: true });
	}
	for (const type of ['FPN', 'IM', 'CDN']) {
		add('create', `create-${type}`, 'Validated creation; exact returned fields, independent GET and persisted domain values', async (c) => {
			const expected = c.data.created[type];
			c.deep((await c.http('POST', '/payments', payload(expected), 200)).body, { payment: expected }, 'Create response matches the independently specified submitted payment');
			await paymentRead(c, expected);
		}, { aws: true });
	}
	add('create', 'create-overwrites-existing', 'Current behaviour: repeated individual creation overwrites details rather than rejecting a duplicate', async (c) => {
		const expected = c.data.replacement;
		c.deep((await c.http('POST', '/payments', payload(expected), 200)).body, { payment: expected }, 'Repeated creation returns the replacement payment');
		await paymentRead(c, expected);
	}, { aws: true, dependsOn: ['create-FPN'] });
	for (const [name, overrides, field] of [
		['invalid-status', { PenaltyStatus: 'INVALID' }, 'PenaltyStatus'],
		['invalid-amount', { PaymentDetail: { PaymentAmount: 9 } }, 'PaymentAmount'],
		['paid-empty-detail', { PaymentDetail: {} }, 'PaymentDetail'],
		['unpaid-nonempty-detail', { PenaltyStatus: 'UNPAID' }, 'PaymentDetail'],
	]) {
		add('create', `create-${name}`, 'Validation rejection has a meaningful error and creates no record', async (c) => {
			const body = { ...payload(c.data.created.FPN), PenaltyReference: c.data.invalidId.split('_')[0], ...overrides };
			const response = await c.http('POST', '/payments', body, 405);
			c.deep(Object.keys(response.body), ['err'], 'Invalid creation has exactly the error envelope');
			c.check(typeof response.body.err === 'string' && response.body.err.includes(field), 'Validation error identifies the rejected payment field');
			await paymentAbsent(c, c.data.invalidId);
		}, { aws: true });
	}
	add('update', 'update-state-transition', 'Accepted known defect: local PUT returns 504 with an empty body; independently verify the real UNPAID to PAID transition and preserve unrelated fields', async (c) => {
		const expected = {
			...c.data.update,
			PenaltyStatus: 'PAID',
			PenaltyType: 'FPN',
			PaymentDetail: details('UPDATED', c.data.now, 150),
		};
		const body = payload(expected);
		delete body.PaymentCode;
		c.deep((await c.http('PUT', `/payments/${expected.ID}`, body, 504, 'gateway-timeout')).body, '', 'Non-async PUT handler times out with an exactly empty response body');
		await c.poll(() => paymentRead(c, expected));
	}, { knownDefect: true });
	add('update', 'update-validation-no-write', 'Accepted known defect: invalid local PUT also returns 504 with an empty body; independent reads prove validation prevented any persistence', async (c) => {
		const body = payload(c.data.unpaid);
		delete body.PaymentCode;
		body.PenaltyStatus = 'INVALID';
		const response = await c.http('PUT', `/payments/${c.data.unpaid.ID}`, body, 504, 'gateway-timeout');
		c.deep(response.body, '', 'Invalid local PUT retains the existing exactly empty timeout response');
		await paymentRead(c, c.data.unpaid);
	}, { knownDefect: true });
	for (const [name, field] of [['unpaid', 'removeUnpaid'], ['paid', 'removePaid']]) {
		add('remove', `delete-${name}`, 'Deletion returns {}, independently removes the payment, and preserves unrelated records', async (c) => {
			const expected = c.data[field];
			c.deep((await c.http('DELETE', `/payments/${expected.ID}`, undefined, 200)).body, {}, 'Delete acknowledgement is empty');
			await paymentAbsent(c, expected.ID);
			await paymentRead(c, c.data.unpaid);
		}, { aws: true });
	}
	add('createPenaltyGroupPaymentRecord', 'group-invalid-type', 'Invalid category is rejected without creating a group or member payments', async (c) => {
		c.deep((await c.http('POST', '/groupPayments', {
			PaymentCode: c.data.missingGroup,
			PenaltyType: 'INVALID',
			PaymentDetail: details('INVALID-GROUP', c.data.now),
			PenaltyIds: [c.data.missingId],
		}, 400)).body, { err: 'Invalid penalty type INVALID, must be either FPN, IM or CDN' }, 'Group category validation response');
		c.deep(await c.stored('groupPaymentsTable', c.data.missingGroup), undefined, 'Rejected group was not persisted');
		await paymentAbsent(c, c.data.missingId);
	}, { aws: true });
	add('createPenaltyGroupPaymentRecord', 'group-empty-code', 'Empty group code is rejected and existing groups/members remain unchanged', async (c) => {
		c.deep((await c.http('POST', '/groupPayments', {
			PaymentCode: '', PenaltyType: 'FPN', PaymentDetail: details('EMPTY-CODE', c.data.now), PenaltyIds: [],
		}, 400)).body, { err: 'Invalid Id' }, 'Empty group code response');
		await groupRead(c, c.data.group);
	}, { aws: true });
	add('createPenaltyGroupPaymentRecord', 'group-duplicate-category', 'Existing category rejects duplicate payment and preserves all category/member values', async (c) => {
		const payment = c.data.group.Payments.FPN;
		c.deep((await c.http('POST', '/groupPayments', {
			PaymentCode: c.data.group.ID, PenaltyType: 'FPN', PaymentDetail: details('DUPLICATE', c.data.now), PenaltyIds: payment.penaltyIds,
		}, 400)).body, { err: `Payment for FPN already exists in ${c.data.group.ID} payment group` }, 'Duplicate category error');
		await groupRead(c, c.data.group);
		for (const member of c.data.members) await paymentRead(c, member);
	}, { aws: true });
	const createdTypes = [];
	for (const type of ['FPN', 'IM', 'CDN']) {
		createdTypes.push(type);
		const types = [...createdTypes];
		add('createPenaltyGroupPaymentRecord', `group-create-${type}`, 'Create/extend group, preserve previous categories and read back every newly created member and category amount', async (c) => {
			const group = c.data.createdGroup;
			const paid = group.Payments[type];
			const detail = { ...paid };
			delete detail.penaltyIds;
			delete detail.PaymentStatus;
			const expected = { ID: group.ID, Payments: Object.fromEntries(types.map((category) => [category, group.Payments[category]])) };
			const response = await c.http('POST', '/groupPayments', {
				PaymentCode: group.ID, PenaltyType: type, PaymentDetail: detail, PenaltyIds: paid.penaltyIds,
			}, type === 'FPN' ? 201 : 200);
			c.deep(response.body, type === 'FPN' ? expected : { ...detail, PaymentStatus: 'PAID' }, 'Group create/extension preserves its actual response envelope');
			await groupRead(c, expected);
			for (const member of c.data.createdMembers.filter((item) => types.includes(item.ID.split('_')[1]))) {
				await paymentRead(c, member);
			}
		}, { aws: true, dependsOn: type === 'FPN' ? [] : [`group-create-${type === 'IM' ? 'FPN' : 'IM'}`] });
	}
	for (const [name, groupId, type] of [
		['missing-group', (c) => c.data.missingGroup, 'FPN'],
		['unknown-category', (c) => c.data.group.ID, 'UNKNOWN'],
	]) {
		add('deletePenaltyGroupPaymentRecord', `group-delete-${name}`, 'Known behaviour: 501 for missing group/category, with no unintended local state changes', async (c) => {
			const code = groupId(c);
			c.deep(
				(await c.http('DELETE', `/groupPayments/${code}/${type}`, undefined, 501)).body,
				`Couldn't remove the payment of type: ${type}, for code ${code}`,
				'Existing group deletion failure response',
			);
			await groupRead(c, c.data.group);
			for (const member of c.data.members) await paymentRead(c, member);
		}, { aws: true, knownDefect: true });
	}
	const deletedTypes = [];
	for (const type of ['FPN', 'IM', 'CDN']) {
		deletedTypes.push(type);
		const removed = [...deletedTypes];
		add('deletePenaltyGroupPaymentRecord', `group-delete-${type}`, 'Delete exactly one category and its members; preserve remaining category data; remove final group physically', async (c) => {
			const expected = clone(c.data.group);
			removed.forEach((category) => { delete expected.Payments[category]; });
			const last = type === 'CDN';
			c.deep(
				(await c.http('DELETE', `/groupPayments/${expected.ID}/${type}`, undefined, 200)).body,
				last ? {} : expected,
				'Group delete returns exact remaining state or final empty acknowledgement',
			);
			if (last) {
				c.deep((await c.http('GET', `/groupPayments/${expected.ID}`, undefined, 404)).body, {}, 'Final category deletion makes group GET return 404');
				c.deep(await c.stored('groupPaymentsTable', expected.ID), undefined, 'Final category physically removes the group');
			} else await groupRead(c, expected);
			for (const member of c.data.members) {
				if (removed.includes(member.ID.split('_')[1])) await paymentAbsent(c, member.ID);
				else await paymentRead(c, member);
			}
		}, { aws: true, dependsOn: type === 'FPN' ? [] : [`group-delete-${type === 'IM' ? 'FPN' : 'IM'}`] });
	}
	return cases;
}

module.exports = {
	inventory, scenarios, paymentRead, groupRead,
};
