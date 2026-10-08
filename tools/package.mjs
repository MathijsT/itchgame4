// Packages the game for itch.io (HTML5 upload): a zip with index.html at its root.
// Usage: node tools/package.mjs   →   dist/terra-endurance.zip
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const zip = join(out, 'terra-endurance.zip');
mkdirSync(out, { recursive: true });
if (existsSync(zip)) rmSync(zip);
execFileSync('zip', ['-r', '-q', zip, 'index.html', 'style.css', 'src'], { cwd: root, stdio: 'inherit' });
console.log(`Wrote ${zip}`);
