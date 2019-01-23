pragma solidity ^0.5.0;

import "embark-test-contract-0/recursive_test_3.sol";

contract SimpleStorageRecursive2 {
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
}