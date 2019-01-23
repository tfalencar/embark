let async = require('async');
//require("../utils/debug_util.js")(__filename, async);
let utils = require('../../utils/utils.js');
import { ZERO_ADDRESS } from '../../utils/addressUtils';

class ContractDeployer {
  constructor(options) {
    const self = this;
    this.logger = options.logger;
    this.events = options.events;
    this.plugins = options.plugins;

    self.events.setCommandHandler('deploy:contract', (contract, cb) => {
      self.checkAndDeployContract(contract, null, cb);
    });
  }

  // TODO: determining the arguments could also be in a module since it's not
  // part of a 'normal' contract deployment
  determineArguments(suppliedArgs, contract, accounts, callback) {
    const self = this;

    let args = suppliedArgs;
    if (!Array.isArray(args)) {
      args = [];
      let abi = contract.abiDefinition.find((abi) => abi.type === 'constructor');

      for (let input of abi.inputs) {
        let inputValue = suppliedArgs[input.name];
        if (!inputValue) {
          this.logger.error(__("{{inputName}} has not been defined for {{className}} constructor", {inputName: input.name, className: contract.className}));
        }
        args.push(inputValue || "");
      }
    }

    function parseArg(arg, cb) {
      const match = arg.match(/\$accounts\[([0-9]+)]/);
      if (match) {
        if (!accounts[match[1]]) {
          return cb(__('No corresponding account at index %d', match[1]));
        }
        return cb(null, accounts[match[1]]);
      }
      let contractName = arg.substr(1);
      self.events.request('contracts:contract', contractName, (referedContract) => {
        // Because we're referring to a contract that is not being deployed (ie. an interface),
        // we still need to provide a valid address so that the ABI checker won't fail.
        cb(null, (referedContract.deployedAddress || ZERO_ADDRESS));
      });
    }

    function checkArgs(argus, cb) {
      async.map(argus, (arg, nextEachCb) => {
        if (arg[0] === "$") {
          return parseArg(arg, nextEachCb);
        }

        if (Array.isArray(arg)) {
          return checkArgs(arg, nextEachCb);
        }

        self.events.request('ens:isENSName', arg, (isENSName) => {
          if (isENSName) {
            return self.events.request("ens:resolve", arg, (err, address) => {
              if (err) {
                return nextEachCb(err);
              }
              nextEachCb(err, address);
            });
          }

          nextEachCb(null, arg);
        });
      }, cb);
    }

    checkArgs(args, callback);
  }

  checkAndDeployContract(contract, params, callback) {
    let self = this;
    contract.error = false;
    let accounts = [];
    let deploymentAccount;

    if (contract.deploy === false) {
      self.events.emit("deploy:contract:undeployed", contract);
      return callback();
    }

    async.waterfall([
      function requestBlockchainConnector(callback) {
        self.events.request("blockchain:object", (blockchain) => {
          self.blockchain = blockchain;
          callback();
        });
      },

      // TODO: can potentially go to a beforeDeploy plugin
      function getAccounts(next) {
        deploymentAccount = self.blockchain.defaultAccount();
        self.blockchain.getAccounts(function (err, _accounts) {
          if (err) {
            return next(new Error(err));
          }
          accounts = _accounts;

          // applying deployer account configuration, if any
          if (typeof contract.fromIndex === 'number') {
            deploymentAccount = accounts[contract.fromIndex];
            if (deploymentAccount === undefined) {
              return next(__("error deploying") + " " + contract.className + ": " + __("no account found at index") + " " + contract.fromIndex + __(" check the config"));
            }
          }
          if (typeof contract.from === 'string' && typeof contract.fromIndex !== 'undefined') {
            self.logger.warn(__('Both "from" and "fromIndex" are defined for contract') + ' "' + contract.className + '". ' + __('Using "from" as deployer account.'));
          }
          if (typeof contract.from === 'string') {
            deploymentAccount = contract.from;
          }

          deploymentAccount = deploymentAccount || accounts[0];
          contract.deploymentAccount = deploymentAccount;
          next();
        });
      },
      function applyArgumentPlugins(next) {
        self.plugins.emitAndRunActionsForEvent('deploy:contract:arguments', {contract: contract}, (_params) => {
          next();
        });
      },
      function _determineArguments(next) {
        self.determineArguments(params || contract.args, contract, accounts, (err, realArgs) => {
          if (err) {
            return next(err);
          }
          contract.realArgs = realArgs;
          next();
        });
      },
      function deployIt(next) {
        let skipBytecodeCheck = false;
        if (contract.address !== undefined) {
          try {
            utils.toChecksumAddress(contract.address);
          } catch(e) {
            self.logger.error(__("error deploying %s", contract.className));
            self.logger.error(e.message);
            contract.error = e.message;
            self.events.emit("deploy:contract:error", contract);
            return next(e.message);
          }
          contract.deployedAddress = contract.address;
          skipBytecodeCheck = true;
        }

        self.plugins.emitAndRunActionsForEvent('deploy:contract:shouldDeploy', {contract: contract, shouldDeploy: true}, function(_err, params) {
          let trackedContract = params.contract;
          if (!params.shouldDeploy) {
            return self.willNotDeployContract(contract, trackedContract, next);
          }
          if (!trackedContract.address) {
            return self.deployContract(contract, next);
          }
          // deploy the contract regardless if track field is defined and set to false
          if (trackedContract.track === false) {
            self.logFunction(contract)(contract.className.bold.cyan + __(" will be redeployed").green);
            return self.deployContract(contract, next);
          }

          self.blockchain.getCode(trackedContract.address, function(_getCodeErr, codeInChain) {
            if (codeInChain.length > 3 || skipBytecodeCheck) { // it is "0x" or "0x0" for empty code, depending on web3 version
              self.contractAlreadyDeployed(contract, trackedContract, next);
            } else {
              self.deployContract(contract, next);
            }
          });
        });
      }
    ], callback);
  }

  willNotDeployContract(contract, trackedContract, callback) {
    contract.deploy = false;
    this.events.emit("deploy:contract:undeployed", contract);
    callback();
  }

  contractAlreadyDeployed(contract, trackedContract, callback) {
    const self = this;
    this.logFunction(contract)(contract.className.bold.cyan + __(" already deployed at ").green + trackedContract.address.bold.cyan);
    contract.deployedAddress = trackedContract.address;
    self.events.emit("deploy:contract:deployed", contract);

    self.events.request('code-generator:contract:custom', contract, (contractCode) => {
      self.events.request('runcode:eval', contractCode, () => {}, true);
      return callback();
    });
  }

  logFunction(contract) {
    return contract.silent ? this.logger.trace.bind(this.logger) : this.logger.info.bind(this.logger);
  }

  deployContract(contract, callback) {
    let self = this;
    let deployObject;

    async.waterfall([
      function doLinking(next) {

        if (!contract.linkReferences || !Object.keys(contract.linkReferences).length) {
          return next();
        }
        let contractCode = contract.code;
        let offset = 0;

        async.eachLimit(contract.linkReferences, 1, (fileReference, eachCb1) => {
          async.eachOfLimit(fileReference, 1, (references, libName, eachCb2) => {
            self.events.request("contracts:contract", libName, (libContract) => {
              async.eachLimit(references, 1, (reference, eachCb3) => {
                if (!libContract) {
                  return eachCb3(new Error(__('{{contractName}} has a link to the library {{libraryName}}, but it was not found. Is it in your contract folder?'), {
                    contractName: contract.className,
                    libraryName: libName
                  }));
                }

                let libAddress = libContract.deployedAddress;
                if (!libAddress) {
                  return eachCb3(new Error(__("{{contractName}} needs {{libraryName}} but an address was not found, did you deploy it or configured an address?", {
                    contractName: contract.className,
                    libraryName: libName
                  })));
                }

                libAddress = libAddress.substr(2).toLowerCase();

                // Multiplying by two because the original pos and length are in bytes, but we have an hex string
                contractCode = contractCode.substring(0, (reference.start * 2) + offset) + libAddress + contractCode.substring((reference.start * 2) + offset + (reference.length * 2));
                // Calculating an offset in case the length is at some point different than the address length
                offset += libAddress.length - (reference.length * 2);

                eachCb3();
              }, eachCb2);
            });
          }, eachCb1);
        }, (err) => {
          contract.code = contractCode;
          next(err);
        });
      },
      function applyBeforeDeploy(next) {
        self.plugins.emitAndRunActionsForEvent('deploy:contract:beforeDeploy', {contract: contract}, (_params) => {
          next();
        });
      },
      function getGasPriceForNetwork(next) {
        self.events.request("blockchain:gasPrice", (err, gasPrice) => {
          if (err) {
            return next(new Error(__("could not get the gas price")));
          }
          contract.gasPrice = contract.gasPrice || gasPrice;
          next();
        });
      },
      function createDeployObject(next) {
        let contractCode   = contract.code;
        let contractObject = self.blockchain.ContractObject({abi: contract.abiDefinition});
        let contractParams = (contract.realArgs || contract.args).slice();

        try {
          const dataCode = contractCode.startsWith('0x') ? contractCode : "0x" + contractCode;
          deployObject = self.blockchain.deployContractObject(contractObject, {arguments: contractParams, data: dataCode});
        } catch(e) {
          if (e.message.indexOf('Invalid number of parameters for "undefined"') >= 0) {
            return next(new Error(__("attempted to deploy %s without specifying parameters", contract.className)) + ". " + __("check if there are any params defined for this contract in this environment in the contracts configuration file"));
          }
          return next(new Error(e));
        }
        next();
      },
      function estimateCorrectGas(next) {
        if (contract.gas === 'auto') {
          return self.blockchain.estimateDeployContractGas(deployObject, (err, gasValue) => {
            if (err) {
              return next(err);
            }
            let increase_per = 1 + (Math.random() / 10.0);
            contract.gas = Math.floor(gasValue * increase_per);
            next();
          });
        }
        next();
      },
      function deployTheContract(next) {
        let estimatedCost = contract.gas * contract.gasPrice;

        self.blockchain.deployContractFromObject(deployObject, {
          from: contract.deploymentAccount,
          gas: contract.gas,
          gasPrice: contract.gasPrice
        }, function(error, receipt) {
          if (error) {
            contract.error = error.message;
            self.events.emit("deploy:contract:error", contract);
            if (error.message && error.message.indexOf('replacement transaction underpriced') !== -1) {
              self.logger.warn("replacement transaction underpriced: This warning typically means a transaction exactly like this one is still pending on the blockchain");
            }
            return next(new Error("error deploying =" + contract.className + "= due to error: " + error.message));
          }
          self.logFunction(contract)(`${contract.className.bold.cyan} ${__('deployed at').green} ${receipt.contractAddress.bold.cyan} ${__("using").green} ${receipt.gasUsed} ${__("gas").green} (txHash: ${receipt.transactionHash.bold.cyan})`);
          contract.deployedAddress = receipt.contractAddress;
          contract.transactionHash = receipt.transactionHash;
          receipt.className = contract.className;

          if(receipt) self.events.emit("deploy:contract:receipt", receipt);
          self.events.emit("deploy:contract:deployed", contract);


          self.events.request('code-generator:contract:custom', contract, (contractCode) => {
            self.events.request('runcode:eval', contractCode, () => {}, true);
            self.plugins.runActionsForEvent('deploy:contract:deployed', {contract: contract}, () => {
              return next(null, receipt);
            });
          });
        }, hash => {
          self.logFunction(contract)(__("deploying") + " " + contract.className.bold.cyan + " " + __("with").green + " " + contract.gas + " " + __("gas at the price of").green + " " + contract.gasPrice + " " + __("Wei, estimated cost:").green + " " + estimatedCost + " Wei".green + " (txHash: " + hash.bold.cyan + ")");
        });
      }
    ], callback);
  }

}

module.exports = ContractDeployer;
