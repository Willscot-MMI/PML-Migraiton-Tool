import inquirer from 'inquirer';
import { allSObjectInputsConst, particularSObjectInputsConst } from './config/constants.js';

async function executeInput() {
    const allSObjectInputsMap = new Map(Object.entries(allSObjectInputsConst));
    const particularSObjectInputsMap = new Map(Object.entries(particularSObjectInputsConst));
    const allSObjectInputsSet = new Set([...allSObjectInputsMap.values()]);
    const particularSObjectInputsSet = new Set([...particularSObjectInputsMap.values()]);

    const allSObjectInputs = [];
    for(const [key, input] of allSObjectInputsSet.entries()) {
        allSObjectInputs.push({
            name: input
        });
    }

    const particularSObjectInputs = [];
    for(const [key, input] of particularSObjectInputsSet.entries()) {
        particularSObjectInputs.push({
            name: input
        });
    }

    const memory = [];

    return inquirer
    .prompt([
        {
        type: 'checkbox',
        message: 'Select logic to execute',
        name: 'logic',
        pageSize: `${allSObjectInputsSet.size + particularSObjectInputsSet.size + 2}`,
        choices: [
            new inquirer.Separator(' = All sObjects = '),
            ...allSObjectInputs
            ,
            new inquirer.Separator(' = Only one sObject = '),
            ...particularSObjectInputs
        ],
        validate(answers) {
            if(answers.length < 1) {
                return 'You must choose at least one option.';
            }

            if(answers.length == 9) {
                return `Don't use toggle all.`;
            }

            if(answers.includes(allSObjectInputsConst.RESUME) && answers.includes(allSObjectInputsConst.EXECUTE_ALL)) {
                return `the options '${allSObjectInputsConst.RESUME}' & '${allSObjectInputsConst.EXECUTE_ALL}' can't be selected at the same time.`;
            }

            const [hasAllSObjects, hasParticularSObject] = answers.reduce((acc, answer) => {
                if(!acc[0]) {
                    acc[0] = allSObjectInputsSet.has(answer);
                }

                if(!acc[1]) {
                    acc[1] = particularSObjectInputsSet.has(answer);
                }

                return acc;
            }, [false, false]);

            if(hasAllSObjects && hasParticularSObject) {
                return 'Choose only one category!'
            }

            return true;
        },
        },
    ])
    .then(answers => {
        if(particularSObjectInputsSet.has(answers.logic[0])) {
            memory.push(answers);
            return inquirer
                .prompt([
                    {
                        type: 'input',
                        message: `What's the sObject?`,
                        name: 'sObject',
                        validate(answer) {
                            if(answer == null) {
                                return 'Pls, enter name of the sObject';
                            }

                            return true;
                        }
                    },
                ]);
        }

        return Promise.resolve(answers);
    })
    .then(answers => {
        memory.push(answers);

        return Promise.resolve(memory);
    });
}

  export default executeInput;