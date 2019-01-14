import * as globule from "globule";
import * as path from "path";
import { coverageContractsPath } from "./path";

const fs = require("../../core/fs");

export class Suppressor {
  public process() {
    globule.find(path.join(coverageContractsPath(), "**/*.sol")).forEach((filepath) => {
      let source = fs.readFileSync(filepath, "utf-8");
      source = source.replace(/pure/g, "").replace(/view/g, "");
      fs.writeFileSync(filepath, source);
    });
  }
}
