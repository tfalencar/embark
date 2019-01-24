/*globals describe, it*/
const TestLogger = require('../lib/utils/test_logger');
const VM = require('../lib/core/modules/coderunner/vm');
const {expect} = require('chai');

describe('embark.vm', function () {
  const testObj = {
    shouldReturnEmbark: 'embark',
    shouldReturnEmbarkAwait: async () => {return new Promise(resolve => resolve('embark'));}
  };
  const vm = new VM({sandbox: {testObj}}, new TestLogger({}));

  describe('#evaluateCode', function () {
    it('should be able to evaluate basic code', function (done) {
      vm.doEval('1 + 1', false, (err, result) => {
        expect(err).to.be.null;
        expect(result).to.be.equal(2);
        done();
      });
    });
    it('should be able to access the members of the sandbox', function (done) {
      vm.doEval('testObj.shouldReturnEmbark', false, (err, result) => {
        expect(err).to.be.null;
        expect(result).to.be.equal('embark');
        done();
      });
    });
    it('should be able to evaluate async code using await', function (done) {
      vm.doEval('await testObj.shouldReturnEmbarkAwait()', false, (err, result) => {
        expect(err).to.be.null;
        expect(result).to.be.equal('embark');
        done();
      });
    });
  });
  describe('#registerVar', function () {
    it('should be able to evaluate code on a registered variable', function (done) {
      vm.registerVar('success', true, () => {
        vm.doEval('success', false, (err, result) => {
          expect(err).to.be.null;
          expect(result).to.be.equal(true);
          done();
        });
      });
    });
    it('should be able to access a required module that was registered as a variable', function (done) {
      vm.registerVar('externalRequire', (module.exports = () => { return "success"; }), () => {
        vm.doEval('externalRequire()', false, (err, result) => {
          expect(err).to.be.null;
          expect(result).to.be.equal('success');
          done();
        });
      });
    });
    it('should be able to access a required ES6 module that was registered as a variable', function (done) {
      const es6Module = {
        default: () => { return "es6"; },
        __esModule: true
      };
      vm.registerVar('externalRequireES6', es6Module, () => {
        vm.doEval('externalRequireES6()', false, (err, result) => {
          expect(err).to.be.null;
          expect(result).to.be.equal("es6");
          done();
        });
      });
    });
    it('should be able to access changed state', function (done) {
      vm.registerVar('one', 1, () => {
        vm.doEval('one += 1; one;', false, (err1, result1) => {
          expect(err1).to.be.null;
          expect(result1).to.be.equal(2);
          vm.registerVar('x', 'x', () => { // instantiates new VM, but should save state
            vm.doEval('one', false, (err2, result2) => {
              expect(err2).to.be.null;
              expect(result2).to.be.equal(2);
              done();
            });
          });
        });
      });
    });
  });
});
