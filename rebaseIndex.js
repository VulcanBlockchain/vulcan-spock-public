const { uint256 } = require('./go-uint256');
const Table = require('cli-table');
const path = require('path');
const fse = require('fs-extra');

// Cryptocurrency precision is 18 digits after decimal point
const DECIMAL_RANGE = uint256.Exp(10, 18);//BigNumber.from(10).pow(18)

const MILLION = uint256.Exp(10, 6);
const BILLION = uint256.Exp(10, 9);
const PERCENT_DIVISOR = 100;

const SECONDS_PER_MINUTE = 60;
const REBASE_INTERVAL_MINUTES = 15;
const BLOCK_INTERVAL = 5; //seconds
const BLOCKS_PER_MINUTE = SECONDS_PER_MINUTE / BLOCK_INTERVAL;
const REBASE_BLOCK_INTERVAL = BLOCKS_PER_MINUTE * REBASE_INTERVAL_MINUTES; 


const REBASE_RATE = uint256.NewInt('1000012557077625570'); // APR = 44%, APY = 55.27%, 1.000012557077625570 x 10^18
const rebaseRate = 1.000012557077625570;

    
    function generate() {
        const outputFile = path.join(__dirname,'rebaseIndex.json');
        const limit = 70080;// 735840;// 35040;
        let lastIndex = Number(1.0);
        const table = [];
        let csv = '';
        let mappings = [];

        for(let block=0; block<limit*REBASE_BLOCK_INTERVAL; block+=REBASE_BLOCK_INTERVAL) {
            const epoch = Math.round(block/REBASE_BLOCK_INTERVAL);
            const data = {
                e: epoch,
                r: lastIndex.toFixed(18).replace('.','')
            }
            table.push(data);
            csv += `${data.e},${data.r}\n`;
            const year = parseInt(epoch/35040);
            if (mappings[year] === undefined) {
                mappings[year] = '';
            }
            mappings[year] += `\t\trebase[${data.e}] = ${data.r};\n`
            lastIndex = Number((lastIndex * rebaseRate).toFixed(18));
            console.log(data)
        }

        let constructor = '';
        let functions = '';
        mappings.forEach((mapping, index) => {
            constructor += `\t\tinitYear${index}();\n`
            functions += `\n\tfunction initYear${index}() public {
${mappings[index]}
    }`
        });
        let sol = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;
        
contract VulcanCore {
    mapping(uint32 => uint64) public rebase;

    constructor() {
${constructor}  }
${functions}
}`;

        fse.writeJsonSync(outputFile, table, { spaces: 2 });
        fse.outputFileSync(outputFile.replace('.json','.csv'), csv);
        fse.outputFileSync(outputFile.replace('rebaseIndex', 'VulcanCore').replace('.json','.sol'), sol);

    }


// Step 1:  Calculate the epoch by dividing current block by block interval.
//          Dropping the decimal portion gives the correct floor value.

// The formula  is P * (1 + r)^t
// P is the balance
// r is the rate which is constant .00001256
// We use (1 + r) * 10^8 to give integer value of REBASE_RATE = 100001256
// Later we will need to divide final value by 10^8

// Step 2:  Calculate the interest by calculating REBASE_RATE^epoch
//          This value is very large and has no loss of precision

// Step 3:  Multiply the balance by the interest to give the rebased value scaled up
//                  by several orders of magnitude

// Step 4:  Scale the final value back down by dividing it by 10^(8 * epoch)
//                  Since we are not using a decimal value for 1+r (something like 1.00001256)
//                  we have to scale back the calculated value by dividing it by the same
//                  exponent of 10 to which 1+r was raised

// This algorithm does not use any division until the very last step. This ensures that all
// the numeric precision is maintained by working solely with integers throughout the calculation.

    function _calculateRebasedBalance(balance, block) {

        // const targetBlock = typeof block !== 'undefined' ? block : this.#currentBlock;
        // const epoch = this._getEpoch(targetBlock);

        // // TODO: Replace exponent with accumulator to eliminate large computations
        
        // const interest = uint256.Exp(
        //                             REBASE_RATE, 
        //                             epoch
        //                 );

        // return uint256.Div(
        //                         uint256.Mul(
        //                             balance,
        //                             interest
        //                         ),
        //                         uint256.Exp(
        //                             10,
        //                             uint256.Mul(
        //                                 REBASE_RATE_EXP_MULTIPLIER,
        //                                 epoch
        //                             )                                        
        //                         )
        //                 )

    }



    function _scale(num) {
        return uint256.Mul(num, DECIMAL_RANGE);
    }

generate();