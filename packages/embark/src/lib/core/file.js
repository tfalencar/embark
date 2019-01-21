const async = require('async');
const fs = require('./fs.js');
const path = require('path');
const request = require('request');
const utils = require('../utils/utils');

class File {

  constructor (options) {
    this.filename = options.filename.replace(/\\/g, '/');
    this.type = options.type;
    this.path = options.path;
    this.basedir = options.basedir;
    this.resolver = options.resolver;
    this.pluginPath = options.pluginPath ? options.pluginPath : '';
    this.downloadedImports = false;
    this.importRemappings = []; // mapping downloaded imports to local file
    this.storageConfig = options.storageConfig;
    this.providerUrl = null;
  }

  parseFileForImport(content, isHttpContract, callback) {
    const self = this;
    if (typeof isHttpContract === 'function') {
      callback = isHttpContract;
      isHttpContract = false;
    }
    if (self.filename.indexOf('.sol') < 0) {
      // Only supported in Solidity
      return callback(null, content);
    }
    const regex = /import ["']([-a-zA-Z0-9@:%_+.~#?&\/=]+)["'];/g;
    let matches;
    const filesToDownload = [];
    const pathWithoutFile = path.dirname(self.path);
    let newContent = content;
    let storageConfig = self.storageConfig;
    if (storageConfig && storageConfig.upload && storageConfig.upload.getUrl) {
        self.providerUrl = storageConfig.upload.getUrl;
    }
    while ((matches = regex.exec(content))) {
      const httpFileObj = utils.getExternalContractUrl(matches[1],self.providerUrl);
      const fileObj = {
        fileRelativePath: path.join(path.dirname(self.filename), matches[1]),
        url: `${pathWithoutFile}/${matches[1]}`
      };

      var target = matches[1];
      if (httpFileObj) {
        target = httpFileObj.filePath;
      } else if (fs.existsSync(path.join(path.dirname(self.filename), matches[1]))) {
        target = path.join(path.dirname(self.filename), matches[1]);
      } else if (fs.existsSync(path.join("node_modules", matches[1]))) {
        target = path.join("node_modules", matches[1]);
      }

      self.importRemappings.push({
        prefix: matches[1],
        target: fs.dappPath(target)
      });

      if (httpFileObj) {
        // Replace http import by filePath import in content
        newContent = newContent.replace(matches[1], httpFileObj.filePath);

        fileObj.fileRelativePath = httpFileObj.filePath;
        fileObj.url = httpFileObj.url;
      } else if (!isHttpContract) {
        // Just a normal import
        continue;
      }
      filesToDownload.push(fileObj);
    }

    if (self.downloadedImports) {
      // We already parsed this file
      return callback(null, newContent);
    }
    async.each(filesToDownload, ((fileObj, eachCb) => {
      self.downloadFile(fileObj.fileRelativePath, fileObj.url, (_content) => {
        eachCb();
      });
    }), (err) => {
      self.downloadedImports = true;
      callback(err, newContent);
    });
  }

  downloadFile (filename, url, callback) {
    const self = this;
    async.waterfall([
      function makeTheDir(next) {
        fs.mkdirp(path.dirname(filename), (err) => {
          if (err) {
            return next(err);
          }
          next();
        });
      },
      function downloadTheFile(next) {
        let alreadyCalledBack = false;
        function doCallback(err) {
          if (alreadyCalledBack) {
            return;
          }
          alreadyCalledBack = true;
          next(err);
        }
        request(url)
          .on('response', function (response) {
            if (response.statusCode !== 200) {
              doCallback('Getting file returned code ' + response.statusCode);
            }
          })
          .on('error', doCallback)
          .pipe(fs.createWriteStream(filename))
          .on('finish', () => {
            doCallback();
          });
      },
      function readFile(next) {
        fs.readFile(filename, next);
      },
      function parseForImports(content, next) {
        self.parseFileForImport(content.toString(), true, (err) => {
          next(err, content);
        });
      }
    ], (err, content) => {
      if (err) {
        console.error(__('Error while downloading the file'), url,  err);
        return callback('');
      }
      callback(content.toString());
    });
  }

  content (callback) {
    let content;
    if (this.type === File.types.embark_internal) {
      content = fs.readFileSync(fs.embarkPath(utils.joinPath('dist', this.path))).toString();
    } else if (this.type === File.types.dapp_file) {
      content = fs.readFileSync(this.path).toString();
    } else if (this.type === File.types.custom) {
      return this.resolver((theContent) => {
        this.parseFileForImport(theContent, (err, newContent) => {
          callback(newContent);
        });
      });
    } else if (this.type === File.types.http) {
      return this.downloadFile(this.filename, this.path, (content) => {
        if (!content) {
          return callback(content);
        }
        this.path = this.filename;
        this.type = File.types.dapp_file;
        callback(content);
      });
    } else {
      throw new Error("unknown file: " + this.filename);
    }
    return this.parseFileForImport(content, (err, newContent) => {
      callback(newContent);
    });
  }

}

File.types = {
  embark_internal: 'embark_internal',
  dapp_file: 'dapp_file',
  custom: 'custom',
  http: 'http'
};

module.exports = File;
