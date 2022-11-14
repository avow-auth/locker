const esbuild = require('esbuild');

// Automatically exclude all node_modules from the bundled version
const { nodeExternalsPlugin } = require('esbuild-node-externals');

esbuild.build({
  entryPoints: ['./src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  minify: false,
  platform: 'node',
  sourcemap: true,
  target: 'node16',
  plugins: [nodeExternalsPlugin()],
}).catch(() => process.exit(1));
