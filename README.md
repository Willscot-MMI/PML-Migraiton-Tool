# Salesforce Data Migration Tool

This Node.js tool helps you migrate records from one Salesforce instance to another. The tool uses a set of configuration files to manage the migration process and offers various features to ensure a smooth data transfer.

[![See how it works]](https://screenpal.com/watch/c0eZ06V4WLJ)

## Configuration

### 1. GeneralConfig.json

This file is used to configure the default external ID, the source org, and the target org. The default external ID will be used only if the sObject has the field, else, the script will choose another external ID.

`{
    "defaultExternalId" : "External_Id__c",
    "sourceEnviroment": "ProductionFusion",
    "targetEnviroment": "Neuraflash"
}` 

### 2. sObjects.json

This file contains the sObjects to be migrated in the given JSON order.

### 3. overwrite.json

This file is used to overwrite the generated query and/or the external field. The `name` property is mandatory, and the other fields are optional.

`[
    {
        "name": "ServiceReportLayout",
        "query": "SELECT DeveloperName, MasterLabel, TemplateType FROM ServiceReportLayout",
        "externalIdFieldName": "MasterLabel"
    }
]` 

### 4. exceptionFields.json

This file is used to avoid fields to be retrieved during the migration process.

## Execution

To execute the script, simply use:

`node index.mjs`  
Or if you want to debug
`node --max-old-space-size=4096 --inspect index.mjs`

Upon execution, you will see the following menu:

1.  **Get sObject Schema From Source Org**: Retrieve the schema of an sObject.
2.  **Query sObject From Source Org**: Query the writable and creatable fields of an sObject.
3.  **Load sObject To Target Org**: Upload the data retrieved from the "Query sObject" operation.
4.  **Analysis on sObject**: Compare the results of your upsertion and the source data.

## File Structure

-   All schemas are stored in the `sobjects` folder.
-   All data is stored in the `data` folder, separated by sObject.
-   All configuration files are stored in the `config` folder.

## Requirements

-   Node.js
-   npm
-   Unix-based OS

# Installation and Setup

Follow the steps below to install and set up the Salesforce Data Migration Tool:

## Step 1: Install Node.js and npm

Ensure that you have Node.js and npm installed on your system. You can download Node.js from the [official website](https://nodejs.org/) and npm will be included in the installation.

## Step 2: Clone the Repository

Clone the Salesforce Data Migration Tool repository to your local machine using Git or download it as a ZIP file.

## Step 3: Install Dependencies

Navigate to the root directory of the cloned repository and run the following command to install the required dependencies:

`npm install`

## Step 4: Configure the Tool

Edit the configuration files in the `config` folder to match your source and target Salesforce instances:

-   Update `GeneralConfig.json` with the correct default external ID, source environment, and target environment.
-   Update `sObjects.json` with the list of sObjects you want to migrate.
-   Update `overwrite.json` with any necessary query or external field overwrites.
-   Update `exceptionFields.json` to list any fields you want to exclude from the migration.

## Step 5: Run the Tool

Execute the script using the following command:

`node index.mjs` 

Choose an option from the menu to perform the desired operation:

1.  **Get sObject Schema From Source Org**: Retrieve the schema of an sObject.
2.  **Query sObject From Source Org**: Query the writable and creatable fields of an sObject.
3.  **Load sObject To Target Org**: Upload the data retrieved from the "Query sObject" operation.
4.  **Analysis on sObject**: Compare the results of your upsertion and the source data.

Repeat the process for each sObject you want to migrate. Once the migration is complete, verify the data in your target Salesforce instance.

# Conclusion

The Salesforce Data Migration Tool is a powerful Node.js-based utility that simplifies the process of migrating records between Salesforce instances. By using this tool, you can ensure that your data is transferred accurately and efficiently. Customize the configuration files to suit your specific migration needs and use the provided menu options to perform various operations throughout the migration process.
