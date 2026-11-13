import {constants, createReadStream} from 'node:fs';
import {copyFile, mkdir, readdir} from 'node:fs/promises';
import {join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const logo = fileURLToPath(new URL('../assets/brand/kotr-logo.png', import.meta.url));

async function copyPublic(source, target) {
  await mkdir(target, {recursive: true});
  for (const entry of await readdir(source, {withFileTypes: true})) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    const path = relative(publicDir, from).split(sep).join('/');
    if (path.startsWith('assets/void-shepherd/') && path !== 'assets/void-shepherd/ASSET_NOTICE.md') continue;
    if (entry.isDirectory()) await copyPublic(from, to);
    else if (entry.isFile()) await copyFile(from, to, constants.COPYFILE_EXCL);
    else throw new Error(`Unsupported public asset: ${path}`);
  }
}

export default {
  base: './',
  cacheDir: '.vite-cache',
  build: {copyPublicDir: false},
  plugins: [{
    name: 'copy-public-without-historical-knight',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/assets/brand/kotr-logo.png') return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        res.setHeader('Content-Type', 'image/png');
        if (req.method === 'HEAD') return res.end();
        createReadStream(logo).on('error', next).pipe(res);
      });
    },
    async writeBundle(output) {
      // An earlier local checkout may still contain separately licensed model
      // files. Keep the notice, but never copy those files into a new build.
      await copyPublic(publicDir, resolve(output.dir));
      await copyFile(logo, resolve(output.dir, 'assets/brand/kotr-logo.png'), constants.COPYFILE_EXCL);
    },
  }],
};
