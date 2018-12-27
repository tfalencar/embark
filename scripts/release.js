/* global __dirname process require */

const chalk = require('chalk');
const {execSync} = require('child_process');
const minimist = require('minimist');
const path = require('path');
const {prompt} = require('promptly');
const semver = require('semver');

const args = minimist(process.argv.slice(2));

const DEFAULT_BUMP = null;
const bump = args._[0] || DEFAULT_BUMP;

const DEFAULT_COMMIT_MSG = `chore(release): %v`;
const commitMsg = args['commit-message'] || DEFAULT_COMMIT_MSG;

const DEFAULT_DIST_TAG = `latest`;
const distTag = args['dist-tag'] || DEFAULT_DIST_TAG;

const DEFAULT_GIT_BRANCH = `master`;
const branch = args['git-branch'] || DEFAULT_GIT_BRANCH;

const DEFAULT_GIT_REMOTE = `origin`;
const remote = args['git-remote'] || DEFAULT_GIT_REMOTE;

const DEFAULT_PRE_ID = null;
const preId = args.preid || DEFAULT_PRE_ID;

const DEFAULT_SIGN = false;
const sign = args.sign || DEFAULT_SIGN;

const cyan = (str) => chalk.cyan(str);
const execSyncInherit = (cmd) => execSync(cmd, {stdio: 'inherit'});
const log = (mark, str, which = 'log') => console[which](
  mark, str.filter(s => !!s).join(` `)
);
const logError = (...str) => log(chalk.red(`✘`), str, 'error');
const logInfo = (...str) => log(chalk.blue(`ℹ`), str);
const logSuccess = (...str) => log(chalk.green(`✔`), str);
const logWarning = (...str) => log(chalk.yellow('‼︎'), str);

const failMsg = `${chalk.red(`RELEASE FAILED!`)} Stopping right here.`;

const reportSetting = (desc, val, def) => {
  logInfo(`${desc} is set to ${cyan(val)}${val === def ? ` (default).`: `.`}`);
};

const runCommand = (cmd, inherit = true, display) => {
  logInfo(`Running command ${cyan(display || cmd)}.`);
  let out;
  if (inherit) {
    execSyncInherit(cmd);
  } else {
    out = execSync(cmd);
  }
  return out;
};

(async () => {
  try {
    let DEFAULT_REGISTRY, registry;
    const lernaJsonPath = path.join(__dirname, '../lerna.json');
    try {
      const lernaJson = require(lernaJsonPath);

      DEFAULT_REGISTRY = lernaJson.command.publish.registry;
      if (!DEFAULT_REGISTRY) throw new Error('missing registry in lerna.json');
      registry = args.registry || DEFAULT_REGISTRY;
    } catch (e) {
      console.error(e.stack);
      logError(
        `Could not read values from ${cyan(lernaJsonPath)}.`,
        `Please check the error above.`
      );
      throw new Error();
    }

    logInfo(`Checking the working tree...`);

    try {
      runCommand(`npm run --silent cwtree`, true, `npm run cwtree`);
      logSuccess(`Working tree is clean.`);
    } catch (e) {
      logError(
        `Working tree is dirty or has untracked files.`,
        `Please make necessary changes or commits before rerunning this script.`
      );
      throw new Error();
    }

    reportSetting(`Release branch`, branch, DEFAULT_GIT_BRANCH);
    logInfo(`Determining the current branch...`);

    let currentBranch;
    try {
      currentBranch = runCommand(`git rev-parse --abbrev-ref HEAD`, false)
        .toString()
        .trim();
    } catch (e) {
      logError(`Couldn't determine the branch. Please check the error above.`);
      throw new Error();
    }

    if (currentBranch === branch) {
      logSuccess(`Current branch and release branch are the same.`);
    } else {
      logError(
        `Current branch ${cyan(currentBranch)} is not the same as release`,
        `branch ${cyan(branch)}. Please checkout the release branch before`,
        `rerunning this script or rerun with`,
        `${cyan(`--git-branch ${currentBranch}`)}.`
      );
      throw new Error();
    }

    reportSetting(`Git remote`, remote, DEFAULT_GIT_REMOTE);
    logInfo(
      `Fetching commits from ${cyan(remote)}`,
      `to compare local and remote branches...`
    );

    try {
      runCommand(`git fetch ${remote}`, false);
    } catch (e) {
      logError(`Couldn't fetch latest commits. Please check the error above.`);
      throw new Error();
    }

    let localRef, remoteRef;
    try {
      localRef = runCommand(`git rev-parse ${branch}`, false).toString().trim();
      remoteRef = (
        runCommand(`git rev-parse ${remote}/${branch}`, false).toString().trim()
      );
    } catch (e) {
      logError(`A problem occured. Please check the error above.`);
      throw new Error();
    }

    if (localRef === remoteRef) {
      logSuccess(`Local branch is in sync with remote branch.`);
    } else {
      logError(
        `Local branch ${cyan(branch)} is not in sync with`,
        `${cyan(`${remote}/${branch}`)}.`,
        `Please sync branches before rerunning this script.`
      );
      throw new Error();
    }

    logInfo(
      `It's time to run the QA suite, this will take awhile...`
    );

    try {
      runCommand(`npm run qa`);
      logSuccess(`All steps succeeded in the QA suite.`);
    } catch (e) {
      logError(`A step failed in the QA suite. Please check the error above.`);
      throw new Error();
    }

    logInfo(`Versioning with Lerna...`);
    if (bump) reportSetting(`Version bump`, bump, DEFAULT_BUMP);
    reportSetting(`Commit message format`, commitMsg, DEFAULT_COMMIT_MSG);
    if (preId) reportSetting(`Prerelease identifier`, preId, DEFAULT_PRE_ID);
    reportSetting(`Signature option`, sign, DEFAULT_SIGN);

    const lernaVersion = [
      `lerna version`,
      bump || ``,
      `--conventional-commits`,
      `--message "${commitMsg}"`,
      `--no-push`,
      (preId && `--preid ${preId}`) || ``,
      (sign && `--sign-git-commit`) || ``,
      (sign && `--sign-git-tag`) || ``
    ].filter(str => !!str).join(` `);

    try {
      runCommand(lernaVersion);
      if (localRef !==
          runCommand(`git rev-parse ${branch}`, false).toString().trim()) {
        logSuccess(`Successfully bumped the version.`);
      } else {
        logWarning(
          chalk.yellow(`RELEASE STOPPED!`),
          `No commit or tag was created. No packages were published.`
        );
        process.exit(0);
      }
    } catch (e) {
      console.error();
      logError(`Couldn't bump the version. Please check the error above.`);
      let infoMsg;
      if (localRef !==
          runCommand(`git rev-parse ${branch}`, false).toString().trim()) {
        infoMsg = [
          `No packages were published, but a local commit and tag were created`,
          `and ${cyan(`${branch}`)} and ${cyan(`${remote}/${branch}`)}`,
          `branches are out of sync.`
        ].join(' ');
      } else {
        infoMsg = [
          `No packages were published and no commit has been added to this`,
          `branch, but a local tag may have been created and would need to be`,
          `cleaned up before rerunning this script.`
        ].join(' ');
      }
      logError(failMsg, infoMsg);
      process.exit(1);
    }

    logInfo(`Publishing with Lerna...`);
    reportSetting(`Package distribution tag`, distTag, DEFAULT_DIST_TAG);
    reportSetting(`Package registry`, registry, DEFAULT_REGISTRY);

    const lernaPublish = [
      `lerna publish`,
      `from-git`,
      `--dist-tag ${distTag}`,
      `--registry ${registry}`,
      `--yes`
    ].join(` `);

    try {
      runCommand(lernaPublish);
      logSuccess(`Successfully published the new version.`);
    } catch (e) {
      console.error();
      logError(
        `Couldn't publish the new version. Please check the error above.`,
      );
      logError(
        failMsg,
        `Packages were not published, but a local commit and tag were created`,
        `and ${cyan(`${branch}`)} and ${cyan(`${remote}/${branch}`)} branches`,
        `are out of sync.`
      );
      process.exit(1);
    }

    logInfo(
      `Pushing release commit and tag to remote ${cyan(remote)} on branch`,
      `${cyan(branch)}...`
    );

    const gitPush = `git push --follow-tags ${remote} ${branch}`;

    try {
      runCommand(gitPush);
      logSuccess(`Successfully pushed.`);
    } catch (e) {
      logError(`Couldn't push. Please check the error above.`);
      logError(
        failMsg,
        `Packages were published and a local commit and tag were created, but`,
        `${cyan(`${branch}`)} and ${cyan(`${remote}/${branch}`)} branches are`,
        `out of sync.`
      );
      process.exit(1);
    }

    logSuccess(`${chalk.green(`RELEASE SUCCEEDED!`)} Woohoo! Done.`);
  } catch (e) {
    logError(
      failMsg,
      `Make sure to clean up the working tree, commits, and tags as necessary.`,
      `Check the package registry to verify no packages were published.`
    );
    process.exit(1);
  }
})();
