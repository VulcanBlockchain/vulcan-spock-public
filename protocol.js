const { uint256 } = require('./go-uint256');

const NULL_ADDRESS = '0x0000';

// Cryptocurrency precision is 18 digits after decimal point
const DECIMAL_RANGE = uint256.Exp(10, 18);//BigNumber.from(10).pow(18)


const MAX_UINT256 = uint256.MAX();
const MILLION = uint256.Exp(10, 6);
const BILLION = uint256.Exp(10, 9);
const PERCENT_DIVISOR = 100;

const BURN_EPOCH_INTERVAL = 4 * 24 * 30 * 3; // Every quarter
const BURN_SUPPLY_THRESHOLD = 51;

const REBASE_DIVISOR = 10 ** 8; // Converts rebase interest rate to correct decimal value
const REBASE_RATE = 1256; // APR = 44%, APY = 55.27%

const MAX_VUL_SUPPLY = uint256.Mul(uint256.Mul(375, BILLION), DECIMAL_RANGE); // 3.75 BILLION
const INITIAL_VUL_SUPPLY = uint256.Mul(uint256.Mul(330, MILLION), DECIMAL_RANGE); // 330 MILLION

class Protocol {

    // Receiving accounts
    treasuryAccount;
    flexAccount;
    firePitAccount;
    holderAccount;

    // All values to be divided by FEE_DIVISOR to get decimal rate
    #treasuryTaxRate;
    #flexTaxRate;
    #firePitTaxRate;

    #totalSupply;

    #vulsPerFrag;
    #fragBalances = {};

    #epoch = 0;
    #isRebaseActive = true;
    #shouldSlashFirePit = false;

    #startSlashEpoch;   // Epoch when slashing can start
    #stopSlashEpoch;    // Epoch to stop slashing/vaporize

    //SIM scenario options
    #slashFirePit;  // To active slash/vaporise
    #firepitMod;    // To activate new slash/vaporise method
    #slashUsingInitSupply;

    totalFirePitSlashes;    // Track how many slashes happened
    totalFirePitSlashVuls;  // Track how much in vul slashes

    #totalFragments;    // Make this dynamic so it can be modified in _burnTotalSupply

    constructor(options) {
        this.options = options || {};

        this.#totalFragments = uint256.Sub(MAX_UINT256, uint256.Mod(MAX_UINT256, INITIAL_VUL_SUPPLY));

        this.#totalSupply = INITIAL_VUL_SUPPLY;
        this.#vulsPerFrag = uint256.Div(this.#totalFragments, this.#totalSupply);
        
        this.treasuryAccount = this.options.treasuryAccount;
        this.flexAccount = this.options.flexAccount;
        this.firePitAccount = NULL_ADDRESS;
        this.holderAccount = this.options.holderAccount;

        this.#treasuryTaxRate = this.options.treasuryTaxRate;
        this.#flexTaxRate = this.options.flexTaxRate;
        this.#firePitTaxRate = this.options.firePitTaxRate;

        // Initialize required accounts
        this.#fragBalances[this.treasuryAccount] = uint256.NewInt(0);
        this.#fragBalances[this.firePitAccount] = uint256.NewInt(0);
        this.#fragBalances[this.flexAccount] = uint256.NewInt(0);
        this.#fragBalances[this.holderAccount] = uint256.NewInt(0); // Added so we can monitor holder amount during vaporization 

        this.#startSlashEpoch = this.options.startSlashEpoch;
        this.#stopSlashEpoch = this.options.stopSlashEpoch;

        this.#slashFirePit = this.options.slashFirePit;
        this.#firepitMod = this.options.firepitMod;
        this.#slashUsingInitSupply = this.options.slashUsingInitSupply;


        this.totalFirePitSlashes = 0;
        this.totalFirePitSlashVuls = uint256.NewInt(0);

        this._initializeWallets(this.options.genesisAccounts);
    }

    rebase() {

        // Rebasing stops once MaxSupply is reached
        if (this.#isRebaseActive === true) {

            // Destroy FirePit balance on next epoch after end of every quarter if conditions are met
            if (
                    (this.#epoch % BURN_EPOCH_INTERVAL === 0) && 
                    this.#slashFirePit &&
                    ((this.#epoch-1) >= this.#startSlashEpoch) && 
                    ((this.#epoch - 1) <= this.#stopSlashEpoch)
                ) {
                this.#shouldSlashFirePit = true;
            }

            // Only rebase after 0th Epoch
            if (this.#epoch > 0) {

                if (this.#shouldSlashFirePit)  {
                    this._slashFirePit();
                    this.#shouldSlashFirePit = false;
                }

                this.#isRebaseActive = this._mintTotalSupply(
                    uint256.Div(
                        uint256.Mul(
                            this.#totalSupply,
                            REBASE_RATE
                        ),
                        REBASE_DIVISOR
                ));
            }
        }

        // Increment the epoch
        this.#epoch++;

        return {
            active: this.#isRebaseActive,
            epoch: this.#epoch - 1,
            totalSupply: this.#totalSupply,
            circulatingSupply: uint256.Sub(this.#totalSupply, this.getBalance(this.firePitAccount).balance),
            vulsPerFrag: this.#vulsPerFrag,
            firePitBalance: this.getBalance(this.firePitAccount).balance,
            totalFirePitSlashes: this.totalFirePitSlashes,
            totalFirePitSlashVuls: this.totalFirePitSlashVuls,
            holder: this.getBalance('0xDemo1').balance
        };
    }

    // Handles transfer of funds from one account to another while handling tax
    transfer(from, to, amount) {

        // Convert the amount from the actual to the internal virtual amount
        let vulAmount = this._scaleAndVirtualize2Frag(amount);

        // Transfer funds if there is enough balance in the sender's account
        if (this.#fragBalances[from] && uint256.Sub(this.#fragBalances[from], vulAmount).GTE(0)) {

            // Check if the transaction is taxable and if yes, reduce the amount appropriately
            // by transferring funds to the appropriate tax accounts
            if (this._isTaxable(from)) {
                let taxableAmount = vulAmount; // Tax on the starting amount
                vulAmount = uint256.Sub(vulAmount, this._chargeTax(from, taxableAmount, this.treasuryAccount, this.#treasuryTaxRate));
                vulAmount = uint256.Sub(vulAmount, this._chargeTax(from, taxableAmount, this.flexAccount, this.#flexTaxRate));
                vulAmount = uint256.Sub(vulAmount, this._chargeTax(from, taxableAmount, this.firePitAccount, this.#firePitTaxRate));
            }

            // Transfer the post-tax balance from the sender to the recipient
            this.#fragBalances[from] = uint256.Sub(this.#fragBalances[from], vulAmount);
            this.#fragBalances[to] = !this.#fragBalances[to] ? vulAmount : uint256.Add(this.#fragBalances[to], vulAmount);

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

    // Handles transfer of gas payment to nodes
    gasTransfer(from, to, amount) {

        // Convert the amount from the actual to the internal virtual amount
        let vulAmount = this._scaleAndVirtualize2Frag(amount);

        // Transfer funds if there is enough balance in the sender's account
        if (this.#fragBalances[from] && uint256.Sub(this.#fragBalances[from], vulAmount).GTE(0)) {

            // Transfer the balance from the sender to the recipient
            this.#fragBalances[from] = uint256.Sub(this.#fragBalances[from], vulAmount);
            this.#fragBalances[to] = !this.#fragBalances[to] ? vulAmount : uint256.Add(this.#fragBalances[to], vulAmount);

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

    totalSupply() {
        return { totalSupply: this.#totalSupply.String() };   
    }

    getBalance(account) {
        if (this.#fragBalances[account]) {
            return {
                account,
                balance: uint256.Div(this.#fragBalances[account], this.#vulsPerFrag).String()
            }
        } else {
            return {
                account,
                balance: '0'
            }
        }
    }

    _initializeWallets(accounts) {
        // Set initial balances for all genesis accounts and track total in genesisAmount
        let genesisVulAmount = uint256.NewInt(0);
        Object.keys(accounts).forEach((account) => {
            this.#fragBalances[account] = this._scaleAndVirtualize2Frag(accounts[account]);
            genesisVulAmount = uint256.Add(genesisVulAmount, this.#fragBalances[account]);
            console.log(`\nBalance of ${account}`, uint256.Commify(this.getBalance(account).balance));
        });

        this.#fragBalances[this.firePitAccount] = uint256.Sub(this._virtualize2Frag(this.#totalSupply), genesisVulAmount);     
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
                this.totalFirePitSlashes++;
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
            this.#fragBalances[account] = uint256.Sub(this.#fragBalances[account], virtualizedAmount);
            console.log(account, uint256.Commify(this.getBalance(account).balance));


            // Update totalfragments to equal the frag total of new supply using the current vulperfrag
            // Update totalfragmentsFirepit to equal the frag total of new firepitsupply using the current vulperfrag
            console.log('vulperfrag bef:',this.#vulsPerFrag.String());

            this.#totalFragments = this._virtualize2Frag(this.#totalSupply);
            
            // Recalculate the new vulsPerFrag and vulsPerFragFirePit using the new totalFragments and totalFragmentsFirepit
            this.#vulsPerFrag = uint256.Div(this.#totalFragments, this.#totalSupply);
                
            console.log('vulperfrag aft:',this.#vulsPerFrag.String());

            this.totalFirePitSlashVuls = uint256.Add(this.totalFirePitSlashVuls, amount);
        }
        else{
            this.#totalSupply = uint256.Sub(this.#totalSupply, amount);
            console.log(account, uint256.Commify(this.getBalance(account).balance), uint256.Commify(amount))
            this.#fragBalances[account] = uint256.Sub(this.#fragBalances[account], virtualizedAmount);
            console.log(account, uint256.Commify(this.getBalance(account).balance));

            // IMPORTANT: Only change vulsPerFrag after modifying account balances
            this.#vulsPerFrag = uint256.Div(this.#totalFragments, this.#totalSupply);
            this.totalFirePitSlashVuls = uint256.Add(this.totalFirePitSlashVuls, amount);
        }
    }


    _scale(num) {
        return uint256.Mul(num, DECIMAL_RANGE);
    }

    _scaleAndVirtualize2Frag(num) {
        return uint256.Mul(this._scale(num), this.#vulsPerFrag);
    }

    _virtualize2Frag(num) {
        return uint256.Mul(num, this.#vulsPerFrag);
    }

    // Helper function which transfers the tax from the sender account to the tax account
    _chargeTax(senderAccount, amount, taxAccount, taxRate) {

        let tax = uint256.NewInt(0);
        if (taxRate > 0) {
            tax = uint256.Div(uint256.Mul(amount, taxRate), PERCENT_DIVISOR);
            this.#fragBalances[senderAccount] = uint256.Sub(this.#fragBalances[senderAccount], tax);
            this.#fragBalances[taxAccount] = uint256.Add(this.#fragBalances[taxAccount], tax);
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
}

module.exports.Protocol = Protocol;