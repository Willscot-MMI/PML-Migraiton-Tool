import fs from 'fs';
import { $ } from 'zx';

function readFile(path, encode = 'utf8') {
    return fs.readFileSync(path, encode);
}

async function writeFile(path, source) {
    fs.writeFileSync(path, source);
}

function readDirectory(path) {
    return fs.readdirSync(path);
}

async function createDataDirectoriesFromExistingSchemas() {
    const sobjects = readDirectory('./sobjects').map(fileName => fileName.replace('.json', ''));

    for(const sobject of sobjects) {
        await $`mkdir -p ./data/${sobject}`;
    }
}

export {
    readFile,
    writeFile,
    readDirectory,
    createDataDirectoriesFromExistingSchemas
}