import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const configPath = path.join(projectRoot, 'apps-script.config.json');

if (!fs.existsSync(configPath)) {
  throw new Error(`Missing config file: ${configPath}`);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const verifyUrl = String(config.verifyUrl || '').trim();

if (!verifyUrl || !verifyUrl.includes('script.google.com') || !verifyUrl.endsWith('/exec')) {
  throw new Error(`Invalid verifyUrl in ${configPath}: ${verifyUrl}`);
}

const envContent = `VITE_APPS_SCRIPT_URL=${verifyUrl}\n`;
for (const filename of ['.env.local', '.env.production.local']) {
  fs.writeFileSync(path.join(projectRoot, filename), envContent, 'utf8');
}

console.log(`Synced Vite env with Apps Script URL: ${verifyUrl}`);
