/*globals describe, it, before*/
const assert = require('assert');
const TemplateGenerator = require('../lib/utils/template_generator');
const semver = require('semver');
const sinon = require('sinon');
const request = require('request');

describe('TemplateGenerator', function () {
  describe('getExternalProject', function () {
    let templateGenerator;

    before(() => {
      templateGenerator = new TemplateGenerator();
      sinon.stub(request, 'get').callsFake((options, callback) => {
        if (options.url.indexOf('status-im/dreddit-devcon') > 0) {
          return callback(null, {}, {default_branch: 'start'});
        }
        callback(null, {}, {default_branch: 'master'});
      });
    });

    describe('with named template', function () {

      it('returns correct info for named template', function () {
        let result = templateGenerator.getExternalProject("typescript");
        let embarkVersion = semver(require('../../package.json').version);
        let branch = `${embarkVersion.major}.${embarkVersion.minor}`;
        assert.strictEqual(result.url, `https://codeload.github.com/embark-framework/embark-typescript-template/tar.gz/${branch}`);
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), `.embark/templates/embark-framework/embark-typescript-template/${branch}/archive.zip`);
        assert.strictEqual(result.browse, `https://github.com/embark-framework/embark-typescript-template/tree/${branch}`);

        result = templateGenerator.getExternalProject("typescript#features/branch");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark-typescript-template/tar.gz/features%2Fbranch");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark-typescript-template/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/embark-framework/embark-typescript-template/tree/features/branch");
      });
    });

    describe('with git host URL', function () {

      it('returns correct info for GitHub URL', async function () {
        let result = await templateGenerator.getExternalProject("https://github.com/embark-framework/embark");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark/tar.gz/master");

        result = await templateGenerator.getExternalProject("https://github.com/embark-framework/embark");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark/tar.gz/master");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/embark-framework/embark");

        result = await templateGenerator.getExternalProject("https://github.com/embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark/tar.gz/features%2Fbranch");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/embark-framework/embark/tree/features/branch");
      });

      it('returns correct info for Bitbucket URL', async function () {
        let result = await templateGenerator.getExternalProject("https://bitbucket.org/embark-framework/embark");
        assert.strictEqual(result.url, "https://bitbucket.org/embark-framework/embark/get/master.tar.gz");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://bitbucket.org/embark-framework/embark");

        result = await templateGenerator.getExternalProject("https://bitbucket.org/embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://bitbucket.org/embark-framework/embark/get/features%2Fbranch.tar.gz");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://bitbucket.org/embark-framework/embark/src/features/branch");
      });

      it('returns correct info for GitLab URL', async function () {
        let result = await templateGenerator.getExternalProject("https://gitlab.com/embark-framework/embark");
        assert.strictEqual(result.url, "https://gitlab.com/embark-framework/embark/repository/archive.tar.gz?ref=master");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://gitlab.com/embark-framework/embark");

        result = await templateGenerator.getExternalProject("https://gitlab.com/embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://gitlab.com/embark-framework/embark/repository/archive.tar.gz?ref=features%2Fbranch");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://gitlab.com/embark-framework/embark/tree/features/branch");
      });
    });

    describe('with git host shortcut', function () {
      it('returns correct info for GitHub shortcut', async function () {
        let result = await templateGenerator.getExternalProject("github:embark-framework/embark");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark/tar.gz/master");

        result = await templateGenerator.getExternalProject("embark-framework/embark");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark/tar.gz/master");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/embark-framework/embark");

        result = await templateGenerator.getExternalProject("embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark/tar.gz/features%2Fbranch");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/embark-framework/embark/tree/features/branch");

        result = await templateGenerator.getExternalProject("github.com/embark-framework/embark");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark/tar.gz/master");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/embark-framework/embark");

        result = await templateGenerator.getExternalProject("github.com/embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark/tar.gz/features%2Fbranch");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/embark-framework/embark/tree/features/branch");
      });

      it('returns correct info for Bitbucket shortcut', async function () {
        let result = await templateGenerator.getExternalProject("bitbucket:embark-framework/embark");
        assert.strictEqual(result.url, "https://bitbucket.org/embark-framework/embark/get/master.tar.gz");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://bitbucket.org/embark-framework/embark");

        result = await templateGenerator.getExternalProject("bitbucket:embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://bitbucket.org/embark-framework/embark/get/features%2Fbranch.tar.gz");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://bitbucket.org/embark-framework/embark/src/features/branch");

        result = await templateGenerator.getExternalProject("bitbucket.org/embark-framework/embark");
        assert.strictEqual(result.url, "https://bitbucket.org/embark-framework/embark/get/master.tar.gz");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://bitbucket.org/embark-framework/embark");

        result = await templateGenerator.getExternalProject("bitbucket.org/embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://bitbucket.org/embark-framework/embark/get/features%2Fbranch.tar.gz");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://bitbucket.org/embark-framework/embark/src/features/branch");
      });

      it('returns correct info for GitLab shortcut', async function () {
        let result = await templateGenerator.getExternalProject("gitlab:embark-framework/embark");
        assert.strictEqual(result.url, "https://gitlab.com/embark-framework/embark/repository/archive.tar.gz?ref=master");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://gitlab.com/embark-framework/embark");

        result = await templateGenerator.getExternalProject("gitlab:embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://gitlab.com/embark-framework/embark/repository/archive.tar.gz?ref=features%2Fbranch");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://gitlab.com/embark-framework/embark/tree/features/branch");

        result = await templateGenerator.getExternalProject("gitlab.com/embark-framework/embark");
        assert.strictEqual(result.url, "https://gitlab.com/embark-framework/embark/repository/archive.tar.gz?ref=master");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://gitlab.com/embark-framework/embark");

        result = await templateGenerator.getExternalProject("gitlab.com/embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://gitlab.com/embark-framework/embark/repository/archive.tar.gz?ref=features%2Fbranch");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://gitlab.com/embark-framework/embark/tree/features/branch");
      });
    });

    describe('with default branch other than master', function () {
      it('returns correct info for GitHub repo with a non-master default branch', async function () {
        let result = await templateGenerator.getExternalProject("status-im/dreddit-devcon");
        assert.strictEqual(result.url, "https://codeload.github.com/status-im/dreddit-devcon/tar.gz/start");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/status-im/dreddit-devcon/start/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/status-im/dreddit-devcon");

        result = await templateGenerator.getExternalProject("status-im/dreddit-devcon#features/branch");
        assert.strictEqual(result.url, "https://codeload.github.com/status-im/dreddit-devcon/tar.gz/features%2Fbranch");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/status-im/dreddit-devcon/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/status-im/dreddit-devcon/tree/features/branch");
      });
    });

    describe('with SSH URL', function () {
      it('returns correct info for GitHub SSH repo', async function () {
        let result = await templateGenerator.getExternalProject("git@github.com/embark-framework/embark");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark/tar.gz/master");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/embark-framework/embark");

        result = await templateGenerator.getExternalProject("git@github.com/embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://codeload.github.com/embark-framework/embark/tar.gz/features%2Fbranch");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://github.com/embark-framework/embark/tree/features/branch");
      });

      it('returns correct info for BitBucket SSH repo', async function () {
        let result = await templateGenerator.getExternalProject("git@bitbucket.org/embark-framework/embark");
        assert.strictEqual(result.url, "https://bitbucket.org/embark-framework/embark/get/master.tar.gz");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://bitbucket.org/embark-framework/embark");

        result = await templateGenerator.getExternalProject("git@bitbucket.org/embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://bitbucket.org/embark-framework/embark/get/features%2Fbranch.tar.gz");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://bitbucket.org/embark-framework/embark/src/features/branch");
      });

      it('returns correct info for GitLab SSH repo', async function () {
        let result = await templateGenerator.getExternalProject("git@gitlab.com/embark-framework/embark");
        assert.strictEqual(result.url, "https://gitlab.com/embark-framework/embark/repository/archive.tar.gz?ref=master");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/master/archive.zip");
        assert.strictEqual(result.browse, "https://gitlab.com/embark-framework/embark");

        result = await templateGenerator.getExternalProject("git@gitlab.com/embark-framework/embark#features/branch");
        assert.strictEqual(result.url, "https://gitlab.com/embark-framework/embark/repository/archive.tar.gz?ref=features%2Fbranch");
        assert.strictEqual(result.filePath.replace(/\\/g, '/'), ".embark/templates/embark-framework/embark/features/branch/archive.zip");
        assert.strictEqual(result.browse, "https://gitlab.com/embark-framework/embark/tree/features/branch");
      });
    });

    describe('with unsupported template specifier', function () {
      it('raises an exception', function () {
        assert.throws(() => templateGenerator.getExternalProject("bad://format"), /Unsupported/);
        assert.throws(() => templateGenerator.getExternalProject("bad://format#/also/bad"), /Unsupported/);
        assert.throws(() => templateGenerator.getExternalProject(/force an error/), Error);
      });
    });

  });
});
