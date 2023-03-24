import { argv } from 'node:process';

import { $, echo } from "zx";
import { spinner } from 'zx/experimental';

const obj =  argv.at(2);
const retrys = argv.at(3) ? parseInt(argv.at(3)) : 1;

startMetrics();
echo('Getting Version');
const version = await spinner(async () => await $`sf version`);
console.log(`version: ${version.stdout}`);

await setDefaultOrg('FusionUAT');
await $`sf org display user --json > FusionUAT_user.json`;
echo('\n');

try {
    // ********************* GETTIN METADATA (To refactor) ************************
    echo(`Getting metadata from ${obj}`); //TODO: this must be a function
    const metadataObjResponse = await spinner(async () => await $`sf sobject describe --sobject ${obj} --json`);
    const metadataObjResObj = JSON.parse(metadataObjResponse.stdout);
    const { fields }  = metadataObjResObj.result;
    const createableAndUpdateableFields = fields.filter(field => (field.calculated == false && field.createable == true && field.updateable == true));

    const relationFieldsByNameMap = fields.filter(field => {
        if(field.referenceTo.length > 0) {
            for(const reference of field.referenceTo) {
                if(reference.toLowerCase() == obj.toLowerCase()) {
                    return false;
                }
            }
            return true;   
        }
    }).reduce((map, field) => {
        map.set(field.name, field);
        return map;
    }, new Map());

    const circularRelationsByNameMap = createableAndUpdateableFields.filter(field => {
        if(field.referenceTo.length == 0) {
            return false;   
        }

        for(const reference of field.referenceTo) {
            if(reference.toLowerCase() == obj.toLowerCase()) {
                return true;
            }
        }
    }).reduce((map, field) => {
        map.set(field.name, field);        
        return map;
    }, new Map());
    echo(`Getting metadata from ${obj}: ✅ \n`);


    // ********************* BUILDING QUERY (To refactor) ************************
    echo(`Building query for ${obj}`);//TODO: this must be a function
    const exceptionFields = new Set(['OwnerId', 'Id']);
    const queryField = createableAndUpdateableFields.reduce((fields, field, idx) => {
        if(exceptionFields.has(field.name)) {
            return fields;
        }

        if(relationFieldsByNameMap.has(field.name) && relationFieldsByNameMap.get(field.name).custom) {
            let nameArr = field.name.split('');
            nameArr[nameArr.length - 1] = 'r.External_Id__c';
            return `${fields}, ${nameArr.join('')}`
        }

        return `${fields}, ${field.name}`
    } , '');
    let baseQuery = `SELECT ${queryField} FROM ${obj} LIMIT 100`;
    baseQuery = baseQuery.replace('SELECT ,', 'SELECT ');
    echo(`Building query for ${obj}: ✅ \n`);


    //*********************QUERING RECORDS (To refactor) ************************** */ //TODO: this must be a function
    echo(`Quering ${obj}`);
    await $`mkdir -p ./data/${obj}`;
    await $`touch ./data/${obj}/${obj}.csv`;
    await $`sf data query --query ${baseQuery} --bulk -r csv --wait 40 > ./data/${obj}/${obj}.csv`;
    echo(`Quering ${obj}: ✅ \n`);

    //*****************CHANGING ORG DEFAULT ORG *********************************** */
    await setDefaultOrg('FusionBuild');
    await $`sf org display user`;
    echo('\n');

    await upsertBulk(obj);
    
} catch(err) {
    echo(`Something went wrong with ${obj}: ❌`);
    throw new Error(err);
}

stopMetrics();

async function setDefaultOrg(org) {
    try {
        echo(`Setting ${org} as default`);
        await spinner(async () => await $`sf config set target-org=${org} --global --json`);
        echo(`Setting ${org} as default: ✅ \n`);
    } catch(err) {
        echo(`Setting ${org} as default: ✅ \n`);
        console.log(err);
        throw new Error(`The script wasn't able to set ${org} as default, pls, try to use: 
            sf login org --instance-url https://<Custom Domain>.sandbox.my.salesforce.com -a ${org}
            before runnnig again.`);
    }
}

async function upsertBulk(obj) {
    await spinner(async () => {
        echo(`Upserting`);
        await $`sf data upsert bulk --sobject ${obj} --file ./data/${obj}/${obj}.csv --external-id External_Id__c --wait 90 --json > ./data/${obj}/${obj}_results.json`;
    });
}

function startMetrics() {
    console.time('index');
}

function stopMetrics() {
    console.timeLog('index');
    console.timeEnd('index');

    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`The script uses approximately ${Math.round(used * 100) / 100} MB`);
}