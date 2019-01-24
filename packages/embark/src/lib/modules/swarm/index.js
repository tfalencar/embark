const UploadSwarm = require('./upload.js');
const utils = require('../../utils/utils.js');
const fs = require('../../core/fs.js');
const SwarmAPI = require('swarm-api');
// TODO: not great, breaks module isolation
const StorageProcessesLauncher = require('../storage/storageProcessesLauncher');
const constants = require('../../constants.json');
require('colors');

class Swarm {

  constructor(embark, _options) {
    this.logger = embark.logger;
    this.events = embark.events;
    this.buildDir = embark.config.buildDir;
    this.storageConfig = embark.config.storageConfig;
    this.host = this.storageConfig.host;
    this.port = this.storageConfig.port;
    this.embark = embark;

    this.webServerConfig = embark.config.webServerConfig;
    this.blockchainConfig = embark.config.blockchainConfig;

    const cantDetermineUrl = this.storageConfig.upload.provider !== 'swarm' && !this.storageConfig.dappConnection.some(connection => connection.provider === 'swarm');

    if(this.isSwarmEnabledInTheConfig() && cantDetermineUrl){
      console.warn('\n===== Swarm module will not be loaded =====');
      console.warn(`Swarm is enabled in the config, however the config is not setup to provide a URL for swarm and therefore the Swarm module will not be loaded. Please either change the ${'config/storage > upload'.bold} setting to Swarm or add the Swarm config to the ${'config/storage > dappConnection'.bold} array. Please see ${'https://embark.status.im/docs/storage_configuration.html'.underline} for more information.\n`);
    }
    if (!this.isSwarmEnabledInTheConfig() || cantDetermineUrl) {
      return;
    }

    this.providerUrl = utils.buildUrl(this.storageConfig.upload.protocol, this.storageConfig.upload.host, this.storageConfig.upload.port);

    this.getUrl = this.storageConfig.upload.getUrl || this.providerUrl + '/bzz:/';


    this.swarm = new SwarmAPI({gateway: this.providerUrl});

    this.setServiceCheck();
    this.addProviderToEmbarkJS();
    this.addObjectToConsole();
    this.registerUploadCommand();

    // swarm needs geth to be running first
    this.events.once(constants.blockchain.blockchainReady, () => {
      this.swarm.isAvailable((err, isAvailable) => {
        if (!err || isAvailable) {
          this.logger.info("Swarm node found, using currently running node");
          return;
        }
        this.logger.info("SWARM: Swarm node not found, attempting to start own node");
        this.listenToCommands();
        this.registerConsoleCommands();
        return this.startProcess(() => {});
      });
    });
  }

  addObjectToConsole() {
    this.events.emit("runcode:register", "swarm", this.swarm);
  }

  setServiceCheck() {
    let self = this;

    this.events.on('check:backOnline:Swarm', function () {
      self.logger.info(__('Swarm node detected...'));
    });

    this.events.on('check:wentOffline:Swarm', function () {
      self.logger.info(__('Swarm node is offline...'));
    });

    self.events.request("services:register", 'Swarm', function (cb) {
      self.logger.trace(`Checking Swarm availability on ${self.providerUrl}...`);
      self._checkService((err, result) => {
        if (err) {
          self.logger.trace("Check Swarm availability error: " + err);
          return cb({name: "Swarm ", status: 'off'});
        }
        self.logger.trace("Swarm " + (result ? '' : 'un') + "available");
        return cb({name: "Swarm ", status: result ? 'on' : 'off'});
      });
    });
  }

  _checkService(cb) {
    this.swarm.isAvailable(cb);
  }

  addProviderToEmbarkJS() {
    let code = "";
    code += "\n" + fs.readFileSync(utils.joinPath(__dirname, 'embarkjs.js')).toString();
    code += "\nEmbarkJS.Storage.registerProvider('swarm', __embarkSwarm);";

    this.embark.addCodeToEmbarkJS(code);
  }

  startProcess(callback) {
    let self = this;
    const storageProcessesLauncher = new StorageProcessesLauncher({
      logger: self.logger,
      events: self.events,
      storageConfig: self.storageConfig,
      webServerConfig: self.webServerConfig,
      corsParts: self.embark.config.corsParts,
      blockchainConfig: self.blockchainConfig,
      embark: self.embark
    });
    self.logger.trace(`Storage module: Launching swarm process...`);
    return storageProcessesLauncher.launchProcess('swarm', callback);
  }

  registerUploadCommand() {
    const self = this;
    this.embark.registerUploadCommand('swarm', (cb) => {
      let upload_swarm = new UploadSwarm({
        buildDir: self.buildDir || 'dist/',
        storageConfig: self.storageConfig,
        providerUrl: self.providerUrl,
        swarm: self.swarm,
        env: self.embark.env
      });

      upload_swarm.deploy(cb);
    });
  }

  listenToCommands() {
    this.events.setCommandHandler('logs:swarm:turnOn',  (cb) => {
      this.events.emit('logs:storage:enable');
      return cb(null, 'Enabling Swarm logs');
    });

    this.events.setCommandHandler('logs:swarm:turnOff',  (cb) => {
      this.events.emit('logs:storage:disable');
      return cb(null, 'Disabling Swarm logs');
    });
  }

  registerConsoleCommands() {
    this.embark.registerConsoleCommand({
      matches: ['log swarm on'],
      process: (cmd, callback) => {
        this.events.request('logs:swarm:turnOn', callback);
      }
    });
    this.embark.registerConsoleCommand({
      matches: ['log swarm off'],
      process: (cmd, callback) => {
        this.events.request('logs:swarm:turnOff', callback);
      }
    });
  }

  isSwarmEnabledInTheConfig() {
    let {enabled, available_providers, dappConnection} = this.storageConfig;
    return enabled && (available_providers.indexOf('swarm') > 0 || dappConnection.find(c => c.provider === 'swarm'));
  }

}

module.exports = Swarm;
