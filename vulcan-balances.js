const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { uint256 } = require('./go-uint256');

const packageDefinition = protoLoader.loadSync('./vulcan.proto', {});
const vulcanPackage = grpc.loadPackageDefinition(packageDefinition).VulcanPackage;

const client = new vulcanPackage.Vulcan('localhost:50051', grpc.credentials.createInsecure());

getBalance('0xTreasury');
getBalance('0x0000');
getBalance('0xFlex');
getBalance('0xSacrificers');
getBalance('0xNodeOwners');
getBalance('0xDemo1');
getBalance('0xDemo2');
getBalance('0xDemo3');
getBalance('0xDemo4');



function getBalance(account) {
	// Get the balance of the Treasury account
	client.getBalance({ account: account }, (err, response) => {
		if (err) {
			console.log(err);
		} else {
			console.log(`\nBalance of ${account}`, uint256.Commify(response));
		}
	});
}
