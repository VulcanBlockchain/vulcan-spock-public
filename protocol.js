const { uint256 } = require('./go-uint256');
const Table = require('cli-table');

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

const BURN_INTERVAL_MINUTES = 3 * 30 * 24 * 60; // Quarter
const BURN_BLOCK_INTERVAL = BLOCKS_PER_MINUTE * BURN_INTERVAL_MINUTES; // Every quarter
const BURN_SUPPLY_THRESHOLD = 51;

const REBASE_RATE_EXP_MULTIPLIER = uint256.NewInt(8);
const REBASE_RATE = uint256.NewInt(100001256); // APR = 44%, APY = 55.27%, 1.00001256 x 10^8

const MAX_VUL_SUPPLY = uint256.Mul(uint256.Mul(375, BILLION), DECIMAL_RANGE); // 3.75 BILLION
const INITIAL_VUL_SUPPLY = uint256.Mul(uint256.Mul(330, MILLION), DECIMAL_RANGE); // 330 MILLION

class Protocol {


    #balances = {};
    #lastEpoch = -1;

    #currentBlock = uint256.NewInt(0);
    #nextRebaseBlock = uint256.NewInt(REBASE_BLOCK_INTERVAL);
    #nextBurnBlock = uint256.NewInt(BURN_BLOCK_INTERVAL);

    #isRebaseActive = true;
    #shouldSlashFirePit = false;

    // Receiving accounts
    treasuryAccount;
    flexAccount;
    firePitAccount;
    holderAccount;

    // All values to be divided by FEE_DIVISOR to get decimal rate
    #treasuryTaxRate;
    #flexTaxRate;
    #firePitTaxRate;

    #startSlashEpoch;   // Epoch when slashing can start
    #stopSlashEpoch;    // Epoch to stop slashing/vaporize

    //SIM scenario options
    #slashFirePit;  // To active slash/vaporise
    #firepitMod;    // To activate new slash/vaporise method
    #slashUsingInitSupply;

    #totalFirePitSlashes;    // Track how many slashes happened
    #totalFirePitSlashVuls;  // Track how much in vul slashes

    #totalFragments;    // Make this dynamic so it can be modified in _burnTotalSupply

    /********************************************************************************/
    /*                                    A P I                                     */
    /********************************************************************************/


    getBalance(account, block) {
        if (this.#balances[account]) {
            return {
                account,
                balance: this.#balances[account] //uint256.Div(this.#balances[account], this.#vulsPerFrag).String()
            }
        } else {
            return {
                account,
                balance: uint256.NewInt(0)
            }
        }
    }



    /********************************************************************************/


    constructor(options) {
        this.options = options || {};

        this.treasuryAccount = this.options.treasuryAccount;
        this.flexAccount = this.options.flexAccount;
        this.firePitAccount = this.options.firePitAccount;

        this.#treasuryTaxRate = this.options.treasuryTaxRate;
        this.#flexTaxRate = this.options.flexTaxRate;
        this.#firePitTaxRate = this.options.firePitTaxRate;

        this.#startSlashEpoch = this.options.startSlashEpoch;
        this.#stopSlashEpoch = this.options.stopSlashEpoch;

        this.#slashFirePit = this.options.slashFirePit;
        this.#firepitMod = this.options.firepitMod;
        this.#slashUsingInitSupply = this.options.slashUsingInitSupply;

        this.#totalFirePitSlashes = 0;
        this.#totalFirePitSlashVuls = uint256.NewInt(0);

        this._initializeWallets(this.options.genesisAccounts);
    }


    _initializeWallets(accounts) {
        // Initialize required accounts
        this.#balances[this.treasuryAccount] = uint256.NewInt(0);
        this.#balances[this.flexAccount] = uint256.NewInt(0);
        
        // Set initial balances for all genesis accounts and track total in genesisAmount
        let genesisVulAmount = uint256.NewInt(0);
        Object.keys(accounts).forEach((account) => {
            this.#balances[account] = this._scale(accounts[account]);
            genesisVulAmount = uint256.Add(genesisVulAmount, this.#balances[account]);
            console.log(`\nBalance of ${account}`, uint256.Commify(this.getBalance(account).balance.String()));
        });

        this.#balances[this.firePitAccount] = uint256.Sub(INITIAL_VUL_SUPPLY, genesisVulAmount);     
    }


    // This function is only needed for simulator. In the 
    // protocol, the current block number is readily available
    _addBlock() {

        this.#currentBlock = uint256.Add(this.#currentBlock, uint256.NewInt(1));

        if (this.#currentBlock === this.#nextBurnBlock) {
            this.burn();
            this.#nextBurnBlock += BURN_BLOCK_INTERVAL;
        }

        // Show balances only for epoch
        if (this._getEpoch().GT(this.#lastEpoch)) {
            this.#lastEpoch = this._getEpoch();
            this.rebase();
        }
    }



    _getEpoch(block) {
        // Calculate the epoch based on the block number
        let epoch = uint256.Div(block ?? this.#currentBlock, REBASE_BLOCK_INTERVAL);
        return epoch;
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

    _calculateRebasedBalance(balance, block) {

        const targetBlock = typeof block !== 'undefined' ? block : this.#currentBlock;
        const epoch = this._getEpoch(targetBlock);

        // TODO: Replace exponent with accumulator to eliminate large computations
        
        const interest = uint256.Exp(
                                    REBASE_RATE, 
                                    epoch
                        );

        return uint256.Div(
                                uint256.Mul(
                                    balance,
                                    interest
                                ),
                                uint256.Exp(
                                    10,
                                    uint256.Mul(
                                        REBASE_RATE_EXP_MULTIPLIER,
                                        epoch
                                    )                                        
                                )
                        )

    }


    rebase() {

        console.log('Rebased at Block ', this.#currentBlock.String()); 
        this._showBalances();

        //     // Destroy FirePit balance on next epoch after end of every quarter if conditions are met
        //     if (
        //             (this.#epoch % BURN_EPOCH_INTERVAL === 0) && 
        //             this.#slashFirePit &&
        //             ((this.#epoch-1) >= this.#startSlashEpoch) && 
        //             ((this.#epoch - 1) <= this.#stopSlashEpoch)
        //         ) {
        //         this.#shouldSlashFirePit = true;
        //     }


        //         if (this.#shouldSlashFirePit)  {
        //             this._slashFirePit();
        //             this.#shouldSlashFirePit = false;
        //         }
            
        


        // return {
        //     active: this.#isRebaseActive,
        //     epoch: this.#epoch - 1,
        //     totalSupply: this.#totalSupply,
        //     circulatingSupply: uint256.Sub(this.#totalSupply, this.getBalance(this.firePitAccount).balance),
        //     vulsPerFrag: this.#vulsPerFrag,
        //     firePitBalance: this.getBalance(this.firePitAccount).balance,
        //     totalFirePitSlashes: this.#totalFirePitSlashes,
        //     totalFirePitSlashVuls: this.#totalFirePitSlashVuls,
        //     holder: this.getBalance('0xDemo1').balance
        // };
    }


    _scale(num) {
        return uint256.Mul(num, DECIMAL_RANGE);
    }

    _showBalances() {
        
        const table = new Table({
            head: ['Block', 'Epoch', 'Account', 'Balance', 'Rebased Balance', 'Decimal']
        });

        Object.keys(this.#balances).forEach((key) => {
            const rebasedBalance = this._calculateRebasedBalance(uint256.NewInt(this.#balances[key]));
    
            // We can safely use this number in JavaScript for the purpose of display
            const loggedBalance = Number(rebasedBalance.String()) / Math.pow(10, 18)
    
            table.push([this.#currentBlock.Commify(), this._getEpoch().Commify(), key, uint256.Commify(this.#balances[key]), uint256.Commify(rebasedBalance), loggedBalance]);    
        });

        console.table(table.toString());
    }


    // Handles transfer of funds from one account to another while handling tax
    transfer(from, to, amount) {

        // Convert the amount from the actual to the internal virtual amount
        let vulAmount = this._scaleAndRebase(amount);

        // Transfer funds if there is enough balance in the sender's account
        if (this.#balances[from] && uint256.Sub(this.#balances[from], vulAmount).GTE(0)) {

            // Check if the transaction is taxable and if yes, reduce the amount appropriately
            // by transferring funds to the appropriate tax accounts
            if (this._isTaxable(from)) {
                let taxableAmount = vulAmount; // Tax on the starting amount
                vulAmount = uint256.Sub(vulAmount, this._chargeTax(from, taxableAmount, this.treasuryAccount, this.#treasuryTaxRate));
                vulAmount = uint256.Sub(vulAmount, this._chargeTax(from, taxableAmount, this.flexAccount, this.#flexTaxRate));
                vulAmount = uint256.Sub(vulAmount, this._chargeTax(from, taxableAmount, this.firePitAccount, this.#firePitTaxRate));
            }

            // Transfer the post-tax balance from the sender to the recipient
            this.#balances[from] = uint256.Sub(this.#balances[from], vulAmount);
            this.#balances[to] = !this.#balances[to] ? vulAmount : uint256.Add(this.#balances[to], vulAmount);

        } else {
            throw new Error("Insufficient balance")
        }


        return {
            balances: [
                this.getBalance(from),
                this.getBalance(to)
            ]
        }
    }

/*

    // Handles transfer of gas payment to nodes
    gasTransfer(from, to, amount) {

        // Convert the amount from the actual to the internal virtual amount
        let vulAmount = this._scaleAndRebase(amount);

        // Transfer funds if there is enough balance in the sender's account
        if (this.#balances[from] && uint256.Sub(this.#balances[from], vulAmount).GTE(0)) {

            // Transfer the balance from the sender to the recipient
            this.#balances[from] = uint256.Sub(this.#balances[from], vulAmount);
            this.#balances[to] = !this.#balances[to] ? vulAmount : uint256.Add(this.#balances[to], vulAmount);

        } else {
            throw new Error("Insufficient balance")
        }

        return {
            balances: [
                this.getBalance(from),
                this.getBalance(to)
            ]
        }
    }



    _slashFirePit() {
        
        let destroyThresholdAmount = uint256.Div(uint256.Mul(uint256.Sub(this.#totalSupply, this.getBalance(this.firePitAccount).balance), BURN_SUPPLY_THRESHOLD), PERCENT_DIVISOR);
        if(this.#slashUsingInitSupply) destroyThresholdAmount = uint256.Div(uint256.Mul(INITIAL_VUL_SUPPLY, BURN_SUPPLY_THRESHOLD), PERCENT_DIVISOR);
         
        console.log('slasha: ts:',uint256.Commify(this.#totalSupply),' fp:',uint256.Commify(this.getBalance(this.firePitAccount).balance), ' cs:',uint256.Commify(uint256.Sub(this.#totalSupply, this.getBalance(this.firePitAccount).balance)), ' 51%:', uint256.Commify(uint256.Mul(uint256.Sub(this.#totalSupply, this.getBalance(this.firePitAccount)), BURN_SUPPLY_THRESHOLD)),' destroy thres:',uint256.Commify(destroyThresholdAmount) );
        const firePitAmount = this.getBalance(this.firePitAccount).balance;
        console.log('slashb: destroyThres:',uint256.Commify(destroyThresholdAmount), ' fp:',uint256.Commify(firePitAmount))
        
        if (firePitAmount.GTE(destroyThresholdAmount)) {
            
            console.log('slashc: fp:', uint256.Commify(firePitAmount),' destroyThres:',uint256.Commify(destroyThresholdAmount));
            let destroyTargetAmount = uint256.Sub(firePitAmount,destroyThresholdAmount);
            
            console.log('slashd: destroyThres:',uint256.Commify(destroyTargetAmount));
            if(destroyTargetAmount.LTE(uint256.NewInt(0))) console.log("Zero amount to burn");
            else{
                this._burnTotalSupply(this.firePitAccount, destroyTargetAmount);
                this.#totalFirePitSlashes++;
            } 
        }
    }

    _mintTotalSupply(amount) {
        if (uint256.Add(this.#totalSupply, amount).LTE(MAX_VUL_SUPPLY)) {
            this.#totalSupply = uint256.Add(this.#totalSupply, amount);

            // IMPORTANT: Only change vulsPerFrag after modifying account balances
            this.#vulsPerFrag = uint256.Div(this.#totalFragments, this.#totalSupply);
            return true;    
        }
        return false;
    }

    _burnTotalSupply(account, amount) {       
        console.log('Burn', uint256.Commify(amount))
        // VAPORIZE, NUKE, ANNIHILATE

        const virtualizedAmount = this._virtualize2Frag(amount);
        if(this.#firepitMod){
            //Set new totalsupplies
            console.log('totsupply bef: ',uint256.Commify(this.#totalSupply), ' slash amount:',uint256.Commify(amount));
            this.#totalSupply = uint256.Sub(this.#totalSupply, amount); // In vul
            
            console.log('totsupply aft: ',uint256.Commify(this.#totalSupply));
            

            //Update firepit balance by subtracting slash amount 
            console.log(account, uint256.Commify(this.getBalance(account).balance), uint256.Commify(amount))
            this.#balances[account] = uint256.Sub(this.#balances[account], virtualizedAmount);
            console.log(account, uint256.Commify(this.getBalance(account).balance));


            // Update totalfragments to equal the frag total of new supply using the current vulperfrag
            // Update totalfragmentsFirepit to equal the frag total of new firepitsupply using the current vulperfrag
            console.log('vulperfrag bef:',this.#vulsPerFrag.String());

            this.#totalFragments = this._virtualize2Frag(this.#totalSupply);
            
            // Recalculate the new vulsPerFrag and vulsPerFragFirePit using the new totalFragments and totalFragmentsFirepit
            this.#vulsPerFrag = uint256.Div(this.#totalFragments, this.#totalSupply);
                
            console.log('vulperfrag aft:',this.#vulsPerFrag.String());

            this.#totalFirePitSlashVuls = uint256.Add(this.#totalFirePitSlashVuls, amount);
        }
        else{
            this.#totalSupply = uint256.Sub(this.#totalSupply, amount);
            console.log(account, uint256.Commify(this.getBalance(account).balance), uint256.Commify(amount))
            this.#balances[account] = uint256.Sub(this.#balances[account], virtualizedAmount);
            console.log(account, uint256.Commify(this.getBalance(account).balance));

            // IMPORTANT: Only change vulsPerFrag after modifying account balances
            this.#vulsPerFrag = uint256.Div(this.#totalFragments, this.#totalSupply);
            this.#totalFirePitSlashVuls = uint256.Add(this.#totalFirePitSlashVuls, amount);
        }
    }


    // Helper function which transfers the tax from the sender account to the tax account
    _chargeTax(senderAccount, amount, taxAccount, taxRate) {

        let tax = uint256.NewInt(0);
        if (taxRate > 0) {
            tax = uint256.Div(uint256.Mul(amount, taxRate), PERCENT_DIVISOR);
            this.#balances[senderAccount] = uint256.Sub(this.#balances[senderAccount], tax);
            this.#balances[taxAccount] = uint256.Add(this.#balances[taxAccount], tax);
        }
        return tax;
    }
    // Helper function to detemine if tax should be levied based on the sender and recipient
    _isTaxable(from) {

        // Define conditions for skipping tax
        if (from == this.treasuryAccount) return false;
        if (from == this.flexAccount) return false;
        if (from == this.firePitAccount) return false;

        return this.#isRebaseActive;
    }
    */
}

module.exports.Protocol = Protocol;