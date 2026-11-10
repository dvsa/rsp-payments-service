const path = require('path');
const { lambdas } = require('./lambdas.json');

module.exports = {
	entry: Object.fromEntries(lambdas.map((name) => [name, `./src/functions/${name}.js`])),

	output: {
		filename: '[name]/app.js',
		libraryTarget: 'commonjs2',
		path: path.resolve('.webpack'),
		asyncChunks: false,
	},

	// Resolve .ts and .js extensions
	resolve: {
		extensions: ['.ts', '.js'],
	},

	// Target node
	target: 'node',

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
							['@babel/preset-env'],
						],
					},
				},
			},
		],
	},

};
