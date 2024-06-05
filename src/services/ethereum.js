import { Web3 } from "web3"
import { bytesToHex } from '@ethereumjs/util';
import { FeeMarketEIP1559Transaction } from '@ethereumjs/tx';
import { deriveChildPublicKey, najPublicKeyStrToUncompressedHexPoint, uncompressedHexPointToEvmAddress } from './kdf.js';
import { Common } from '@ethereumjs/common'
import {ethers} from "ethers";
import BN from "bn.js";

const sepoliaContract = "0x6d454714c3Ac6D2deB4eA123254BD87DD14Fd729";
const nearProxyContract = "blobfishy.testnet";

export class Ethereum {
  constructor(chain_rpc, chain_id) {
    this.web3 = new Web3(chain_rpc);
    this.chain_id = chain_id;
    this.queryGasPrice();
  }

  async deriveAddress(accountId, derivation_path) {
    const publicKey = await deriveChildPublicKey(najPublicKeyStrToUncompressedHexPoint(), accountId, derivation_path);
    const address = await uncompressedHexPointToEvmAddress(publicKey);
    return { publicKey: Buffer.from(publicKey, 'hex'), address };
  }

  async queryGasPrice() {
    const maxFeePerGas = await this.web3.eth.getGasPrice();
    const maxPriorityFeePerGas = await this.web3.eth.getMaxPriorityFeePerGas();
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  async getBalance(accountId) {
    const balance = await this.web3.eth.getBalance(accountId)
    const ONE_ETH = 1000000000000000000n;
    return Number(balance * 100n / ONE_ETH) / 100;
  }

  async createSepoliaFaucetPayload(sender) {
    const common = new Common({ chain: this.chain_id });

    // Get the nonce & gas price
    const nonce = await this.web3.eth.getTransactionCount(sender);
    const {data} = this.encodeData("withdraw", {}, []);

    // Construct transaction
    const transactionData = {
      to: sepoliaContract,
      nonce: nonce,
      data: data,
      value: 0,
      chain: this.chain_id,
      gasLimit: 22000,
    };

    // Return the message hash
    const transaction = FeeMarketEIP1559Transaction.fromTxData(transactionData, { common });
    const payload = transaction.getHashedMessageToSign();
    return { transaction, payload };
  }

  encodeData (method, args, ret) {
    const abi = [
      `function ${method}(${Object.keys(args).join(',')}) returns (${ret.join(
          ',',
      )})`,
    ];
    const iface = new ethers.Interface(abi);
    const allArgs = [];
    const argValues = Object.values(args);
    for (let i = 0; i < argValues.length; i++) {
      allArgs.push(argValues[i]);
    }

    console.log(abi[0], 'with args', allArgs);

    return {
      iface,
      data: iface.encodeFunctionData(method, allArgs),
    };
  }
  toHexString(byteArray) {
    return Array.from(byteArray, function(byte) {
      return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('')
  }
  async requestSignatureToMPCNearContract(contract, nearConnection, path, transaction, ethPayload, sender) {
    // Ask the MPC to sign the payload
    const hexEthPayload = this.toHexString(ethPayload);
    console.log("ETH Payload", ethPayload);
    console.log("Near proxy contract payload", hexEthPayload);

    // try {
    //   const payload = await nearContract.sign(
    //       {
    //         rlp_payload: hexEthPayload, // argument name and value - pass empty object if no args required
    //         path: path,
    //         key_version: 0
    //       },
    //       "300000000000000", // attached GAS (optional)
    //       0
    //   )
    //   console.log("payload for signnnn using ze contract", payload);
    //   return payload;
    // } catch (e) {
    //   console.log("errror", e)
    // }

    try {
      const [big_r, big_s] = await nearConnection.callMethod({
        contractId: nearProxyContract,
        method: 'sign',
        args: { rlp_payload: hexEthPayload, path: path, key_version: 0 },
        gas: new BN('300000000000000'),
        deposit: '0'
      });

      console.log("Big R", big_r);
      console.log("Big S", big_s);

      // reconstruct the signature
      const r = Buffer.from(big_r.substring(2), 'hex');
      const s = Buffer.from(big_s, 'hex');

      const candidates = [0n, 1n].map((v) => transaction.addSignature(v, r, s));
      // const signature = candidates.find((c) => c.getSenderAddress().toString().toLowerCase() === sender.toLowerCase());

      candidates.forEach((c) => {
        console.log(`Sender Address: ${c.getSenderAddress()}, Tx: ${c}`)
      })

      // if (!signature) {
      //   throw new Error("Signature is not valid");
      // }
      //
      // console.log(signature.getValidationErrors().join(","))
      // if (signature.getValidationErrors().length > 0) throw new Error("Transaction validation errors");
      // if (!signature.verifySignature()) throw new Error("Signature is not valid");

      return candidates[0];
    } catch (e) {
      console.log("error when functionCall", e);
    }

  }

  async requestSignatureToMPC(wallet, contractId, path, ethPayload, transaction, sender) {
    // Ask the MPC to sign the payload
    const payload = Array.from(ethPayload.reverse());
    const [big_r, big_s] = await wallet.callMethod({ contractId, method: 'sign', args: { payload, path, key_version: 0 }, gas: '250000000000000' });

    // reconstruct the signature
    const r = Buffer.from(big_r.substring(2), 'hex');
    const s = Buffer.from(big_s, 'hex');

    const candidates = [0n, 1n].map((v) => transaction.addSignature(v, r, s));
    const signature = candidates.find((c) => c.getSenderAddress().toString().toLowerCase() === sender.toLowerCase());

    if (!signature) {
      throw new Error("Signature is not valid");
    }

    console.log(signature.getValidationErrors().join(","))
    if (signature.getValidationErrors().length > 0) throw new Error("Transaction validation errors");
    if (!signature.verifySignature()) throw new Error("Signature is not valid");

    return signature;
  }

  // This code can be used to actually relay the transaction to the Ethereum network
  async relayTransaction(signedTransaction) {
    const serializedTx = bytesToHex(signedTransaction.serialize());
    const relayed = await this.web3.eth.sendSignedTransaction(serializedTx);
    return relayed.transactionHash
  }
}