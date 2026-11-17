export default function awsError(error) {
	if (error.$metadata) {
		if (error.code === undefined) error.code = error.name;
		if (error.statusCode === undefined) error.statusCode = error.$metadata.httpStatusCode;
	}
	throw error;
}
