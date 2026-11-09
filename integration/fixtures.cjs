const OWNER = 'RSP-PAYMENTS-INTEGRATION-V1';
const clone = (value) => JSON.parse(JSON.stringify(value));
const reference = (index, type = 'FPN') => (type === 'IM'
	? `9900981${String(index).padStart(6, '0')}` : String(990098000000 + index));
const id = (index, type = 'FPN') => `${reference(index, type)}_${type}`;

function details(label, now, amount = 120) {
	return {
		PaymentMethod: 'CARD',
		PaymentRef: `${OWNER}-${label}`,
		AuthCode: 'RSPINT123',
		PaymentAmount: amount,
		PaymentDate: now - 600,
	};
}

function fixtures(now = Math.floor(Date.now() / 1000)) {
	const payment = (index, type = 'FPN', status = 'PAID') => ({
		ID: id(index, type),
		PenaltyStatus: status,
		PaymentDetail: status === 'PAID' ? details(`${index}-${type}`, now) : {},
		IntegrationFixture: OWNER,
	});
	const paid = payment(1);
	const unpaid = payment(2, 'FPN', 'UNPAID');
	const im = payment(3, 'IM');
	const cdn = payment(4, 'CDN');
	const update = { ...payment(5, 'FPN', 'UNPAID'), BaselineNote: OWNER };
	const removeUnpaid = payment(6, 'FPN', 'UNPAID');
	const removePaid = payment(7);
	const group = { ID: 'rspintegrationpaymentsseed', Payments: {}, IntegrationFixture: OWNER };
	const members = [];
	for (const [type, indices] of [['FPN', [11, 12]], ['IM', [13]], ['CDN', [14]]]) {
		const detail = details(`GROUP-${type}`, now, type === 'FPN' ? 240 : 80);
		group.Payments[type] = {
			...detail, PaymentStatus: 'PAID', penaltyIds: indices.map((index) => id(index, type)),
		};
		members.push(...indices.map((index) => ({
			ID: id(index, type),
			PenaltyStatus: 'PAID',
			PaymentDetail: detail,
			PenaltyGroupId: group.ID,
			IntegrationFixture: OWNER,
		})));
	}
	const created = Object.fromEntries(['FPN', 'IM', 'CDN'].map((type, index) => [type, {
		ID: id(201 + index, type),
		PenaltyStatus: 'PAID',
		PaymentDetail: details(`CREATE-${type}`, now),
	}]));
	const createdGroup = { ID: 'rspintegrationpaymentscreated', Payments: {} };
	const createdMembers = [];
	for (const [type, indices] of [['FPN', [101, 102]], ['IM', [103]], ['CDN', [104]]]) {
		const detail = details(`CREATED-GROUP-${type}`, now, type === 'FPN' ? 240 : 80);
		createdGroup.Payments[type] = {
			...detail, PaymentStatus: 'PAID', penaltyIds: indices.map((index) => id(index, type)),
		};
		createdMembers.push(...indices.map((index) => ({
			ID: id(index, type),
			PenaltyStatus: 'PAID',
			PaymentDetail: detail,
			PenaltyGroupId: createdGroup.ID,
		})));
	}
	return {
		now,
		paid,
		unpaid,
		im,
		cdn,
		update,
		removeUnpaid,
		removePaid,
		group,
		members,
		payments: [paid, unpaid, im, cdn, update, removeUnpaid, removePaid, ...members],
		groups: [group],
		created,
		replacement: { ...created.FPN, PaymentDetail: details('REPLACEMENT', now, 135) },
		createdGroup,
		createdMembers,
		invalidId: id(204),
		missingId: id(999),
		missingGroup: 'rspintegrationpaymentsmissing',
	};
}

function payload(item) {
	const [PenaltyReference, PenaltyType] = item.ID.split('_');
	return {
		PenaltyReference,
		PenaltyType,
		PenaltyStatus: item.PenaltyStatus,
		PaymentDetail: clone(item.PaymentDetail),
		PaymentCode: OWNER,
	};
}

module.exports = {
	OWNER, clone, fixtures, payload, details,
};
