# Chainlink-Demo-Server

## Contract

PADOFunctionsConsumer on Sepolia address is 0xc5670D0E6F17627355A7DDD9FfE2468128cb369b.

PADOFunctionsConsumer is deployed by remix.

## Run

* Set an encryption password for your environment variables.

```shell
npx env-enc set-pw
```

* npx env-enc set to configure a `.env.enc` file with the basic variables that you need to send your requests to the Sepolia network.

COINMARKETCAP_API_KEY, PRIVATE_KEY and SEPOLIA_RPC_URL.

```shell
npx env-enc set
```

* run `npm install`
* run `node index.js`