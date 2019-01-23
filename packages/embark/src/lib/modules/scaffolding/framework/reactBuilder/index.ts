import Handlebars from "handlebars";
import * as path from "path";
import { ABIDefinition } from "web3/eth/abi";

import { Contract } from "../../../../../typings/contract";
import { Embark } from "../../../../../typings/embark";
import { Builder } from "../../builder";
import { CommandOptions } from "../../commandOptions";
import { SmartContractsRecipe } from "../../smartContractsRecipe";

const fs = require("../../../../core/fs");
const utils = require("../../../../utils/utils");
require("../../handlebarHelpers");

interface ABIDefinitionDecorated extends ABIDefinition {
  isIpfsText?: boolean;
  isIpfsFile?: boolean;
  isStandard?: boolean;
}

const indexTemplatePath = path.join(__dirname, "templates", "index.html.hbs");
const dappTemplatePath = path.join(__dirname, "templates", "dapp.js.hbs");

export class ReactBuilder implements Builder {
  constructor(private embark: Embark,
              private description: SmartContractsRecipe,
              private contracts: Contract[],
              private options: CommandOptions) {
  }

  public async build() {
    await this.installDependencies();

    return [].concat.apply([], Object.keys(this.description.data).map((contractName) => {
      const [indexCode, dappCode] = this.generateCodes(contractName);
      if (indexCode && dappCode) {
        const files = this.saveFiles(contractName, indexCode, dappCode);
        this.updateEmbarkJson(contractName, files);
        return files;
      } else {
        return [];
      }
    }));
  }

  private updateEmbarkJson(contractName: string, files: string[]) {
    const embarkJsonPath = path.join(fs.dappPath(), "embark.json");
    const embarkJson = fs.readJSONSync(embarkJsonPath);
    embarkJson.app[`js/${contractName}.js`] = `app/${contractName}.js`;
    embarkJson.app[`${contractName}.html`] = `app/${contractName}.html`;

    fs.writeFileSync(embarkJsonPath, JSON.stringify(embarkJson, null, 2));
  }

  private generateCodes(contractName: string) {
    const indexSource = fs.readFileSync(indexTemplatePath, "utf-8");
    const dappSource = fs.readFileSync(dappTemplatePath, "utf-8");

    const indexTemplate = Handlebars.compile(indexSource);
    const dappTemplate = Handlebars.compile(dappSource);

    const indexData = {
      filename: contractName.toLowerCase(),
      title: contractName,
    };

    const contract = this.contracts.find((c) => c.className === contractName);
    if (!contract) {
      return [];
    }

    const dappData = {
      contractName,
      functions: this.getFunctions(contract),
    };

    return [indexTemplate(indexData), dappTemplate(dappData)];
  }

  private getFunctions(contract: Contract) {
    const ipfsAttributes = this.description.ipfsAttributes(contract.className);

    return contract.abiDefinition.filter((entry) => entry.type === "function").map((entry) => {
      const decorated: ABIDefinitionDecorated = entry;
      const inputName = entry.inputs && entry.inputs.length > 1 ? entry.inputs[1].name.substring(1, entry.inputs[1].name.length) : "";
      const functionName = entry.name || "";

      Object.keys(ipfsAttributes).forEach((name) => {
        let text = false;
        if (ipfsAttributes[name] === "ipfsText") {
          text = true;
        }

        let ipfs = false;
        if (name === inputName || `get${name.charAt(0).toUpperCase() + name.slice(1)}` === functionName) {
          ipfs = true;
        }

        if (ipfs) {
          if (text) {
            decorated.isIpfsText = true;
          } else {
            decorated.isIpfsFile = true;
          }
        }
      });

      if (!decorated.isIpfsText && !decorated.isIpfsFile) {
        decorated.isStandard = true;
      }

      return decorated;
    });
  }

  private installDependencies() {
    const cmd = "npm install react react-bootstrap react-dom";
    return new Promise<void>((resolve, reject) => {
      utils.runCmd(cmd, null, (error: string) => {
        if (error) {
          return reject(new Error(error));
        }

        resolve();
      });
    });
  }

  private saveFiles(contractName: string, indexCode: string, dappCode: string) {
    const indexFilePath = path.join(fs.dappPath(), "app", `${contractName}.html`);
    const dappFilePath = path.join(fs.dappPath(), "app", `${contractName}.js`);

    if (!this.options.overwrite && (fs.existsSync(indexFilePath) || fs.existsSync(dappFilePath))) {
      return [];
    }

    fs.writeFileSync(indexFilePath, indexCode);
    fs.writeFileSync(dappFilePath, dappCode);

    this.embark.logger.info(__(`${indexFilePath} generated`));
    this.embark.logger.info(__(`${dappFilePath} generated`));
    return [indexFilePath, dappFilePath];
  }
}
