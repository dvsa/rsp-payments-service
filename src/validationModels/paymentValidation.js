import Joi from 'joi';

const paymentDetailsSchema = {
	PaymentRef: Joi.string(),
	AuthCode: Joi.string(),
	PaymentAmount: Joi.number().integer(),
	PaymentDate: Joi.number().integer(),
};


export default {
	request: Joi.object().keys({
		ID: Joi.string().regex(/^[0-9]{12,13}_(IM|CDN|FPN)$/).required(),
		PenaltyStatus: Joi.string().regex(/^(PAID|UNPAID)$/).required(),
		PaymentDetail: Joi.object(paymentDetailsSchema).required(),
	}),
};
