pragma solidity ^0.4.24;

import "@aragon/os/contracts/acl/ACL.sol";

contract SimpleStorage {
  uint public storedData;

  constructor(uint initialValue) public {
    storedData = initialValue;
  }

  function set(uint x) public {
    storedData = x;
  }

  function get() public view returns (uint retVal) {
    return storedData;
  }

  function ESCAPE_HATCH_CALLER_ROLE() external  returns (bytes32) { return "hello"; }

}