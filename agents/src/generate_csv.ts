import * as fs from 'fs';
import * as path from 'path';

const KEYSTORES_DIR = path.join(process.cwd(), 'keystores');
const CSV_PATH = path.join(process.cwd(), 'swarm_addresses.csv');

const files = fs.readdirSync(KEYSTORES_DIR);
let csvContent = 'id,address\n';
let count = 0;

for (const file of files) {
    if (file.endsWith('.json') && file.startsWith('worker')) {
        const id = file.replace('worker', '').replace('.json', '');
        const content = JSON.parse(fs.readFileSync(path.join(KEYSTORES_DIR, file), 'utf8'));
        const address = '0x' + content.address.replace('0x', '');
        csvContent += `${id},${address}\n`;
        count++;
    }
}

fs.writeFileSync(CSV_PATH, csvContent);
console.log(`Generated swarm_addresses.csv with ${count} addresses.`);
