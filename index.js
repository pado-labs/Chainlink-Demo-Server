var http = require('http');
const fs = require("fs");
const path = require("path");
const {
  SubscriptionManager,
  SecretsManager,
  simulateScript,
  ResponseListener,
  ReturnType,
  decodeResult,
  FulfillmentCode,
} = require("@chainlink/functions-toolkit");
const functionsConsumerAbi = require("./abi/functionsClient.json");
const ethers = require("ethers");
require("@chainlink/env-enc").config();

const consumerAddress = "0xc5670d0e6f17627355a7ddd9ffe2468128cb369b";
const subscriptionId = 1792; 

//start test

//end test

http.createServer( function (request, response) {
    console.log("request url=", request.url);
    const querys = getQueryRes(request.url.split("?")[1]);
    console.log("querys=", querys);
    makeRequest(querys.attestationUID, querys.userAddress, response);
}).listen(9000);
console.log('Server running at http://127.0.0.1:9000/');
function getQueryRes(variable) {
    const params = {};
    var vars = variable.split("&");
    for (var i=0;i<vars.length;i++) {
        var pair = vars[i].split("=");
        params[pair[0]] = pair[1];
    }
    return params;
}

const makeRequest = async (attestationUID, userAddress, httpResponse) => {
    const routerAddress = "0xb83E47C2bC239B3bf370bc41e1459A34b41238D0";
    const linkTokenAddress = "0x779877A7B0D9E8603169DdbD7836e478b4624789";
    const donId = "fun-ethereum-sepolia-1";
    const gatewayUrls = [
      "https://01.functions-gateway.testnet.chain.link/",
      "https://02.functions-gateway.testnet.chain.link/",
    ];
    const explorerUrl = "https://sepolia.etherscan.io";
  
    // Initialize functions settings
    const source = fs
      .readFileSync(path.resolve(__dirname, "source.js"))
      .toString();
  
    const args = ["1", "USD"];
    const secrets = { apiKey: process.env.COINMARKETCAP_API_KEY };
    const slotIdNumber = 0; // slot ID where to upload the secrets
    const expirationTimeMinutes = 15; // expiration time in minutes of the secrets
    const gasLimit = 300000;
  
    // Initialize ethers signer and provider to interact with the contracts onchain
    const privateKey = process.env.PRIVATE_KEY; // fetch PRIVATE_KEY
    if (!privateKey)
      throw new Error(
        "private key not provided - check your environment variables"
      );
  
    const rpcUrl = process.env.SEPOLIA_RPC_URL; // fetch sepolia network RPC URL
  
    if (!rpcUrl)
      throw new Error(`rpcUrl not provided  - check your environment variables`);
  
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  
    const wallet = new ethers.Wallet(privateKey);
    const signer = wallet.connect(provider); // create ethers signer for signing transactions
  
    //////// ESTIMATE REQUEST COSTS ////////
    console.log("\nEstimate request costs...");
    // Initialize and return SubscriptionManager
    const subscriptionManager = new SubscriptionManager({
      signer: signer,
      linkTokenAddress: linkTokenAddress,
      functionsRouterAddress: routerAddress,
    });
    await subscriptionManager.initialize();
  
    // estimate costs in Juels
  
    const gasPriceWei = await signer.getGasPrice(); // get gasPrice in wei
  
    const estimatedCostInJuels =
      await subscriptionManager.estimateFunctionsRequestCost({
        donId: donId, // ID of the DON to which the Functions request will be sent
        subscriptionId: subscriptionId, // Subscription ID
        callbackGasLimit: gasLimit, // Total gas used by the consumer contract's callback
        gasPriceWei: BigInt(gasPriceWei), // Gas price in gWei
      });
  
    console.log(
      `Fulfillment cost estimated to ${ethers.utils.formatEther(
        estimatedCostInJuels
      )} LINK`
    );
  
    //////// MAKE REQUEST ////////
  
    console.log("\nMake request...");
  
    // First encrypt secrets and upload the encrypted secrets to the DON
    const secretsManager = new SecretsManager({
      signer: signer,
      functionsRouterAddress: routerAddress,
      donId: donId,
    });
    await secretsManager.initialize();
  
    // Encrypt secrets and upload to DON
    const encryptedSecretsObj = await secretsManager.encryptSecrets(secrets);
  
    console.log(
      `Upload encrypted secret to gateways ${gatewayUrls}. slotId ${slotIdNumber}. Expiration in minutes: ${expirationTimeMinutes}`
    );
    // Upload secrets
    const uploadResult = await secretsManager.uploadEncryptedSecretsToDON({
      encryptedSecretsHexstring: encryptedSecretsObj.encryptedSecrets,
      gatewayUrls: gatewayUrls,
      slotId: slotIdNumber,
      minutesUntilExpiration: expirationTimeMinutes,
    });
  
    if (!uploadResult.success)
      throw new Error(`Encrypted secrets not uploaded to ${gatewayUrls}`);
  
    console.log(
      `Secrets uploaded properly to gateways ${gatewayUrls}! Gateways response: `,
      uploadResult
    );
  
    const donHostedSecretsVersion = parseInt(uploadResult.version); // fetch the reference of the encrypted secrets
  
    const functionsConsumer = new ethers.Contract(
      consumerAddress,
      functionsConsumerAbi,
      signer
    );
  
    // Actual transaction call
    const transaction = await functionsConsumer.sendRequest(
      source, // source
      "0x", // user hosted secrets - encryptedSecretsUrls - empty in this example
      slotIdNumber, // slot ID of the encrypted secrets
      donHostedSecretsVersion, // version of the encrypted secrets
      args,
      [], // bytesArgs - arguments can be encoded off-chain to bytes.
      subscriptionId,
      gasLimit,
      ethers.utils.formatBytes32String(donId), // jobId is bytes32 representation of donId
      attestationUID,
      userAddress
    );
  
    // Log transaction details
    console.log(
      `Functions request sent! Transaction hash ${transaction.hash}. Waiting for a response...`
    );
  
    console.log(
      `See your request in the explorer ${explorerUrl}/tx/${transaction.hash}`
    );
  
    const responseListener = new ResponseListener({
      provider: provider,
      functionsRouterAddress: routerAddress,
    }); // Instantiate a ResponseListener object to wait for fulfillment.
    (async () => {
      try {
        const response = await new Promise((resolve, reject) => {
          responseListener
            .listenForResponseFromTransaction(transaction.hash)
            .then((response) => {
              resolve(response); // Resolves once the request has been fulfilled.
            })
            .catch((error) => {
              reject(error); // Indicate that an error occurred while waiting for fulfillment.
            });
        });
  
        const fulfillmentCode = response.fulfillmentCode;
  
        if (fulfillmentCode === FulfillmentCode.FULFILLED) {
          console.log(
            `Request ${
              response.requestId
            } successfully fulfilled. Cost is ${ethers.utils.formatEther(
              response.totalCostInJuels
            )} LINK.Complete reponse: `,
            response
          );

          httpResponse.writeHead(200, { "Content-Type": "application/json" });
          const jsonDataObj = {
            code: 0,
            message: "success",
            data: {
                verifyResult: true
            },
          };
          httpResponse.write(JSON.stringify(jsonDataObj));
          httpResponse.end();
        } else if (fulfillmentCode === FulfillmentCode.USER_CALLBACK_ERROR) {
          console.log(
            `Request ${
              response.requestId
            } fulfilled. However, the consumer contract callback failed. Cost is ${ethers.utils.formatEther(
              response.totalCostInJuels
            )} LINK.Complete reponse: `,
            response
          );

          httpResponse.writeHead(200, { "Content-Type": "application/json" });
          const jsonDataObj = {
            code: 0,
            message: "success",
            data: {
                verifyResult: false
            },
          };
          httpResponse.write(JSON.stringify(jsonDataObj));
          httpResponse.end();
        } else {
          console.log(
            `Request ${
              response.requestId
            } not fulfilled. Code: ${fulfillmentCode}. Cost is ${ethers.utils.formatEther(
              response.totalCostInJuels
            )} LINK.Complete reponse: `,
            response
          );

          httpResponse.writeHead(200, { "Content-Type": "application/json" });
          const jsonDataObj = {
            code: 0,
            message: "success",
            data: {
                verifyResult: false
            },
          };
          httpResponse.write(JSON.stringify(jsonDataObj));
          httpResponse.end();
        }
  
        const errorString = response.errorString;
        if (errorString) {
          console.log(`Error during the execution: `, errorString);
        } else {
          const responseBytesHexstring = response.responseBytesHexstring;
          if (ethers.utils.arrayify(responseBytesHexstring).length > 0) {
            const decodedResponse = decodeResult(
              response.responseBytesHexstring,
              ReturnType.uint256
            );
            console.log(
              `Decoded response to ${ReturnType.uint256}: `,
              decodedResponse
            );
          }
        }
      } catch (error) {
        console.error("Error listening for response:", error);
      }
    })();
  };