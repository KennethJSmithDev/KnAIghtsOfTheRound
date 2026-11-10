import {constants} from 'node:fs';
import {copyFile, mkdir, readdir} from 'node:fs/promises';
import {join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));

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
    apply: 'build',
    async writeBundle(output) {
      // An earlier local checkout may still contain separately licensed model
      // files. Keep the notice, but never copy those files into a new build.
      await copyPublic(publicDir, resolve(output.dir));
    },
  }],
};
