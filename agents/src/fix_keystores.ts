import * as fs from 'fs';
import * as path from 'path';

const KEYSTORES_DIR = path.join(process.cwd(), 'keystores');

const files = fs.readdirSync(KEYSTORES_DIR);
for (const file of files) {
    if (file.endsWith('.json')) {
        const filePath = path.join(KEYSTORES_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        try {
            const parsed = JSON.parse(content);
            if (typeof parsed === 'string') {
                fs.writeFileSync(filePath, parsed);
                console.log(`Fixed ${file}`);
            }
        } catch (e) {
        }
    }
}
