const { BigNumber } = require('@ethersproject/bignumber');
const { ethers } = require('ethers');


// This class is a wrapper for BigNumber to match the
// golang "big" package library
class uint256 {

    bigNumber;

    constructor(i) {
        this.bigNumber = i?.bigNumber ? i.bigNumber : BigNumber.from(i);
    }

    static NewInt(i) {
        return new uint256(i);
    }

    static Add(x, y) {
        const b = uint256.NewInt(x);
        b.bigNumber = typeof y === 'object' ? b.bigNumber.add(y.bigNumber) : b.bigNumber.add(y);
        return b;
    }

    static Sub(x, y) {
        const b = uint256.NewInt(x);
        b.bigNumber = typeof y === 'object' ? b.bigNumber.sub(y.bigNumber) : b.bigNumber.sub(y);
        return b;
    }

    static Mul(x, y) {
        const b = uint256.NewInt(x);
        b.bigNumber = typeof y === 'object' ? b.bigNumber.mul(y.bigNumber) : b.bigNumber.mul(y);
        return b;
    }

    static Div(x, y) {
        const b = uint256.NewInt(x);
        b.bigNumber = typeof y === 'object' ? b.bigNumber.div(y.bigNumber) : b.bigNumber.div(y);
        return b;
    }

    Equals(x) {
        return this.bigNumber.eq(typeof x === 'object' ? x.bigNumber : x);
    }

    static Mod(x, y) {
        const b = uint256.NewInt(x);
        b.bigNumber = typeof y === 'object' ? b.bigNumber.mod(y.bigNumber) : b.bigNumber.mod(y);
        return b;
    }

    static Exp(x, y, m) {
        const x1 = uint256.NewInt(x);
        const y1 = uint256.NewInt(y);
        const b = uint256.NewInt(0);
        b.bigNumber = x1.bigNumber.pow(y1.bigNumber);
        return b;
    }

    GT(x) {
        return this.bigNumber.gt(typeof x === 'object' ? x.bigNumber : x);
    }

    GTE(x) {
        return this.bigNumber.gte(typeof x === 'object' ? x.bigNumber : x);
    }

    LTE(x) {
        return this.bigNumber.lte(typeof x === 'object' ? x.bigNumber : x);
    }

    String() {
        return this.bigNumber.toString();
    }

    Truncate(x) {
        return this.bigNumber.toString().substr(0, x);
    }

    static Commify(x) {
        let c = ethers.utils.commify(typeof x === 'object' ? x.bigNumber : x).split(',');
        c.length = c.length > 6 ? c.length - 6 : c.length;
        return c.join(',');
    }

    Commify() {
        let c = ethers.utils.commify(this.bigNumber).split(',');
        c.length = c.length > 6 ? c.length - 6 : c.length;
        return c.join(',');
    }

    static MAX() {
        return ethers.constants.MaxUint256;
    }
}

module.exports.uint256 = uint256;