import * as utilsContractsConfig from "../../utils/contractsConfig";

const async = require('async');
const AccountParser = require('../../utils/accountParser');
const EmbarkJS = require('embarkjs');
const utils = require('../../utils/utils');
const constants = require('../../constants');
const web3Utils = require('web3-utils');
const VM = require('../../core/modules/coderunner/vm');
const Web3 = require('web3');
const IpfsApi = require("ipfs-api");

const BALANCE_10_ETHER_IN_HEX = '0x8AC7230489E80000';

class Test {
  constructor(options) {
    this.options = options || {};
    this.simOptions = {};
    this.events = options.events;
    this.plugins = options.config.plugins;
    this.logger = options.logger;
    this.ipc = options.ipc;
    this.configObj = options.config;
    this.ready = true;
    this.firstRunConfig = true;
    this.error = false;
    this.contracts = {};
    this.firstDeployment = true;
    this.needConfig = true;
    this.provider = null;
    this.accounts = [];
  }

  init(callback) {
    this.gasLimit = constants.tests.gasLimit;
    this.events.request('deploy:setGasLimit', this.gasLimit);
    if (this.options.node !== 'embark') {
      this.showNodeHttpWarning();
      return callback();
    }
    if (!this.ipc.connected) {
      this.logger.error("Could not connect to Embark's IPC. Is embark running?");
      if (!this.options.inProcess) process.exit(1);
    }
    return this.connectToIpcNode(callback);
  }

  connectToIpcNode(cb) {
    this.ipc.request('blockchain:node', {}, (err, node) => {
      if (err) {
        this.logger.error(err.message || err);
        return cb();
      }
      this.options.node = node;
      this.showNodeHttpWarning();
      cb();
    });
  }

  initWeb3Provider(callback) {
    if (this.simOptions.accounts) {
      this.simOptions.accounts = this.simOptions.accounts.map((account) => {
        if (!account.hexBalance) {
          account.hexBalance = BALANCE_10_ETHER_IN_HEX;
        }
        return {balance: account.hexBalance, secretKey: account.privateKey};
      });
    }

    if (!this.simOptions.host && (this.options.node && this.options.node === 'vm')) {
      this.simOptions.type = 'vm';
    } else if (this.simOptions.host || (this.options.node && this.options.node !== 'vm')) {
      let options = this.simOptions;
      if (this.options.node && this.options.node !== 'vm') {
        options = utils.deconstructUrl(this.options.node);
      }

      if (!options.protocol) {
        options.protocol = (options.type === "rpc") ? 'http' : 'ws';
      }
      Object.assign(this.simOptions, options);
    }

    this.configObj.contractsConfig.deployment = this.simOptions;
    this.configObj.contractsConfig.deployment.coverage = this.options.coverage;
    this.events.request("config:contractsConfig:set", this.configObj.contractsConfig, () => {
      this.events.request('blockchain:reset', (err) => {
        if (err) {
          this.logger.error('Error restarting the blockchain connection');
        }
        callback(err);
      });
    });

  }

  showNodeHttpWarning() {
    if (this.options.node.startsWith('http')) {
      this.logger.warn("You are using http to connect to the node, as a result the gas details won't be correct." +
        " For correct gas details reporting, please use a websockets connection to your node.");
    }
  }

  onReady(callback) {
    const self = this;
    if (this.ready) {
      return callback();
    }
    if (this.error) {
      return callback(this.error);
    }

    let errorCallback, readyCallback;

    errorCallback = (err) => {
      self.events.removeListener('tests:ready', readyCallback);
      callback(err);
    };

    readyCallback = () => {
      self.events.removeListener('tests:deployError', errorCallback);
      callback();
    };

    this.events.once('tests:ready', readyCallback);
    this.events.once('tests:deployError', errorCallback);
  }

  checkDeploymentOptions(options, callback) {
    const self = this;
    let resetServices = false;
    const {host, port, type, accounts} = options.deployment || {};

    if (host && port && !['rpc', 'ws'].includes(type)) {
      return callback(__("contracts config error: unknown deployment type %s", type));
    }

    if (this.options.coverage && type === 'rpc') {
      this.logger.warn(__('Coverage does not work with an RPC node'));
      this.logger.warn(__('You can change to a WS node (`"type": "ws"`) or use the simulator (no node or `"type": "vm"`)'));
    }

    if (accounts || (port && port !== this.simOptions.port) || (type && type !== this.simOptions.type) ||
      (host && host !== this.simOptions.host)) {
      resetServices = true;
    }

    this.events.request("blockchain:get", (web3) => {
      if (accounts) {
        self.simOptions.accounts = AccountParser.parseAccountsConfig(accounts, web3);
      } else {
        self.simOptions.accounts = null;
      }

      Object.assign(self.simOptions, {
        host,
        port,
        type
      });

      if (!resetServices && !self.firstRunConfig) {
        return callback();
      }

      self.initWeb3Provider((err) => {
        if (err) {
          return callback(err);
        }
        self.firstRunConfig = false;
        callback();
      });
    });
  }

  config(options, callback) {
    const self = this;
    self.needConfig = false;
    if (typeof (options) === 'function') {
      callback = options;
      options = {};
    }
    if (!callback) {
      callback = function () {
      };
    }
    if (!options.contracts) {
      options.contracts = {};
    }
    self.ready = false;

    async.waterfall([
      function checkDeploymentOpts(next) {
        self.checkDeploymentOptions(options, next);
      },
      function compileContracts(next) {
        if (!self.firstDeployment) {
          return next();
        }
        console.info('Compiling contracts'.cyan);
        self.events.request("contracts:build", false, (err) => {
          self.firstDeployment = false;
          next(err);
        });
      },
      function resetContracts(next) {
        self.events.request("contracts:reset:dependencies", next);
      },
      function deploy(next) {
        self._deploy(options, (err, accounts) => {
          if (err) {
            self.events.emit('tests:deployError', err);
            self.error = err;
            return next(err);
          }
          self.ready = true;
          self.error = false;
          self.events.emit('tests:ready');
          next(null, accounts);
        });
      },
      function changeGlobalWeb3(accounts, next) {
        self.events.request('blockchain:get', (web3) => {
          global.web3 = web3;
          self.vm = new VM({
            sandbox: {
              EmbarkJS,
              web3: web3,
              Web3: Web3,
              IpfsApi
            }
          });
          self.events.request("code-generator:embarkjs:provider-code", (code) => {
            self.vm.doEval(code, false, (err, _result) => {
              if(err) return next(err);
              self.events.request("code-generator:embarkjs:init-provider-code", (code) => {
                self.vm.doEval(code, false, (err, _result) => {
                  next(err, accounts);
                });
              });
            });
          });
        });
      }
    ], (err, accounts) => {
      if (err) {
        // TODO Do not exit in case of not a normal run (eg after a change)
        if (!self.options.inProcess) process.exit(1);
      }
      callback(null, accounts);
    });
  }

  async deploy(contract, deployArgs = {}, sendArgs = {}) {
    const instance = await contract.deploy(deployArgs).send(sendArgs);
    this.events.emit("tests:manualDeploy", instance);
    return instance;
  }

  async _deploy(config, callback) {
    const self = this;
    async.waterfall([
      function setConfig(next) {
        utilsContractsConfig.prepare(config);
        self.events.request('config:contractsConfig:set',
          {contracts: config.contracts, versions: self.versions_default}, next);
      },
      function getAccounts(next) {
        self.events.request('blockchain:getAccounts', (err, accounts) => {
          if (err) {
            return next(err);
          }
          self.accounts = accounts;
          self.events.request('blockchain:defaultAccount:set', accounts[0], () => {
            next(null, accounts);
          });
        });
      },
      function getBalance(accounts, next) {
        self.events.request('blockchain:getBalance', self.accounts[0], (err, balance) => {
          if (err) {
            return next(err);
          }
          if (web3Utils.toBN(balance).eq(web3Utils.toBN(0))) {
            self.logger.warn("Warning: default account has no funds");
          }
          next(null, accounts);
        });
      },
      function deploy(accounts, next) {
        self.events.request('deploy:contracts:test', () => {
          next(null, accounts);
        });
      },
      function getWeb3Object(accounts, next) {
        self.events.request('blockchain:get', (web3) => {
          next(null, accounts, web3);
        });
      },
      function waitForProvidersReady(accounts, web3, next) {
        self.events.request('console:provider:ready', () => {
          next(null, accounts, web3);
        });
      },
      function createContractObject(accounts, web3, next) {
        self.events.request('contracts:all', (err, contracts) => {

          async.each(contracts, (contract, eachCb) => {
            if (!self.contracts[contract.className]) {
              self.contracts[contract.className] = {};
            }

            const testContractFactoryPlugin = self.plugins.getPluginsFor('testContractFactory').slice(-1)[0];

            const newContract = testContractFactoryPlugin ? testContractFactoryPlugin.testContractFactory(contract, web3) : Test.getWeb3Contract(contract, web3);
            Object.setPrototypeOf(self.contracts[contract.className], newContract);

            eachCb();
          }, (err) => {
            next(err, accounts);
          });

        });
      }
    ], function (err, accounts) {
      if (err) {
        self.logger.error(__('terminating due to error'));
        self.logger.error(err.message || err);
        return callback(err);
      }
      callback(null, accounts);
    });
  }

  static getWeb3Contract(contract, web3) {
    const newContract = new EmbarkJS.Blockchain.Contract({
      abi: contract.abiDefinition,
      address: contract.deployedAddress,
      from: contract.deploymentAccount || web3.eth.defaultAccount,
      gas: constants.tests.gasLimit,
      web3: web3
    });

    newContract.filename = contract.filename;
    if (newContract.options) {
      newContract.options.from = contract.deploymentAccount || web3.eth.defaultAccount;
      newContract.options.data = contract.code;
      if (!newContract.options.data.startsWith('0x')) {
        newContract.options.data = '0x' + newContract.options.data;
      }
      newContract.options.gas = constants.tests.gasLimit;
    }

    return newContract;
  }

  require(path) {
    const [contractsPrefix, embarkJSPrefix] = ['Embark/contracts/', 'Embark/EmbarkJS'];

    // Contract require
    if (path.startsWith(contractsPrefix)) {
      const contractName = path.replace(contractsPrefix, "");
      const contract = this.contracts[contractName];
      if (contract) {
        return contract;
      }

      const newContract = {};
      this.contracts[contractName] = newContract;
      return newContract;
    }

    // EmbarkJS require
    if (path.startsWith(embarkJSPrefix)) {
      return EmbarkJS;
    }

    throw new Error(__('Unknown module %s', path));
  }
}

module.exports = Test;
