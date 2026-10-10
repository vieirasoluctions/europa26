/* Empacota as bibliotecas externas dentro do app (funcionam offline, sem CDN). */
import { build } from 'esbuild';
const common = { bundle: true, format: 'esm', minify: true, target: ['safari16'], logLevel: 'info', legalComments: 'none' };
await build({ ...common, entryPoints: ['tools/vendor-entry-firebase.js'], outfile: 'src/vendor/firebase.js' });
await build({ ...common, entryPoints: ['tools/vendor-entry-anthropic.js'], outfile: 'src/vendor/anthropic.js' });
