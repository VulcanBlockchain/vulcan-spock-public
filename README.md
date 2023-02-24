# Spock Simulator for Vulcan Protocol

Spock is a simulator for Vulcan Protocol that enables what-if scenarios to project how the rebasing protocol will impact transactions. It is implemented as a gRPC server and client.

### Why is this simulator needed?

Creating a rebasing protocol like Vulcan is an enormously complicated engineering endeavor. The changing values of token balances and triggers for certain events have to be associated with time durations (epochs). Modeling values for this requires the ability to simulate the protocol's behavior over a large span of time. A simulator enables us to compress time and model/tweak values based on business requirements until they represent the desired state.

Using this simulator, the Vulcan team has been able to model, simulate and validate the behavior of the protocol over 20+ years in just a few minutes. With this code, you can do the same. The simulator is been designed to be easy to change and test various scenarios. You do need knowledge of JavaScript and NodeJS, but no other expertise is required.

### Spock Architecture

The Spock simulator architecture is closely modeled like the real Vulcan protocol. There is a Server and multiple Clients that use RPC for communication. `vulcan-server.js` contains the server code and you probably don't need to change anything there. The are a couple of clients — `vulcan-client.js` and `vulcan-balances.js` — the former exercises the server code and the latter reads account balances. You can either modify these or create your own client using `vulcan-template.js`

A majority of the core logic is encapsulated in `protocol.js` This is the code you can tinker with to see how different decisions could impact the protocol's long-term operation. In order to understand how rebasing works, this code is what you will need to understand. In particular, focus on `vulsPerFrag` which is the focal point of rebasing in the protocol.

### RPC Calls

The basic simulator has the following RPC calls available:
- getBalance
- totalSupply
- transfer
- gasTransfer

### Time Configuration

The simulator runs by rebasing every N milliseconds representing 15 mins in real time. This is configurable by changing `EPOCH_INTERVAL_MSEC` in `vulcan-server.js`.

Many operational aspects are configurable via `config.json`.

### Usage

`npm install`

Terminal window 1: `npm run vserver`
Terminal window 2: `npm run vclient`

(Optional)
Terminal window 3: `npm run vbalances` (returns balances of main and demo accounts without any transactions)

