## Embark Compiler module

This module abstracts the compiler interface. It exposes a plugin api to register contract extensions and how to handle them. It accepts command requests to compile and returns the aggregated compilation result.

### API

**command: `compiler:contracts`**

arguments:

* `contractFiles` - <array of embark File Objects>
* `options` - <object> config object `{disableOptimizations: boolean (default: false)}`

response:

* `error`
* `compiledObject` - compilation result
```
  {
    runtimeBytecode: <deployed bytecode>
    realRuntimeByteCode: <deployed bytecode without swarm hash>
    code: <bytecode>
    abiDefinition: <abi object>

    swarmHash: (optional)
    gasEstimates: (optional)
    functionHashes: (optional)
    filename: (optional) <contract relative filename>
    originalFilename: (optional) <contract real filename>
  }
```

example:

```
const File = require('src/lib/core/file.js');
const contractFiles = [(new File({filename: "simplestorage.sol", type: "custom", path: "simplestorage.sol", resolver: (cb) => { return cb(".. contract code...") }}))];

embark.events.request("compiler:contracts", contractFiles, {}, (err, compiledObject) => {
})

```

### Plugins

This module enables the `registerCompiler` plugin API. see [documentation](https://embark.status.im/docs/plugin_reference.html#embark-registerCompiler-extension-callback-contractFiles-doneCallback)

***embark.registerCompiler***

arguments:

* `extension` - extension of the contract language (e.g `.sol`)
* response callback
  * `contractFiles`: filenames matching the extension
  * `callback(error, compiledObject)`

### Dependencies

* async.eachObject

