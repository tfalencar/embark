const async = require('async');
const fs = require('../../core/fs');
const NetcatClient = require('netcat/client');

//Constants
const minerStart = 'miner_start';
const minerStop = 'miner_stop';
const getHashRate = 'miner_getHashrate';
const getCoinbase = 'eth_coinbase';
const getBalance = 'eth_getBalance';
const newBlockFilter = 'eth_newBlockFilter';
const pendingBlockFilter = 'eth_newPendingTransactionFilter';
const getChanges = 'eth_getFilterChanges';
const getBlockCount = 'eth_getBlockTransactionCountByNumber';

class GethMiner {
  constructor(options) {
    const self = this;
    // TODO: Find a way to load mining config from YML.
    // In the meantime, just set an empty config object
    this.config = {};
    this.datadir = options.datadir;
    self.interval = null;
    self.callback = null;
    self.started = null;

    self.commandQueue = async.queue((task, callback) => {
      self.callback = callback;
      self.client.send(JSON.stringify({"jsonrpc": "2.0", "method": task.method, "params": task.params || [], "id": 1}));
    }, 1);

    const defaults = {
      interval_ms: 15000,
      initial_ether: 15000000000000000000,
      mine_pending_txns: true,
      mine_periodically: false,
      mine_normally: false,
      threads: 1
    };

    for (let key in defaults) {
      if (this.config[key] === undefined) {
        this.config[key] = defaults[key];
      }
    }

    const ipcPath = fs.ipcPath('geth.ipc', true);

    this.client = new NetcatClient();
    this.client.unixSocket(ipcPath)
      .enc('utf8')
      .connect()
      .on('data', (response) => {
        try {
          response = JSON.parse(response);
        } catch (e) {
          console.error(e);
          return;
        }
        if (self.callback) {
          self.callback(response.error, response.result);
        }
      });

    if (this.config.mine_normally) {
      this.startMiner();
      return;
    }

    self.stopMiner(() => {
      self.fundAccount(function (err) {
        if (err) {
          console.error(err);
          return;
        }
        if (self.config.mine_periodically) self.start_periodic_mining();
        if (self.config.mine_pending_txns) self.start_transaction_mining();
      });
    });

  }

  sendCommand(method, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    if (!callback) {
      callback = function () {
      };
    }
    this.commandQueue.push({method, params: params || []}, callback);
  }

  startMiner(callback) {
    if (this.started) {
      if (callback) {
        callback();
      }
      return;
    }
    this.started = true;
    this.sendCommand(minerStart, callback);
  }

  stopMiner(callback) {
    if (!this.started) {
      if (callback) {
        callback();
      }
      return;
    }
    this.started = false;
    this.sendCommand(minerStop, callback);
  }

  getCoinbase(callback) {
    if (this.coinbase) {
      return callback(null, this.coinbase);
    }
    this.sendCommand(getCoinbase, (err, result) => {
      if (err) {
        return callback(err);
      }
      this.coinbase = result;
      if (!this.coinbase) {
        return callback('Failed getting coinbase account');
      }
      callback(null, this.coinbase);
    });
  }

  accountFunded(callback) {
    const self = this;
    self.getCoinbase((err, coinbase) => {
      if (err) {
        return callback(err);
      }
      self.sendCommand(getBalance, [coinbase, 'latest'], (err, result) => {
        if (err) {
          return callback(err);
        }
        callback(null, parseInt(result, 16) >= self.config.initial_ether);
      });
    });
  }

  watchBlocks(filterCommand, callback, delay) {
    const self = this;
    self.sendCommand(filterCommand, (err, filterId) => {
      if (err) {
        return callback(err);
      }
      self.interval = setInterval(() => {
        self.sendCommand(getChanges, [filterId], (err, changes) => {
          if (err) {
            console.error(err);
            return;
          }
          if (!changes || !changes.length) {
            return;
          }
          callback(null, changes);
        });
      }, delay || 1000);
    });
  }

  mineUntilFunded(callback) {
    const self = this;
    this.startMiner();
    self.watchBlocks(newBlockFilter, (err) => {
      if (err) {
        console.error(err);
        return;
      }
      self.accountFunded((err, funded) => {
        if (funded) {
          clearTimeout(self.interval);
          self.stopMiner();
          callback();
        }
      });
    });
  }

  fundAccount(callback) {
    const self = this;

    self.accountFunded((err, funded) => {
      if (err) {
        return callback(err);
      }
      if (funded) {
        return callback();
      }

      console.log("== Funding account");
      self.mineUntilFunded(callback);
    });
  }

  pendingTransactions(callback) {
    const self = this;
    self.sendCommand(getBlockCount, ['pending'], (err, hexCount) => {
      if (err) {
        return callback(err);
      }
      callback(null, parseInt(hexCount, 16));
    });
  }

  start_periodic_mining() {
    const self = this;
    const WAIT = 'wait';
    let last_mined_ms = Date.now();
    let timeout_set = false;
    let next_block_in_ms;

    self.startMiner();
    self.watchBlocks(newBlockFilter, (err) => {
      if (err) {
        console.error(err);
        return;
      }
      if (timeout_set) {
        return;
      }
      async.waterfall([
        function checkPendingTransactions(next) {
          if (!self.config.mine_pending_txns) {
            return next();
          }
          self.pendingTransactions((err, count) => {
            if (err) {
              return next(err);
            }
            if (count) {
              return next(WAIT);
            }
            next();
          });
        },
        function stopMiner(next) {
          timeout_set = true;

          const now = Date.now();
          const ms_since_block = now - last_mined_ms;
          last_mined_ms = now;

          if (ms_since_block > self.config.interval_ms) {
            next_block_in_ms = 0;
          } else {
            next_block_in_ms = (self.config.interval_ms - ms_since_block);
          }
          self.stopMiner();
          console.log("== Looking for next block in " + next_block_in_ms + "ms");
          next();
        },
        function startAfterTimeout(next) {
          setTimeout(function () {
            console.log("== Looking for next block");
            timeout_set = false;
            self.startMiner();
            next();
          }, next_block_in_ms);
        }
      ], (err) => {
        if (err === WAIT) {
          return;
        }
        if (err) {
          console.error(err);
        }
      });
    });
  }

  start_transaction_mining() {
    const self = this;
    const pendingTrasactionsMessage = "== Pending transactions! Looking for next block...";
    self.watchBlocks(pendingBlockFilter, (err) => {
      if (err) {
        console.error(err);
        return;
      }
      self.sendCommand(getHashRate, (err, result) => {
        if (result > 0) return;

        console.log(pendingTrasactionsMessage);
        self.startMiner();
      });
    }, 2000);

    if (self.config.mine_periodically) return;

    self.watchBlocks(newBlockFilter, (err) => {
      if (err) {
        console.error(err);
        return;
      }
      self.pendingTransactions((err, count) => {
        if (err) {
          console.error(err);
          return;
        }
        if (!count) {
          console.log("== No transactions left. Stopping miner...");
          self.stopMiner();
        } else {
          console.log(pendingTrasactionsMessage);
          self.startMiner();
        }
      });
    }, 2000);
  }
}

module.exports = GethMiner;
