/*global describe, config, it, web3*/
const assert = require('assert');
const Token = require('Embark/contracts/Token');
const MyToken = require('Embark/contracts/MyToken');
const MyToken2 = require('Embark/contracts/MyToken2');
const AlreadyDeployedToken = require('Embark/contracts/AlreadyDeployedToken');
const Test = require('Embark/contracts/Test');
const SomeContract = require('Embark/contracts/SomeContract');

config({
  contracts: {
    ZAMyLib: {},
    SimpleStorage: {
      args: [100]
    },
    AnotherStorage: {
      args: ["$SimpleStorage"]
    },
    Token: {
      deploy: false,
      args: [1000]
    },
    MyToken: {
      instanceOf: "Token"
    },
    MyToken2: {
      instanceOf: "Token",
      args: [2000]
    },
    AlreadyDeployedToken: {
      address: "0xCAFECAFECAFECAFECAFECAFECAFECAFECAFECAFE",
      instanceOf: "Token"
    },
    Test: {
      onDeploy: ["Test.methods.changeAddress('$MyToken').send()", "Test.methods.changeENS('embark.eth').send()"]
    },
    ContractArgs: {
      args: {
        initialValue: 123,
        _addresses: ["$MyToken2", "$SimpleStorage"]
      }
    },
    SomeContract: {
      deployIf: "await MyToken.methods.isAvailable().call()",
      args: [
        ["$MyToken2", "$SimpleStorage"],
        100
      ]
    }
  }
});

describe("Token", function () {
  this.timeout(0);

  it("not deploy Token", function () {
    assert.strictEqual(Token.address, undefined);
  });

  it("should deploy MyToken and MyToken2", function () {
    assert.ok(MyToken.options.address);
    assert.ok(MyToken2.options.address);
  });

  it("set MyToken Balance correctly", async function () {
    let result = await MyToken.methods._supply().call();
    assert.strictEqual(parseInt(result, 10), 1000);
  });

  it("set MyToken2 Balance correctly", async function () {
    let result = await MyToken2.methods._supply().call();
    assert.strictEqual(parseInt(result, 10), 2000);
  });

  it("get right address", function () {
    assert.strictEqual(AlreadyDeployedToken.options.address.toLowerCase(),
      "0xCAFECAFECAFECAFECAFECAFECAFECAFECAFECAFE".toLowerCase());
  });

  it("should use onDeploy", async function () {
    let result = await Test.methods.addr().call();
    assert.strictEqual(result, MyToken.options.address);
  });

  it("should not deploy if deployIf returns false", function() {
    assert.ok(!SomeContract.options.address);
  });

  it("should set the ens attr to the address of embark.eth", async function() {
    let result = await Test.methods.ens().call();
    // Testing that it is an address as we don't really know the address
    assert.strictEqual(web3.utils.isAddress(result), true);
    assert.notStrictEqual(result, '0x0000000000000000000000000000000000000000');
  });
});
