const path = require('path');
const AwsSamPlugin = require('aws-sam-webpack-plugin');

const awsSamPlugin = new AwsSamPlugin({ vscodeDebug: false });

module.exports = {
	// Loads the entry object from the AWS::Serverless::Function resources in your
	// SAM config. Setting this to a function will
	entry: () => awsSamPlugin.entry(),

	// Write the output to the .aws-sam/build folder
	output: {
		filename: (/** @type {any} */ chunkData) => awsSamPlugin.filename(chunkData),
		libraryTarget: 'commonjs2',
		path: path.resolve('.'),
	},

	// Resolve .ts and .js extensions
	resolve: {
		extensions: ['.ts', '.js'],
	},

	// Target node
	target: 'node',

	// AWS recommends always including the aws-sdk in your Lambda package but excluding can significantly reduce
	// the size of your deployment package. If you want to always include it then comment out this line. It has
	// been included conditionally because the node10.x docker image used by SAM local doesn't include it.
	// externals: process.env.NODE_ENV === 'development' ? [] : ['aws-sdk'],
	externals: {
		fsevents: 'require(\'fsevents\')',
	},

	module: {
		rules: [
			{
				test: /\.m?js$/,
				exclude: /node_modules/,
				use: {
					loader: 'babel-loader',
					options: {
						presets: [
							['@babel/preset-env', { targets: { node: '16.16.0' }, useBuiltIns: 'entry', corejs: '3' }],
						],
					},
				},
			},
		],
	},

	// Add the AWS SAM Webpack plugin
	plugins: [
		awsSamPlugin,
	],
};
