const fs = require('../core/fs.js');
const hostedGitInfo = require('hosted-git-info');
const utils = require('./utils.js');
const semver = require('semver');

const REPLACEMENTS = {
  'git@github.com/': 'git@github.com:',
  'git@bitbucket.org/': 'git@bitbucket.org:',
  'git@gitlab.com/': 'git@gitlab.com:',
  'github.com/': '',
  'bitbucket.org/': 'bitbucket:',
  'gitlab.com/': 'gitlab:'
};

class TemplateGenerator {
  constructor(templateName) {
    this.templateName = templateName;
  }

  checkPathExists(fspath) {
    if (fs.existsSync(fspath)) {
      console.error(`${fspath} already exists, will not overwrite`.red);
      process.exit(1);
    }
  }

  download(url, tmpFilePath, browse) {
    console.log(__('Installing template from ' + browse).green);
    console.log(__('Downloading template...').green);
    fs.mkdirpSync(utils.dirname(tmpFilePath));
    return new Promise((resolve, reject) => {
      utils.downloadFile(url, tmpFilePath, (err) => {
        if (err) {
          console.error(utils.errorMessage(err).red);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  downloadFailed() {
    console.error('Does the template really exist?'.red);
    console.error(`Embark's supported templates: https://embark.status.im/templates/`.green);
    process.exit(1);
  }

  async downloadAndGenerate(uri, destinationFolder, name) {
    const fspath = utils.joinPath(destinationFolder, name);
    this.checkPathExists(fspath);
    const self = this;
    let ext;
    try {
      ext = await this.getExternalProject(uri);
    } catch (e) {
      console.error(utils.errorMessage(e).red);
      process.exit(1);
    }
    let {url, filePath, browse} = ext;
    let tmpFilePath = fs.tmpDir(filePath);
    try {
      try {
        await this.download(url, tmpFilePath, browse);
      } catch (err) {
        let {url_fallback, filePath_fallback, browse_fallback, embarkVersion} = ext;
        if (url_fallback) {
          console.log(__('Retrying with the default branch...').yellow);
          console.log((__(`It may not be compatible with your Embark version`) + ` ${embarkVersion}`).yellow);
          tmpFilePath = fs.tmpDir(filePath_fallback);
          await this.download(url_fallback, tmpFilePath, browse_fallback);
        } else {
          throw new Error();
        }
      }
    } catch (e) {
      return this.downloadFailed();
    }
    utils.extractZip(tmpFilePath, fspath, {
      map: file => {
        let fixed_path = file.path.split('/');
        fixed_path.shift(); // remove first directory
        file.path = utils.joinPath(...fixed_path);
        return file;
      }
    }, () => {
      self.installTemplate(fspath, name, true);
    });
  }

  generate(destinationFolder, name) {
    const fspath = utils.joinPath(destinationFolder, name);
    this.checkPathExists(fspath);
    console.log(__('Initializing Embark template...').green);
    let templatePath = fs.embarkPath(utils.joinPath('templates', this.templateName));
    fs.copySync(templatePath, fspath);

    this.installTemplate(
      fspath,
      name,
      (this.templateName === 'boilerplate' || this.templateName === 'demo'),
      () => {
        if (name === 'embark_demo') {
          console.log('-------------------'.yellow);
          console.log(__('Next steps:').green);
          console.log(('-> ' + ('cd ' + fspath).bold.cyan).green);
          console.log('-> '.green + 'embark run'.bold.cyan);
          console.log(__('For more info go to http://embark.status.im').green);
        }
      }
    );
  }

  installTemplate(templatePath, name, installPackages, cb) {
    utils.cd(templatePath);
    utils.sed('package.json', '%APP_NAME%', name);
    if (fs.existsSync('dot.gitignore')) {
      fs.moveSync('dot.gitignore', '.gitignore');
    } else if (!fs.existsSync('.gitignore')) {
      fs.copySync(fs.embarkPath('templates/dot.gitignore'), '.gitignore');
    }

    if (installPackages) {
      console.log(__('Installing packages...').green);
      utils.runCmd('npm install', null, (err) => {
        if (err) {
          console.error(utils.errorMessage(err).red);
          process.exit(1);
        }
        console.log(__('Init complete').green);
        console.log('\n' + __('App ready at ').green + templatePath);
        if (cb) cb();
      });
    }
  }

  getExternalProject(uri) {
    let url, folder, hgi;
    let fallback, url_fallback, folder_fallback, hgi_fallback, embarkVersion;
    
    // reformat uri before parsing with hosted-git-info. Allows for further syntax support.
    Object.keys(REPLACEMENTS).forEach(replacement => {
      if(uri.indexOf(replacement) === 0) uri = uri.replace(replacement, REPLACEMENTS[replacement]);
    });
    hgi = hostedGitInfo.fromUrl(uri);
    if (!hgi || hgi.user.includes('#')) {
      let templateAndBranch = uri.split('#');
      if (templateAndBranch.length === 1) {
        fallback = true;
        embarkVersion = semver(require('../../../package.json').version);
        templateAndBranch.push(`${embarkVersion.major}.${embarkVersion.minor}`);
      }
      templateAndBranch[0] = `embark-framework/embark-${templateAndBranch[0]}-template`;
      hgi = hostedGitInfo.fromUrl(templateAndBranch.join('#'));
      if (fallback) {
        hgi_fallback = hostedGitInfo.fromUrl(templateAndBranch[0]);
      }
    }
    if(!hgi) { throw new Error('Unsupported template name or git host URL'); }
    url = hgi.tarball();
    if (fallback) {
      url_fallback = hgi_fallback.tarball();
      folder_fallback = `${hgi_fallback.user}/${hgi_fallback.project}/master`;
    }
    const returnObject = {
      url,
      browse: decodeURIComponent(hgi.browse()),
      url_fallback,
      filePath_fallback: fallback && utils.joinPath(".embark/templates/", folder_fallback, "archive.zip"),
      browse_fallback: fallback && decodeURIComponent(hgi_fallback.browse()),
      embarkVersion
    };
    if (hgi.committish) {
      folder = `${hgi.user}/${hgi.project}/${hgi.committish}`;
      returnObject.filePath = utils.joinPath(".embark/templates/", folder, "archive.zip");
      return returnObject;
    }
    return new Promise((resolve, reject) => {
      const request = require('request');
      request.get({
        url: `https://api.github.com/repos/${hgi.user}/${hgi.project}`, json: true, headers: {
          'User-Agent': 'embark'
        }
      }, (err, resp, body) => {
        if (err) {
          return reject(err);
        }
        folder = `${hgi.user}/${hgi.project}/${body.default_branch}`;
        returnObject.url = returnObject.url.replace('/master', '/' + body.default_branch);
        returnObject.filePath = utils.joinPath(".embark/templates/", folder, "archive.zip");
        resolve(returnObject);
      });
    });
  }
}
module.exports = TemplateGenerator;
