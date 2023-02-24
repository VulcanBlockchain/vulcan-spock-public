const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const { uint256 } = require('./go-uint256');
const config = require('./config.json');
const { Protocol } = require('./protocol');

const packageDefinition = protoLoader.loadSync('./vulcan.proto', {});
const vulcanPackage = grpc.loadPackageDefinition(packageDefinition).VulcanPackage;

// CHANGE THIS VALUE TO SPEED UP EPOCHS IN SIMULATOR
const EPOCH_INTERVAL_MSEC = 1000; // Can be any value for simulator...smaller = faster


const EPOCH_SECONDS = 15 * 60; // 15 minutes in seconds

// Create the RPC server
const server = new grpc.Server();

// Initialize the protocol simulator
const protocol = new Protocol(config);

// Add the service
server.addService(vulcanPackage.Vulcan.service, {
	'getBalance': getBalance,
	'transfer': transfer,
	'gasTransfer': gasTransfer,
	'totalSupply': totalSupply
});

server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), async () => {
	console.log("Vulcan Protocol running at http://127.0.0.1:50051");
	server.start();
	
	let timestamp = 1672531200; // 1/1/2023 00:00:00

	await new Promise(resolve => setInterval(() => { 
        
		     
        let rebaseInfo = protocol.rebase();

		console.info(
			'\nEpoch:\t' + String(rebaseInfo.epoch).padStart(12, '0'), 
			'\t',
			new Date(timestamp * 1000).toISOString().replace(':00.000Z','').replace('T',' '),
			'\n',
			'totalSupply:\t' + uint256.Commify(rebaseInfo.totalSupply),
			'\n',
			'🔥\t' + uint256.Commify(rebaseInfo.firePitBalance),
			'\n',
			'circSupply\t' + uint256.Commify(rebaseInfo.circulatingSupply),
			'\n',
			'holder Amount\t' + uint256.Commify(rebaseInfo.holder),
			'\n',
			'slash Times\t' + uint256.Commify(rebaseInfo.totalFirePitSlashes),
			'\n',
			'slash Amount\t' + uint256.Commify(rebaseInfo.totalFirePitSlashVuls),
			'\n',
			'vulsPerFrag\t' + uint256.Commify(rebaseInfo.vulsPerFrag),
			'\n',
			'🚀\tRebasing ' + (rebaseInfo.active ? 'ACTIVE' : 'ENDED')
		);

		timestamp += EPOCH_SECONDS;


    }, EPOCH_INTERVAL_MSEC));

}); // Server is insecure, no ssl


function getBalance(call, callback) {
	console.log('34989348394893483489389384938493849384938493483849384948394839483')
	callback(null, protocol.getBalance(call.request.account));
}

function totalSupply(call, callback) {console.log(protocol.totalSupply())
	callback(null, protocol.totalSupply());
}

function transfer(call, callback) {
	const result = protocol.transfer(call.request.from, call.request.to, call.request.amount);
	callback(null, result);

	console.info(`\nTransfer\tamount: ${uint256.Commify(call.request.amount)}\n\t\tfrom: ${call.request.from} (${uint256.Commify(result.balances[0].balance)}) \n\t\tto: ${call.request.to} (${uint256.Commify(result.balances[1].balance)})\n`);
}


function gasTransfer(call, callback) {
	const result = protocol.gasTransfer(call.request.from, call.request.to, call.request.amount);
	callback(null, result);

	console.info(`\nGas Transfer\tamount: ${uint256.Commify(call.request.amount)}\n\t\tfrom: ${call.request.from} (${uint256.Commify(result.balances[0].balance)}) \n\t\tto: ${call.request.to} (${uint256.Commify(result.balances[1].balance)})\n`);
}



