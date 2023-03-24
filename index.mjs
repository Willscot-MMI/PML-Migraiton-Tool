import fs from 'fs';

import { $, echo } from 'zx';
import { spinner } from 'zx/experimental';
import csvtojsonV2 from 'csvtojson';
import cliProgress from 'cli-progress';

import SObject from './SObject.js';
import executeInput from './input.js';
import { allSObjectInputsConst, particularSObjectInputsConst } from './config/constants.js';

$.verbose = false;
const overwritesMap = loadOverwritesMap();
const generalConfigMap = loadGeneralConfigMap();
const progressBar = new cliProgress.SingleBar({
    format: 'Progress | {bar} ' + '| {percentage}% || {value}/{total} Objects',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    stopOnComplete: true,
    forceRedraw: true
});

await setDefaultOrg(generalConfigMap.get('sourceEnviroment'));

let enviromentInfo = await getEnviromentInfo(generalConfigMap.get('sourceEnviroment'));
const answers = await executeInput();
startMetrics();

if(answers.length == 1) {
    await executeAll(answers);    
}

if(answers.length == 2) {
    await executeSpecific(answers);
}

stopMetrics();
//TODO: Get Listed Schemas
async function executeAll(answers) {
    let sobjects = JSON.parse(readFile('./config/sobjects.json'));

    if(answers.at(0).logic.includes(allSObjectInputsConst.EXECUTE_ALL)) {
        await getAllInvolvedSchemas(sobjects, overwritesMap, generalConfigMap);
        sobjects = getExistingSchemasNames();
        await queryDataAll(sobjects);
        await buildGeneralDependencyTree();

		sobjects = JSON.parse(readFile('./config/sortedTree.json'));
        upsertToTargetOrg(sobjects, generalConfigMap);
        return;
    }

    if(answers.at(0).logic.includes(allSObjectInputsConst.GET_ALL_INVOLVED)) {
        await getAllInvolvedSchemas(sobjects, overwritesMap, generalConfigMap);
    }

    if(answers.at(0).logic.includes(allSObjectInputsConst.REFRESH_ALL_SCHEMAS)) {
        await refreshAllExistingSchemas(overwritesMap, generalConfigMap);
    }

    if(answers.at(0).logic.includes(allSObjectInputsConst.QUERY_SOBJECTS)) {
        await queryDataAll(getExistingSchemasNames());
    }

    if(answers.at(0).logic.includes(allSObjectInputsConst.BUILD_TREE)) {
        const tree = await buildGeneralDependencyTree();
        
        const order = new Set();
        let postOrderTraversalArr = [];
        for(const node of tree) {
            postOrderTraversalArr = postOrderTraversal(node);

            for(const nodeName of postOrderTraversalArr) {
                order.add(nodeName);
            }
        }

        await writeFile('./config/postOrderTraversal.json', JSON.stringify(Array.from(order), null, 2));
    }

    if(answers.at(0).logic.includes(allSObjectInputsConst.LOAD_SOBJECTS)) {
		sobjects = JSON.parse(readFile('./config/postOrderTraversal.json'));
        await upsertToTargetOrg(sobjects, generalConfigMap);
    }

    if(answers.at(0).logic.includes(allSObjectInputsConst.ANALYSIS)) {
        for(const sobject of sobjects) {
            generateResultAnalysis(sobject);
        }
    }
}

async function executeSpecific(answers) {
    let sobject = [ answers.at(1).sObject ];

    if(answers.at(0).logic.includes(particularSObjectInputsConst.EXECUTE_ALL)) {
        await getAllInvolvedSchemas(sobject, overwritesMap, generalConfigMap);
        await queryDataAll(sobject);
        upsertToTargetOrg(sobject, generalConfigMap);
        return;
    }

    if(answers.at(0).logic.includes(particularSObjectInputsConst.GET_SOBJECT_SCHEMA)) {
        await getSchemas(sobject, overwritesMap, generalConfigMap);
    }

    if(answers.at(0).logic.includes(particularSObjectInputsConst.QUERY_SOBJECT)) {
        await queryDataAll(sobject);
    }

    if(answers.at(0).logic.includes(particularSObjectInputsConst.LOAD_SOBJECT)) {
        await upsertToTargetOrg(sobject, generalConfigMap);
    }

    if(answers.at(0).logic.includes(particularSObjectInputsConst.ANALYSIS)) {        
        generateResultAnalysis(sobject);
    }
}

async function upsertToTargetOrg(sobjects, generalConfigMap) {
    await setDefaultOrg(generalConfigMap.get('targetEnviroment'));
    enviromentInfo = await getEnviromentInfo(generalConfigMap.get('targetEnviroment'));
    progressBar.start(sobjects.length, 0);

    let job;
    let jobDataResults;
    let closeJobResults;
    let jobStatus;
    let successRecordsCsv;
    let failedRecordsCsv;
    let analysis;
    let sObject;

    for(const sobjectName of sobjects) {
        sObject = Object.assign(new SObject, JSON.parse(readFile(`./sobjects/${sobjectName}.json`)));
        job = await createUpsertBulkJob(enviromentInfo, sObject);
        jobDataResults = await uploadJobData(enviromentInfo, job, sObject);

        if(jobDataResults.status != 201) {
            throw new Error(`job failed with status: ${jobDataResults.status} : ${jobDataResults.statusText}`);
        }

        closeJobResults = await closeJob(enviromentInfo, job);
        jobStatus = await waitUntilFinish(enviromentInfo, job);
        sObject.jobStatus = jobStatus;

        [ successRecordsCsv, failedRecordsCsv ] = await Promise.all([
            getJobSuccessRecords(enviromentInfo, job),
            getFailedRecords(enviromentInfo, job),
            writeFile(`./sobjects/${sobjectName}.json`, JSON.stringify(sObject, null, 2))
        ]);

        await Promise.all([
            writeFile(`./data/${sobjectName}/${sobjectName}_success.csv`, successRecordsCsv),
            writeFile(`./data/${sobjectName}/${sobjectName}_errors.csv`, failedRecordsCsv)
        ]);

        analysis = await generateResultAnalysis(sObject);

        await writeFile(`./data/${sobjectName}/analysis.csv`, JSON.stringify(analysis, null, 2));
        progressBar.increment();
    }
}

async function refreshAllExistingSchemas(overwritesMap, generalConfigMap) {
    const existingSObjectSchemas = new Set(getExistingSchemasNames());

    await getSchemas(existingSObjectSchemas, overwritesMap, generalConfigMap);
}

async function getSchemas(schemasToBeRetrieved, overwritesMap, generalConfigMap) {
    let sObject;
    echo(`\nGetting schemas\n`);
    progressBar.start(schemasToBeRetrieved.length, 0);

    for(const schemaName of schemasToBeRetrieved) {        
        sObject = await getSobject(schemaName);
        sObject.buildQuery(JSON.parse(readFile('./config/exceptionFields.json')), overwritesMap);
        await sObject.buildUpsertConfig(generalConfigMap.get('defaultExternalId'), overwritesMap);
        sObject.saveRelationshipFields();
        await writeFile(`./sobjects/${schemaName}.json`, JSON.stringify(sObject, null, 2));
        progressBar.increment();
    }    
}

//TODO: change this function to avoid some objects
async function getAllInvolvedSchemas(sobjects, overwritesMap, generalConfigMap) {
    await getSchemas(sobjects, overwritesMap, generalConfigMap);
    const involvedSchema = getInvolvedSchemas(sobjects);
    await getSchemas(involvedSchema, overwritesMap, generalConfigMap);
}

function getInvolvedSchemas(sobjects) {
    let sObject;
    const allSObjectsInvolved = new Set();

    for(const sobjectName of sobjects) { 
        sObject = Object.assign(new SObject, JSON.parse(readFile(`./sobjects/${sobjectName}.json`)));

        allSObjectsInvolved.add(sObject.name);

        sObject.fields.forEach(field => {
            field.referenceTo.forEach(fieldName => {
                allSObjectsInvolved.add(fieldName);
            });
        });
    }

    return Array.from(allSObjectsInvolved);
}

function getExistingSchemasNames() {
    return new readDirectory('./sobjects').map(fileName => {
        return fileName.replace('.json', '');
    });
}

async function queryDataAll(schemasToBeRetrieved) {
    let sObject;
	let job;
	let jobStatus;
	let data;
	let locator;
	let stream;

	enviromentInfo = await getEnviromentInfo(generalConfigMap.get('sourceEnviroment'));
    echo(`\nQueryng sObjects`);
    progressBar.start(schemasToBeRetrieved.length, 0);

    for(const schemaName of schemasToBeRetrieved) { 
        sObject = Object.assign(new SObject, JSON.parse(readFile(`./sobjects/${schemaName}.json`)));

        job = await createQueryJob(sObject);
		jobStatus = await waitUntilFinishQuery(enviromentInfo, job);
		data = await getData(enviromentInfo, job);
		locator = data[0].get('sforce-locator');
		await writeFile(`./data/${schemaName}/${schemaName}.csv`, data[1]);

		stream = fs.createWriteStream(`./data/${schemaName}/${schemaName}.csv`, {flags:'a'});				
		
		while(locator) {
			data = await getData(enviromentInfo, job, locator);
			stream.write(removeFirstLine(data[1]));
			locator = data[0].get('sforce-locator');
		}

		stream.end();

		sObject.retrieveSuccessfully = true;
		await writeFile(`./sobjects/${schemaName}.json`, JSON.stringify(sObject, null, 2));
        progressBar.increment();
    }
}

function removeFirstLine(csvString) {
	const lines = csvString.split('\n');
	if (lines.length <= 1) {
	  return '';
	}
	lines.shift();
	return lines.join('\n');
}

async function buildGeneralDependencyTree() {
    const files  = readDirectory('./sobjects');
    const nodes = files.map(fileName => {
        return JSON.parse(readFile(`./sobjects/${fileName}`));
    });
    let tree = createTreeSorted(nodes);
    await writeFile('./config/sortedTree.json',  JSON.stringify(tree, null, 2));

    return tree;
}

//better function
function createTreeSorted(nodes) {
    const nodeMap = new Map(nodes.map(node => [node.name, node]));
    const nodeNames = new Set(nodeMap.keys());
    const visited = new Set();
    const circularNodes = new Set();
    const treeNodes = [];
  
    function buildNode(nodeName, parentNodeName) {
      if (visited.has(nodeName)) {
        circularNodes.add(nodeName);
        return { name: nodeName, circular: true, childCount: 0, children: [] };
      }
  
      visited.add(nodeName);
      const node = nodeMap.get(nodeName);
      const children = [];
  
      for (const field of node.fields) {
        if (field.type === "reference") {
          const childNodeName = field.referenceTo[0]; //TODO:use all referenceTo
  
          if (!nodeNames.has(childNodeName)) {
            continue;
          }
  
          if (childNodeName === parentNodeName) {
            continue;
          }
  
          const childNode = buildNode(childNodeName, nodeName);
          if (childNode.circular) {
            children.push({ name: childNodeName, circular: true, childCount: 0, children: [] });
            circularNodes.add(childNodeName);
          } else {
            children.push(childNode);
          }
        }
      }
  
      visited.delete(nodeName);
      const childCount = children.reduce((sum, child) => sum + child.childCount + 1, 0);
      return { name: nodeName, children, circular: circularNodes.has(nodeName), childCount };
    }
  
    for (const node of nodes) {
      if (!nodeNames.has(node.name)) {
        continue;
      }
      const treeNode = buildNode(node.name, null);
      treeNodes.push(treeNode);
    }
  
    const circularNodeSet = new Set([...circularNodes]);
    for (const treeNode of treeNodes) {
      if (circularNodeSet.has(treeNode.name)) {
        continue;
      }
      const containsCircular = treeNode.children.some(child => child.circular);
      if (containsCircular) {
        circularNodeSet.add(treeNode.name);
        treeNode.circular = true;
      }
    }
  
    const circularNodesArr = [...circularNodeSet].map(name => ({ name, circular: true, childCount: 0, children: [] }));
    const mergedNodes = treeNodes.concat(circularNodesArr);

    const sortedTree =  mergedNodes.sort((a, b) => a.childCount - b.childCount);

    const treeMap = new Map();
    for(const node of sortedTree) {
        treeMap.set(node.name, node);
    }

    return [...treeMap.values()].sort((a, b) => a.childCount - b.childCount);
}

function postOrderTraversal(tree) {
    let result = [];
  
    function traverse(node) {
      if (node.children.length > 0) {
        node.children.forEach(child => {
          traverse(child);
        });
      }
      result.push(node.name);
    }
  
    traverse(tree);
  
    return result;
}

async function generateResultAnalysis(sObject) {
    const [targetRecords, sourceRecords] = await Promise.all([
        csvtojsonV2().fromFile(`./data/${sObject.name}/${sObject.name}_success.csv`),
        csvtojsonV2().fromFile(`./data/${sObject.name}/${sObject.name}.csv`)
    ]);

    const externalFieldName = sObject.upsertConfig.externalIdFieldName;

    const sourceRecordsByExternalId = new Map();
    for(const sourceRecord of sourceRecords) {
        sourceRecordsByExternalId.set(sourceRecord[externalFieldName], sourceRecord);
    }

    const targetRecordsByExternalId = new Map();
    for(const targetRecord of targetRecords) {
        targetRecordsByExternalId.set(targetRecord[externalFieldName], targetRecord);
    }

    const analysisResults = {};
    const salesforceIdRegex = /^[a-zA-Z0-9]{18}$|^[a-zA-Z0-9]{15}$/;
    const fieldsInQuery = sObject.fieldsInQuery;
    let targetRecord = {};

    analysisResults.sameNumberOfRecords = targetRecords.length == sourceRecords.length;
    analysisResults.sourceNumberOfRecords = sourceRecords.length;
    analysisResults.targetNumberOfRecordsUpserted = targetRecords.length;
    analysisResults.diffs = [];

    for(const [ externalValue, sourceRecord ] of sourceRecordsByExternalId.entries()) {
        if(!targetRecordsByExternalId.has(externalValue)) {
            analysisResults.diffs.push({
                externalValue,
                diffs: [{
                    field: null,
                    sourceValue: null,
                    targetValue: null                    
                }],
                note: 'this record was not inserted in target org'
            });
            continue;
        }

        targetRecord = targetRecordsByExternalId.get(externalValue);

        for(const field of fieldsInQuery) {
            if(salesforceIdRegex.test(targetRecord[field]) && salesforceIdRegex.test(sourceRecord[field])) {
                continue;       
            }

            if(targetRecord[field] != sourceRecord[field]) {
                analysisResults.diffs.push({
                    externalValue,
                    diffs: [{
                        field,
                        sourceValue: sourceRecord[field],
                        targetValue: targetRecord[field]
                    }],
                    note: ''
                }); 
            }
        }
    }

    return analysisResults;
}

async function setDefaultOrg(org) {
    try {
        echo(`Setting ${org} as default`);
        await spinner(async () => await $`sf config set target-org=${org} --global --json`);
        echo(`Setting ${org} as default: ✅ \n`);
    } catch(err) {
        echo(`Setting ${org} as default: ❌ \n`);
        console.log(err);
        throw new Error(`The script wasn't able to set ${org} as default, pls, try to use: 
            sf login web org --instance-url https://<Custom Domain>.sandbox.my.salesforce.com -a ${org}
            before runnnig again.`);
    }
}

async function createUpsertBulkJob(enviromentInfo, sObject) {
    return fetch(`${enviromentInfo.instanceUrl}/services/data/v57.0/jobs/ingest`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${enviromentInfo.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(sObject.upsertConfig),
    }).then((response) => response.json())
}

async function uploadJobData(enviromentInfo, job, sObject) {
    return fetch(`${enviromentInfo.instanceUrl}/services/data/v57.0/jobs/ingest/${job.id}/batches`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${enviromentInfo.accessToken}`,
            'Content-Type': 'text/csv'
        },
        body: readFile(`./data/${sObject.name}/${sObject.name}.csv`),
    });
}

async function closeJob(enviromentInfo, job) {
    return fetch(`${enviromentInfo.instanceUrl}/services/data/v57.0/jobs/ingest/${job.id}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${enviromentInfo.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ state :'UploadComplete' }),
    }).then((response) => response.json());
}

async function waitUntilFinish(enviromentInfo, job) {
    let jobStatus;
    
    while(!isJobFinished(jobStatus)) {
        jobStatus = await getJobStatus(enviromentInfo, job);

        if(!isJobFinished(jobStatus)) {
            await sleep(10000);
        }        
    }

    return jobStatus;
}

async function sleep(msec) {
    return new Promise(resolve => setTimeout(resolve, msec));
}

async function getJobSuccessRecords(enviromentInfo, job) {
    return fetch(`${enviromentInfo.instanceUrl}/services/data/v57.0/jobs/ingest/${job.id}/successfulResults`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${enviromentInfo.accessToken}`
        }
    }).then((response) => response.text());
}

async function getFailedRecords(enviromentInfo, job) {
    return fetch(`${enviromentInfo.instanceUrl}/services/data/v57.0/jobs/ingest/${job.id}/failedResults`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${enviromentInfo.accessToken}`
        }
    }).then((response) => response.text());
}

async function getJobStatus(enviromentInfo, job) {
    return fetch(`${enviromentInfo.instanceUrl}/services/data/v57.0/jobs/ingest/${job.id}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${enviromentInfo.accessToken}`,
            'X-PrettyPrint': '1'
        }
    }).then((response) => response.json());
}

async function getEnviromentInfo(org) {
    const response = await $`sf org display user --json`;
    const currentUser = JSON.parse(response.stdout);

    if(currentUser.status != 0 || currentUser.result.alias != org) {
        throw new Error(`not able to get access token for current org: ${org}`);
    }

    echo(currentUser.result.alias);
    return currentUser.result; 
}

async function getSobject(sobject) {
    const response = await spinner(async () => await $`sf sobject describe --sobject ${sobject} --json`);
    const metadataSobject = JSON.parse(response.stdout);
    const { fields, name, childRelationships }  = metadataSobject.result;

    return new SObject(name, fields, childRelationships);
}

async function createQueryJob(sobject) {
    await $`mkdir -p ./data/${sobject.name}`;
    await $`touch ./data/${sobject.name}/${sobject.name}.csv`;
    const data = await $`sf data query --query ${sobject.query} --bulk --json --async`;
	return JSON.parse(data.stdout).result;
}

async function waitUntilFinishQuery(enviromentInfo, job) {
    let jobStatus;

    while(!isJobFinished(jobStatus)) {
        jobStatus = await getQueryJobStatus(enviromentInfo, job);
        if(!isJobFinished(jobStatus)) {
            await sleep(10000);
        }        
    }

    return jobStatus;
}

async function getQueryJobStatus(enviromentInfo, job) {
	return fetch(`${enviromentInfo.instanceUrl}/services/data/v57.0/jobs/query/${job.id}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${enviromentInfo.accessToken}`
        }
    }).then((response) => response.json());
}

async function getData(enviromentInfo, job, locator = null) {
	let payload = {
		maxRecords: 50000
	};

	if(locator) {
		payload.locator = locator;
	}

	return fetch(`${enviromentInfo.instanceUrl}/services/data/v57.0/jobs/query/${job.id}/results?${new URLSearchParams(payload)}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${enviromentInfo.accessToken}`
        }
    }).then((response) => { 
		return Promise.all([ Promise.resolve(response.headers), response.text() ]);
	});
}

function loadOverwritesMap() {
    const overwrites = JSON.parse(readFile('./config/overwrite.json'));

    return overwrites.reduce((overwriteByName, overwrite) => {
        overwriteByName.set(overwrite.name, overwrite);
        return overwriteByName;
    }, new Map());
}

function loadGeneralConfigMap() {
    const enviromentInfo = JSON.parse(readFile('./config/generalConfig.json'));
    return new Map(Object.entries(enviromentInfo));
}

function startMetrics() {
    console.time('Execution Time');
}

function stopMetrics() {
    console.timeEnd('Execution Time');

    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    echo(`The script uses approximately ${Math.round(used * 100) / 100} MB`);
}

function isJobFinished(jobStatus) {
    return (jobStatus?.state == 'JobComplete' || jobStatus?.state == 'Failed' || jobStatus?.state == 'Aborted');
}

function readFile(path, encode = 'utf8') {
    return fs.readFileSync(path, encode);
}

async function writeFile(path, source) {
    fs.writeFileSync(path, source);
}

function readDirectory(path) {
    return fs.readdirSync(path);
}