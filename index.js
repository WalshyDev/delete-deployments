import fetch from 'node-fetch';
import readline from 'readline';
import fs from 'fs/promises';

const projectName = 'pages-testing';
const notBranches = [];
const olderThanDays = 30;

const currentTime = Date.now();
// 30 days * 24 hours * 60 mins * 60 secs * 1000 milliseconds
const olderThanInMs = olderThanDays * 24 * 60 * 60 * 1000;
const olderThanTime = currentTime - olderThanInMs;

const VERBOSE = false;

// accounts/:account_id/pages/projects/:project_name/deployments
async function fetchDeployments(page = 1) {
  const res = await callApi(`/pages/projects/${projectName}/deployments?page=${page}&per_page=25`, 'GET');

  const removableDeployments = [];
  
  if (res === null) {
    console.error('Failed to fetch deployments... retrying...');
    const deps = await fetchDeployments(page);
    removableDeployments.push(...deps);
    return;
  }

  const deployments = res.result;
  for (const deployment of deployments) {
    const createdOn = Date.parse(deployment.created_on);

    const metadata = deployment.deployment_trigger.metadata;
    // If it's older than x days and is an allowed branch, add to the removal list
    if (createdOn < olderThanTime && !notBranches.includes(metadata.branch)) {
      console.log(`${deployment.id} - [${metadata.branch}] ${metadata.commit_message} (${metadata.commit_hash})`);
      removableDeployments.push(deployment.id);
    }
  }

  if (deployments.length > 0) {
    const deps = await fetchDeployments(page + 1);
    removableDeployments.push(...deps);
  }

  return removableDeployments;
}

// accounts/:account_id/pages/projects/:project_name/deployments/:deployment
async function removeOldDeployments(deployments) {
  for (const deployment of deployments) {
    const res = await callApi(`/pages/projects/${projectName}/deployments/${deployment}`, 'DELETE');

    if (res === null) {
      console.error(`Failed to delete ${deployment}`);
    } else {
      console.log(`Successfully deleted ${deployment}`);
    }
  }
}

async function callApi(path, method) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.ACCOUNT_ID}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.API_TOKEN}`
    }
  });

  if (VERBOSE) {
    console.log(`[${res.status}] ${method} ${path}`);
  }

  if (res.ok) {
    return await res.json();
  } else {
    // Don't even try to parse JSON, we can easily get a HTML page back
    const body = await res.text();

    console.error(`Failed call to ${method} ${path}`);
    console.error(`Got back ${res.status} - body: ${body}`);
    return null;
  }
}

function prompt(query) {
  const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
      rl.close();
      resolve(ans);
  }))
}

async function run() {
  if (!process.env.ACCOUNT_ID) {
    console.error('Please specify the "ACCOUNT_ID" env var!');
    process.exit(1);
  }

  if (!process.env.API_TOKEN) {
    console.error('Please specify the "API_TOKEN" env var!');
    process.exit(1);
  }

  console.log('Fetching deployments which can be deleted...');
  const deploymentList = await fetchDeployments(1);

  await fs.writeFile('deployments.txt', deploymentList.join('\n'));

  console.log();
  const ans = await prompt('Are you sure you want to remove all these deployments? [y/N] ');
  console.log();
  if (ans.toLowerCase() !== 'y' && ans.toLowerCase() !== 'yes') {
    console.error('Confirmation not given, exiting!');
    process.exit(1);
  }

  removeOldDeployments(deploymentList);
}

run();