let async = require('async');
let fs = require('../../core/fs.js');
const utils = require('../../utils/utils.js');
const constants = require('../../constants');

require('ejs');
const Templates = {
  vanilla_contract: require('./code_templates/vanilla-contract.js.ejs'),
  embarkjs_contract: require('./code_templates/embarkjs-contract.js.ejs'),
  exec_when_ready: require('./code_templates/exec-when-ready.js.ejs'),
  load_manager: require('./code_templates/load-manager.js.ejs'),
  define_when_env_loaded: require('./code_templates/define-when-env-loaded.js.ejs'),
  main_context: require('./code_templates/main-context.js.ejs'),
  define_web3_simple: require('./code_templates/define-web3-simple.js.ejs'),
  web3_connector: require('./code_templates/web3-connector.js.ejs'),
  do_when_loaded: require('./code_templates/do-when-loaded.js.ejs'),
  exec_when_env_loaded: require('./code_templates/exec-when-env-loaded.js.ejs')
};

class CodeGenerator {
  constructor(embark, options) {
    this.blockchainConfig = embark.config.blockchainConfig || {};
    this.rpcHost = this.blockchainConfig.rpcHost || '';
    this.rpcPort = this.blockchainConfig.rpcPort || '';
    this.contractsConfig = embark.config.contractsConfig || {};
    this.storageConfig = embark.config.storageConfig || {};
    this.communicationConfig = embark.config.communicationConfig || {};
    this.namesystemConfig = embark.config.namesystemConfig || {};
    this.webServerConfig = embark.config.webServerConfig || {};
    this.env = options.env || 'development';
    this.plugins = options.plugins;
    this.events = embark.events;

    this.listenToCommands();

    const self = this;
    this.events.setCommandHandler("code-generator:embarkjs:build", (cb) => {
      self.buildEmbarkJS(cb);
    });
  }

  listenToCommands() {
    let self = this;

    this.events.setCommandHandler('provider-code', function(cb) {
      let providerCode = self.generateProvider(false);

      cb(providerCode);
    });

    this.events.setCommandHandler('code', function(cb) {
      self.events.request("contracts:list", (_err, contractsList) => {
        let embarkJSABI = self.generateABI(contractsList, {useEmbarkJS: true});
        let contractsJSON = self.generateContractsJSON(contractsList);
        cb(embarkJSABI, contractsJSON);
      });
    });

    this.events.setCommandHandler('code-generator:web3js', function(cb) {
      self.buildWeb3JS(cb);
    });

    self.events.setCommandHandler('code-generator:contract', (contractName, cb) => {
      self.events.request('contracts:contract', contractName, (contract) => {
        self.buildContractJS(contractName, self.generateContractJSON(contract, contract), cb);
      });
    });

    self.events.setCommandHandler('code-generator:contract:vanilla', (contract, gasLimit, cb) => {
      cb(self.generateContractCode(contract, gasLimit));
    });

    self.events.setCommandHandler('code-generator:contract:custom', (contract, cb) => {
      const customCode = self.generateCustomContractCode(contract);
      if (!customCode) {
        // Fallback to generate code from vanilla contract generator.
        //
        // TODO: can be moved into a afterDeploy event
        // just need to figure out the gasLimit coupling issue
        return cb(self.generateContractCode(contract, contract._gasLimit || false));
      }
      cb(customCode);
    });

    self.events.setCommandHandler('code-generator:embarkjs:provider-code', (cb) => {
      cb(self.getEmbarkJsProviderCode());
    });

    self.events.setCommandHandler('code-generator:embarkjs:init-provider-code', (cb) => {
      cb(self.getInitProviderCode());
    });
  }

  generateProvider(isDeployment) {
    let self = this;
    let result = "";
    let providerPlugins;

    result += Templates.main_context();
    result += Templates.load_manager();
    result += Templates.define_when_env_loaded();

    if (self.blockchainConfig === {} || self.blockchainConfig.enabled === false) {
      return result;
    }

    if (this.plugins) {
      providerPlugins = this.plugins.getPluginsFor('clientWeb3Provider');
    }

    if (this.plugins && providerPlugins.length > 0) {
      providerPlugins.forEach(function(plugin) {
        result += plugin.generateProvider(self) + "\n";
      });
    } else {
      let web3Load;

      if (this.contractsConfig === {} || this.contractsConfig.enabled === false) {
        return result;
      }

      if (isDeployment) {
        let connection = utils.buildUrlFromConfig(this.contractsConfig.deployment);
        web3Load = Templates.define_web3_simple({url: connection, done: 'done();'});
      } else {
        let connectionList = "[" + this.contractsConfig.dappConnection.map((x) => '"' + x + '"').join(',') + "]";
        let isDev = self.blockchainConfig.isDev;
        web3Load = Templates.web3_connector({
          autoEnable: this.contractsConfig.dappAutoEnable,
          connectionList: connectionList,
          done: 'done(err);',
          warnAboutMetamask: isDev,
          blockchainClient: this.blockchainConfig.ethereumClientName
        });
      }

      result += Templates.do_when_loaded({block: web3Load, environment: this.env});
    }

    return result;
  }

  generateContracts(contractsList, useEmbarkJS, isDeployment, useLoader) {
    let self = this;
    let result = "\n";
    let contractsPlugins;

    if (useLoader === false) {
      for (let contract of contractsList) {
        let abi = JSON.stringify(contract.abiDefinition);
        result += Templates.vanilla_contract({className: contract.className, abi: abi, contract: contract, gasLimit: constants.codeGenerator.gasLimit});
      }
      return result;
    }

    if (self.blockchainConfig === {} || self.blockchainConfig.enabled === false) {
      return "";
    }

    if (this.plugins) {
      contractsPlugins = this.plugins.getPluginsFor('contractGeneration');
    }

    if (this.plugins && contractsPlugins.length > 0) {
      contractsPlugins.forEach(function (plugin) {
        result += plugin.generateContracts({contracts: contractsList});
      });
    } else {
      for (let contract of contractsList) {
        let abi = JSON.stringify(contract.abiDefinition);
        let gasEstimates = JSON.stringify(contract.gasEstimates);

        let block = "";

        if (useEmbarkJS) {
           let contractAddress = contract.deployedAddress ? ("'" + contract.deployedAddress + "'") : "undefined";
          block += Templates.embarkjs_contract({className: contract.className, abi: abi, contract: contract, contractAddress: contractAddress, gasEstimates: gasEstimates});
        } else {
          block += Templates.vanilla_contract({className: contract.className, abi: abi, contract: contract, gasLimit: (isDeployment ? constants.codeGenerator.gasLimit : false)});
        }
        result += Templates.exec_when_ready({block: block});

      }
    }

    return result;
  }

  generateContractCode(contract, gasLimit) {
    let abi = JSON.stringify(contract.abiDefinition);

    let block = "";
    block += Templates.vanilla_contract({className: contract.className, abi: abi, contract: contract, gasLimit: gasLimit});
    return block;
  }

  generateCustomContractCode(contract) {
    const customContractGeneratorPlugin = this.plugins.getPluginsFor('customContractGeneration').splice(-1)[0];
    if (!customContractGeneratorPlugin) {
      return null;
    }
    return customContractGeneratorPlugin.generateCustomContractCode(contract);
  }

  generateNamesInitialization(useEmbarkJS) {
    if (!useEmbarkJS || this.namesystemConfig === {}) return "";

    let result = "\n";
    result += Templates.define_when_env_loaded();
    result += this._getInitCode('names', this.namesystemConfig);

    return result;
  }

  generateStorageInitialization(useEmbarkJS) {
    if (!useEmbarkJS || this.storageConfig === {}) return "";

    let result = "\n";
    result += Templates.define_when_env_loaded();
    result += this._getInitCode('storage', this.storageConfig);

    return result;
  }

  generateCommunicationInitialization(useEmbarkJS) {
    if (!useEmbarkJS || this.communicationConfig === {}) return "";

    let result = "\n";
    result += Templates.define_when_env_loaded();
    result += this._getInitCode('communication', this.communicationConfig);

    return result;
  }

  _getInitCode(codeType, config) {
    let result = "";
    let pluginsWithCode = this.plugins.getPluginsFor('initCode');
    for (let plugin of pluginsWithCode) {
      let initCodes = plugin.embarkjs_init_code[codeType] || [];
      for (let initCode of initCodes) {
        let [block, shouldInit] = initCode;
        if (shouldInit.call(plugin, config)) {
          result += Templates.exec_when_env_loaded({block: block});
        }
      }
    }
    return result;
  }

  generateABI(contractsList, options) {
    let result = "";

    result += this.generateProvider(options.deployment);
    result += this.generateContracts(contractsList, options.useEmbarkJS, options.deployment, true);
    result += this.generateStorageInitialization(options.useEmbarkJS);
    result += this.generateCommunicationInitialization(options.useEmbarkJS);
    result += this.generateNamesInitialization(options.useEmbarkJS);

    return result;
  }

  generateContractJSON(className, contract) {
    let contractJSON = {};

    contractJSON.contract_name = className;
    contractJSON.address = contract.deployedAddress;
    contractJSON.code = contract.code;
    contractJSON.runtime_bytecode = contract.runtimeBytecode;
    contractJSON.real_runtime_bytecode = contract.realRuntimeBytecode;
    contractJSON.swarm_hash = contract.swarmHash;
    contractJSON.gas_estimates = contract.gasEstimates;
    contractJSON.function_hashes = contract.functionHashes;
    contractJSON.abi = contract.abiDefinition;

    return contractJSON;
  }

  generateContractsJSON(contractsList) {
    let contracts = {};

    for (let contract of contractsList) {
      contracts[contract.className] = this.generateContractJSON(contract.className, contract);
    }

    return contracts;
  }

  buildEmbarkJS(cb) {
    const self = this;
    let embarkjsCode = "import EmbarkJS from 'embarkjs';";
    embarkjsCode += "\nexport default EmbarkJS;";
    embarkjsCode += "\nglobal.EmbarkJS = EmbarkJS";
    let code = "";

    async.waterfall([
      function getWeb3Location(next) {
        self.events.request("version:get:web3", function(web3Version) {
          if (web3Version === "1.0.0-beta") {
            return next(null, require.resolve("web3", {paths: [fs.embarkPath("node_modules")]}));
          }
          self.events.request("version:getPackageLocation", "web3", web3Version, function(err, location) {
            return next(null, fs.dappPath(location));
          });
        });
      },
      function getImports(web3Location, next) {
        web3Location = web3Location.replace(/\\/g, '/'); // Import paths must always have forward slashes
        code += `\nimport Web3 from '${web3Location}';\n`;
        code += "\nimport web3 from 'Embark/web3';\n";
        code += "\nimport IpfsApi from 'ipfs-api';\n";

        next();
      },
      function getJSCode(next) {
        code += "\n" + embarkjsCode + "\n";

        code += self.getEmbarkJsProviderCode();
        code += self.generateCommunicationInitialization(true);
        code += self.generateStorageInitialization(true);
        code += self.generateNamesInitialization(true);
        code += self.getReloadPageCode();

        next();
      },
      function writeFile(next) {
        fs.mkdirpSync(fs.dappPath(".embark"));
        fs.writeFileSync(fs.dappPath(".embark", 'embark.js'), code);
        next();
      }
    ], function(_err, _result) {
      cb();
    });
  }

  getReloadPageCode() {
    return this.env === 'development' ? fs.readFileSync(require('path').join(__dirname,'/code/reload-on-change.js'), 'utf8') : '';
  }

  getEmbarkJsProviderCode() {
    return this.plugins.getPluginsFor('embarkjsCode').reduce((code, plugin) => (
      code += plugin.embarkjs_code.join('\n')
    ), '');
  }

  getInitProviderCode() {
    const codeTypes = {
      blockchain: this.blockchainConfig || {},
      communication: this.communicationConfig || {},
      names: this.namesystemConfig || {},
      storage: this.storageConfig || {}
    };
  
    return this.plugins.getPluginsFor("initConsoleCode").reduce((acc, plugin) => {
      Object.keys(codeTypes).forEach((codeTypeName) => {
        (plugin.embarkjs_init_console_code[codeTypeName] || []).forEach((initCode) => {
          const [block, shouldInit] = initCode;
          if (shouldInit.call(plugin, codeTypes[codeTypeName])) {
            acc += block;
          }
        });
      });
      return acc;
    }, "");
  }

  buildContractJS(contractName, contractJSON, cb) {
    let contractCode = "";
    contractCode += "import web3 from 'Embark/web3';\n";
    contractCode += "import EmbarkJS from 'Embark/EmbarkJS';\n";
    contractCode += `let ${contractName}JSONConfig = ${JSON.stringify(contractJSON)};\n`;
    contractCode += `${contractName}JSONConfig.web3 = web3;\n`;
    contractCode += `let ${contractName} = new EmbarkJS.Blockchain.Contract(${contractName}JSONConfig);\n`;

    contractCode += "export default " + contractName + ";\n";
    cb(contractCode);
  }

  buildWeb3JS(cb) {
    const self = this;
    let code = "";

    async.waterfall([
      function getWeb3Location(next) {
        self.events.request("version:get:web3", function(web3Version) {
          if (web3Version === "1.0.0-beta") {
            return next(null, require.resolve("web3", {paths: [fs.embarkPath("node_modules")]}));
          }
          self.events.request("version:getPackageLocation", "web3", web3Version, function(err, location) {
            return next(null, fs.dappPath(location));
          });
        });
      },
      function getImports(web3Location, next) {
        web3Location = web3Location.replace(/\\/g, '/'); // Import paths must always have forward slashes
        code += `\nimport Web3 from '${web3Location}';\n`;
        code += "\nglobal.Web3 = Web3;\n";

        code += "\n if (typeof web3 === 'undefined') {";
        code += "\n var web3 = new Web3();\n";
        code += "\n }";

        let providerCode = self.generateProvider(false);
        code += providerCode;
        code += "\nexport default web3;\n";
        next(null, code);
      }
    ], cb);
  }
}

module.exports = CodeGenerator;
