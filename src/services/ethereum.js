import {eth, Web3} from "web3"
import { bytesToHex } from '@ethereumjs/util';
import {FeeMarketEIP1559Transaction, LegacyTransaction} from '@ethereumjs/tx';
import { deriveChildPublicKey, najPublicKeyStrToUncompressedHexPoint, uncompressedHexPointToEvmAddress } from './kdf.js';
import { Common } from '@ethereumjs/common'
import {ethers} from "ethers";
import BN from "bn.js";
import CryptoJS from 'crypto-js';
import * as string_decoder from "string_decoder";
import * as nearAPI from "near-api-js";

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

    const gasPrice = await this.getGasPrice();
    // Construct transaction
    const transactionData = {
      to: sender,
      nonce: nonce,
      data: data,
      value: 0,
      chain: this.chain_id,
      gasLimit: 22000,
      gasPrice: gasPrice,
    };

    // Return the message hash
    const transaction = LegacyTransaction.fromTxData(transactionData, { common });
    const payload = transaction.getHashedMessageToSign();
    return { transaction, payload };
  }

  // async createPayload(sender, receiver, amount) {
  //   const common = new Common({ chain: this.chain_id });
  //
  //   // Get the nonce & gas price
  //   const nonce = await this.web3.eth.getTransactionCount(sender);
  //   const { maxFeePerGas, maxPriorityFeePerGas } = await this.queryGasPrice();
  //
  //   // Construct transaction
  //   const transactionData = {
  //     nonce,
  //     gasLimit: 21000,
  //     maxFeePerGas,
  //     maxPriorityFeePerGas,
  //     to: receiver,
  //     value: BigInt(this.web3.utils.toWei(amount, "ether")),
  //     chain: this.chain_id,
  //   };
  //
  //   // Return the message hash
  //   const transaction = FeeMarketEIP1559Transaction.fromTxData(transactionData, { common });
  //   const payload = transaction.getHashedMessageToSign();
  //   return { transaction, payload };
  // }

  async getGasPrice() {
    // get current gas prices on Sepolia
    const {
      data: { rapid, fast, standard },
    } = await this.fetchJson(`https://sepolia.beaconcha.in/api/v1/execution/gasnow`);

    let gasPrice = Math.max(rapid, fast, standard);
    if (!gasPrice) {
      console.log('Unable to get gas price. Please refresh and try again.');
    }

    return Math.max(rapid, fast, standard);
  }
  async fetchJson (url, params = {}, noWarnings = false) {
    let res;
    try {
      res = await fetch(url, params);
      if (res.status !== 200) {
        if (noWarnings) return;
        console.log('res error');
        console.log(res);
        throw res;
      }
      return res.json();
    } catch (e) {
      if (noWarnings) return;
      console.log('fetchJson error', JSON.stringify(e));
    }
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
    return Array.from(byteArray)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
  }
  async requestSignatureToMPCNearContract(wallet, path, transaction, ethPayload, sender) {
    // Ask the MPC to sign the payload

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
      let args = {
        contractId: nearProxyContract,
        method: 'sign',
        args: { payload: payload, path: path, key_version: 0 },
        gas: new BN('300000000000000'),
        attachedDeposit: '1',
      }

      // let serializedArgs = JSON.stringify(args);
      // let hash = CryptoJS.SHA256(serializedArgs).toString(CryptoJS.enc.Hex);
      // console.log("args hash", hash);

      const [big_r, big_s] = await wallet.callMethod(args);

      // reconstruct the signature
      const r = Buffer.from(big_r.substring(2), 'hex');
      const s = Buffer.from(big_s, 'hex');

      const candidates = [0n, 1n].map((v) => transaction.addSignature(v, r, s));
      const signature = candidates.find((c) => c.getSenderAddress().toString().toLowerCase() === sender.toLowerCase());

      candidates.forEach((c) => {
        console.log(`Sender Address: ${c.getSenderAddress()}, Tx: ${c} JSON: ${c.toString()}`)
      })

      if (!signature) {
        throw new Error("Signature is not valid");
      }

      console.log(signature.getValidationErrors().join(","))
      if (signature.getValidationErrors().length > 0) throw new Error("Transaction validation errors");
      if (!signature.verifySignature()) throw new Error("Signature is not valid");

      return signature;


      // console.log("Big R", big_r);
      // console.log("Big S", big_s);
      //
      // // reconstruct the signature
      // const r = Buffer.from(big_r.substring(2), 'hex');
      // const s = Buffer.from(big_s, 'hex');
      //
      // const candidates = [0n, 1n].map((v) => transaction.addSignature(v, r, s));
      // // const signature = candidates.find((c) => c.getSenderAddress().toString().toLowerCase() === sender.toLowerCase());
      //
      // candidates.forEach((c) => {
      //   console.log(`Sender Address: ${c.getSenderAddress()}, Tx: ${c} JSON: ${c.toJSON()}`)
      // })

      // if (!signature) {
      //   throw new Error("Signature is not valid");
      // }
      //
      // console.log(signature.getValidationErrors().join(","))
      // if (signature.getValidationErrors().length > 0) throw new Error("Transaction validation errors");
      // if (!signature.verifySignature()) throw new Error("Signature is not valid");

      // return candidates[0];
    } catch (e) {
      throw Error(`error when functionCall: ${e}`);
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
    candidates.forEach((c) => {
      console.log(`Transaction sender: ${c.getSenderAddress()}`)
    })
    if (!signature) {
      throw new Error("Signature is not valid");
    }

    console.log(signature.getValidationErrors().join(","))
    if (signature.getValidationErrors().length > 0) throw new Error("Transaction validation errors");
    if (!signature.verifySignature()) throw new Error("Signature is not valid");

    return signature;
  }

  async sign(wallet, mpc_contract, transaction, ethPayload, path, sender) {
    const payload = Array.from(ethPayload.reverse());
    const args = {
      path: path,
      key_version: 0,
      payload: payload,
    };

    console.log(
        'sign payload',
        payload.length > 200 ? payload.length : payload.toString(),
    );
    console.log('with path', path);
    console.log('this may take approx. 30 seconds to complete');

    let big_r, big_s;
    try {
      [big_r, big_s] = await wallet.callMethod({
        contractId: mpc_contract,
        method: 'sign',
        args: args,
        gas: new BN('300000000000000'),
      });
    } catch (e) {
      let message = `error signing: ${e.message}`;
      throw new Error(message);
    }

    // parse result into signature values we need r, s but we don't need first 2 bytes of r (y-parity)
    // reconstruct the signature
    const r = Buffer.from(big_r.substring(2), 'hex');
    const s = Buffer.from(big_s, 'hex');

    const candidates = [27n, 28n, 22310257n, 22310258n].map((v) => transaction.addSignature(v, r, s));
    const signature = candidates.find((c) => c.getSenderAddress().toString().toLowerCase() === sender.toLowerCase());
    candidates.forEach((c) => {
      console.log(`Transaction sender: ${c.getSenderAddress()}`)
    })
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