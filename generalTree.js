import fs from "fs";

const files  = readDirectory('./sobjects');
const testNodes = files.map(fileName => {
    return JSON.parse(readFile(`./sobjects/${fileName}`));
});

//writeFile('./test.json',  JSON.stringify(createTree(testNodes), null, 2));
writeFile('./testSorted.json',  JSON.stringify(createTreeSorted(testNodes), null, 2));


function createTree(nodes) {
    const nodeMap = new Map(nodes.map(node => [node.name, node]));
    const nodeNames = new Set(nodeMap.keys());
    const visited = new Set();
    const treeNodes = [];
  
    function buildNode(nodeName, parentNodeName) {
      if (visited.has(nodeName)) {
        return { name: nodeName, circular: true };
      }
  
      visited.add(nodeName);
      const node = nodeMap.get(nodeName);
      const children = [];
  
      for (const field of node.fields) {
        if (field.type === "reference") {
          const childNodeName = field.referenceTo[0];
  
          if (!nodeNames.has(childNodeName)) {
            continue;
          }
  
          if (childNodeName === parentNodeName) {
            continue;
          }
  
          const childNode = buildNode(childNodeName, nodeName);
          if (childNode.circular) {
            children.push({ name: childNodeName, circular: true });
          } else {
            children.push(childNode);
          }
        }
      }
  
      visited.delete(nodeName);
      return { name: nodeName, children, circular: false };
    }
  
    for (const node of nodes) {
      if (!nodeNames.has(node.name)) {
        continue;
      }
      const treeNode = buildNode(node.name, null);
      treeNodes.push(treeNode);
    }
  
    return treeNodes;
}

function createTreeSorted(nodes) {
    const nodeMap = new Map(nodes.map(node => [node.name, node]));
    const nodeNames = new Set(nodeMap.keys());
    const visited = new Set();
    const treeNodes = [];
  
    function buildNode(nodeName, parentNodeName) {
      if (visited.has(nodeName)) {
        return { name: nodeName, circular: true, childCount: 0 };
      }
  
      visited.add(nodeName);
      const node = nodeMap.get(nodeName);
      const children = [];
  
      for (const field of node.fields) {
        if (field.type === "reference") {
          const childNodeName = field.referenceTo[0];
  
          if (!nodeNames.has(childNodeName)) {
            continue;
          }
  
          if (childNodeName === parentNodeName) {
            continue;
          }
  
          const childNode = buildNode(childNodeName, nodeName);
          if (childNode.circular) {
            children.push({ name: childNodeName, circular: true, childCount: 0 });
          } else {
            children.push(childNode);
          }
        }
      }
  
      visited.delete(nodeName);
      const childCount = children.reduce((sum, child) => sum + child.childCount + 1, 0);
      return { name: nodeName, children, circular: false, childCount };
    }
  
    for (const node of nodes) {
      if (!nodeNames.has(node.name)) {
        continue;
      }
      const treeNode = buildNode(node.name, null);
      treeNodes.push(treeNode);
    }
  
    return treeNodes.sort((a, b) => a.childCount - b.childCount);
}
    

function readDirectory(path) {
    return fs.readdirSync(path);
}

function readFile(path, encode = 'utf8') {
    return fs.readFileSync(path, encode);
}

async function writeFile(path, source) {
    fs.writeFileSync(path, source);
}