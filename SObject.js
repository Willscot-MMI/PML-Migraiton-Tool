import { writeFile } from './modules/files.js'
import { $ } from 'zx';
import csvtojsonV2 from 'csvtojson';

export default class SObject {
    name;
    fields;
    childRelationships;
    query;
    isQueryOverwrite;
    upsertConfig;
    jobStatus;    
    retrieveSuccessfully;
    relationshipFields;

    constructor(name, fields, childRelationships) {
        this.name = name;
        this.fields = fields;
        this.childRelationships = childRelationships;
    }

    get externalIds() {
        return this.createableAndUpdateableFields.filter(field => field.externalId);
    }

    get createableAndUpdateableFields() {
        return this.fields.filter(field => (field.calculated == false && field.createable == true && field.updateable == true));
    }

    get createableAndUpdateableFieldsByName() {
        return this.createableAndUpdateableFields.reduce((map, field) => {
            map.set(field.name, field);
            return map;
        } ,new Map());
    }

    get relationFields() {
        return this.fields.filter(field => {
            return field.referenceTo.length > 0 || field.type == 'reference'
        });
    }

    get relationFieldsByNameMap() {
        return this.relationFields.reduce((map, field) => {
                map.set(field.name, field);
                return map;
            }, new Map());
    }

    get circularRelations() {
        return this.relationFields.filter(field => {
            if(field.referenceTo.length == 0) {
                return false;   
            }
    
            for(const reference of field.referenceTo) {
                if(reference.toLowerCase() == this.name.toLowerCase()) {
                    return true;
                }
            }
        }).reduce((map, field) => {
            map.set(field.name, field);        
            return map;
        }, new Map());
    }

    get circularRelationsByNameMap() {
        return this.circularRelations.reduce((map, field) => {
            map.set(field.name, field);        
            return map;
        }, new Map());
    }

    get upsertableFields() {
        return this.fields.filter(field => field.idLookup);
    }

    get insertedSuccessfully() {
        return this.jobStatus?.numberRecordsFailed == 0 && this.jobStatus?.state == 'JobComplete';
    }

    get fieldsInQuery() {
        if(this.query == null) {
            return [];
        }

        const regex = /SELECT([^<]*)FROM/;
        const match = this.query.match(regex); 

        return match[1].replaceAll(' ', '')?.split(',');    
    }

    buildQuery(exceptions, overwritesMap) {
        if(overwritesMap.has(this.name)) {
            this.query = overwritesMap.get(this.name).query;
            this.isQueryOverwrite = true;
            return;
        }

        const exceptionFields = new Set(exceptions);
        const queryField = this.createableAndUpdateableFields.reduce((fields, field) => {
            if(exceptionFields.has(field.name)) {
                return fields;
            }
    
            return `${fields}, ${field.name}`
        } , '');
        let baseQuery = `SELECT ${queryField} FROM ${this.name}`;
        this.query = baseQuery.replace('SELECT ,', 'SELECT ');
        this.isQueryOverwrite = false;
    }

    async buildUpsertConfig(defaultExternalId, overwritesMap) {
        const hasDefaultExternalId = this.externalIds.find(field => (field.name == defaultExternalId && field.externalId)) ? true : false;
        let externalIdFieldName = '';

        if(overwritesMap.has(this.name) && overwritesMap.has(this.name).externalIdFieldName) {
            externalIdFieldName = overwritesMap.get(this.name).externalIdFieldName;
        } else if(hasDefaultExternalId) {
            externalIdFieldName = defaultExternalId;
        } else if(this.externalIds.length > 0 || this.upsertableFields.length > 0 ) {            
            externalIdFieldName = await this.getBetterExternalId();
        }

        this.upsertConfig = {
            externalIdFieldName,
            object : this.name,
            contentType : "CSV",
            operation : "upsert",
            lineEnding : "LF"
        }
    }

    async getBetterExternalId() {
        const fieldCandidates = this.externalIds.concat(this.upsertableFields).reduce((fields, field) => {    
            return `${fields}, COUNT(${field.name})`
        } , '');

        this.countExternalQuery = `SELECT ${fieldCandidates} FROM ${this.name}`.replace('SELECT ,', 'SELECT ');
        const csvData = await $`sf data query --query ${this.countExternalQuery} -r csv`;
        await writeFile(`./data/${this.name}/${this.name}_externalCount.csv`, csvData.stdout);

        const response = await csvtojsonV2().fromFile(`./data/${this.name}/${this.name}_externalCount.csv`);
        const countByField = new Map(Object.entries(response[0]));
        const totalRecords = countByField.get('count(Id)');
        const regex = /count\((.*?)\)/;
        let externalId = '';
        let lastValue = 0;

        for(const [key, value] of countByField.entries()) {
            if(key == 'count(Id)') {
                continue;
            }

            if(value == totalRecords || value > lastValue) {
                externalId = key.match(regex)[1];           
            }

            lastValue = value;
        }

        return externalId;
    }

    saveRelationshipFields() {
        this.relationshipFields = this.relationFields.map(field => field.name);
    }
}