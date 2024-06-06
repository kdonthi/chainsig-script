import {Web3} from "web3"
import { bytesToHex } from '@ethereumjs/util';
import {LegacyTransaction} from '@ethereumjs/tx';
import { deriveChildPublicKey, najPublicKeyStrToUncompressedHexPoint, uncompressedHexPointToEvmAddress } from './kdf.js';
import { Common } from '@ethereumjs/common'
import {ethers} from "ethers";
import BN from "bn.js";

const sepoliaContract = "0x6d454714c3Ac6D2deB4eA123254BD87DD14Fd729";

export class Ethereum {
  constructor(chain_rpc, chain_id) {
    this.web3 = new Web3(chain_rpc);
    this.chain_id = chain_id;
  }

  async deriveAddress(accountId, derivation_path) {
    const publicKey = await deriveChildPublicKey(najPublicKeyStrToUncompressedHexPoint(), accountId, derivation_path);
    const address = await uncompressedHexPointToEvmAddress(publicKey);
    return { publicKey: Buffer.from(publicKey, 'hex'), address };
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
      to: sepoliaContract,
      nonce: nonce,
      data: data,
      value: 0,
      chain: this.chain_id,
      gasLimit: 70000,
      gasPrice: gasPrice + 1000000000,
    };

    // Return the message hash
    const transaction = LegacyTransaction.fromTxData(transactionData, { common });
    const payload = transaction.getHashedMessageToSign();
    return { transaction, payload };
  }

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