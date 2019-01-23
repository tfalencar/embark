let utils = require('../../utils/utils.js');
let fs = require('../../core/fs.js');
let Web3 = require('web3');
const {parallel} = require('async');
const {sendMessage, listenTo} = require('./js/communicationFunctions');
const messageEvents = require('./js/message_events');
const constants = require('../../constants');

const {canonicalHost, defaultHost} = require('../../utils/host');

class Whisper {

  constructor(embark, options) {
    this.logger = embark.logger;
    this.events = embark.events;
    this.communicationConfig = embark.config.communicationConfig;
    this.web3 = new Web3();
    this.embark = embark;
    this.web3Ready = false;

    if (embark.currentContext.includes('test') && options.node &&options.node === 'vm') {
      this.logger.info(__('Whisper disabled in the tests'));
      return;
    }

    if (!this.communicationConfig.enabled) {
      return;
    }

    this.connectToProvider();

    this.events.request('processes:register', 'whisper', (cb) => {
      this.waitForWeb3Ready(() => {
        this.web3.shh.getInfo((err) => {
          if (err) {
            const message = err.message || err;
            if (message.indexOf('not supported') > -1) {
              this.logger.error('Whisper is not supported on your node. Are you using the simulator?');
              return this.logger.trace(message);
            }
          }
          this.setServiceCheck();
          this.addWhisperToEmbarkJS();
          this.addSetProvider();
          this.registerAPICalls();
          cb();
        });
      });
    });

    this.events.request('processes:launch', 'whisper');
  }

  connectToProvider() {
    let {host, port} = this.communicationConfig.connection;
    let web3Endpoint = 'ws://' + host + ':' + port;
    // Note: dont't pass to the provider things like {headers: {Origin: "embark"}}. Origin header is for browser to fill
    // to protect user, it has no meaning if it is used server-side. See here for more details: https://github.com/ethereum/go-ethereum/issues/16608
    // Moreover, Parity reject origins that are not urls so if you try to connect with Origin: "embark" it gives the followin error:
    // << Blocked connection to WebSockets server from untrusted origin: Some("embark") >>
    // The best choice is to use void origin, BUT Geth rejects void origin, so to keep both clients happy we can use http://embark
    this.web3.setProvider(new Web3.providers.WebsocketProvider(web3Endpoint, {headers: {Origin: constants.embarkResourceOrigin}}));
  }

  waitForWeb3Ready(cb) {
    if (this.web3Ready) {
      return cb();
    }
    if (this.web3.currentProvider.connection.readyState !== 1) {
      this.connectToProvider();
      return setTimeout(this.waitForWeb3Ready.bind(this, cb), 50);
    }
    this.web3Ready = true;
    cb();
  }

  setServiceCheck() {
    const self = this;
    self.events.request("services:register", 'Whisper', function(cb) {
      if (!self.web3.currentProvider || self.web3.currentProvider.connection.readyState !== 1) {
        return self.connectToProvider();
      }
      // 1) Parity does not implement shh_version JSON-RPC method
      // 2) web3 1.0 still does not implement web3_clientVersion
      // so we must do all by our own
      self.web3._requestManager.send({method: 'web3_clientVersion', params: []}, (err, clientVersion) => {
        if (err) return cb(err);
        if (clientVersion.indexOf("Parity-Ethereum//v2") === 0) {
          // This is Parity
          return self.web3.shh.getInfo(function(err) {
            if (err) {
              return cb({name: 'Whisper', status: 'off'});
            }
            // TOFIX Assume Whisper v6 until there's a way to understand it via JSON-RPC
            return cb({name: 'Whisper (version 6)', status: 'on'});
          });
        }
        // Assume it is a Geth compliant client
        self.web3.shh.getVersion(function(err, version) {
          if (err || version === "2") {
            return cb({name: 'Whisper', status: 'off'});
          }
          return cb({name: 'Whisper (version ' + version + ')', status: 'on'});
        });
      });
    });
  }

  addWhisperToEmbarkJS() {
    const self = this;
    // TODO: make this a shouldAdd condition
    if (this.communicationConfig === {}) {
      return;
    }
    if ((this.communicationConfig.available_providers.indexOf('whisper') < 0) && (this.communicationConfig.provider !== 'whisper' || this.communicationConfig.enabled !== true)) {
      return;
    }

    // TODO: possible race condition could be a concern
    this.events.request("version:get:web3", function(web3Version) {
      let code = "";
      code += "\n" + fs.readFileSync(utils.joinPath(__dirname, 'js', 'message_events.js')).toString();

      if (web3Version[0] === "0") {
        self.isOldWeb3 = true;
        code += "\n" + fs.readFileSync(utils.joinPath(__dirname, 'js', 'embarkjs_old_web3.js')).toString();
        code += "\nEmbarkJS.Messages.registerProvider('whisper', __embarkWhisperOld);";
      } else {
        code += "\n" + fs.readFileSync(utils.joinPath(__dirname, 'js', 'communicationFunctions.js')).toString();
        code += "\n" + fs.readFileSync(utils.joinPath(__dirname, 'js', 'embarkjs.js')).toString();
        code += "\nEmbarkJS.Messages.registerProvider('whisper', __embarkWhisperNewWeb3);";
      }
      self.embark.addCodeToEmbarkJS(code);
    });
  }

  addSetProvider() {
    let connection = this.communicationConfig.connection || {};
    const shouldInit = (communicationConfig) => {
      return (communicationConfig.provider === 'whisper' && communicationConfig.enabled === true);
    };

    // todo: make the add code a function as well
    const config = {
      server: canonicalHost(connection.host || defaultHost),
      port: connection.port || '8546',
      type: connection.type || 'ws'
    };
    const code = `\nEmbarkJS.Messages.setProvider('whisper', ${JSON.stringify(config)});`;
    this.embark.addProviderInit('communication', code, shouldInit);

    const consoleConfig = Object.assign({}, config, {providerOptions: {headers: {Origin: constants.embarkResourceOrigin}}});
    const consoleCode = `\nEmbarkJS.Messages.setProvider('whisper', ${JSON.stringify(consoleConfig)});`;
    this.embark.addConsoleProviderInit('communication', consoleCode, shouldInit);
  }

  registerAPICalls() {
    const self = this;
    if (self.apiCallsRegistered) {
      return;
    }
    self.apiCallsRegistered = true;
    let symKeyID, sig;
    parallel([
      function(paraCb) {
        self.web3.shh.newSymKey((err, id) => {
          symKeyID = id;
          paraCb(err);
        });
      },
      function(paraCb) {
        self.web3.shh.newKeyPair((err, id) => {
          sig = id;
          paraCb(err);
        });
      }
    ], (err) => {
      if (err) {
        self.logger.error('Error getting Whisper keys:', err.message || err);
        return;
      }
      self.embark.registerAPICall(
        'post',
        '/embark-api/communication/sendMessage',
        (req, res) => {
          sendMessage({
            topic: req.body.topic,
            data: req.body.message,
            sig,
            symKeyID,
            fromAscii: self.web3.utils.asciiToHex,
            toHex: self.web3.utils.toHex,
            post: self.web3.shh.post
          }, (err, result) => {
            if (err) {
              return res.status(500).send({error: err});
            }
            res.send(result);
          });
        });

      self.embark.registerAPICall(
        'ws',
        '/embark-api/communication/listenTo/:topic',
        (ws, req) => {
          self.webSocketsChannels[req.params.topic] = listenTo({
            topic: req.params.topic,
            messageEvents,
            toHex: self.web3.utils.toHex,
            toAscii: self.web3.utils.hexToAscii,
            sig,
            symKeyID,
            subscribe: self.web3.shh.subscribe
          }, (err, result) => {
            if (ws.readyState === ws.CLOSED) {
              return;
            }
            if (err) {
              return ws.status(500).send(JSON.stringify({error: err}));
            }
            ws.send(JSON.stringify(result));
          });
        });
    });
  }
}

module.exports = Whisper;
