const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { uint256 } = require('./go-uint256');
const packageDefinition = protoLoader.loadSync('./vulcan.proto', {});
const vulcanPackage = grpc.loadPackageDefinition(packageDefinition).VulcanPackage;
const client = new vulcanPackage.Vulcan('localhost:50051', grpc.credentials.createInsecure());

/******************************************************************************************/

// Your code here

/******************************************************************************************/


function totalSupply() {
	// Get the total supply
	client.totalSupply(null, (err, response) => {
		if (err) {
			console.log(err);
		} else {
			
			console.log(`\nTotal Supply`, uint256.Commify(response.totalSupply));
		}
	});
}


function getBalance(account) {
	// Get the balance of the Treasury account
	client.getBalance({ account: account }, (err, response) => {
		if (err) {
			console.log(err);
		} else {
			console.log(`\nBalance of ${account}`, uint256.Commify(response.balance));
		}
	});
}

function transfer(from, to, amount) {
	client.transfer({ from: from, to: to, amount: amount }, (err, response) => {
		if (err) {
			console.log(err);
		} else {
			response.balances[0].balance = uint256.Commify(response.balances[0].balance);
			response.balances[1].balance = uint256.Commify(response.balances[1].balance);
			console.log(`\nTransfer: ${amount} from ${from} to ${to}`, JSON.stringify(response, null, 2));
		}
	});
}


function gasTransfer(from, to, amount) {
	client.gasTransfer({ from: from, to: to, amount: amount }, (err, response) => {
		if (err) {
			console.log(err);
		} else {
			response.balances[0].balance = uint256.Commify(response.balances[0].balance);
			response.balances[1].balance = uint256.Commify(response.balances[1].balance);
			console.log(`\nGas Transfer: ${amount} from ${from} to ${to}`, JSON.stringify(response, null, 2));
		}
	});
}
