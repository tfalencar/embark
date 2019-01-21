const fs = require('../../core/fs.js');
const path = require('path');
const async = require('async');
const utils = require('../../utils/utils.js');
const ProcessLauncher = require('../../core/processes/processLauncher');
const constants = require('../../constants');
const WebpackConfigReader = require('../pipeline/webpackConfigReader');
import LongRunningProcessTimer from '../../utils/longRunningProcessTimer';

class Pipeline {
  constructor(embark, options) {
    this.embark = embark;
    this.env = embark.config.env;
    this.buildDir = embark.config.buildDir;
    this.contractsFiles = embark.config.contractsFiles;
    this.assetFiles = embark.config.assetFiles;
    this.events = embark.events;
    this.logger = embark.config.logger;
    this.plugins = embark.config.plugins;
    this.webpackConfigName = options.webpackConfigName;
    this.pipelinePlugins = this.plugins.getPluginsFor('pipeline');
    this.pipelineConfig = embark.config.pipelineConfig;
    this.isFirstBuild = true;
    this.useDashboard = options.useDashboard;

    this.events.setCommandHandler('pipeline:build', (options, callback) => this.build(options, callback));
    this.events.setCommandHandler('pipeline:build:contracts', callback => this.buildContracts(callback));
    fs.removeSync(this.buildDir);

    let plugin = this.plugins.createPlugin('deployment', {});
    plugin.registerAPICall(
      'get',
      '/embark-api/file',
      (req, res) => {
        try {
          this.apiGuardBadFile(req.query.path);
        } catch (error) {
          return res.send({error: error.message});
        }

        const name = path.basename(req.query.path);
        const content = fs.readFileSync(req.query.path, 'utf8');
        res.send({name, content, path: req.query.path});

      }
    );

    plugin.registerAPICall(
      'post',
      '/embark-api/folders',
      (req, res) => {
        try {
          this.apiGuardBadFile(req.body.path);
        } catch (error) {
          return res.send({error: error.message});
        }

        fs.mkdirpSync(req.body.path);
        const name = path.basename(req.body.path);
        res.send({name, path: req.body.path});
      }
    );

    plugin.registerAPICall(
      'post',
      '/embark-api/files',
      (req, res) => {
        try {
          this.apiGuardBadFile(req.body.path);
        } catch (error) {
          return res.send({error: error.message});
        }

        fs.writeFileSync(req.body.path, req.body.content, {encoding: 'utf8'});
        const name = path.basename(req.body.path);
        res.send({name, path: req.body.path, content: req.body.content});
      }
    );

    plugin.registerAPICall(
      'delete',
      '/embark-api/file',
      (req, res) => {
        try {
          this.apiGuardBadFile(req.query.path, {ensureExists: true});
        } catch (error) {
          return res.send({error: error.message});
        }
        fs.removeSync(req.query.path);
        res.send();
      }
    );

    plugin.registerAPICall(
      'get',
      '/embark-api/files',
      (req, res) => {
        const rootPath = fs.dappPath();

        const walk = (dir, filelist = []) => fs.readdirSync(dir).map(name => {
          let isRoot = rootPath === dir;
          if (fs.statSync(path.join(dir, name)).isDirectory()) {
            return {
              isRoot,
              name,
              dirname: dir,
              path: path.join(dir, name),
              isHidden: name.indexOf('.') === 0,
              children: utils.fileTreeSort(walk(path.join(dir, name), filelist))
            };
          }
          return {
            name,
            isRoot,
            path: path.join(dir, name),
            dirname: dir,
            isHidden: name.indexOf('.') === 0
          };
        });
        const files = utils.fileTreeSort(walk(fs.dappPath()));
        res.send(files);
      }
    );
  }

  apiGuardBadFile(pathToCheck, options = {ensureExists: false}) {
    const dir = path.dirname(pathToCheck);
    const error = new Error('Path is invalid');
    if (options.ensureExists && !fs.existsSync(pathToCheck)) {
      throw error;
    }
    if (!dir.startsWith(fs.dappPath())) {
      throw error;
    }
  }

  build({modifiedAssets}, callback) {
    let self = this;
    const importsList = {};
    let placeholderPage;

    if (!self.assetFiles || !Object.keys(self.assetFiles).length) {
      return self.buildContracts(callback);
    }

    async.waterfall([
      function createPlaceholderPage(next) {
        if (self.isFirstBuild) {
          self.isFirstBuild = false;
          return next();
        }
        self.events.request('build-placeholder', next);
      },
      (next) => self.buildContracts(next),
      (next) => self.buildWeb3JS(next),
      function createImportList(next) {
        importsList["Embark/EmbarkJS"] = fs.dappPath(".embark", 'embark.js');
        importsList["Embark/web3"] = fs.dappPath(".embark", 'web3_instance.js');
        importsList["Embark/contracts"] = fs.dappPath(".embark/contracts", '');

        self.plugins.getPluginsProperty('imports', 'imports').forEach(importObject => {
          let [importName, importLocation] = importObject;
          importsList[importName] = importLocation;
        });
        next();
      },
      function writeContracts(next) {
        self.events.request('contracts:list', (_err, contracts) => {
          // ensure the .embark/contracts directory exists (create if not exists)
          fs.mkdirp(fs.dappPath(".embark/contracts", ''), err => {
            if (err) return next(err);

            // Create a file .embark/contracts/index.js that requires all contract files
            // Used to enable alternate import syntax:
            // e.g. import {Token} from 'Embark/contracts'
            // e.g. import * as Contracts from 'Embark/contracts'
            let importsHelperFile = fs.createWriteStream(fs.dappPath(".embark/contracts", 'index.js'));
            importsHelperFile.write('module.exports = {\n');

            async.eachOf(contracts, (contract, idx, eachCb) => {
              self.events.request('code-generator:contract', contract.className, contractCode => {
                let filePath = fs.dappPath(".embark/contracts", contract.className + '.js');
                importsList["Embark/contracts/" + contract.className] = filePath;
                fs.writeFile(filePath, contractCode, eachCb);

                // add the contract to the exports list to support alternate import syntax
                importsHelperFile.write(`"${contract.className}": require('./${contract.className}').default`);
                if (idx < contracts.length - 1) importsHelperFile.write(',\n'); // add a comma if we have more contracts to add
              });
            }, () => {
              importsHelperFile.write('\n}'); // close the module.exports = {}
              importsHelperFile.close(next); // close the write stream
            });
          });
        });
      },
      function shouldRunWebpack(next) {
        // assuming we got here because an asset was changed, let's check our webpack config
        // to see if the changed asset requires webpack to run
        if (!(modifiedAssets && modifiedAssets.length)) return next(null, false);
        const configReader = new WebpackConfigReader({webpackConfigName: self.webpackConfigName});
        return configReader.readConfig((err, config) => {
          if (err) return next(err);

          if (typeof config !== 'object' || config === null) {
            return next(__('Pipeline: bad webpack config, the resolved config was null or not an object'));
          }

          const shouldRun = modifiedAssets.some(modifiedAsset => config.module.rules.some(rule => rule.test.test(modifiedAsset)));
          return next(null, !shouldRun);
        });
      },
      function runWebpack(shouldNotRun, next) {
        if (shouldNotRun) return next();
        const assets = Object.keys(self.assetFiles).filter(key => key.match(/\.js$/));
        if (!assets || !assets.length) {
          return next();
        }
        let strAssets = '';
        if (!self.useDashboard) {
          assets.forEach(key => {
            strAssets += ('\n  ' + (utils.joinPath(self.buildDir, key)).bold.dim);
          });
        }
        const timer = new LongRunningProcessTimer(
          self.logger,
          'webpack',
          '0',
          `${'Pipeline:'.cyan} Bundling dapp using '${self.webpackConfigName}' config...${strAssets}`,
          `${'Pipeline:'.cyan} Still bundling dapp using '${self.webpackConfigName}' config... ({{duration}})${strAssets}`,
          `${'Pipeline:'.cyan} Finished bundling dapp in {{duration}}${strAssets}`,
          {
            showSpinner: !self.useDashboard,
            interval: self.useDashboard ? 5000 : 1000,
            longRunningThreshold: 15000
          }
        );
        timer.start();
        let built = false;
        const webpackProcess = new ProcessLauncher({
          embark: self.embark,
          plugins: self.plugins,
          modulePath: utils.joinPath(__dirname, 'webpackProcess.js'),
          logger: self.logger,
          events: self.events,
          exitCallback: code => {
            if (!built) {
              return next(`Webpack build exited with code ${code} before the process finished`);
            }
            if (code) {
              self.logger.error(__('Webpack build process exited with code ', code));
            }
          }
        });
        webpackProcess.send({
          action: constants.pipeline.init,
          options: {
            webpackConfigName: self.webpackConfigName,
            pipelineConfig: self.pipelineConfig
          }
        });
        webpackProcess.send({action: constants.pipeline.build, assets: self.assetFiles, importsList});

        webpackProcess.once('result', constants.pipeline.built, (msg) => {
          built = true;
          webpackProcess.kill();
          return next(msg.error);
        });
        webpackProcess.once('result', constants.pipeline.webpackDone, () => {
          timer.end();
        });
      },
      function assetFileWrite(next) {
        async.eachOf(
          // assetFileWrite should not process .js files
          Object.keys(self.assetFiles)
            .filter(key => !key.match(/\.js$/))
            .reduce((obj, key) => {
              obj[key] = self.assetFiles[key];
              return obj;
            }, {}),
          function (files, targetFile, cb) {
            const isDir = targetFile.slice(-1) === '/' || targetFile.slice(-1) === '\\' || targetFile.indexOf('.') === -1;
            // if it's not a directory
            if (!isDir) {
              self.logger.info('Pipeline: '.cyan + __("writing file") + " " + (utils.joinPath(self.buildDir, targetFile)).bold.dim);
            }
            async.map(
              files,
              function (file, fileCb) {
                self.logger.trace("reading " + file.filename);
                return file.content(fileContent => {
                  self.runPlugins(file, fileContent, fileCb);
                });
              },
              function (err, contentFiles) {
                if (err) {
                  self.logger.error('Pipeline: '.cyan + __('errors found while generating') + ' ' + targetFile);
                }
                let dir = targetFile.split('/').slice(0, -1).join('/');
                self.logger.trace(`${'Pipeline:'.cyan} creating dir ` + utils.joinPath(self.buildDir, dir));
                fs.mkdirpSync(utils.joinPath(self.buildDir, dir));

                // if it's a directory
                if (isDir) {
                  let targetDir = targetFile;

                  if (targetDir.slice(-1) !== '/') {
                    targetDir = targetDir + '/';
                  }

                  async.each(contentFiles, function (file, eachCb) {
                    let filename = file.filename.replace(file.basedir + '/', '');
                    self.logger.info(`${'Pipeline:'.cyan} writing file ` + (utils.joinPath(self.buildDir, targetDir, filename)).bold.dim);

                    fs.copy(file.path, utils.joinPath(self.buildDir, targetDir, filename), {overwrite: true}, eachCb);
                  }, cb);
                  return;
                }

                let content = contentFiles.map(file => {
                  if (file === undefined) {
                    return "";
                  }
                  return file.content;
                }).join("\n");

                if (new RegExp(/^index.html?/i).test(targetFile)) {
                  targetFile = targetFile.replace('index', 'index-temp');
                  placeholderPage = targetFile;
                }
                fs.writeFile(utils.joinPath(self.buildDir, targetFile), content, cb);
              }
            );
          },
          next
        );
      },
      function removePlaceholderPage(next) {
        let placeholderFile = utils.joinPath(self.buildDir, placeholderPage);
        fs.access(utils.joinPath(self.buildDir, placeholderPage), (err) => {
          if (err) return next(); // index-temp doesn't exist, do nothing

          // rename index-temp.htm/l to index.htm/l, effectively replacing our placeholder page
          // with the contents of the built index.html page
          fs.move(placeholderFile, placeholderFile.replace('index-temp', 'index'), {overwrite: true}, next);
        });
      }
    ], callback);
  }

  buildContracts(cb) {
    const self = this;
    async.waterfall([
      function makeDirectory(next) {
        fs.mkdirp(fs.dappPath(self.buildDir, 'contracts'), err => next(err));
      },
      function getContracts(next) {
        self.events.request('contracts:list', next);
      },
      function writeContractsJSON(contracts, next) {
        async.each(contracts, (contract, eachCb) => {
          fs.writeJson(fs.dappPath(
            self.buildDir,
            'contracts', contract.className + '.json'
          ), contract, {spaces: 2}, eachCb);
        }, () => next());
      }
    ], cb);
  }

  buildWeb3JS(cb) {
    const self = this;
    async.waterfall([
      function makeDirectory(next) {
        fs.mkdirp(fs.dappPath(".embark"), err => next(err));
      },
      function getWeb3Code(next) {
        self.events.request('code-generator:web3js', next);
      },
      function writeFile(code, next) {
        fs.writeFile(fs.dappPath(".embark", 'web3_instance.js'), code, next);
      }
    ], cb);
  }

  runPlugins(file, fileContent, fileCb) {
    const self = this;
    if (self.pipelinePlugins.length <= 0) {
      return fileCb(null, {content: fileContent, filename: file.filename, path: file.path, basedir: file.basedir, modified: true});
    }
    async.eachSeries(self.pipelinePlugins, (plugin, pluginCB) => {
      if (file.options && file.options.skipPipeline) {
        return pluginCB();
      }

      fileContent = plugin.runPipeline({targetFile: file.filename, source: fileContent});
      file.modified = true;
      pluginCB();
    }, err => {
      if (err) {
        self.logger.error(err.message);
      }
      return fileCb(null, {content: fileContent, filename: file.filename, path: file.path, basedir: file.basedir, modified: true});
    });
  }

}

module.exports = Pipeline;
