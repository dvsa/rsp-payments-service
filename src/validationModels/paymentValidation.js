import Joi from 'joi';

const paymentDetailsSchema = {
	PaymentRef: Joi.string(),
	AuthCode: Joi.string(),
	PaymentAmount: Joi.number().integer(),
	PaymentDate: Joi.number().integer(),
};


export default {
	request: Joi.object().keys({
		PenaltyReference: Joi.string().required(),
		PenaltyType: Joi.string().regex(/^(IM|CDN|FPN)$/).required(),
		PenaltyStatus: Joi.string().regex(/^(PAID|UNPAID)$/).required(),
		PaymentDetail: Joi.object(paymentDetailsSchema).required(),
	}),
};
